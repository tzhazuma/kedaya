/**
 * 找搭子 HTTP 仓储测试 —— 断言**契约形状**：
 * - 路由由 `@kedaya/contracts` 的模块注册表派生（不硬编码模块名）；
 * - 5 个动作名全部是契约 §11.2 已冻结的（`join` / `leave` / `close` / `decide` / `feedback`），
 *   三端不得自创；
 * - 写操作带 `Idempotency-Key`（契约 §11.3）；
 * - **游标原样透传**（契约 §11.10-E：客户端不得解析或构造）；
 * - 身份来自 Bearer token：`userId` **不**作为查询参数下发；
 * - 出站/入站数据都过 zod 校验，脏数据返回 INTERNAL 而不是静默通过。
 */
import { modulePath } from '@kedaya/contracts';
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';
import { describe, expect, it } from 'vitest';

import type { ApiClient, ApiRequest, ApiResult, RequestOptions } from '../api/client';
import { createBuddyHttpRepository } from './buddy.http';

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
      record({ path, method: 'POST', ...(body === undefined ? {} : { body }) }, options) as ApiResult<T>,
    patch: async <T>(path: string, body?: unknown, options?: RequestOptions) =>
      record({ path, method: 'PATCH', ...(body === undefined ? {} : { body }) }, options) as ApiResult<T>,
    put: async <T>(path: string, body?: unknown, options?: RequestOptions) =>
      record({ path, method: 'PUT', ...(body === undefined ? {} : { body }) }, options) as ApiResult<T>,
    del: async <T>(path: string, options?: RequestOptions) =>
      record({ path, method: 'DELETE' }, options) as ApiResult<T>,
    upload: async <T>(path: string, _form: FormData, options?: RequestOptions) =>
      record({ path, method: 'POST' }, options) as ApiResult<T>,
  };

  return { client, calls };
}

const ISO = '2026-10-17T02:00:00.000Z';
const STARTS_AT = '2026-10-24T06:00:00.000Z';

const POST_PAYLOAD = {
  id: 'bp-1',
  activity: 'sport',
  status: 'OPEN',
  title: '周六下午羽毛球，缺 2 人',
  description: '体育馆 3 号场。',
  location: '体育馆',
  startsAt: STARTS_AT,
  durationMin: 120,
  capacity: 4,
  joinedCount: 2,
  genderPreference: 'any',
  minSkillLevel: 'casual',
  tags: ['badminton'],
  creator: { id: 'u_4096', nickname: '球场老张', avatarUrl: null },
  createdAt: ISO,
  autoCloseAt: STARTS_AT,
};

const APPLICATION_PAYLOAD = {
  id: 'ba-1',
  postId: 'bp-1',
  applicantId: 'u_1024',
  applicantNickname: '鸭鸭先冲',
  status: 'PENDING',
  message: '我也常打',
  createdAt: ISO,
  decidedAt: null,
  decidedBy: null,
};

const DETAIL_PAYLOAD = {
  post: POST_PAYLOAD,
  applications: [APPLICATION_PAYLOAD],
  viewerApplication: APPLICATION_PAYLOAD,
  viewerIsCreator: false,
};

const PROFILE_PAYLOAD = {
  userId: 'u_1024',
  sections: ['academic', 'sport'],
  interestTags: ['self-study'],
  activityTags: ['badminton'],
  skillLevel: 'casual',
  availability: [
    { dow: 1, startMin: 480, endMin: 720 },
    { dow: 5, startMin: 1380, endMin: 60 },
  ],
  preferredAreas: ['图书馆'],
  department: '信息科学与技术学院',
  bio: null,
  matchEnabled: true,
  updatedAt: ISO,
};

const RECOMMENDATION_PAYLOAD = {
  items: [
    {
      post: POST_PAYLOAD,
      score: 0.723,
      reason: '同一个院系、共同兴趣 3 项',
      reasons: [
        { code: 'same-department', label: '同一个院系', weight: 0.4 },
        { code: 'shared-interests', label: '共同兴趣 3 项', weight: 0.3 },
      ],
    },
  ],
  nextCursor: null,
  matchMode: 'hash',
};

/* ------------------------------------------------------------------ *
 * 路由与动作名
 * ------------------------------------------------------------------ */

describe('路由由模块注册表派生（契约 §6.1）', () => {
  it('列表 / 详情 / 推荐 / 申请 / 资料路径都来自 modulePath("buddy", …)', async () => {
    const { client, calls } = createFakeClient(() => ok({}));
    const repository = createBuddyHttpRepository(client);

    await repository.listPosts({});
    await repository.postDetail('bp-1', 'u_1024');
    await repository.recommendations({ userId: 'u_1024', section: 'sport' });
    await repository.listMyApplications('u_1024');
    await repository.getProfile('u_1024');

    expect(calls.map((call) => call.path)).toEqual([
      `/${modulePath('buddy', 'items')}`,
      `/${modulePath('buddy', 'items')}/bp-1`,
      `/${modulePath('buddy', 'recommendations')}`,
      `/${modulePath('buddy', 'applications')}`,
      `/${modulePath('buddy', 'profile')}`,
    ]);
  });

  it('5 个写动作只用契约 §11.2 已冻结的 action 名', async () => {
    const { client, calls } = createFakeClient(() => ok({}));
    const repository = createBuddyHttpRepository(client);

    await repository.join({ postId: 'bp-1', applicant: { id: 'u_1024', nickname: '我', gender: 'female', skillLevel: 'casual' } });
    await repository.leave({ postId: 'bp-1', applicantId: 'u_1024' });
    await repository.close({ postId: 'bp-1', actorId: 'u_4096' });
    await repository.decide({ postId: 'bp-1', applicationId: 'ba-1', decision: 'ACCEPTED', actorId: 'u_4096' });
    await repository.feedback({ postId: 'bp-1', userId: 'u_1024', section: 'sport', action: 'like' });

    const items = modulePath('buddy', 'items');
    expect(calls.map((call) => call.path)).toEqual([
      `/${items}/bp-1/join`,
      `/${items}/bp-1/leave`,
      `/${items}/bp-1/close`,
      `/${items}/bp-1/decide`,
      `/${items}/bp-1/feedback`,
    ]);
    // 动作名不得自创
    const allowed = new Set(['join', 'leave', 'close', 'decide', 'feedback']);
    for (const call of calls) {
      const action = call.path.split('/').pop() as string;
      expect(allowed.has(action)).toBe(true);
    }
  });

  it('帖子 id 会被 URL 编码（防注入）', async () => {
    const { client, calls } = createFakeClient(() => ok({}));
    const repository = createBuddyHttpRepository(client);
    await repository.postDetail('bp/../admin', 'u_1024');
    expect(calls[0]?.path).toBe(`/${modulePath('buddy', 'items')}/bp%2F..%2Fadmin`);
  });
});

/* ------------------------------------------------------------------ *
 * 幂等键与请求体
 * ------------------------------------------------------------------ */

describe('写操作带 Idempotency-Key（契约 §11.3）', () => {
  it('未显式传键时自动生成；显式传入时原样使用', async () => {
    const { client, calls } = createFakeClient(() => ok(APPLICATION_PAYLOAD));
    const repository = createBuddyHttpRepository(client);

    await repository.join({
      postId: 'bp-1',
      applicant: { id: 'u_1024', nickname: '我', gender: 'female', skillLevel: 'casual' },
      idempotencyKey: 'fixed-key',
    });
    await repository.leave({ postId: 'bp-1', applicantId: 'u_1024' });

    expect(calls[0]?.idempotencyKey).toBe('fixed-key');
    expect(typeof calls[1]?.idempotencyKey).toBe('string');
    expect((calls[1]?.idempotencyKey ?? '').length).toBeGreaterThan(8);
  });

  it('GET 不带幂等键', async () => {
    const { client, calls } = createFakeClient(() => ok(RECOMMENDATION_PAYLOAD));
    const repository = createBuddyHttpRepository(client);
    await repository.recommendations({ userId: 'u_1024', section: 'sport' });
    expect(calls[0]?.idempotencyKey).toBeUndefined();
  });

  it('createPost 不下发 creator（身份来自 token，客户端不得自称发起人）', async () => {
    const { client, calls } = createFakeClient(() => ok(POST_PAYLOAD));
    const repository = createBuddyHttpRepository(client);

    await repository.createPost({
      activity: 'sport',
      title: '羽毛球',
      description: '体育馆',
      location: '体育馆',
      startsAt: STARTS_AT,
      durationMin: 120,
      capacity: 4,
      genderPreference: 'any',
      tags: ['badminton'],
      minSkillLevel: 'casual',
      creator: { id: 'u_1024', nickname: '鸭鸭先冲', avatarUrl: null },
      idempotencyKey: 'key-create',
    });

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('creator');
    expect(body).not.toHaveProperty('idempotencyKey');
    expect(body.tags).toEqual(['badminton']);
    expect(calls[0]?.idempotencyKey).toBe('key-create');
  });

  it('decide / feedback 的请求体形状与规格一致', async () => {
    const { client, calls } = createFakeClient((call) =>
      call.path.endsWith('decide') ? ok(DETAIL_PAYLOAD) : ok({
        userId: 'u_1024',
        targetPostId: 'bp-1',
        section: 'sport',
        action: 'like',
        createdAt: ISO,
      }),
    );
    const repository = createBuddyHttpRepository(client);

    await repository.decide({ postId: 'bp-1', applicationId: 'ba-1', decision: 'REJECTED', actorId: 'u_4096' });
    await repository.feedback({ postId: 'bp-1', userId: 'u_1024', section: 'sport', action: 'like' });

    expect(calls[0]?.body).toEqual({ applicationId: 'ba-1', decision: 'REJECTED' });
    expect(calls[1]?.body).toEqual({ section: 'sport', action: 'like' });
  });
});

/* ------------------------------------------------------------------ *
 * 查询参数：游标原样透传 + 身份不下发
 * ------------------------------------------------------------------ */

describe('查询参数（契约 §11.10-E / §5.7）', () => {
  it('游标原样透传，不做任何解析或改写', async () => {
    const cursor = 'eyJzIjoic3RhcnRzQXRfYXNjIiwiaSI6ImJwLTEifQ';
    const { client, calls } = createFakeClient(() => ok({ items: [], nextCursor: null }));
    const repository = createBuddyHttpRepository(client);

    await repository.listPosts({ cursor, limit: 4, section: 'sport', sort: 'createdAt_desc' });

    expect(calls[0]?.query?.cursor).toBe(cursor);
    expect(calls[0]?.query?.limit).toBe(4);
    expect(calls[0]?.query?.section).toBe('sport');
    expect(calls[0]?.query?.sort).toBe('createdAt_desc');
  });

  it('标签数组按逗号拼接（规格 §5.3）；空数组不下发', async () => {
    const { client, calls } = createFakeClient(() => ok({ items: [], nextCursor: null }));
    const repository = createBuddyHttpRepository(client);

    await repository.listPosts({ tags: ['badminton', 'running'] });
    await repository.listPosts({ tags: [] });

    expect(calls[0]?.query?.tags).toBe('badminton,running');
    expect(calls[1]?.query).not.toHaveProperty('tags');
  });

  it('recommendations 只下发 section / limit / cursor，**不**下发 userId（身份来自 token）', async () => {
    const { client, calls } = createFakeClient(() => ok(RECOMMENDATION_PAYLOAD));
    const repository = createBuddyHttpRepository(client);

    await repository.recommendations({ userId: 'u_1024', section: 'daily', limit: 5 });

    expect(calls[0]?.query).toEqual({ section: 'daily', limit: 5 });
    expect(calls[0]?.query).not.toHaveProperty('userId');
  });

  it('undefined 的查询参数不会被序列化成字符串 "undefined"', async () => {
    const { client, calls } = createFakeClient(() => ok({ items: [], nextCursor: null }));
    const repository = createBuddyHttpRepository(client);
    await repository.listPosts({});
    expect(calls[0]?.query).toEqual({});
  });
});

/* ------------------------------------------------------------------ *
 * 响应解析与错误
 * ------------------------------------------------------------------ */

describe('响应解析：zod 校验 + 错误透传', () => {
  it('脏数据 → INTERNAL（不静默通过）', async () => {
    const { client } = createFakeClient(() => ok({ ...POST_PAYLOAD, capacity: 1 }));
    const repository = createBuddyHttpRepository(client);
    const result = await repository.postDetail('bp-1', 'u_1024');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('INTERNAL');
    expect(result.error.message).toContain('冻结契约');
  });

  it('推荐响应里的 reasons 被解析出来（UI 需要它展示理由）', async () => {
    const { client } = createFakeClient(() => ok(RECOMMENDATION_PAYLOAD));
    const repository = createBuddyHttpRepository(client);
    const result = await repository.recommendations({ userId: 'u_1024', section: 'sport' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.matchMode).toBe('hash');
    expect(result.value.items[0]?.reasons.map((reason) => reason.label)).toEqual([
      '同一个院系',
      '共同兴趣 3 项',
    ]);
  });

  it('缺失 reasons 时回退为空数组（老后端兼容）', async () => {
    const { client } = createFakeClient(() =>
      ok({
        items: [{ post: POST_PAYLOAD, score: 0.5, reason: '有潜在匹配' }],
        nextCursor: null,
        matchMode: 'rule',
      }),
    );
    const repository = createBuddyHttpRepository(client);
    const result = await repository.recommendations({ userId: 'u_1024', section: 'sport' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.items[0]?.reasons).toEqual([]);
  });

  it('冻结错误码与 details.reason 原样透传', async () => {
    const { client } = createFakeClient(() =>
      err({
        code: 'CONFLICT',
        message: '名额已满',
        details: { reason: 'POST_FULL' },
      }),
    );
    const repository = createBuddyHttpRepository(client);
    const result = await repository.join({
      postId: 'bp-1',
      applicant: { id: 'u_1024', nickname: '我', gender: 'female', skillLevel: 'casual' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('CONFLICT');
    expect((result.error.details as { reason?: string }).reason).toBe('POST_FULL');
  });

  it('NOT_FOUND 详情：不区分"不存在"与"不可见"（契约 §2.1）', async () => {
    const { client } = createFakeClient(() => err({ code: 'NOT_FOUND', message: '资源不存在' }));
    const repository = createBuddyHttpRepository(client);
    const result = await repository.postDetail('bp-nope', 'u_1024');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

/* ------------------------------------------------------------------ *
 * 资料（单例资源）
 * ------------------------------------------------------------------ */

describe('匹配资料：GET / PUT / DELETE', () => {
  it('getProfile 解析出跨零点时段', async () => {
    const { client, calls } = createFakeClient(() => ok(PROFILE_PAYLOAD));
    const repository = createBuddyHttpRepository(client);
    const result = await repository.getProfile('u_1024');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.availability).toEqual([
      { dow: 1, startMin: 480, endMin: 720 },
      { dow: 5, startMin: 1380, endMin: 60 },
    ]);
    expect(calls[0]?.method).toBe('GET');
  });

  it('putProfile 用 PUT 并带上 matchEnabled（身份不下发）', async () => {
    const { client, calls } = createFakeClient(() => ok(PROFILE_PAYLOAD));
    const repository = createBuddyHttpRepository(client);

    await repository.putProfile({
      userId: 'u_1024',
      sections: ['sport'],
      interestTags: ['running'],
      activityTags: ['running'],
      skillLevel: 'regular',
      availability: [{ dow: 5, startMin: 1380, endMin: 60 }],
      preferredAreas: ['田径场'],
      department: null,
      bio: null,
      matchEnabled: true,
    });

    expect(calls[0]?.method).toBe('PUT');
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.matchEnabled).toBe(true);
    expect(body).not.toHaveProperty('userId');
    expect(calls[0]?.idempotencyKey).toBeTruthy();
  });

  it('deleteProfile 走 DELETE 并返回 deleted', async () => {
    const { client, calls } = createFakeClient(() => ok({ deleted: true }));
    const repository = createBuddyHttpRepository(client);
    const result = await repository.deleteProfile('u_1024');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toEqual({ deleted: true });
    expect(calls[0]?.method).toBe('DELETE');
  });

  it('listMyApplications 同时接受数组与分页信封', async () => {
    const asArray = createFakeClient(() => ok([APPLICATION_PAYLOAD]));
    const asPage = createFakeClient(() =>
      ok({ items: [APPLICATION_PAYLOAD], nextCursor: null }),
    );

    const first = await createBuddyHttpRepository(asArray.client).listMyApplications('u_1024');
    const second = await createBuddyHttpRepository(asPage.client).listMyApplications('u_1024');
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(first.value[0]?.id).toBe('ba-1');
    expect(second.value[0]?.id).toBe('ba-1');
  });

  it('我的申请列表脏数据 → INTERNAL', async () => {
    const { client } = createFakeClient(() => ok([{ id: 'ba-1' }]));
    const repository = createBuddyHttpRepository(client);
    const result = await repository.listMyApplications('u_1024');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('INTERNAL');
  });
});
