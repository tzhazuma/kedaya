import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  API_BASE_PATH,
  IDEMPOTENCY_HEADER,
  TRACE_HEADER,
  type ContactAccessAuditWire,
  type ContactEntryWire,
  type ContactExchangeRequestWire,
  type ExchangedContactsWire,
  type Page,
} from '@kedaya/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { signJwt } from '../../common/auth/jwt';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from '../../common/interceptors/envelope.interceptor';
import { TraceMiddleware } from '../../common/middleware/trace.middleware';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { ContactExchangeModule } from './contact-exchange.module';
import { createContactPglite, seedContactUser, type ContactPglite } from './testing/pglite';

/**
 * 联系方式交换（U8）· HTTP 端到端验收
 *
 * 真实装配：控制器 + AuthGuard + IdempotencyInterceptor + EnvelopeInterceptor +
 * 异常过滤器 + **真实仓储** + **真实 PostgreSQL（PGlite）+ 真实 PrismaClient**。
 *
 * 覆盖交付要求里的五条硬指标：
 *   · 未同意 → 拿不到（含脱敏）；
 *   · 撤销后立刻不可见；
 *   · 24h 限流生效；
 *   · 日志 / 审计里搜不到联系方式明文；
 *   · 响应里不含未授权条目。
 */

const JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-please-change-me-32-chars';
const ENC_KEY = process.env.CONTACT_EXCHANGE_ENC_KEY ?? 'c'.repeat(64);
const RATE_LIMIT = '3';

interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: { code: string; message: string; details?: unknown };
  traceId: string;
}

interface UserSession {
  id: string;
  token: string;
}

let ctx: ContactPglite;
let app: NestExpressApplication;
let baseUrl: string;
let userSeq = 0;
let keySeq = 0;

function nextKey(prefix = 'cx'): string {
  keySeq += 1;
  return `${prefix}-${keySeq}-${Date.now()}`;
}

async function makeUser(prefix = 'cx'): Promise<UserSession> {
  userSeq += 1;
  const id = `${prefix}-user-${userSeq}`;
  await seedContactUser(ctx.prisma, id);
  return { id, token: signJwt(id, 'access', JWT_SECRET, 900) };
}

interface CallOptions {
  method?: string;
  token?: string;
  body?: unknown;
  key?: string;
}

async function call<T>(
  path: string,
  options: CallOptions = {},
): Promise<{ status: number; body: Envelope<T>; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.key) headers[IDEMPOTENCY_HEADER] = options.key;

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const body = (await response.json()) as Envelope<T>;
  return { status: response.status, body, headers: response.headers };
}

async function createEntry(
  session: UserSession,
  kind: 'wechat' | 'phone' | 'email' | 'qq',
  value: string,
  shared = false,
): Promise<ContactEntryWire> {
  const response = await call<ContactEntryWire>('/contacts', {
    method: 'POST',
    token: session.token,
    key: nextKey('contact'),
    body: { kind, value, shared },
  });
  expect(response.status).toBe(201);
  expect(response.body.ok).toBe(true);
  return response.body.data;
}

async function apply(
  requester: UserSession,
  addressee: UserSession,
  overrides: Partial<{ contextModule: string; contextId: string; message: string }> = {},
): Promise<ContactExchangeRequestWire> {
  const response = await call<ContactExchangeRequestWire>('/requests', {
    method: 'POST',
    token: requester.token,
    key: nextKey('apply'),
    body: {
      addresseeId: addressee.id,
      contextModule: overrides.contextModule ?? 'buddy',
      contextId: overrides.contextId,
      message: overrides.message,
    },
  });
  expect(response.status).toBe(201);
  expect(response.body.ok).toBe(true);
  return response.body.data;
}

async function approve(addressee: UserSession, requestId: string): Promise<ContactExchangeRequestWire> {
  const response = await call<ContactExchangeRequestWire>(`/requests/${requestId}/approve`, {
    method: 'POST',
    token: addressee.token,
    key: nextKey('approve'),
  });
  expect(response.status).toBe(200);
  expect(response.body.ok).toBe(true);
  return response.body.data;
}

async function acceptedPair(): Promise<{
  requester: UserSession;
  addressee: UserSession;
  request: ContactExchangeRequestWire;
}> {
  const requester = await makeUser('requester');
  const addressee = await makeUser('addressee');
  const request = await apply(requester, addressee);
  const accepted = await approve(addressee, request.id);
  return { requester, addressee, request: accepted };
}

function buildProbeModule() {
  @Global()
  @Module({
    providers: [
      { provide: PrismaService, useValue: {} },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => {
            if (key === 'CONTACT_EXCHANGE_ENC_KEY') return ENC_KEY;
            if (key === 'CONTACT_EXCHANGE_RATE_LIMIT') return RATE_LIMIT;
            return undefined;
          },
        },
      },
    ],
    exports: [PrismaService, ConfigService],
  })
  class FakeInfraModule {}

  @Module({
    imports: [FakeInfraModule, ContactExchangeModule],
    providers: [
      TraceMiddleware,
      { provide: APP_PIPE, useValue: new ZodValidationPipe() },
      { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
    ],
  })
  class ContactExchangeProbeModule {}

  return ContactExchangeProbeModule;
}

describe('联系方式交换 · HTTP（真库 + 真实控制器 / 守卫 / 幂等 / 信封）', () => {
  beforeAll(async () => {
    ctx = await createContactPglite();

    const moduleRef = await Test.createTestingModule({ imports: [buildProbeModule()] })
      .overrideProvider(PrismaService)
      .useValue(ctx.prisma)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));
    const trace = app.get(TraceMiddleware);
    app.use((req: Request, res: Response, next: NextFunction) => trace.use(req, res, next));
    app.useLogger(false);

    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}${API_BASE_PATH}/contact-exchange`;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await ctx?.dispose();
  });

  /* ================================================================== *
   * 鉴权 / 幂等 / 信封
   * ================================================================== */

  it('未登录访问任何端点 → 401 UNAUTHENTICATED + 统一失败信封', async () => {
    const response = await call('/contacts');
    expect(response.status).toBe(401);
    expect(response.body.ok).toBe(false);
    expect(response.body.error?.code).toBe('UNAUTHENTICATED');
    expect(response.body.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get(TRACE_HEADER)).toBe(response.body.traceId);
  });

  it('POST 缺 Idempotency-Key → 400 VALIDATION_FAILED（契约 §11.3）', async () => {
    const user = await makeUser();
    const response = await call('/contacts', {
      method: 'POST',
      token: user.token,
      body: { kind: 'email', value: 'nokey@example.com' },
    });
    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('VALIDATION_FAILED');
    expect(response.body.error?.details).toMatchObject({ header: IDEMPOTENCY_HEADER });
  });

  it('同一 Idempotency-Key 重放返回同一结果，且不会重复落库', async () => {
    const user = await makeUser();
    const key = nextKey('idem');
    const body = { kind: 'email', value: 'idem@example.com' };

    const first = await call<ContactEntryWire>('/contacts', { method: 'POST', token: user.token, key, body });
    const second = await call<ContactEntryWire>('/contacts', { method: 'POST', token: user.token, key, body });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);

    const rows = await ctx.prisma.contactEntry.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
  });

  /* ================================================================== *
   * 我的联系方式 CRUD
   * ================================================================== */

  it('新增默认 shared=false；本人列表可见明文', async () => {
    const user = await makeUser();
    const created = await createEntry(user, 'email', 'default-off@example.com');
    expect(created.shared).toBe(false);

    const list = await call<Page<ContactEntryWire>>('/contacts', { token: user.token });
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0]).toMatchObject({
      id: created.id,
      value: 'default-off@example.com',
      shared: false,
    });
  });

  it('重复联系方式 → 409 CONFLICT（唯一指纹约束）', async () => {
    const user = await makeUser();
    await createEntry(user, 'email', 'dup@example.com');

    const response = await call('/contacts', {
      method: 'POST',
      token: user.token,
      key: nextKey('dup'),
      body: { kind: 'email', value: 'DUP@example.com' }, // 规范化后同值
    });
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe('CONFLICT');
  });

  it('非法手机号 → 400 VALIDATION_FAILED', async () => {
    const user = await makeUser();
    const response = await call('/contacts', {
      method: 'POST',
      token: user.token,
      key: nextKey('bad-phone'),
      body: { kind: 'phone', value: '12345' },
    });
    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('PATCH 可单独打开授权；null 可清空 label；只传 kind 被拒', async () => {
    const user = await makeUser();
    const created = await createEntry(user, 'wechat', 'wxpatched');

    const opened = await call<ContactEntryWire>(`/contacts/${created.id}`, {
      method: 'PATCH',
      token: user.token,
      body: { shared: true, label: '常用' },
    });
    expect(opened.status).toBe(200);
    expect(opened.body.data.shared).toBe(true);
    expect(opened.body.data.label).toBe('常用');

    const cleared = await call<ContactEntryWire>(`/contacts/${created.id}`, {
      method: 'PATCH',
      token: user.token,
      body: { label: null },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.label).toBeNull();

    const kindOnly = await call(`/contacts/${created.id}`, {
      method: 'PATCH',
      token: user.token,
      body: { kind: 'email' },
    });
    expect(kindOnly.status).toBe(400);
    expect(kindOnly.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('删除：非本人 404；本人删除后列表为空（硬删）', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const created = await createEntry(owner, 'qq', '12345678');

    const forbidden = await call(`/contacts/${created.id}`, { method: 'DELETE', token: other.token });
    expect(forbidden.status).toBe(404);

    const removed = await call(`/contacts/${created.id}`, { method: 'DELETE', token: owner.token });
    expect(removed.status).toBe(200);

    const list = await call<Page<ContactEntryWire>>('/contacts', { token: owner.token });
    expect(list.body.data.items).toEqual([]);
  });

  it('游标分页：limit=2 两页不重叠，nextCursor 可用', async () => {
    const user = await makeUser();
    await createEntry(user, 'wechat', 'wxpage1');
    await createEntry(user, 'email', 'page2@example.com');
    await createEntry(user, 'qq', '22345678');

    const first = await call<Page<ContactEntryWire>>('/contacts?limit=2', { token: user.token });
    expect(first.status).toBe(200);
    expect(first.body.data.items).toHaveLength(2);
    expect(first.body.data.nextCursor).toBeTruthy();

    const second = await call<Page<ContactEntryWire>>(
      `/contacts?limit=2&cursor=${encodeURIComponent(first.body.data.nextCursor as string)}`,
      { token: user.token },
    );
    expect(second.status).toBe(200);
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.nextCursor).toBeNull();

    const ids = new Set([
      ...first.body.data.items.map((item) => item.id),
      ...second.body.data.items.map((item) => item.id),
    ]);
    expect(ids.size).toBe(3);
  });

  /* ================================================================== *
   * 申请 / 同意 / 拒绝 / 撤销
   * ================================================================== */

  it('不能向自己发起；敏感模块不能作为上下文；附言夹带手机号被拒', async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    const self = await call('/requests', {
      method: 'POST',
      token: alice.token,
      key: nextKey('self'),
      body: { addresseeId: alice.id, contextModule: 'buddy' },
    });
    expect(self.status).toBe(400);
    expect(self.body.error?.code).toBe('VALIDATION_FAILED');

    const sensitive = await call('/requests', {
      method: 'POST',
      token: alice.token,
      key: nextKey('ctx'),
      body: { addresseeId: bob.id, contextModule: 'wellbeing' },
    });
    expect(sensitive.status).toBe(400);
    expect(sensitive.body.error?.code).toBe('VALIDATION_FAILED');

    const leaky = await call('/requests', {
      method: 'POST',
      token: alice.token,
      key: nextKey('leaky'),
      body: { addresseeId: bob.id, contextModule: 'buddy', message: '加我微信 wxalice01' },
    });
    expect(leaky.status).toBe(400);
    expect(leaky.body.error?.details).toMatchObject({ reason: 'CONTACT_INFO_IN_MESSAGE' });
  });

  it('申请详情只有关系元数据：不含联系方式 / 脱敏值 / 条目', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    await createEntry(bob, 'phone', '13900001111', true);

    const created = await apply(alice, bob);
    expect(created.status).toBe('PENDING');

    const detail = await call<ContactExchangeRequestWire>(`/requests/${created.id}`, {
      token: alice.token,
    });
    expect(detail.status).toBe(200);

    const dump = JSON.stringify(detail.body);
    expect(dump).not.toContain('13900001111');
    expect(dump).not.toContain('***');
    expect(dump).not.toContain('masked');
    expect(dump).not.toContain('entries');
    expect(dump).not.toContain('valueCipher');
    expect(detail.body.data).toMatchObject({
      id: created.id,
      requesterId: alice.id,
      addresseeId: bob.id,
      status: 'PENDING',
      contextModule: 'buddy',
    });
  });

  it('非当事人访问申请 → 404（不泄漏存在性）', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const outsider = await makeUser();
    const created = await apply(alice, bob);

    const response = await call(`/requests/${created.id}`, { token: outsider.token });
    expect(response.status).toBe(404);
    expect(response.body.error?.code).toBe('NOT_FOUND');
  });

  it('只有被申请人能同意：发起人尝试 → 403 FORBIDDEN', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const created = await apply(alice, bob);

    const response = await call(`/requests/${created.id}/approve`, {
      method: 'POST',
      token: alice.token,
      key: nextKey('self-approve'),
    });
    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe('FORBIDDEN');
  });

  it('被申请人同意 → ACCEPTED；重复申请 / 已有活跃申请 → 409', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const created = await apply(alice, bob);

    const duplicate = await call('/requests', {
      method: 'POST',
      token: alice.token,
      key: nextKey('dup-pending'),
      body: { addresseeId: bob.id, contextModule: 'buddy' },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error?.code).toBe('CONFLICT');

    const accepted = await approve(bob, created.id);
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.respondedAt).toBeTruthy();

    const again = await call('/requests', {
      method: 'POST',
      token: bob.token,
      key: nextKey('already'),
      body: { addresseeId: alice.id, contextModule: 'buddy' },
    });
    expect(again.status).toBe(409);
  });

  it('拒绝 → REJECTED；之后可以重新发起（活跃索引已释放）', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const created = await apply(alice, bob);

    const rejected = await call<ContactExchangeRequestWire>(`/requests/${created.id}/reject`, {
      method: 'POST',
      token: bob.token,
      key: nextKey('reject'),
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');

    const again = await apply(alice, bob);
    expect(again.status).toBe('PENDING');
  });

  it('PENDING 过期后不能同意，详情显示 EXPIRED', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const created = await apply(alice, bob);

    await ctx.prisma.contactExchangeRequest.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const response = await call(`/requests/${created.id}/approve`, {
      method: 'POST',
      token: bob.token,
      key: nextKey('expired-approve'),
    });
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe('CONFLICT');

    const detail = await call<ContactExchangeRequestWire>(`/requests/${created.id}`, {
      token: bob.token,
    });
    expect(detail.body.data.status).toBe('EXPIRED');
  });

  it('撤销：PENDING 时发起人可取消；ACCEPTED 时被申请人可解除', async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    const pending = await apply(alice, bob);
    const cancelled = await call<ContactExchangeRequestWire>(`/requests/${pending.id}/revoke`, {
      method: 'POST',
      token: alice.token,
      key: nextKey('cancel'),
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('REVOKED');

    const accepted = await acceptedPair();
    const revoked = await call<ContactExchangeRequestWire>(`/requests/${accepted.request.id}/revoke`, {
      method: 'POST',
      token: accepted.addressee.token,
      key: nextKey('revoke-accepted'),
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe('REVOKED');
  });

  /* ================================================================== *
   * 隐私核心：未同意 → 拿不到（含脱敏）
   * ================================================================== */

  it('未同意时读取 → 403 CONSENT_REQUIRED；响应里连脱敏值都没有', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    await createEntry(bob, 'phone', '13812345678', true);
    const request = await apply(alice, bob);

    const response = await call(`/requests/${request.id}/contacts`, { token: alice.token });
    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe('CONSENT_REQUIRED');

    const dump = JSON.stringify(response.body);
    expect(dump).not.toContain('13812345678');
    expect(dump).not.toContain('138****5678');
    expect(dump).not.toContain('***');
    expect(dump).not.toContain('masked');
    expect(dump).not.toContain('entries');
  });

  it('同意后只返回对方 shared=true 的条目；未授权条目绝不出现', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const sharedWechat = await createEntry(bob, 'wechat', 'wxbobshared', true);
    const unsharedPhone = await createEntry(bob, 'phone', '13700007777', false);
    const sharedEmail = await createEntry(bob, 'email', 'bob@example.com', true);

    const request = await apply(alice, bob);
    await approve(bob, request.id);

    const response = await call<ExchangedContactsWire>(`/requests/${request.id}/contacts`, {
      token: alice.token,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.counterpartyId).toBe(bob.id);

    const kinds = response.body.data.entries.map((item) => item.kind);
    expect(kinds.sort()).toEqual(['email', 'wechat']);

    const ids = response.body.data.entries.map((item) => item.id);
    expect(ids.sort()).toEqual([sharedEmail.id, sharedWechat.id].sort());
    expect(ids).not.toContain(unsharedPhone.id);

    const dump = JSON.stringify(response.body);
    expect(dump).not.toContain('13700007777');
    expect(dump).not.toContain('valueCipher');
    expect(dump).not.toContain('valueFingerprint');
    expect(dump).not.toContain('"shared"');
  });

  it('双方对等：被申请人也能读取申请人已授权的条目', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    await createEntry(alice, 'qq', '32345678', true);
    const request = await apply(alice, bob);
    await approve(bob, request.id);

    const response = await call<ExchangedContactsWire>(`/requests/${request.id}/contacts`, {
      token: bob.token,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.counterpartyId).toBe(alice.id);
    expect(response.body.data.entries).toHaveLength(1);
    expect(response.body.data.entries[0]?.value).toBe('32345678');
  });

  it('撤销单条授权后，对方**立刻**不可见（不需要重新申请）', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const wechat = await createEntry(bob, 'wechat', 'wxbobvisible', true);
    const email = await createEntry(bob, 'email', 'visible@example.com', true);

    const request = await apply(alice, bob);
    await approve(bob, request.id);

    const before = await call<ExchangedContactsWire>(`/requests/${request.id}/contacts`, {
      token: alice.token,
    });
    expect(before.body.data.entries).toHaveLength(2);

    await call(`/contacts/${wechat.id}`, {
      method: 'PATCH',
      token: bob.token,
      body: { shared: false },
    });

    const after = await call<ExchangedContactsWire>(`/requests/${request.id}/contacts`, {
      token: alice.token,
    });
    expect(after.body.data.entries.map((item) => item.id)).toEqual([email.id]);
  });

  it('删除条目后对方立刻不可见；删除不影响已建立的协议', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const entry = await createEntry(bob, 'email', 'delete-me@example.com', true);
    const request = await apply(alice, bob);
    await approve(bob, request.id);

    await call(`/contacts/${entry.id}`, { method: 'DELETE', token: bob.token });

    const response = await call<ExchangedContactsWire>(`/requests/${request.id}/contacts`, {
      token: alice.token,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.entries).toEqual([]);

    const detail = await call<ContactExchangeRequestWire>(`/requests/${request.id}`, {
      token: alice.token,
    });
    expect(detail.body.data.status).toBe('ACCEPTED');
  });

  it('撤销协议后对方**立刻**不可见', async () => {
    const { requester, addressee, request } = await acceptedPair();
    await createEntry(addressee, 'wechat', 'wxrevoked', true);

    const before = await call(`/requests/${request.id}/contacts`, { token: requester.token });
    expect(before.status).toBe(200);

    await call(`/requests/${request.id}/revoke`, {
      method: 'POST',
      token: requester.token,
      key: nextKey('revoke-before-view'),
    });

    const after = await call(`/requests/${request.id}/contacts`, { token: requester.token });
    expect(after.status).toBe(403);
    expect(after.body.error?.code).toBe('CONSENT_REQUIRED');
  });

  /* ================================================================== *
   * 审计
   * ================================================================== */

  it('查看联系方式写审计：谁、何时、看了谁；审计响应不含明文', async () => {
    const { requester, addressee, request } = await acceptedPair();
    await createEntry(addressee, 'phone', '13600006666', true);

    const viewed = await call<ExchangedContactsWire>(`/requests/${request.id}/contacts`, {
      token: requester.token,
    });
    expect(viewed.status).toBe(200);

    const inbound = await call<Page<ContactAccessAuditWire>>('/audit?direction=inbound', {
      token: addressee.token,
    });
    expect(inbound.status).toBe(200);
    expect(inbound.body.data.items).toHaveLength(1);
    expect(inbound.body.data.items[0]).toMatchObject({
      requestId: request.id,
      actorId: requester.id,
      subjectId: addressee.id,
      action: 'view_contacts',
      entryCount: 1,
    });
    expect(inbound.body.data.items[0]?.entryKinds).toContain('phone');

    const outbound = await call<Page<ContactAccessAuditWire>>('/audit?direction=outbound', {
      token: requester.token,
    });
    expect(outbound.body.data.items).toHaveLength(1);

    const dump = JSON.stringify(inbound.body) + JSON.stringify(outbound.body);
    expect(dump).not.toContain('13600006666');
    expect(dump).not.toContain('valueCipher');
    expect(dump).not.toContain('valueFingerprint');
  });

  it('审计只追加：条目删除后历史审计仍在，且不含明文', async () => {
    const { requester, addressee, request } = await acceptedPair();
    const entry = await createEntry(addressee, 'email', 'audit-keep@example.com', true);

    await call(`/requests/${request.id}/contacts`, { token: requester.token });
    await call(`/contacts/${entry.id}`, { method: 'DELETE', token: addressee.token });
    await call(`/requests/${request.id}/contacts`, { token: requester.token });

    const inbound = await call<Page<ContactAccessAuditWire>>('/audit', {
      token: addressee.token,
    });
    expect(inbound.body.data.items.length).toBeGreaterThanOrEqual(2);

    const dump = JSON.stringify(inbound.body);
    expect(dump).not.toContain('audit-keep@example.com');
  });

  /* ================================================================== *
   * 限流
   * ================================================================== */

  it('同一对用户 24h 第 4 次申请 → 429 RATE_LIMITED（同一对、双向计数）', async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    for (let index = 0; index < 3; index += 1) {
      const request = await apply(index % 2 === 0 ? alice : bob, index % 2 === 0 ? bob : alice);
      const rejected = await call(`/requests/${request.id}/reject`, {
        method: 'POST',
        token: (index % 2 === 0 ? bob : alice).token,
        key: nextKey('reject-rl'),
      });
      expect(rejected.status).toBe(200);
    }

    const blocked = await call('/requests', {
      method: 'POST',
      token: alice.token,
      key: nextKey('rate-limited'),
      body: { addresseeId: bob.id, contextModule: 'buddy' },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error?.code).toBe('RATE_LIMITED');
    expect(blocked.body.error?.details).toMatchObject({ limit: 3 });
  });

  it('限流按用户对隔离：A-B 达到上限后，A-C 仍可申请', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const carol = await makeUser();

    for (let index = 0; index < 3; index += 1) {
      const request = await apply(alice, bob);
      await call(`/requests/${request.id}/reject`, {
        method: 'POST',
        token: bob.token,
        key: nextKey('reject-isolation'),
      });
    }

    const blocked = await call('/requests', {
      method: 'POST',
      token: alice.token,
      key: nextKey('blocked-ab'),
      body: { addresseeId: bob.id, contextModule: 'buddy' },
    });
    expect(blocked.status).toBe(429);

    const allowed = await call('/requests', {
      method: 'POST',
      token: alice.token,
      key: nextKey('allowed-ac'),
      body: { addresseeId: carol.id, contextModule: 'buddy' },
    });
    expect(allowed.status).toBe(201);
  });

  /* ================================================================== *
   * 数据库级证据：密文 / 审计无明文
   * ================================================================== */

  it('数据库里 ContactEntry 只有密文与带密钥指纹，搜不到明文', async () => {
    const user = await makeUser();
    await createEntry(user, 'phone', '13500005555', true);

    const rows = await ctx.prisma.contactEntry.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.valueCipher.startsWith('v1.')).toBe(true);
    expect(rows[0]?.valueFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.valueFingerprint).not.toBe('13500005555');

    const raw = await ctx.db.query<Record<string, unknown>>('SELECT * FROM "ContactEntry"');
    const dump = JSON.stringify(raw.rows);
    expect(dump).not.toContain('13500005555');
  });

  it('数据库里 ContactAccessAudit 不含任何联系方式明文', async () => {
    const { requester, addressee, request } = await acceptedPair();
    await createEntry(addressee, 'wechat', 'wxauditraw', true);
    await call(`/requests/${request.id}/contacts`, { token: requester.token });

    const raw = await ctx.db.query<Record<string, unknown>>('SELECT * FROM "ContactAccessAudit"');
    const dump = JSON.stringify(raw.rows);
    expect(dump).not.toContain('wxauditraw');
    expect(dump).not.toContain('valueCipher');
  });
});
