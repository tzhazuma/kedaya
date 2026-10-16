import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { API_BASE_PATH, IDEMPOTENCY_HEADER, TRACE_HEADER } from '@kedaya/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { signJwt } from '../src/common/auth/jwt';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { IdempotencyStore } from '../src/common/idempotency/idempotency.store';
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor';
import { TraceMiddleware } from '../src/common/middleware/trace.middleware';
import { FacilityModule } from '../src/modules/facility/facility.module';
import { FacilityBookingService } from '../src/modules/facility/facility.service';
import { FaqModule } from '../src/modules/faq/faq.module';
import { FaqService } from '../src/modules/faq/faq.service';
import { ForumModule } from '../src/modules/forum/forum.module';
import { ForumService } from '../src/modules/forum/forum.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 装配 + **wire 契约**端到端验收（forum/faq 一起，真实控制器/守卫/拦截器/仓储，
 * 只把 Prisma 换成假客户端）。
 *
 * 两条目的：
 *   1. 证明 DI 图能被解析 —— forum/faq 的仓储用 `useExisting` 把一个类实例挂到
 *      多个 token 上，typecheck 看不见 DI。这里真实抓到过一个启动期缺陷：
 *      `IdempotencyStore` 原本把 TTL 写成构造参数，Nest 当成待注入的 `Number`，应用起不来。
 *   2. 钉死 Lead v1.2 裁决的 wire 形状：`boardId` / `keyword` / `/votes` / 大写状态。
 */

const JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-please-change-me-32-chars';
const USER_ID = 'user-wire';

const WIRE_POST = {
  id: 'post-1',
  boardId: 'board-1',
  authorId: null,
  anonHandle: 'anon_wire',
  title: '食堂推荐',
  body: '一食堂的牛肉面',
  status: 'published', // DB 里存小写也应被 DTO 归一化为大写
  tags: ['food'],
  replyCount: 0,
  likeCount: 0,
  pinnedAt: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-02T00:00:00.000Z'),
};

const WIRE_ENTRY = {
  id: 'faq-1',
  slug: 'faq-card',
  question: '校园卡如何充值？',
  answer: '在一卡通 App 里充值。',
  category: '校园卡',
  tags: ['校园卡'],
  status: 'PUBLISHED',
  helpfulCount: 0,
  unhelpfulCount: 0,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

const calls = {
  forumPostFindMany: vi.fn(),
  faqEntryFindMany: vi.fn(),
  voteCreate: vi.fn(),
};

interface FakeDelegate {
  findMany: (args?: unknown) => Promise<unknown[]>;
  findFirst: (args?: unknown) => Promise<unknown>;
  findUnique: (args?: unknown) => Promise<unknown>;
  create: (args?: { data?: unknown }) => Promise<unknown>;
  update: (args?: { where?: { id?: string }; data?: unknown }) => Promise<unknown>;
  updateMany: (args?: unknown) => Promise<{ count: number }>;
  delete: (args?: unknown) => Promise<unknown>;
  count: (args?: unknown) => Promise<number>;
  groupBy: (args?: unknown) => Promise<unknown[]>;
}

function fakeDelegate(): FakeDelegate {
  return {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    create: async (args) => ({ id: 'fake', ...(args?.data as object) }),
    update: async (args) => ({ id: args?.where?.id, ...(args?.data as object) }),
    updateMany: async () => ({ count: 0 }),
    delete: async () => ({}),
    count: async () => 0,
    groupBy: async () => [],
  };
}

const forumPost = fakeDelegate();
forumPost.findMany = async (args: unknown) => {
  calls.forumPostFindMany(args);
  return [WIRE_POST];
};

const faqEntry = fakeDelegate();
faqEntry.findMany = async (args: unknown) => {
  calls.faqEntryFindMany(args);
  return [WIRE_ENTRY];
};
faqEntry.findFirst = async () => WIRE_ENTRY;
faqEntry.findUnique = async () => WIRE_ENTRY;
faqEntry.update = async () => ({ ...WIRE_ENTRY, helpfulCount: 1 });

const faqHelpfulVote = fakeDelegate();
faqHelpfulVote.create = async (args) => {
  calls.voteCreate(args);
  return { id: 'vote-1', ...(args?.data as object) };
};

const fakePrisma = {
  forumPost,
  forumReply: fakeDelegate(),
  forumBoard: fakeDelegate(),
  forumReport: fakeDelegate(),
  faqEntry,
  faqHelpfulVote,
  faqTicket: fakeDelegate(),
  facilityBooking: fakeDelegate(),
  user: { findMany: async () => [{ id: USER_ID, displayName: '测试同学' }] },
  $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
};

@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: fakePrisma },
    {
      provide: ConfigService,
      useValue: {
        get: (key: string) => (key === 'ANON_HANDLE_SECRET' || key === 'JWT_SECRET' ? 'wiring-test-secret' : undefined),
      },
    },
  ],
  exports: [PrismaService, ConfigService],
})
class FakeInfraModule {}

@Module({
  imports: [FakeInfraModule, ForumModule, FaqModule, FacilityModule],
  providers: [
    TraceMiddleware,
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
class WiringProbeModule {}

describe('装配 + wire 契约：ForumModule + FaqModule + FacilityModule（真实控制器/仓储，仅 Prisma 是假的）', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WiringProbeModule] }).compile();

    // DI 图能被解析（含 useExisting 的仓储别名与控制器级拦截器）
    expect(moduleRef.get(ForumService)).toBeInstanceOf(ForumService);
    expect(moduleRef.get(FaqService)).toBeInstanceOf(FaqService);
    expect(moduleRef.get(FacilityBookingService)).toBeInstanceOf(FacilityBookingService);
    expect(moduleRef.get(IdempotencyStore)).toBeInstanceOf(IdempotencyStore);

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));
    const trace = app.get(TraceMiddleware);
    app.use((req: Request, res: Response, next: NextFunction) => trace.use(req, res, next));
    app.useLogger(false);

    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}${API_BASE_PATH}`;
    token = signJwt(USER_ID, 'access', JWT_SECRET, 900);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /forum/items?boardId=&keyword= ：参数真的进 where，DTO 是 wire 形状', async () => {
    const response = await fetch(`${baseUrl}/forum/items?boardId=board-1&keyword=食堂`);
    const body = (await response.json()) as {
      ok: boolean;
      data: { items: Array<Record<string, unknown>> };
      traceId: string;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get(TRACE_HEADER)).toBe(body.traceId);

    const where = (calls.forumPostFindMany.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> }).where;
    expect(where.boardId).toBe('board-1');
    expect(where.OR).toEqual([
      { title: { contains: '食堂', mode: 'insensitive' } },
      { body: { contains: '食堂', mode: 'insensitive' } },
    ]);

    const post = body.data.items[0]!;
    expect(post.boardId).toBe('board-1');
    expect(post.status).toBe('PUBLISHED'); // 大写 canonical
    expect(post.anonymous).toBe(true);
    expect(post.authorId).toBe('anon_wire'); // 匿名 handle，不是实名 id
    expect(post.authorNickname).toBe('匿名同学');
    expect(post.replyCount).toBe(0);
    expect(post.lastActivityAt).toBeTruthy();
  });

  it('GET /forum/items?board=<slug> 作为兼容别名同样生效', async () => {
    await fetch(`${baseUrl}/forum/items?board=board-1`);
    const where = (calls.forumPostFindMany.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> }).where;
    expect(where.boardId).toBe('board-1');
  });

  it('GET /faq/items?keyword= ：参数真的进 where，DTO 带 slug/status/两个计数', async () => {
    const response = await fetch(`${baseUrl}/faq/items?keyword=充值&category=校园卡`);
    const body = (await response.json()) as { ok: boolean; data: { items: Array<Record<string, unknown>> } };

    expect(response.status).toBe(200);
    const where = (calls.faqEntryFindMany.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> }).where;
    expect(where.category).toBe('校园卡');
    expect(where.OR).toHaveLength(3);
    expect(JSON.stringify(where.OR)).toContain('充值');

    const entry = body.data.items[0]!;
    expect(entry.slug).toBe('faq-card');
    expect(entry.status).toBe('PUBLISHED');
    expect(entry.helpfulCount).toBe(0);
    expect(entry.unhelpfulCount).toBe(0);
  });

  it('POST /faq/items/:slug/votes 是主路由：带 Idempotency-Key 成功且重试回放（只计一次）', async () => {
    const call = () =>
      fetch(`${baseUrl}/faq/items/faq-card/votes`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          [IDEMPOTENCY_HEADER]: 'wire-vote-key',
        },
        body: JSON.stringify({ value: 'helpful' }),
      });

    const first = (await (await call()).json()) as {
      ok: boolean;
      data: { id: string; slug: string; helpfulCount: number; counted: boolean };
    };
    const second = (await (await call()).json()) as { ok: boolean; data: { helpfulCount: number } };

    expect(first.ok).toBe(true);
    expect(first.data).toMatchObject({ id: 'faq-1', slug: 'faq-card', helpfulCount: 1, counted: true });
    expect(second.data.helpfulCount).toBe(1);
    expect(calls.voteCreate).toHaveBeenCalledTimes(1); // 第二次是回放，没有重复计票
  });

  it('POST /faq/items/:id/votes 缺 Idempotency-Key → 400（契约 §11.3）', async () => {
    const response = await fetch(`${baseUrl}/faq/items/faq-card/votes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ value: 'helpful' }),
    });
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('POST /faq/items/:id/helpful 作为兼容别名仍然可用', async () => {
    const response = await fetch(`${baseUrl}/faq/items/faq-card/helpful`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        [IDEMPOTENCY_HEADER]: 'wire-helpful-alias',
      },
      body: JSON.stringify({}),
    });
    const body = (await response.json()) as { ok: boolean; data: { helpfulCount: number } };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.helpfulCount).toBe(1);
  });

  it('POST /faq/tickets 未登录可提交，但缺 Idempotency-Key → VALIDATION_FAILED', async () => {
    const response = await fetch(`${baseUrl}/faq/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contact: 'a@shanghaitech.edu.cn', question: '校园卡怎么充值' }),
    });
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('GET /faq/suggestions?keyword= 公开可用（无需登录）', async () => {
    const response = await fetch(`${baseUrl}/faq/suggestions?keyword=校园卡`);
    const body = (await response.json()) as { ok: boolean; data: unknown[] };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
