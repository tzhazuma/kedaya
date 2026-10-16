import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { API_BASE_PATH, IDEMPOTENCY_HEADER, TRACE_HEADER } from '@kedaya/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { ROLE_PORT } from '../src/common/auth/role.port';
import { signJwt } from '../src/common/auth/jwt';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { IdempotencyStore } from '../src/common/idempotency/idempotency.store';
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor';
import { TraceMiddleware } from '../src/common/middleware/trace.middleware';
import {
  FORUM_BOARD_REPOSITORY,
  FORUM_POST_REPOSITORY,
  FORUM_REPORT_REPOSITORY,
  FORUM_USER_DIRECTORY,
  type CreateForumPostInput,
} from '../src/modules/forum/domain/forum.domain';
import { ForumController } from '../src/modules/forum/forum.controller';
import { ForumService } from '../src/modules/forum/forum.service';

/**
 * forum 的 **HTTP 层**验收（真实监听端口，走完整链路）：
 *   TraceMiddleware → Guard → Controller → IdempotencyInterceptor → EnvelopeInterceptor → Filter
 *
 * 这里刻意不接数据库（本机没有 PostgreSQL）：仓储用内存假实现，
 * 要证明的是三件契约级事实：
 *   1. 响应一定是 `{ ok, data, traceId }` 信封（契约 §6.1）；
 *   2. POST 缺 `Idempotency-Key` → `VALIDATION_FAILED`（契约 §11.3）；
 *   3. 带 key 的重试回放同一份 data，不重复执行副作用。
 */

const SECRET = process.env.JWT_SECRET ?? 'test-secret-please-change-me-32-chars';
const USER_ID = 'user-http-test';

const boards = new Map<string, Record<string, unknown>>([
  [
    'campus',
    {
      id: 'board-1',
      slug: 'campus',
      name: '校园',
      description: null,
      visibility: 'public',
      postCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
]);

const postRows: Record<string, unknown>[] = [];
let createCalls = 0;

const fakePosts = {
  list: vi.fn(),
  listFiltered: vi.fn(async () => ({ items: postRows, nextCursor: null })),
  create: vi.fn(async (input: CreateForumPostInput) => {
    createCalls += 1;
    const row = {
      ...input,
      replyCount: 0,
      likeCount: 0,
      pinnedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    postRows.push(row);
    return row;
  }),
  findById: vi.fn(async (id: string) => postRows.find((row) => row.id === id) ?? null),
  update: vi.fn(),
  remove: vi.fn(),
  addReply: vi.fn(),
  listReplies: vi.fn(),
  findReplyById: vi.fn(),
  updateReply: vi.fn(),
  adjustReplyCount: vi.fn(),
};

const fakeBoards = {
  listBoards: vi.fn(async () => ({ items: [...boards.values()], nextCursor: null })),
  findBoardByIdOrSlug: vi.fn(async (key: string) => boards.get(key) ?? null),
  createBoard: vi.fn(),
  adjustBoardPostCount: vi.fn(async () => undefined),
  latestPostAtByBoard: vi.fn(async () => new Map()),
};

const fakeReports = {
  createReport: vi.fn(),
  findReportByReporter: vi.fn(),
  countDistinctReporters: vi.fn(),
  listReports: vi.fn(),
  setReportStatus: vi.fn(),
};

@Module({
  controllers: [ForumController],
  providers: [
    ForumService,
    IdempotencyStore,
    TraceMiddleware,
    { provide: FORUM_POST_REPOSITORY, useValue: fakePosts },
    { provide: FORUM_BOARD_REPOSITORY, useValue: fakeBoards },
    { provide: FORUM_REPORT_REPOSITORY, useValue: fakeReports },
    { provide: FORUM_USER_DIRECTORY, useValue: { displayNamesFor: async () => new Map([[USER_ID, '测试同学']]) } },
    { provide: ROLE_PORT, useValue: { hasRole: async () => false } },
    {
      provide: ConfigService,
      useValue: {
        get: (key: string) => {
          if (key === 'ANON_HANDLE_SECRET') return SECRET;
          if (key === 'JWT_SECRET') return SECRET;
          return undefined;
        },
      },
    },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
class ForumProbeModule {}

describe('HTTP 集成：forum 路由 + 统一信封 + Idempotency-Key（契约 §6.1 / §11.3）', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ForumProbeModule] }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));

    const trace = app.get(TraceMiddleware);
    app.use((req: Request, res: Response, next: NextFunction) => trace.use(req, res, next));
    app.useLogger(false);

    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}${API_BASE_PATH}`;
    token = signJwt(USER_ID, 'access', SECRET, 900);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /forum/boards 返回成功信封 + traceId（且回写同名响应头）', async () => {
    const response = await fetch(`${baseUrl}/forum/boards`);
    const body = (await response.json()) as { ok: boolean; data: { items: unknown[] }; traceId: string };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(response.headers.get(TRACE_HEADER)).toBe(body.traceId);
  });

  it('POST /forum/items 缺 Idempotency-Key → 400 + VALIDATION_FAILED 失败信封', async () => {
    const response = await fetch(`${baseUrl}/forum/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ boardId: 'campus', title: '标题', body: '正文' }),
    });
    const body = (await response.json()) as { ok: boolean; error: { code: string }; traceId: string };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.traceId).toBeTruthy();
    expect(createCalls).toBe(0);
  });

  it('带 Idempotency-Key 的 POST 成功，重试回放同一份 data（副作用只发生一次）', async () => {
    const request = () =>
      fetch(`${baseUrl}/forum/items`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          [IDEMPOTENCY_HEADER]: 'http-test-key-1',
        },
        body: JSON.stringify({ boardId: 'campus', title: '匿名求助', body: '卡丢了', anonymous: true }),
      });

    const first = (await (await request()).json()) as {
      ok: boolean;
      data: { id: string; authorId: string; anonymous: boolean; status: string };
    };
    const second = (await (await request()).json()) as { ok: boolean; data: { id: string } };

    expect(first.ok).toBe(true);
    expect(second.data.id).toBe(first.data.id);
    expect(createCalls).toBe(1); // 第二次没有真正执行用例
    // 匿名：实名身份不落库，对外只给不透明 handle（契约 §9）
    expect(first.data.anonymous).toBe(true);
    expect(first.data.authorId.startsWith('anon_')).toBe(true);
    expect(first.data.authorId).not.toContain(USER_ID);
    expect(first.data.status).toBe('PUBLISHED'); // 大写 canonical
  });

  it('未登录 POST 被守卫拦下 → 401 UNAUTHENTICATED 信封', async () => {
    const response = await fetch(`${baseUrl}/forum/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [IDEMPOTENCY_HEADER]: 'http-test-key-2' },
      body: JSON.stringify({ boardId: 'campus', title: '标题', body: '正文' }),
    });
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('非法 query（status 不在枚举内）→ 400 VALIDATION_FAILED', async () => {
    const response = await fetch(`${baseUrl}/forum/items?status=archived`);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });
});
