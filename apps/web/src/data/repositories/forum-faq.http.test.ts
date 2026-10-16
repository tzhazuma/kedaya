/**
 * forum / faq HTTP 仓储测试 —— 断言**契约形状**：
 * - 路由由 `@kedaya/contracts` 的模块注册表派生（不硬编码模块名）
 * - 举报走已冻结的 action 名 `report`（契约 §11.2），faq 不自创 action
 * - 写操作带 `Idempotency-Key`（契约 §11.3）
 * - 出站/入站数据都过 zod 校验，脏数据返回 INTERNAL 而不是静默通过
 */
import { modulePath } from '@kedaya/contracts';
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';
import { describe, expect, it } from 'vitest';

// 注意：契约 §6.1 定义了 `ApiRequest`，但 `@kedaya/contracts` 目前**未导出**它
// （README「与冻结契约的偏差」第 1 条）；Web 侧在 data/api/client.ts 复刻了一份。
import type { ApiClient, ApiRequest, ApiResult, RequestOptions } from '../api/client';
import { createFaqHttpRepository } from './faq.http';
import { createForumHttpRepository } from './forum.http';

interface RecordedCall {
  method: ApiRequest['method'];
  path: string;
  query?: ApiRequest['query'];
  body?: unknown;
  idempotencyKey?: string;
}

function createFakeClient(handler: (call: RecordedCall) => Result<unknown, ApiError>): {
  client: ApiClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const record = (req: ApiRequest, options?: RequestOptions): Result<unknown, ApiError> => {
    const call: RecordedCall = {
      method: req.method,
      path: req.path,
      ...(req.query === undefined ? {} : { query: req.query }),
      ...(req.body === undefined ? {} : { body: req.body }),
      ...(options?.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
    };
    calls.push(call);
    return handler(call);
  };

  const client: ApiClient = {
    baseUrl: '/api/v1',
    request: async <T>(req: ApiRequest, options?: RequestOptions) =>
      record(req, options) as ApiResult<T>,
    get: async <T>(path: string, query?: ApiRequest['query'], options?: RequestOptions) =>
      record({ path, method: 'GET', ...(query ? { query } : {}) }, options) as ApiResult<T>,
    post: async <T>(path: string, body?: unknown, options?: RequestOptions) =>
      record(
        { path, method: 'POST', ...(body === undefined ? {} : { body }) },
        options,
      ) as ApiResult<T>,
    patch: async <T>(path: string, body?: unknown, options?: RequestOptions) =>
      record(
        { path, method: 'PATCH', ...(body === undefined ? {} : { body }) },
        options,
      ) as ApiResult<T>,
    put: async <T>(path: string, body?: unknown, options?: RequestOptions) =>
      record({ path, method: 'PUT', ...(body === undefined ? {} : { body }) }, options) as ApiResult<T>,
    del: async <T>(path: string, options?: RequestOptions) =>
      record({ path, method: 'DELETE' }, options) as ApiResult<T>,
    // forum / faq 不使用 multipart；仅为满足 `ApiClient` 形状（wildlife 照片上传在用）
    upload: async <T>(path: string, _form: FormData, options?: RequestOptions) =>
      record({ path, method: 'POST' }, options) as ApiResult<T>,
  };

  return { client, calls };
}

const ISO = '2026-10-16T10:00:00.000Z';

const POST_PAYLOAD = {
  id: 'fp-1',
  boardId: 'fb-01',
  title: '三食堂几点人最少？',
  body: '正文',
  status: 'PUBLISHED',
  anonymous: true,
  authorId: 'anon_deadbeef',
  authorNickname: '匿名同学',
  tags: ['食堂'],
  replyCount: 0,
  likeCount: 0,
  pinnedAt: null,
  createdAt: ISO,
  lastActivityAt: ISO,
};

const BOARD_PAYLOAD = {
  id: 'fb-01',
  slug: 'campus-life',
  name: '校园生活',
  visibility: 'public',
  postCount: 3,
  lastPostAt: null,
};

const REPLY_PAYLOAD = {
  id: 'fr-1',
  postId: 'fp-1',
  parentReplyId: null,
  body: '11 点前去不用排',
  status: 'PUBLISHED',
  anonymous: false,
  authorId: 'u_1024',
  authorNickname: '鸭鸭先冲',
  likeCount: 0,
  createdAt: ISO,
};

const REPORT_PAYLOAD = {
  id: 'frep-1',
  targetType: 'POST',
  targetId: 'fp-1',
  reason: 'spam',
  status: 'PENDING',
  reporterId: 'u_1024',
  anonymous: true,
  createdAt: ISO,
};

const ARTICLE_PAYLOAD = {
  id: 'faq-1',
  slug: 'login-cas-failed',
  question: '统一身份认证登录失败怎么办？',
  answer: '确认学校页面能登录。',
  category: 'account',
  status: 'PUBLISHED',
  helpfulCount: 42,
  unhelpfulCount: 3,
  updatedAt: ISO,
};

const TICKET_PAYLOAD = {
  id: 'ft-1',
  userId: 'u_1024',
  contact: 'yaya@shanghaitech.edu.cn',
  question: '课表显示需要绑定',
  status: 'OPEN',
  createdAt: ISO,
  updatedAt: ISO,
};

describe('forum HTTP 仓储（路由与契约形状）', () => {
  it('listBoards 走模块注册表派生的路径', async () => {
    const { client, calls } = createFakeClient(() => ok([BOARD_PAYLOAD]));
    const repository = createForumHttpRepository(client);

    const result = await repository.listBoards();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.slug).toBe('campus-life');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.path).toBe(`/${modulePath('forum', 'boards')}`);
    expect(calls[0]?.path).toBe('/forum/boards');
  });

  it('listPosts 把不透明游标**原样**放进 query（契约 §11.10-E：不解析 / 不构造）', async () => {
    const opaque = 'eyJvIjo0LCJ0IjoiMjAyNi0xMC0xNlQxMDowMDowMFoifQ==';
    const { client, calls } = createFakeClient(() =>
      ok({ items: [POST_PAYLOAD], nextCursor: opaque, total: 2 }),
    );
    const repository = createForumHttpRepository(client);

    const result = await repository.listPosts({ cursor: opaque, limit: 4 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.nextCursor).toBe(opaque);
    expect(calls[0]?.query).toEqual({ cursor: opaque, limit: 4 });
  });

  it('listPosts 透传游标 / 筛选参数，返回校验后的分页', async () => {
    const { client, calls } = createFakeClient(() =>
      ok({ items: [POST_PAYLOAD], nextCursor: 'c_1', total: 2 }),
    );
    const repository = createForumHttpRepository(client);

    const result = await repository.listPosts({
      cursor: 'c_0',
      limit: 4,
      boardId: 'fb-01',
      keyword: '食堂',
      includeGoverned: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nextCursor).toBe('c_1');
      expect(result.value.total).toBe(2);
      expect(result.value.items[0]?.anonymous).toBe(true);
    }
    expect(calls[0]?.path).toBe('/forum/items');
    expect(calls[0]?.query).toEqual({
      cursor: 'c_0',
      limit: 4,
      boardId: 'fb-01',
      keyword: '食堂',
      includeGoverned: false,
    });
  });

  it('postDetail / listReplies 使用 :id 与 replies 子集合', async () => {
    const { client, calls } = createFakeClient((call) =>
      call.path.endsWith('/replies')
        ? ok({ items: [REPLY_PAYLOAD], nextCursor: null, total: 1 })
        : ok({ post: POST_PAYLOAD, replies: [REPLY_PAYLOAD], repliesNextCursor: null }),
    );
    const repository = createForumHttpRepository(client);

    const detail = await repository.postDetail('fp-1');
    expect(detail.ok).toBe(true);
    if (detail.ok) expect(detail.value.replies[0]?.id).toBe('fr-1');

    const replies = await repository.listReplies({ postId: 'fp-1', limit: 10 });
    expect(replies.ok).toBe(true);

    expect(calls[0]?.path).toBe('/forum/items/fp-1');
    expect(calls[1]?.path).toBe('/forum/items/fp-1/replies');
    expect(calls[1]?.query).toEqual({ limit: 10 });
  });

  it('createPost 走 POST /forum/items，带 Idempotency-Key，且**不**把实名 id 传给后端', async () => {
    const { client, calls } = createFakeClient(() => ok(POST_PAYLOAD));
    const repository = createForumHttpRepository(client);

    const result = await repository.createPost({
      boardId: 'fb-01',
      title: '匿名吐槽',
      body: '正文',
      tags: ['快递'],
      anonymous: true,
      authorId: 'u_1024',
      authorNickname: '鸭鸭先冲',
      idempotencyKey: 'idem-forum-1',
    });
    expect(result.ok).toBe(true);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe('/forum/items');
    expect(calls[0]?.idempotencyKey).toBe('idem-forum-1');
    expect(calls[0]?.body).toEqual({
      boardId: 'fb-01',
      title: '匿名吐槽',
      body: '正文',
      tags: ['快递'],
      anonymous: true,
    });
    expect(JSON.stringify(calls[0]?.body)).not.toContain('u_1024');
  });

  it('createPost 未提供幂等键时自动生成一个非空键（契约 §11.3）', async () => {
    const { client, calls } = createFakeClient(() => ok(POST_PAYLOAD));
    const repository = createForumHttpRepository(client);

    await repository.createPost({
      boardId: 'fb-01',
      title: '标题',
      body: '正文',
      tags: [],
      anonymous: false,
      authorId: 'u_1024',
      authorNickname: '鸭鸭先冲',
    });
    expect(typeof calls[0]?.idempotencyKey).toBe('string');
    expect((calls[0]?.idempotencyKey ?? '').length).toBeGreaterThan(0);
  });

  it('createReply 走 :id/replies 子集合创建（不是自创 action）', async () => {
    const { client, calls } = createFakeClient(() => ok(REPLY_PAYLOAD));
    const repository = createForumHttpRepository(client);

    const result = await repository.createReply({
      postId: 'fp-1',
      body: '11 点前去不用排',
      anonymous: false,
      authorId: 'u_1024',
      authorNickname: '鸭鸭先冲',
      idempotencyKey: 'idem-reply-1',
    });
    expect(result.ok).toBe(true);
    expect(calls[0]?.path).toBe('/forum/items/fp-1/replies');
    expect(calls[0]?.body).toEqual({
      body: '11 点前去不用排',
      anonymous: false,
      parentReplyId: null,
    });
    expect(calls[0]?.idempotencyKey).toBe('idem-reply-1');
  });

  it('report 走已冻结的 action 名 report（契约 §11.2）', async () => {
    const { client, calls } = createFakeClient(() => ok(REPORT_PAYLOAD));
    const repository = createForumHttpRepository(client);

    const result = await repository.report({
      targetType: 'POST',
      targetId: 'fp-1',
      reason: 'spam',
      note: '广告',
      reporterId: 'u_1024',
      anonymous: true,
      idempotencyKey: 'idem-report-1',
    });
    expect(result.ok).toBe(true);
    expect(calls[0]?.path).toBe('/forum/items/fp-1/report');
    expect(calls[0]?.body).toEqual({ targetType: 'POST', reason: 'spam', note: '广告' });
  });

  it('后端返回脏数据 → INTERNAL（不静默通过）', async () => {
    const { client } = createFakeClient(() => ok({ ...POST_PAYLOAD, status: 'NOT_A_STATUS' }));
    const result = await createForumHttpRepository(client).postDetail('fp-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL');
      expect(result.error.message).toContain('不符合冻结契约');
    }
  });

  it('客户端错误码原样透传（UNAUTHENTICATED / NOT_FOUND 等）', async () => {
    const { client } = createFakeClient(() => err({ code: 'NOT_FOUND', message: '主题不存在' }));
    const result = await createForumHttpRepository(client).postDetail('fp-404');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toBe('主题不存在');
    }
  });
});

describe('faq HTTP 仓储（路由与契约形状）', () => {
  it('listArticles 走 /faq/items 并透传筛选参数', async () => {
    const { client, calls } = createFakeClient(() =>
      ok({ items: [ARTICLE_PAYLOAD], nextCursor: null, total: 1 }),
    );
    const repository = createFaqHttpRepository(client);

    const result = await repository.listArticles({
      cursor: 'c_0',
      limit: 5,
      category: 'account',
      keyword: '登录',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items[0]?.slug).toBe('login-cas-failed');
    expect(calls[0]?.path).toBe(`/${modulePath('faq', 'items')}`);
    expect(calls[0]?.path).toBe('/faq/items');
    expect(calls[0]?.query).toEqual({ cursor: 'c_0', limit: 5, category: 'account', keyword: '登录' });
  });

  it('voteHelpful 走 votes 子集合创建（faq 无冻结 action，不自创）', async () => {
    const { client, calls } = createFakeClient(() => ok({ ...ARTICLE_PAYLOAD, helpfulCount: 43 }));
    const repository = createFaqHttpRepository(client);

    const result = await repository.voteHelpful({
      slug: 'login-cas-failed',
      vote: 'helpful',
      userId: 'u_1024',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.helpfulCount).toBe(43);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe('/faq/items/login-cas-failed/votes');
    expect(calls[0]?.body).toEqual({ vote: 'helpful' });
    expect(calls[0]?.idempotencyKey).toContain('faq-vote-login-cas-failed-helpful');
  });

  it('撤回投票（vote=null）也会提交', async () => {
    const { client, calls } = createFakeClient(() => ok(ARTICLE_PAYLOAD));
    await createFaqHttpRepository(client).voteHelpful({
      slug: 'login-cas-failed',
      vote: null,
      userId: null,
    });
    expect(calls[0]?.body).toEqual({ vote: null });
    expect(calls[0]?.idempotencyKey).toContain('none');
  });

  it('listTickets / submitTicket 走 /faq/tickets', async () => {
    const { client, calls } = createFakeClient((call) =>
      call.method === 'GET'
        ? ok({ items: [TICKET_PAYLOAD], nextCursor: null, total: 1 })
        : ok(TICKET_PAYLOAD),
    );
    const repository = createFaqHttpRepository(client);

    const list = await repository.listTickets({ status: 'OPEN', limit: 3 });
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value.items[0]?.contact).toBe('yaya@shanghaitech.edu.cn');

    const submitted = await repository.submitTicket({
      contact: 'yaya@shanghaitech.edu.cn',
      question: '课表显示需要绑定',
      userId: 'u_1024',
      idempotencyKey: 'idem-ticket-1',
    });
    expect(submitted.ok).toBe(true);

    expect(calls[0]?.path).toBe('/faq/tickets');
    expect(calls[0]?.query).toEqual({ status: 'OPEN', limit: 3 });
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.path).toBe('/faq/tickets');
    expect(calls[1]?.body).toEqual({
      contact: 'yaya@shanghaitech.edu.cn',
      question: '课表显示需要绑定',
    });
    expect(calls[1]?.idempotencyKey).toBe('idem-ticket-1');
  });

  it('工单脏数据（缺 userId 字段）→ INTERNAL', async () => {
    const { client } = createFakeClient(() => ok({ ...TICKET_PAYLOAD, userId: undefined }));
    const result = await createFaqHttpRepository(client).listTickets({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INTERNAL');
  });

  it('后端错误原样透传（CONFLICT / VALIDATION_FAILED）', async () => {
    const { client } = createFakeClient(() => err({ code: 'CONFLICT', message: '该条目已归档，不能再投票' }));
    const result = await createFaqHttpRepository(client).voteHelpful({
      slug: 'deprecated-campus-card-page',
      vote: 'helpful',
      userId: 'u_1024',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CONFLICT');
  });
});
