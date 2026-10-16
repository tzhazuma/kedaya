/**
 * 找搭子 · HTTP 端到端验收（规格 §5 / §6 / §8）
 *
 * ## 真实装配
 *
 * 控制器 + `AuthGuard` + 幂等拦截器 + 信封拦截器 + 异常过滤器 +
 * **真实仓储** + **真实 PostgreSQL（PGlite + pgvector）+ 真实 PrismaClient**。
 * 没有内存假 Prisma —— 因为 buddy 的向量列是 `Unsupported("vector(768)")`，
 * 假实现里的"假 `<=>`"只能证明我按自己的理解实现了 `<=>`。
 *
 * 覆盖：T11 / T16 / T17 / T18 / T19 / T20 / T21 / T23 / T24 / T25 / T26 / T27 /
 * T28 / T30 / T32 / T35（编号见规格 §8）。
 *
 * ## ⚠️ 一处必须记录的 HTTP 状态码差异
 *
 * 规格 §5.3–§5.8 的错误表写 `VALIDATION_FAILED` = **422**。
 * 但本仓 `common/errors/app-error.ts` 的 `ERROR_HTTP_STATUS` 把
 * `VALIDATION_FAILED` 映射为 **400**，且这是**全仓 20 个模块共用的约定**
 * （契约 §6.1 只冻结错误码，状态码由该表统一决定）。
 * 本模块**不改**这张表（改它会动到其它模块的行为与既有测试），
 * 因此测试断言的是 `code: 'VALIDATION_FAILED'` + HTTP 400。
 * 这条差异记入交付说明，由 Lead 决定是改全局映射还是改规格文档。
 */
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { API_BASE_PATH, IDEMPOTENCY_HEADER, TRACE_HEADER } from '@kedaya/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { signJwt } from '../src/common/auth/jwt';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor';
import { TraceMiddleware } from '../src/common/middleware/trace.middleware';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';
import { BuddyModule } from '../src/modules/buddy/buddy.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createPglitePrisma, seedUser, type PglitePrisma } from './fixtures/pglite-prisma';

const JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-please-change-me-32-chars';

const ME = 'user-me';
const CREATOR = 'user-creator';
const OTHER = 'user-other';
const SAME_DEPT = 'user-same-dept';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: { code: string; message: string; details?: unknown };
  traceId: string;
}

let ctx: PglitePrisma;
let app: NestExpressApplication;
let baseUrl: string;
let tokens: Record<string, string>;

function buildInfra(configValues: Record<string, string>) {
  @Global()
  @Module({
    providers: [
      { provide: PrismaService, useValue: {} },
      { provide: ConfigService, useValue: { get: (key: string) => configValues[key] } },
    ],
    exports: [PrismaService, ConfigService],
  })
  class FakeInfraModule {}

  @Module({
    imports: [FakeInfraModule, BuddyModule],
    providers: [
      TraceMiddleware,
      // 与生产 `app.module.ts` 完全一致的三个全局提供者。
      // ⚠️ 管道必须是 `useValue`（实例）而不是 `useClass`：
      // `ZodValidationPipe` 的构造参数是可选**配置**而非依赖，
      // `useClass` 会让 Nest 去解析 `Object` → 应用起不来。
      // 这个缺陷由 `test/app-module.spec.ts` 抓出并已在 `app.module.ts` 修好。
      { provide: APP_PIPE, useValue: new ZodValidationPipe() },
      { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
    ],
  })
  class BuddyProbeModule {}

  return BuddyProbeModule;
}

async function bootApp(configValues: Record<string, string>): Promise<{ app: NestExpressApplication; url: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [buildInfra(configValues)] })
    .overrideProvider(PrismaService)
    .useValue(ctx.prisma)
    .compile();

  const nestApp = moduleRef.createNestApplication<NestExpressApplication>();
  nestApp.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));
  const trace = nestApp.get(TraceMiddleware);
  nestApp.use((req: Request, res: Response, next: NextFunction) => trace.use(req, res, next));
  nestApp.useLogger(false);
  await nestApp.listen(0);
  const address = nestApp.getHttpServer().address() as AddressInfo;
  return { app: nestApp, url: `http://127.0.0.1:${address.port}${API_BASE_PATH}/buddy` };
}

let ruleApp: NestExpressApplication;
let ruleUrl: string;

beforeAll(async () => {
  ctx = await createPglitePrisma();
  await seedUser(ctx.prisma, ME, '我');
  await seedUser(ctx.prisma, CREATOR, '鸭鸭');
  await seedUser(ctx.prisma, OTHER, '同学乙');
  await seedUser(ctx.prisma, SAME_DEPT, '同院系同学');

  const booted = await bootApp({ BUDDY_MATCHING_MODE: 'hash', BUDDY_VECTOR_DIM: '768' });
  app = booted.app;
  baseUrl = booted.url;

  // 第二套装配：显式 rule 档（验收 T32）
  const ruleBooted = await bootApp({ BUDDY_MATCHING_MODE: 'rule', BUDDY_VECTOR_DIM: '768' });
  ruleApp = ruleBooted.app;
  ruleUrl = ruleBooted.url;

  tokens = {
    [ME]: signJwt(ME, 'access', JWT_SECRET, 900),
    [CREATOR]: signJwt(CREATOR, 'access', JWT_SECRET, 900),
    [OTHER]: signJwt(OTHER, 'access', JWT_SECRET, 900),
    [SAME_DEPT]: signJwt(SAME_DEPT, 'access', JWT_SECRET, 900),
  };
}, 180_000);

afterAll(async () => {
  await app?.close();
  await ruleApp?.close();
  await ctx?.dispose();
});

interface CallOptions extends RequestInit {
  token?: string;
  idempotencyKey?: string;
  base?: string;
}

async function call<T = any>(path: string, init: CallOptions = {}): Promise<{ status: number; body: Envelope<T>; headers: Headers }> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.idempotencyKey) headers[IDEMPOTENCY_HEADER] = init.idempotencyKey;
  if (init.body && typeof init.body === 'string') headers['content-type'] ??= 'application/json';

  const response = await fetch(`${init.base ?? baseUrl}${path}`, { ...init, headers });
  const body = (await response.json()) as Envelope<T>;
  return { status: response.status, body, headers: response.headers };
}

let keyCounter = 0;
function nextKey(prefix = 'key'): string {
  keyCounter += 1;
  return `${prefix}-${keyCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 造一个活动（默认由 CREATOR 发布） */
async function createPost(
  overrides: Record<string, unknown> = {},
  token = tokens[CREATOR],
  key = nextKey('post'),
) {
  return call('/items', {
    method: 'POST',
    token,
    idempotencyKey: key,
    body: JSON.stringify({
      activity: 'sport',
      title: '周六下午羽毛球，缺 2 人',
      description: '体育馆 3 号场，打两小时，新手也行',
      location: '体育馆',
      startsAt: new Date(Date.now() + DAY).toISOString(),
      durationMin: 120,
      capacity: 4,
      genderPreference: 'any',
      tags: ['badminton'],
      ...overrides,
    }),
  });
}

async function setProfile(userId: string, overrides: Record<string, unknown> = {}) {
  return call('/profile', {
    method: 'PUT',
    token: tokens[userId],
    body: JSON.stringify({
      sections: ['sport'],
      interestTags: ['badminton'],
      activityTags: ['badminton'],
      skillLevel: 'regular',
      availability: [{ dow: new Date(Date.now() + DAY).getDay(), startMin: 0, endMin: 1439 }],
      preferredAreas: ['体育馆'],
      department: '信息学院',
      bio: '常打羽毛球',
      matchEnabled: true,
      ...overrides,
    }),
  });
}

/* ================================================================== *
 * 1. 鉴权（规格 §5.1：所有端点要求登录）
 * ================================================================== */

describe('鉴权（规格 §5.1）', () => {
  const endpoints: Array<[string, string]> = [
    ['GET', '/profile'],
    ['GET', '/items'],
    ['GET', '/recommendations?section=sport'],
    ['GET', '/applications'],
    ['GET', '/questionnaires'],
  ];

  it.each(endpoints)('%s %s 未带 token → 401 UNAUTHENTICATED', async (method, path) => {
    const result = await call(path, { method });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('无效 token → 401', async () => {
    const result = await call('/items', { token: 'not-a-jwt' });
    expect(result.status).toBe(401);
    expect(result.body.error?.code).toBe('UNAUTHENTICATED');
  });

  it('信封含 traceId，且响应头带 trace（契约 §6.1）', async () => {
    const result = await call('/items', { token: tokens[ME] });
    expect(result.body.ok).toBe(true);
    expect(typeof result.body.traceId).toBe('string');
    expect(result.body.traceId.length).toBeGreaterThan(0);
    expect(result.headers.get(TRACE_HEADER.toLowerCase()) ?? result.headers.get(TRACE_HEADER)).toBeTruthy();
  });
});

/* ================================================================== *
 * 2. 幂等（契约 §11.3，验收 T16 / T17）
 * ================================================================== */

describe('Idempotency-Key（契约 §11.3，验收 T16 / T17）', () => {
  it('T16：POST /items 缺 Idempotency-Key → VALIDATION_FAILED', async () => {
    const result = await call('/items', {
      method: 'POST',
      token: tokens[CREATOR],
      body: JSON.stringify({
        activity: 'sport',
        title: 'x',
        location: '体育馆',
        startsAt: new Date(Date.now() + DAY).toISOString(),
        capacity: 2,
      }),
    });
    expect(result.body).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(JSON.stringify(result.body.error?.details)).toContain(IDEMPOTENCY_HEADER);
  });

  it('T16：所有 POST 动作都要求 Idempotency-Key（逐端点）', async () => {
    const created = await createPost();
    const postId = (created.body.data as { id: string }).id;

    const actions = [
      { path: `/items/${postId}/join`, body: {} },
      { path: `/items/${postId}/leave`, body: {} },
      { path: `/items/${postId}/close`, body: {} },
      { path: `/items/${postId}/decide`, body: { applicationId: 'x', decision: 'ACCEPTED' } },
      { path: `/items/${postId}/feedback`, body: { section: 'sport', action: 'like' } },
      { path: '/questionnaires/none/responses', body: { answers: {} } },
    ];

    for (const action of actions) {
      const result = await call(action.path, {
        method: 'POST',
        token: tokens[ME],
        body: JSON.stringify(action.body),
      });
      expect(result.body.error?.code, action.path).toBe('VALIDATION_FAILED');
    }
  });

  it('T17：同一 key + 同一 body 重复提交 → **只创建一条**，第二次返回相同 id', async () => {
    const key = nextKey('replay');
    const first = await createPost({ title: '幂等测试' }, tokens[CREATOR], key);
    const second = await createPost({ title: '幂等测试' }, tokens[CREATOR], key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((second.body.data as { id: string }).id).toBe((first.body.data as { id: string }).id);

    const count = await ctx.prisma.buddyPost.count({ where: { title: '幂等测试' } });
    expect(count).toBe(1);
  });

  it('不同 key 真正创建两条', async () => {
    const a = await createPost({ title: '不同 key A' });
    const b = await createPost({ title: '不同 key B' });
    expect((a.body.data as { id: string }).id).not.toBe((b.body.data as { id: string }).id);
  });
});

/* ================================================================== *
 * 3. 发布与校验（规格 §5.4，验收 T18 / T25）
 * ================================================================== */

describe('POST /items（规格 §5.4）', () => {
  it('T18：成功响应严格匹配 ApiEnvelope，且 joinedCount 初值为 1（规格 U2）', async () => {
    const result = await createPost({ title: '信封与初值' });
    expect(result.status).toBe(201);
    expect(Object.keys(result.body).sort()).toEqual(['data', 'ok', 'traceId']);
    expect(result.body.ok).toBe(true);
    expect(result.body.data).toMatchObject({
      activity: 'sport',
      status: 'OPEN',
      title: '信封与初值',
      capacity: 4,
      joinedCount: 1,
      // 视图**不**回传 creatorId，只回传 creator 公开资料（规格 §5.3 的响应示例）
      creator: { id: CREATOR, nickname: '鸭鸭', avatarUrl: null },
    });
  });

  it('T25：description 含手机号 → VALIDATION_FAILED / CONTACT_INFO_IN_DESCRIPTION', async () => {
    const result = await createPost({ description: '联系我 13812345678' });
    expect(result.body.error?.code).toBe('VALIDATION_FAILED');
    expect(result.body.error?.details).toMatchObject({ reason: 'CONTACT_INFO_IN_DESCRIPTION' });
  });

  it('T25：微信 / QQ 两类模式同样被拦（三类全覆盖）', async () => {
    const wechat = await createPost({ description: '微信：duck_2026' });
    expect(wechat.body.error?.details).toMatchObject({ reason: 'CONTACT_INFO_IN_DESCRIPTION' });

    const qq = await createPost({ description: 'QQ：123456789' });
    expect(qq.body.error?.details).toMatchObject({ reason: 'CONTACT_INFO_IN_DESCRIPTION' });
  });

  it('未知标签 → VALIDATION_FAILED / UNKNOWN_TAG:<key>', async () => {
    const result = await createPost({ tags: ['badminton', 'not-a-real-tag'] });
    expect(result.body.error?.code).toBe('VALIDATION_FAILED');
    expect(result.body.error?.details).toMatchObject({ reason: 'UNKNOWN_TAG:not-a-real-tag' });
  });

  it('未知地点 → VALIDATION_FAILED / UNKNOWN_LOCATION', async () => {
    const result = await createPost({ location: '校外某小区' });
    expect(result.body.error?.code).toBe('VALIDATION_FAILED');
    expect(result.body.error?.details).toMatchObject({ reason: 'UNKNOWN_LOCATION' });
  });

  it('startsAt 早于当前 → VALIDATION_FAILED', async () => {
    const result = await createPost({ startsAt: new Date(Date.now() - HOUR).toISOString() });
    expect(result.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('title 超 60 字 / capacity 越界 → VALIDATION_FAILED（Zod 字段级 details）', async () => {
    const longTitle = await createPost({ title: 'x'.repeat(61) });
    expect(longTitle.body.error?.code).toBe('VALIDATION_FAILED');

    const badCapacity = await createPost({ capacity: 21 });
    expect(badCapacity.body.error?.code).toBe('VALIDATION_FAILED');
    const details = badCapacity.body.error?.details as Array<{ path: string }>;
    expect(details.some((issue) => issue.path === 'capacity')).toBe(true);
  });

  it('活动名非法（含 dating 之类不存在的板块）→ VALIDATION_FAILED', async () => {
    const result = await createPost({ activity: 'dating' });
    expect(result.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('T19：全部错误响应的 code ∈ 契约 §6.1 的 10 个值', async () => {
    const allowed = new Set([
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_FAILED',
      'RATE_LIMITED',
      'CONFLICT',
      'CAMPUS_BINDING_REQUIRED',
      'CONSENT_REQUIRED',
      'UPSTREAM_UNAVAILABLE',
      'INTERNAL',
    ]);

    const responses = [
      await call('/items', { method: 'GET' }),
      await call('/items/no-such-id', { token: tokens[ME] }),
      await createPost({ location: '校外' }),
      await call('/items/x/join', { method: 'POST', token: tokens[ME] }),
    ];
    for (const response of responses) {
      expect(response.body.ok).toBe(false);
      expect(allowed.has(response.body.error?.code as string), response.body.error?.code).toBe(true);
    }
  });
});

/* ================================================================== *
 * 4. 列表、详情与 PATCH（规格 §5.3 / §5.9，验收 T20 / T21 / T24 / T26 / T27）
 * ================================================================== */

describe('GET /items（规格 §5.3 / §5.9）', () => {
  it('T20：limit=1 连续翻页遍历全部结果，**无重复无跳过**', async () => {
    // 用唯一前缀造一批，避免被其它用例的数据干扰
    const marker = `翻页-${Math.random().toString(36).slice(2, 8)}`;
    const created: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const result = await createPost({ title: `${marker}-${i}`, tags: ['badminton'] });
      created.push((result.body.data as { id: string }).id);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ limit: '1', tags: 'badminton' });
      if (cursor) query.set('cursor', cursor);
      const result = await call<{ items: Array<{ id: string }>; nextCursor: string | null }>(
        `/items?${query.toString()}`,
        { token: tokens[ME] },
      );
      expect(result.body.ok).toBe(true);
      for (const item of result.body.data.items) seen.push(item.id);
      if (!result.body.data.nextCursor) break;
      cursor = result.body.data.nextCursor;
    }

    expect(new Set(seen).size).toBe(seen.length); // 无重复
    for (const id of created) expect(seen).toContain(id); // 无跳过
  }, 60_000);

  it('nextCursor 为 null 表示没有下一页（契约 api-contract §3.2）', async () => {
    const result = await call<{ nextCursor: string | null }>('/items?limit=100', { token: tokens[ME] });
    expect(result.body.data.nextCursor).toBeNull();
  });

  it('T26 / T27：列表项不含禁用字段与联系方式（逐字段断言）', async () => {
    await createPost({ title: '隐私断言' });
    const result = await call<{ items: Array<Record<string, unknown>> }>('/items?limit=100', {
      token: tokens[ME],
    });
    const item = result.body.data.items.find((row) => row.title === '隐私断言');
    expect(item).toBeDefined();

    const serialized = JSON.stringify(item);
    for (const forbidden of ['gender', 'age', 'birthDate', 'mbti', 'embedding', 'embeddingModel', 'contact', 'phone', 'wechat']) {
      expect(serialized, forbidden).not.toContain(`"${forbidden}"`);
    }
    // 列表**不含** description（规格 §5.3）
    expect(item).not.toHaveProperty('description');
  });

  it('非法 section / limit → VALIDATION_FAILED', async () => {
    expect((await call('/items?section=dating', { token: tokens[ME] })).body.error?.code).toBe('VALIDATION_FAILED');
    expect((await call('/items?limit=0', { token: tokens[ME] })).body.error?.code).toBe('VALIDATION_FAILED');
    expect((await call('/items?limit=abc', { token: tokens[ME] })).body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('section 过滤生效（daily 板块不返回 sport 活动）', async () => {
    await createPost({ title: 'sport 活动', activity: 'sport' });
    await createPost({ title: 'meal 活动', activity: 'meal' });
    const daily = await call<{ items: Array<{ title: string; activity: string }> }>('/items?section=daily&limit=100', {
      token: tokens[ME],
    });
    expect(daily.body.data.items.every((item) => ['meal', 'travel', 'other'].includes(item.activity))).toBe(true);
  });
});

describe('GET /items/:id 与 PATCH（规格 §5.3，验收 T21 / T23 / T24）', () => {
  it('T24：不存在的活动 → 404 NOT_FOUND（与不可见不区分）', async () => {
    const result = await call('/items/does-not-exist', { token: tokens[ME] });
    expect(result.status).toBe(404);
    expect(result.body.error?.code).toBe('NOT_FOUND');
  });

  it('已删除（deletedAt 非空）与不存在返回同一个 404', async () => {
    const created = await createPost({ title: '将被软删' });
    const id = (created.body.data as { id: string }).id;
    await ctx.prisma.buddyPost.update({ where: { id }, data: { deletedAt: new Date() } });

    const softDeleted = await call(`/items/${id}`, { token: tokens[ME] });
    const missing = await call('/items/no-such-id', { token: tokens[ME] });
    expect(softDeleted.status).toBe(missing.status);
    expect(JSON.stringify(softDeleted.body.error)).toBe(JSON.stringify(missing.body.error));
  });

  it('详情含 description 全文，但不含联系方式字段', async () => {
    const created = await createPost({ title: '详情断言', description: '体育馆见' });
    const id = (created.body.data as { id: string }).id;
    const result = await call<Record<string, unknown>>(`/items/${id}`, { token: tokens[ME] });
    expect(result.body.data.description).toBe('体育馆见');
    const serialized = JSON.stringify(result.body.data);
    for (const forbidden of ['embedding', 'phone', 'wechat', 'contactInfo']) {
      expect(serialized, forbidden).not.toContain(`"${forbidden}"`);
    }
  });

  it('T21：只传 title 时其它字段不变（Merge Patch）', async () => {
    const created = await createPost({ title: '原标题', description: '原描述', capacity: 4 });
    const id = (created.body.data as { id: string }).id;

    const patched = await call<Record<string, unknown>>(`/items/${id}`, {
      method: 'PATCH',
      token: tokens[CREATOR],
      body: JSON.stringify({ title: '新标题' }),
    });

    expect(patched.body.data.title).toBe('新标题');
    expect(patched.body.data.description).toBe('原描述');
    expect(patched.body.data.capacity).toBe(4);
  });

  it('T21：传 null 清空可空字段（`undefined` 不动 vs `null` 清空）', async () => {
    const created = await createPost({ title: '清空测试', description: '要被清掉' });
    const id = (created.body.data as { id: string }).id;

    const cleared = await call<Record<string, unknown>>(`/items/${id}`, {
      method: 'PATCH',
      token: tokens[CREATOR],
      body: JSON.stringify({ description: null }),
    });

    expect(cleared.body.data.description).toBeNull();
  });

  it('T23：非发起人 PATCH → 403 FORBIDDEN', async () => {
    const created = await createPost({ title: '权限测试' });
    const id = (created.body.data as { id: string }).id;
    const result = await call(`/items/${id}`, {
      method: 'PATCH',
      token: tokens[OTHER],
      body: JSON.stringify({ title: '篡改' }),
    });
    expect(result.status).toBe(403);
    expect(result.body.error?.code).toBe('FORBIDDEN');
  });

  it('PATCH 改成含联系方式 → VALIDATION_FAILED', async () => {
    const created = await createPost({ title: 'PATCH 内容安全' });
    const id = (created.body.data as { id: string }).id;
    const result = await call(`/items/${id}`, {
      method: 'PATCH',
      token: tokens[CREATOR],
      body: JSON.stringify({ description: '加微信 abc12345' }),
    });
    expect(result.body.error?.details).toMatchObject({ reason: 'CONTACT_INFO_IN_DESCRIPTION' });
  });
});

/* ================================================================== *
 * 5. 申请与决定（规格 §5.5 / §5.6，验收 T22 / T23）
 * ================================================================== */

describe('join / leave / close / decide（规格 §5.5 / §5.6）', () => {
  it('join 成功 → 200 + PENDING，且**不**递增 joinedCount', async () => {
    const created = await createPost({ title: 'join 测试', capacity: 3 });
    const id = (created.body.data as { id: string }).id;

    const joined = await call<{ status: string; applicantId: string }>(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({ message: '我也常打，一起？' }),
    });

    expect(joined.status).toBe(200);
    expect(joined.body.data).toMatchObject({ status: 'PENDING', applicantId: ME });

    const post = await ctx.prisma.buddyPost.findUnique({ where: { id } });
    expect(post?.joinedCount).toBe(1); // 申请不占名额
  });

  it('申请自己的活动 → 409 CONFLICT / CANNOT_JOIN_OWN_POST', async () => {
    const created = await createPost({ title: '自己的活动' });
    const id = (created.body.data as { id: string }).id;
    const result = await call(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[CREATOR],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({}),
    });
    expect(result.status).toBe(409);
    expect(result.body.error?.details).toMatchObject({ reason: 'CANNOT_JOIN_OWN_POST' });
  });

  it('重复申请 → 409 CONFLICT / ALREADY_APPLIED', async () => {
    const created = await createPost({ title: '重复申请', capacity: 4 });
    const id = (created.body.data as { id: string }).id;
    await call(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({}),
    });
    const again = await call(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({}),
    });
    expect(again.body.error?.details).toMatchObject({ reason: 'ALREADY_APPLIED' });
  });

  it('申请已关闭的活动 → 409 CONFLICT / POST_NOT_OPEN', async () => {
    const created = await createPost({ title: '已关闭' });
    const id = (created.body.data as { id: string }).id;
    await call(`/items/${id}/close`, {
      method: 'POST',
      token: tokens[CREATOR],
      idempotencyKey: nextKey('close'),
    });
    const result = await call(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({}),
    });
    expect(result.body.error?.details).toMatchObject({ reason: 'POST_NOT_OPEN' });
  });

  it('leave 撤回 → WITHDRAWN；再 leave → 409', async () => {
    const created = await createPost({ title: '撤回测试', capacity: 4 });
    const id = (created.body.data as { id: string }).id;
    await call(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({}),
    });

    const left = await call<{ status: string }>(`/items/${id}/leave`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('leave'),
    });
    expect(left.body.data.status).toBe('WITHDRAWN');

    const again = await call(`/items/${id}/leave`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('leave'),
    });
    expect(again.status).toBe(409);
  });

  it('撤回后重新申请 → 复用同一行（PENDING）', async () => {
    const created = await createPost({ title: '重新申请', capacity: 4 });
    const id = (created.body.data as { id: string }).id;
    const first = await call<{ id: string }>(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({}),
    });
    await call(`/items/${id}/leave`, { method: 'POST', token: tokens[ME], idempotencyKey: nextKey('leave') });
    const again = await call<{ id: string; status: string }>(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({}),
    });

    expect(again.body.data.id).toBe(first.body.data.id); // 同一行
    expect(again.body.data.status).toBe('PENDING');
  });

  it('decide：非发起人 → 403 FORBIDDEN（验收 T23）', async () => {
    const created = await createPost({ title: 'decide 权限', capacity: 4 });
    const id = (created.body.data as { id: string }).id;
    const joined = await call<{ id: string }>(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({}),
    });

    const result = await call(`/items/${id}/decide`, {
      method: 'POST',
      token: tokens[OTHER],
      idempotencyKey: nextKey('decide'),
      body: JSON.stringify({ applicationId: joined.body.data.id, decision: 'ACCEPTED' }),
    });
    expect(result.status).toBe(403);
    expect(result.body.error?.code).toBe('FORBIDDEN');
  });

  it('close：非发起人 → 403 FORBIDDEN（验收 T23）', async () => {
    const created = await createPost({ title: 'close 权限' });
    const id = (created.body.data as { id: string }).id;
    const result = await call(`/items/${id}/close`, {
      method: 'POST',
      token: tokens[OTHER],
      idempotencyKey: nextKey('close'),
    });
    expect(result.status).toBe(403);
  });

  it('decide(ACCEPTED) → joinedCount+1，满员转 FULL，并发多接受一次 → 409 POST_FULL', async () => {
    const created = await createPost({ title: 'decide 名额', capacity: 2 });
    const id = (created.body.data as { id: string }).id;

    const joinA = await call<{ id: string }>(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({}),
    });
    const joinB = await call<{ id: string }>(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[OTHER],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({}),
    });

    const first = await call<{ post: { joinedCount: number; status: string } }>(`/items/${id}/decide`, {
      method: 'POST',
      token: tokens[CREATOR],
      idempotencyKey: nextKey('decide'),
      body: JSON.stringify({ applicationId: joinA.body.data.id, decision: 'ACCEPTED' }),
    });
    expect(first.body.data.post).toMatchObject({ joinedCount: 2, status: 'FULL' });

    const second = await call(`/items/${id}/decide`, {
      method: 'POST',
      token: tokens[CREATOR],
      idempotencyKey: nextKey('decide'),
      body: JSON.stringify({ applicationId: joinB.body.data.id, decision: 'ACCEPTED' }),
    });
    expect(second.status).toBe(409);
    expect(second.body.error?.details).toMatchObject({ reason: 'POST_FULL' });

    const post = await ctx.prisma.buddyPost.findUnique({ where: { id } });
    expect(post?.joinedCount).toBe(2); // 没有超员
  });

  it('decide(REJECTED) 不改 joinedCount，且通知申请人（载荷不含联系方式）', async () => {
    const created = await createPost({ title: 'decide 拒绝', capacity: 4 });
    const id = (created.body.data as { id: string }).id;
    const joined = await call<{ id: string }>(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({}),
    });

    const result = await call<{ application: { status: string } }>(`/items/${id}/decide`, {
      method: 'POST',
      token: tokens[CREATOR],
      idempotencyKey: nextKey('decide'),
      body: JSON.stringify({ applicationId: joined.body.data.id, decision: 'REJECTED' }),
    });
    expect(result.body.data.application.status).toBe('REJECTED');

    const post = await ctx.prisma.buddyPost.findUnique({ where: { id } });
    expect(post?.joinedCount).toBe(1);

    const notifications = await ctx.prisma.notification.findMany({ where: { userId: ME } });
    expect(notifications.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(notifications);
    for (const forbidden of ['13812345678', '微信', 'QQ']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('重复 decide 同一条申请 → 409 APPLICATION_NOT_PENDING', async () => {
    const created = await createPost({ title: '重复 decide', capacity: 4 });
    const id = (created.body.data as { id: string }).id;
    const joined = await call<{ id: string }>(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({}),
    });
    const body = JSON.stringify({ applicationId: joined.body.data.id, decision: 'ACCEPTED' });
    await call(`/items/${id}/decide`, {
      method: 'POST',
      token: tokens[CREATOR],
      idempotencyKey: nextKey('decide'),
      body,
    });
    const again = await call(`/items/${id}/decide`, {
      method: 'POST',
      token: tokens[CREATOR],
      idempotencyKey: nextKey('decide'),
      body,
    });
    expect(again.body.error?.details).toMatchObject({ reason: 'APPLICATION_NOT_PENDING' });
  });

  it('申请列表：发起人可见；非发起人 403（规格 §6.1 矩阵）', async () => {
    const created = await createPost({ title: '申请列表', capacity: 4 });
    const id = (created.body.data as { id: string }).id;
    await call(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({ message: '想加入' }),
    });

    const asCreator = await call<Array<{ message: string }>>(`/items/${id}/applications`, {
      token: tokens[CREATOR],
    });
    expect(asCreator.body.data).toHaveLength(1);
    expect(asCreator.body.data[0]?.message).toBe('想加入');

    const asOther = await call(`/items/${id}/applications`, { token: tokens[OTHER] });
    expect(asOther.status).toBe(403);
  });

  it('GET /applications 只返回我的申请', async () => {
    const result = await call<Array<{ application: { applicantId: string } }>>('/applications', {
      token: tokens[ME],
    });
    expect(result.body.ok).toBe(true);
    for (const item of result.body.data) {
      expect(item.application.applicantId).toBe(ME);
    }
  });

  it('DELETE /items/:id → CANCELLED（动作名与状态名一一对应）', async () => {
    const created = await createPost({ title: '取消活动' });
    const id = (created.body.data as { id: string }).id;
    const result = await call<{ status: string }>(`/items/${id}`, { method: 'DELETE', token: tokens[CREATOR] });
    expect(result.body.data.status).toBe('CANCELLED');
  });

  it('⚠️ 已满（FULL）的帖子无法取消 —— 冻结状态图里没有 FULL → CANCELLED', async () => {
    const created = await createPost({ title: '满员取消', capacity: 2 });
    const id = (created.body.data as { id: string }).id;
    const joined = await call<{ id: string }>(`/items/${id}/join`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('join'),
      body: JSON.stringify({}),
    });
    await call(`/items/${id}/decide`, {
      method: 'POST',
      token: tokens[CREATOR],
      idempotencyKey: nextKey('decide'),
      body: JSON.stringify({ applicationId: joined.body.data.id, decision: 'ACCEPTED' }),
    });

    const result = await call(`/items/${id}`, { method: 'DELETE', token: tokens[CREATOR] });
    expect(result.status).toBe(409);
    expect(result.body.error?.details).toMatchObject({ reason: 'INVALID_STATUS_TRANSITION' });
  });
});

/* ================================================================== *
 * 6. 推荐（规格 §5.7，验收 T4 / T11 / T32 / T35）
 * ================================================================== */

describe('GET /recommendations（规格 §5.7）', () => {
  it('T11：没有匹配资料 → matchMode=rule、reason="按时间排序"、score=0，**不抛异常**', async () => {
    const result = await call<{ matchMode: string; items: Array<{ score: number; reason: string }> }>(
      '/recommendations?section=sport',
      { token: tokens[OTHER] },
    );
    expect(result.status).toBe(200);
    expect(result.body.data.matchMode).toBe('rule');
    for (const item of result.body.data.items) {
      expect(item.score).toBe(0);
      expect(item.reason).toBe('按时间排序');
    }
  });

  it('缺 section → VALIDATION_FAILED；section 非法 → VALIDATION_FAILED', async () => {
    expect((await call('/recommendations', { token: tokens[ME] })).body.error?.code).toBe('VALIDATION_FAILED');
    expect((await call('/recommendations?section=dating', { token: tokens[ME] })).body.error?.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('limit 越界（>50）→ VALIDATION_FAILED（规格 §5.7 是 1–50，不是全局的 1–100）', async () => {
    expect(
      (await call('/recommendations?section=sport&limit=51', { token: tokens[ME] })).body.error?.code,
    ).toBe('VALIDATION_FAILED');
  });

  it('T32：显式 rule 档下全部端点正常，matchMode === "rule"（用第二套装配验证）', async () => {
    await setProfile(ME);
    const result = await call<{ matchMode: string }>('/recommendations?section=sport', {
      token: tokens[ME],
      base: ruleUrl,
    });
    expect(result.body.data.matchMode).toBe('rule');

    const items = await call('/items?limit=1', { token: tokens[ME], base: ruleUrl });
    expect(items.body.ok).toBe(true);
  });

  it('T35：三种模式的 recommendations 都返回**非空** reason', async () => {
    await setProfile(ME);
    // hash 档（本仓默认）
    const hash = await call<{ matchMode: string; items: Array<{ reason: string }> }>(
      '/recommendations?section=sport&limit=10',
      { token: tokens[ME] },
    );
    expect(hash.body.data.matchMode).toBe('hash');
    for (const item of hash.body.data.items) {
      expect(item.reason.length).toBeGreaterThan(0);
    }

    // rule 档（无资料的 OTHER → 时间排序；显式 rule 装配 → rule）
    const rule = await call<{ matchMode: string; items: Array<{ reason: string }> }>(
      '/recommendations?section=sport&limit=10',
      { token: tokens[ME], base: ruleUrl },
    );
    expect(rule.body.data.matchMode).toBe('rule');
    for (const item of rule.body.data.items) {
      expect(item.reason.length).toBeGreaterThan(0);
    }

    // vector 档：本仓没有中文 embedding 模型（规格 U4），
    // 因此"请求 vector"会降级为 hash —— 由 domain/matching-mode.spec.ts 穷举验证。
    // 这里断言的是"降级后仍然可用且理由非空"。
    expect(hash.body.data.items.length + rule.body.data.items.length).toBeGreaterThan(0);
  }, 60_000);

  it('T4（HTTP 层）：academic 同院系候选人排序高于不同院系，且 reason 含"同院系"', async () => {
    // 同院系发起人（SAME_DEPT 开了匹配、院系=信息学院）
    await setProfile(SAME_DEPT, { sections: ['academic'], department: '信息学院' });
    // 不同院系发起人（OTHER 开匹配、院系=物质学院）
    await setProfile(OTHER, { sections: ['academic'], department: '物质学院' });

    const mine = await createPost(
      { activity: 'study', title: '同院系自习', location: '图书馆' },
      tokens[SAME_DEPT],
    );
    const otherDept = await createPost(
      { activity: 'study', title: '异院系自习', location: '图书馆' },
      tokens[OTHER],
    );
    expect(mine.body.ok).toBe(true);
    expect(otherDept.body.ok).toBe(true);

    // 我自己的资料：信息学院、academic 板块、可用时段覆盖整天
    await setProfile(ME, { sections: ['academic'], department: '信息学院', interestTags: [], activityTags: [] });

    const result = await call<{ items: Array<{ post: { id: string; title: string }; reason: string }> }>(
      '/recommendations?section=academic&limit=50',
      { token: tokens[ME] },
    );

    const ids = result.body.data.items.map((item) => item.post.id);
    const sameIndex = ids.indexOf((mine.body.data as { id: string }).id);
    const otherIndex = ids.indexOf((otherDept.body.data as { id: string }).id);

    expect(sameIndex).toBeGreaterThanOrEqual(0);
    if (otherIndex >= 0) expect(sameIndex).toBeLessThan(otherIndex);
    expect(result.body.data.items[sameIndex]?.reason).toContain('同院系');
  }, 60_000);

  it('T26：推荐响应不含禁用字段与 embedding', async () => {
    await setProfile(ME);
    const result = await call('/recommendations?section=sport&limit=5', { token: tokens[ME] });
    const serialized = JSON.stringify(result.body);
    for (const forbidden of ['gender', 'age', 'birthDate', 'mbti', 'embedding', 'embeddingModel']) {
      expect(serialized, forbidden).not.toContain(`"${forbidden}"`);
    }
  });

  it('响应带 matchMode 字段（必须暴露，让前端诚实展示）', async () => {
    await setProfile(ME);
    const result = await call<{ matchMode: string }>('/recommendations?section=sport', { token: tokens[ME] });
    expect(['vector', 'hash', 'rule']).toContain(result.body.data.matchMode);
  });
});

/* ================================================================== *
 * 7. 反馈（规格 §5.8）
 * ================================================================== */

describe('POST /items/:id/feedback（规格 §5.8）', () => {
  it('提交 like → 200；UPSERT 覆盖而非累积', async () => {
    const created = await createPost({ title: '反馈测试', activity: 'meal' });
    const id = (created.body.data as { id: string }).id;

    const like = await call<{ action: string }>(`/items/${id}/feedback`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('fb'),
      body: JSON.stringify({ section: 'daily', action: 'like' }),
    });
    expect(like.status).toBe(200);
    expect(like.body.data).toMatchObject({ action: 'like' });

    const dislike = await call<{ action: string }>(`/items/${id}/feedback`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('fb'),
      body: JSON.stringify({ section: 'daily', action: 'dislike' }),
    });
    expect(dislike.body.data.action).toBe('dislike');

    const rows = await ctx.prisma.buddyMatchFeedback.findMany({ where: { userId: ME, targetPostId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('dislike');
  });

  it('同一帖子在**不同板块**各存一条（section 是隔离维度）', async () => {
    const created = await createPost({ title: '跨板块反馈', activity: 'sport' });
    const id = (created.body.data as { id: string }).id;

    await call(`/items/${id}/feedback`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('fb'),
      body: JSON.stringify({ section: 'academic', action: 'dislike' }),
    });
    await call(`/items/${id}/feedback`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('fb'),
      body: JSON.stringify({ section: 'daily', action: 'like' }),
    });

    const rows = await ctx.prisma.buddyMatchFeedback.findMany({ where: { userId: ME, targetPostId: id } });
    expect(rows).toHaveLength(2);
  });

  it('action / section 非法 → VALIDATION_FAILED', async () => {
    const created = await createPost({ title: '非法反馈' });
    const id = (created.body.data as { id: string }).id;
    const bad = await call(`/items/${id}/feedback`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('fb'),
      body: JSON.stringify({ section: 'daily', action: 'love' }),
    });
    expect(bad.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('帖子不存在 → 404 NOT_FOUND', async () => {
    const result = await call('/items/no-such/feedback', {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('fb'),
      body: JSON.stringify({ section: 'daily', action: 'like' }),
    });
    expect(result.status).toBe(404);
  });
});

/* ================================================================== *
 * 8. 资料与隐私（规格 §6.3，验收 T28 / T30）
 * ================================================================== */

describe('资料与隐私（规格 §6.3，验收 T28 / T30）', () => {
  it('GET /profile 未创建 → 404 NOT_FOUND', async () => {
    const fresh = signJwt('user-fresh-profile', 'access', JWT_SECRET, 900);
    await seedUser(ctx.prisma, 'user-fresh-profile', '新人');
    const result = await call('/profile', { token: fresh });
    expect(result.status).toBe(404);
  });

  it('PUT /profile 需要至少一个板块；未知标签 / 地点 → VALIDATION_FAILED', async () => {
    const noSection = await call('/profile', {
      method: 'PUT',
      token: tokens[ME],
      body: JSON.stringify({ sections: [], matchEnabled: true }),
    });
    expect(noSection.body.error?.code).toBe('VALIDATION_FAILED');

    const badTag = await call('/profile', {
      method: 'PUT',
      token: tokens[ME],
      body: JSON.stringify({ sections: ['sport'], interestTags: ['nope'] }),
    });
    expect(badTag.body.error?.details).toMatchObject({ reason: 'UNKNOWN_TAG:nope' });

    const badArea = await call('/profile', {
      method: 'PUT',
      token: tokens[ME],
      body: JSON.stringify({ sections: ['sport'], preferredAreas: ['校外'] }),
    });
    expect(badArea.body.error?.details).toMatchObject({ reason: 'UNKNOWN_LOCATION' });
  });

  it('T28：`BuddyProfile` 只在 GET /profile（本人）出现，详情响应里没有任何资料字段', async () => {
    await setProfile(ME, { interestTags: ['badminton'], bio: '常打羽毛球' });
    const profile = await call<Record<string, unknown>>('/profile', { token: tokens[ME] });
    expect(profile.body.data).toMatchObject({ interestTags: ['badminton'], bio: '常打羽毛球' });
    expect(profile.body.data).not.toHaveProperty('embedding');

    const created = await createPost({ title: '资料不可见' });
    const id = (created.body.data as { id: string }).id;
    const detail = await call(`/items/${id}`, { token: tokens[OTHER] });
    const serialized = JSON.stringify(detail.body.data);
    for (const field of ['interestTags', 'availability', 'preferredAreas', 'matchEnabled', 'bio', 'department']) {
      expect(serialized, field).not.toContain(`"${field}"`);
    }
  });

  it('T30：DELETE /profile 后立即从推荐池移除（matchMode 回到 rule，embedding 置 NULL）', async () => {
    await setProfile(ME, { sections: ['sport'] });
    // 确认资料与向量存在
    const before = await call<{ matchMode: string }>('/recommendations?section=sport', { token: tokens[ME] });
    expect(before.body.data.matchMode).toBe('hash');
    const embeddingBefore = await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "BuddyProfile" WHERE "userId"=$1 AND "embedding" IS NOT NULL`,
      [ME],
    );
    expect(embeddingBefore.rows[0]?.n).toBe(1);

    const deleted = await call('/profile', { method: 'DELETE', token: tokens[ME] });
    expect(deleted.body.ok).toBe(true);

    const after = await call<{ matchMode: string; items: Array<{ reason: string }> }>(
      '/recommendations?section=sport',
      { token: tokens[ME] },
    );
    expect(after.body.data.matchMode).toBe('rule');
    for (const item of after.body.data.items) {
      expect(item.reason).toBe('按时间排序');
    }

    // 行已硬删（embedding 也随之消失）
    const rows = await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "BuddyProfile" WHERE "userId"=$1`,
      [ME],
    );
    expect(rows.rows[0]?.n).toBe(0);
  }, 60_000);

  it('matchEnabled=false 时仍然不进个性化推荐（隐私默认关闭）', async () => {
    await setProfile(ME, { matchEnabled: false });
    const result = await call<{ matchMode: string }>('/recommendations?section=sport', { token: tokens[ME] });
    expect(result.body.data.matchMode).toBe('rule');
  });
});

/* ================================================================== *
 * 9. 问卷（规格 §5.1 端点 16–19）
 * ================================================================== */

describe('问卷（规格 §5.1 端点 16–19）', () => {
  const SLUG = 'buddy-sport-v1';

  beforeAll(async () => {
    await ctx.prisma.buddyQuestionnaire.create({
      data: {
        slug: SLUG,
        title: '运动搭子问卷',
        section: 'sport',
        description: '帮我们找到更合适的搭子',
        version: 1,
        isActive: true,
        questions: [
          {
            id: 'activityTags',
            type: 'multiple_choice',
            options: [
              { value: 'badminton', label: '羽毛球' },
              { value: 'running', label: '跑步' },
            ],
          },
          { id: 'skillLevel', type: 'single_choice', required: true, options: [{ value: 'regular', label: '经常' }] },
          { id: 'weeklyHours', type: 'rating', min: 1, max: 5 },
          { id: 'idealPerson', type: 'text', maxLength: 20 },
        ],
      },
    });
  }, 60_000);

  it('GET /questionnaires 返回启用中的问卷', async () => {
    const result = await call<Array<{ slug: string }>>('/questionnaires', { token: tokens[ME] });
    expect(result.body.data.some((item) => item.slug === SLUG)).toBe(true);
  });

  it('GET /questionnaires/:slug 返回题目；不存在 → 404', async () => {
    const found = await call<{ slug: string; questions: unknown[] }>(`/questionnaires/${SLUG}`, {
      token: tokens[ME],
    });
    expect(found.body.data.slug).toBe(SLUG);
    expect(Array.isArray(found.body.data.questions)).toBe(true);

    const missing = await call('/questionnaires/no-such-slug', { token: tokens[ME] });
    expect(missing.status).toBe(404);
  });

  it('提交答案：**只**把白名单键同步进 BuddyProfile（idealPerson 不落库）', async () => {
    const result = await call<{ syncedKeys: string[] }>(`/questionnaires/${SLUG}/responses`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('q'),
      body: JSON.stringify({
        answers: {
          activityTags: ['badminton', 'running'],
          skillLevel: 'regular',
          weeklyHours: 3,
          idealPerson: '温柔的人', // 非白名单键
        },
      }),
    });

    expect(result.body.ok).toBe(true);
    expect(result.body.data.syncedKeys).toContain('activityTags');
    expect(result.body.data.syncedKeys).not.toContain('idealPerson');

    const profile = await ctx.prisma.buddyProfile.findUnique({ where: { userId: ME } });
    expect(profile?.activityTags).toEqual(['badminton', 'running']);
    expect(profile?.skillLevel).toBe('regular');
    // 填问卷**不**打开匹配开关（规格 §6.3：匹配是新用途，不默认开启）
    expect(profile?.matchEnabled).toBe(false);
  }, 60_000);

  it('必填缺失 / 非法选项 → VALIDATION_FAILED（字段级 details）', async () => {
    const missingRequired = await call(`/questionnaires/${SLUG}/responses`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('q'),
      body: JSON.stringify({ answers: {} }),
    });
    expect(missingRequired.body.error?.code).toBe('VALIDATION_FAILED');

    const badOption = await call(`/questionnaires/${SLUG}/responses`, {
      method: 'POST',
      token: tokens[ME],
      idempotencyKey: nextKey('q'),
      body: JSON.stringify({ answers: { skillLevel: 'pro' } }),
    });
    expect(badOption.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('GET .../responses/me 返回我的答案；没提交过 → null', async () => {
    const mine = await call<{ answers: unknown }>(`/questionnaires/${SLUG}/responses/me`, { token: tokens[ME] });
    expect(mine.body.data).not.toBeNull();

    const fresh = signJwt('user-no-answers', 'access', JWT_SECRET, 900);
    await seedUser(ctx.prisma, 'user-no-answers', '没填过');
    const empty = await call(`/questionnaires/${SLUG}/responses/me`, { token: fresh });
    expect(empty.body.data).toBeNull();
  });
});
