/**
 * 找搭子 mock 适配器测试（**服务端替身**的契约形状）。
 *
 * 覆盖验收里点名的另外两件事：
 * - **游标分页**（契约 §11.10-E：不透明复合游标，翻页不重不漏，切 sort 即失效）；
 * - **`explainMatch` 理由**（推荐里必须出现共享纯函数给出的中文理由，不是只有分数）。
 *
 * 还覆盖：硬过滤 F1–F7 逐条、`join` 不占名额、`decide` 才递增、反馈的**板块隔离**（验收 T6）、
 * 资料删除后立即移出推荐池（验收 T30）、幂等键（验收 T17）、故障演练与 reset。
 *
 * ⚠️ 时区假设：本机 TZ = Asia/Shanghai（与 `@kedaya/shared` 的默认 tz 一致），
 * fixture 的 `localAt` 用本机本地时间构造，因此断言是确定性的。
 */
import { describe, expect, it } from 'vitest';

import {
  sectionOf,
  type BuddyApplication,
  type BuddyMatchFeedback,
  type BuddyPost,
} from '@/domain/models/buddy';

import {
  createMockBuddyRepository,
  decodeBuddyCursor,
  decodeRecommendationCursor,
  encodeBuddyCursor,
  encodeRecommendationCursor,
  mmrRerank,
  type MockBuddyRepository,
} from './buddy.repository';
import { DEMO_BUDDY_USER_ID } from './fixtures/buddy';

const NOW = new Date('2026-10-17T05:00:00+08:00');

function makeRepo(
  overrides: Parameters<typeof createMockBuddyRepository>[0] = {},
): MockBuddyRepository {
  return createMockBuddyRepository({ now: () => NOW, latencyMs: 0, ...overrides });
}

/** 申请人：与演示会话一致（female / casual），但 id 可换 */
function applicant(id = DEMO_BUDDY_USER_ID, overrides: Record<string, unknown> = {}) {
  return {
    id,
    nickname: '鸭鸭先冲',
    gender: 'female' as const,
    skillLevel: 'casual' as const,
    ...overrides,
  };
}

function makePost(overrides: Partial<BuddyPost> = {}): BuddyPost {
  return {
    id: 'bp-test',
    activity: 'sport',
    status: 'OPEN',
    title: '测试活动',
    description: null,
    location: '体育馆',
    startsAt: '2026-10-21T14:00:00+08:00',
    durationMin: 120,
    capacity: 4,
    joinedCount: 1,
    genderPreference: 'any',
    minSkillLevel: null,
    tags: ['badminton'],
    creator: { id: 'u_4096', nickname: '球场老张', avatarUrl: null },
    createdAt: '2026-10-17T02:00:00.000Z',
    autoCloseAt: null,
    ...overrides,
  };
}

async function allPostIds(repo: MockBuddyRepository, limit = 100): Promise<string[]> {
  const result = await repo.listPosts({ limit });
  expect(result.ok).toBe(true);
  return result.ok ? result.value.items.map((post) => post.id) : [];
}

async function recommendationIds(
  repo: MockBuddyRepository,
  section: 'academic' | 'daily' | 'sport',
  userId = DEMO_BUDDY_USER_ID,
): Promise<string[]> {
  const result = await repo.recommendations({ userId, section });
  expect(result.ok).toBe(true);
  return result.ok ? result.value.items.map((item) => item.post.id) : [];
}

/* ------------------------------------------------------------------ *
 * 游标：不透明 + 复合（契约 §11.10-E）
 * ------------------------------------------------------------------ */

describe('游标是不透明的复合游标（契约 §11.10-E）', () => {
  it('encode/decode 往返一致，且编码结果里看不到原始 ISO 时间', () => {
    const cursor = encodeBuddyCursor('startsAt_asc', '2026-10-24T14:00:00.000Z', 'bp-1001');
    expect(cursor).not.toContain('2026');
    expect(cursor).not.toContain('bp-1001');
    expect(decodeBuddyCursor(cursor)).toEqual({
      s: 'startsAt_asc',
      k: '2026-10-24T14:00:00.000Z',
      i: 'bp-1001',
    });
  });

  it('无法解析的游标返回 null（调用方转成 VALIDATION_FAILED）', () => {
    expect(decodeBuddyCursor('!!!not-base64!!!')).toBeNull();
    expect(decodeBuddyCursor(btoa('{"s":"nope"}'))).toBeNull();
    expect(decodeBuddyCursor(btoa(JSON.stringify({ s: 'other_sort', k: 'x', i: 'y' })))).toBeNull();
  });

  it('推荐游标同样是不透明偏移量', () => {
    const cursor = encodeRecommendationCursor(4);
    expect(decodeRecommendationCursor(cursor)).toBe(4);
    expect(decodeRecommendationCursor('garbage')).toBeNull();
  });
});

describe('列表：游标分页不重不漏（硬要求）', () => {
  it('默认只给 OPEN 且未开始的活动，总数与单页一致', async () => {
    const repo = makeRepo();
    const all = await allPostIds(repo);
    expect(all).toHaveLength(10);
    const result = await repo.listPosts({ limit: 100 });
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.total).toBe(10);
    expect(result.value.nextCursor).toBeNull();
    for (const post of result.value.items) expect(post.status).toBe('OPEN');
  });

  it('limit=1 连续翻页能遍历全部结果且无重复无跳过', async () => {
    const repo = makeRepo();
    const expected = await allPostIds(repo);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 50; guard += 1) {
      const result = await repo.listPosts({ limit: 1, ...(cursor ? { cursor } : {}) });
      if (!result.ok) throw new Error('unreachable');
      seen.push(...result.value.items.map((post) => post.id));
      if (result.value.nextCursor === null) break;
      cursor = result.value.nextCursor;
    }

    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('limit=4 与 limit=1 得到同一个序列（游标与页大小无关）', async () => {
    const repo = makeRepo();
    const expected = await allPostIds(repo);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const result = await repo.listPosts({ limit: 4, ...(cursor ? { cursor } : {}) });
      if (!result.ok) throw new Error('unreachable');
      seen.push(...result.value.items.map((post) => post.id));
      if (result.value.nextCursor === null) break;
      cursor = result.value.nextCursor;
    }
    expect(seen).toEqual(expected);
  });

  it('createdAt_desc 排序也能翻页遍历（另一套复合游标）', async () => {
    const repo = makeRepo();
    const first = await repo.listPosts({ limit: 100, sort: 'createdAt_desc' });
    if (!first.ok) throw new Error('unreachable');
    const expected = first.value.items.map((post) => post.id);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 50; guard += 1) {
      const result = await repo.listPosts({
        limit: 2,
        sort: 'createdAt_desc',
        ...(cursor ? { cursor } : {}),
      });
      if (!result.ok) throw new Error('unreachable');
      seen.push(...result.value.items.map((post) => post.id));
      if (result.value.nextCursor === null) break;
      cursor = result.value.nextCursor;
    }
    expect(seen).toEqual(expected);
  });

  it('切换 sort 后旧游标失效 → VALIDATION_FAILED / INVALID_CURSOR', async () => {
    const repo = makeRepo();
    const first = await repo.listPosts({ limit: 1 });
    if (!first.ok) throw new Error('unreachable');
    const cursor = first.value.nextCursor;
    expect(cursor).not.toBeNull();

    const result = await repo.listPosts({
      limit: 1,
      sort: 'createdAt_desc',
      cursor: cursor as string,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect((result.error.details as { reason?: string }).reason).toBe('INVALID_CURSOR');
  });

  it('无法解析的游标 → VALIDATION_FAILED / INVALID_CURSOR', async () => {
    const repo = makeRepo();
    const result = await repo.listPosts({ cursor: 'not-a-cursor' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('游标指向已被筛掉的行时失效（筛选变化后游标不可复用）', async () => {
    const repo = makeRepo();
    // 取一条 daily 板块的游标，然后换到 sport 板块使用
    const daily = await repo.listPosts({ limit: 1, section: 'daily' });
    if (!daily.ok) throw new Error('unreachable');
    const cursor = daily.value.nextCursor as string;

    const result = await repo.listPosts({ limit: 1, section: 'academic', cursor });
    expect(result.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 过滤
 * ------------------------------------------------------------------ */

describe('列表过滤：板块 / 标签 / 时间 / 非 OPEN 状态', () => {
  it('板块过滤按 sectionOf(activity) 派生', async () => {
    const repo = makeRepo();
    const academic = await repo.listPosts({ limit: 100, section: 'academic' });
    const daily = await repo.listPosts({ limit: 100, section: 'daily' });
    const sport = await repo.listPosts({ limit: 100, section: 'sport' });
    if (!academic.ok || !daily.ok || !sport.ok) throw new Error('unreachable');

    expect(academic.value.items.map((p) => p.id)).toEqual(['bp-1002', 'bp-1013', 'bp-1009']);
    expect(daily.value.items.map((p) => p.id)).toEqual(['bp-1003', 'bp-1011', 'bp-1006']);
    expect(sport.value.items.map((p) => p.id)).toEqual([
      'bp-1012',
      'bp-1007',
      'bp-1004',
      'bp-1001',
    ]);
    for (const post of academic.value.items) expect(sectionOf(post.activity)).toBe('academic');
  });

  it('标签过滤：命中任一即返回', async () => {
    const repo = makeRepo();
    const result = await repo.listPosts({ limit: 100, tags: ['badminton'] });
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.items.map((p) => p.id)).toEqual(['bp-1001']);

    const multi = await repo.listPosts({ limit: 100, tags: ['badminton', 'english'] });
    if (!multi.ok) throw new Error('unreachable');
    expect(multi.value.items.map((p) => p.id).sort()).toEqual(['bp-1001', 'bp-1009']);
  });

  it('startsAfter 默认 now：已过期的活动不出现在列表里', async () => {
    const repo = makeRepo();
    const ids = await allPostIds(repo);
    expect(ids).not.toContain('bp-1010');
  });

  it('includeClosed 时能看到 FULL / CLOSED（并保留在列表里，不静默消失）', async () => {
    const repo = makeRepo();
    const result = await repo.listPosts({ limit: 100, includeClosed: true });
    if (!result.ok) throw new Error('unreachable');
    const ids = result.value.items.map((p) => p.id);
    expect(ids).toContain('bp-1005');
    expect(ids).toContain('bp-1008');
    expect(ids).toHaveLength(12);
  });

  it('显式把 startsAfter 放到过去 + includeClosed 时能看到已过期的活动', async () => {
    const repo = makeRepo();
    const result = await repo.listPosts({
      limit: 100,
      includeClosed: true,
      startsAfter: '2026-10-01T00:00:00+08:00',
    });
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.items.map((p) => p.id)).toContain('bp-1010');
  });
});

/* ------------------------------------------------------------------ *
 * join / leave / decide / close（契约 §11.2 冻结动作名）
 * ------------------------------------------------------------------ */

describe('join：是**申请**，不占名额（规格 §5.5）', () => {
  it('申请成功返回 PENDING，且 joinedCount 不变', async () => {
    const repo = makeRepo();
    const before = await repo.postDetail('bp-1001', DEMO_BUDDY_USER_ID);
    if (!before.ok) throw new Error('unreachable');

    const result = await repo.join({
      postId: 'bp-1001',
      applicant: applicant(),
      message: '我也常打，一起？',
      idempotencyKey: 'key-join-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.status).toBe('PENDING');
    expect(result.value.message).toBe('我也常打，一起？');

    const after = await repo.postDetail('bp-1001', DEMO_BUDDY_USER_ID);
    if (!after.ok) throw new Error('unreachable');
    expect(after.value.post.joinedCount).toBe(before.value.post.joinedCount);
    expect(after.value.viewerApplication?.status).toBe('PENDING');
  });

  it('缺 Idempotency-Key → VALIDATION_FAILED / IDEMPOTENCY_KEY_REQUIRED（契约 §11.3）', async () => {
    const repo = makeRepo();
    const result = await repo.join({ postId: 'bp-1001', applicant: applicant() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect((result.error.details as { reason?: string }).reason).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('同一幂等键重复提交只产生一条申请（验收 T17）', async () => {
    const repo = makeRepo();
    const input = {
      postId: 'bp-1001',
      applicant: applicant(),
      idempotencyKey: 'key-join-2',
    };
    const first = await repo.join(input);
    const second = await repo.join(input);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(second.value.id).toBe(first.value.id);
  });

  it('不能申请自己发布的活动', async () => {
    const repo = makeRepo();
    const result = await repo.join({
      postId: 'bp-1001',
      applicant: applicant('u_4096', { gender: 'male', skillLevel: 'regular' }),
      idempotencyKey: 'key-own',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('CONFLICT');
    expect((result.error.details as { reason?: string }).reason).toBe('CANNOT_JOIN_OWN_POST');
  });

  it('已申请过 → CONFLICT / ALREADY_APPLIED', async () => {
    const repo = makeRepo();
    const result = await repo.join({
      postId: 'bp-1002',
      applicant: applicant(),
      idempotencyKey: 'key-dup',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect((result.error.details as { reason?: string }).reason).toBe('ALREADY_APPLIED');
  });

  it('名额已满 → CONFLICT / POST_FULL', async () => {
    const repo = makeRepo({
      seed: { posts: [makePost({ id: 'bp-full', capacity: 2, joinedCount: 2 })] },
    });
    const result = await repo.join({
      postId: 'bp-full',
      applicant: applicant('u_9999'),
      idempotencyKey: 'key-full',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect((result.error.details as { reason?: string }).reason).toBe('POST_FULL');
  });

  it('非 OPEN → CONFLICT / POST_NOT_OPEN', async () => {
    const repo = makeRepo();
    const result = await repo.join({
      postId: 'bp-1005',
      applicant: applicant('u_9999'),
      idempotencyKey: 'key-closed',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect((result.error.details as { reason?: string }).reason).toBe('POST_NOT_OPEN');
  });

  it('性别准入不符 → FORBIDDEN / GENDER_PREFERENCE_MISMATCH（F5）', async () => {
    const repo = makeRepo();
    const result = await repo.join({
      postId: 'bp-1007',
      applicant: applicant(),
      idempotencyKey: 'key-gender',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('FORBIDDEN');
    expect((result.error.details as { reason?: string }).reason).toBe(
      'GENDER_PREFERENCE_MISMATCH',
    );
  });

  it('运动水平低于门槛 → FORBIDDEN / SKILL_LEVEL_TOO_LOW（F6）', async () => {
    const repo = makeRepo();
    const result = await repo.join({
      postId: 'bp-1012',
      applicant: applicant(),
      idempotencyKey: 'key-skill',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('FORBIDDEN');
    expect((result.error.details as { reason?: string }).reason).toBe('SKILL_LEVEL_TOO_LOW');
  });

  it('活动不存在 → NOT_FOUND', async () => {
    const repo = makeRepo();
    const result = await repo.join({
      postId: 'bp-nope',
      applicant: applicant(),
      idempotencyKey: 'key-404',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('leave：撤回后 10 分钟内不能重新申请（规格 §6.4 防骚扰）', () => {
  it('PENDING → WITHDRAWN，且立即重新申请被 RATE_LIMITED', async () => {
    const repo = makeRepo();
    const left = await repo.leave({
      postId: 'bp-1002',
      applicantId: DEMO_BUDDY_USER_ID,
      idempotencyKey: 'key-leave',
    });
    expect(left.ok).toBe(true);
    if (!left.ok) throw new Error('unreachable');
    expect(left.value.status).toBe('WITHDRAWN');

    const rejoin = await repo.join({
      postId: 'bp-1002',
      applicant: applicant(),
      idempotencyKey: 'key-rejoin',
    });
    expect(rejoin.ok).toBe(false);
    if (rejoin.ok) throw new Error('unreachable');
    expect(rejoin.error.code).toBe('RATE_LIMITED');
  });

  it('冷却期为 0 时，重新申请**复用同一行**（服务 @@unique 约束）', async () => {
    const repo = makeRepo({ reapplyCooldownMs: 0 });
    const left = await repo.leave({
      postId: 'bp-1002',
      applicantId: DEMO_BUDDY_USER_ID,
      idempotencyKey: 'key-leave-2',
    });
    if (!left.ok) throw new Error('unreachable');

    const rejoin = await repo.join({
      postId: 'bp-1002',
      applicant: applicant(),
      idempotencyKey: 'key-rejoin-2',
    });
    expect(rejoin.ok).toBe(true);
    if (!rejoin.ok) throw new Error('unreachable');
    expect(rejoin.value.id).toBe(left.value.id);
    expect(rejoin.value.status).toBe('PENDING');
  });

  it('非 PENDING 的申请不能撤回', async () => {
    const repo = makeRepo();
    const result = await repo.leave({
      postId: 'bp-1001',
      applicantId: 'u_2048',
      idempotencyKey: 'key-leave-accepted',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect((result.error.details as { reason?: string }).reason).toBe('APPLICATION_NOT_PENDING');
  });
});

describe('decide：只有发起人，且接受才递增名额', () => {
  it('非发起人 → FORBIDDEN / NOT_CREATOR', async () => {
    const repo = makeRepo();
    // 以**发起人**视角才能拿到申请列表（规格 §6.1 可见性矩阵）
    const detail = await repo.postDetail('bp-1001', 'u_4096');
    if (!detail.ok) throw new Error('unreachable');
    const pending = detail.value.applications.find((a) => a.status === 'PENDING');
    expect(pending).toBeDefined();

    const result = await repo.decide({
      postId: 'bp-1001',
      applicationId: (pending as BuddyApplication).id,
      decision: 'ACCEPTED',
      actorId: DEMO_BUDDY_USER_ID,
      idempotencyKey: 'key-decide-forbidden',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('FORBIDDEN');
    expect((result.error.details as { reason?: string }).reason).toBe('NOT_CREATOR');
  });

  it('发起人接受 → 申请 ACCEPTED，joinedCount +1，decidedBy 记录', async () => {
    const repo = makeRepo();
    const before = await repo.postDetail('bp-1001', 'u_4096');
    if (!before.ok) throw new Error('unreachable');
    const pending = before.value.applications.find((a) => a.status === 'PENDING');
    if (!pending) throw new Error('unreachable');

    const result = await repo.decide({
      postId: 'bp-1001',
      applicationId: pending.id,
      decision: 'ACCEPTED',
      actorId: 'u_4096',
      idempotencyKey: 'key-decide-accept',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.post.joinedCount).toBe(before.value.post.joinedCount + 1);
    const decided = result.value.applications.find((a) => a.id === pending.id);
    expect(decided?.status).toBe('ACCEPTED');
    expect(decided?.decidedBy).toBe('u_4096');
  });

  it('接受后人数达上限 → 帖子转 FULL', async () => {
    const pendingApplication: BuddyApplication = {
      id: 'ba-test',
      postId: 'bp-test',
      applicantId: 'u_3072',
      applicantNickname: '早八人',
      status: 'PENDING',
      message: '算我一个。',
      createdAt: '2026-10-17T01:00:00.000Z',
      decidedAt: null,
      decidedBy: null,
    };
    const repo = makeRepo({
      seed: {
        posts: [makePost({ id: 'bp-test', capacity: 2, joinedCount: 1 })],
        applications: [pendingApplication],
      },
    });

    const result = await repo.decide({
      postId: 'bp-test',
      applicationId: 'ba-test',
      decision: 'ACCEPTED',
      actorId: 'u_4096',
      idempotencyKey: 'key-decide-full',
    });
    expect(
      result.ok,
      result.ok ? '' : `${result.error.code} / ${result.error.message} / ${JSON.stringify(result.error.details)}`,
    ).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.post.joinedCount).toBe(2);
    expect(result.value.post.status).toBe('FULL');
  });

  it('拒绝不递增名额', async () => {
    const repo = makeRepo();
    const before = await repo.postDetail('bp-1001', 'u_4096');
    if (!before.ok) throw new Error('unreachable');
    const pending = before.value.applications.find((a) => a.status === 'PENDING');
    if (!pending) throw new Error('unreachable');

    const result = await repo.decide({
      postId: 'bp-1001',
      applicationId: pending.id,
      decision: 'REJECTED',
      actorId: 'u_4096',
      idempotencyKey: 'key-decide-reject',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.post.joinedCount).toBe(before.value.post.joinedCount);
  });

  it('重复处理同一条申请 → CONFLICT / APPLICATION_NOT_PENDING', async () => {
    const repo = makeRepo();
    const before = await repo.postDetail('bp-1001', 'u_4096');
    if (!before.ok) throw new Error('unreachable');
    const pending = before.value.applications.find((a) => a.status === 'PENDING');
    if (!pending) throw new Error('unreachable');

    await repo.decide({
      postId: 'bp-1001',
      applicationId: pending.id,
      decision: 'ACCEPTED',
      actorId: 'u_4096',
      idempotencyKey: 'key-decide-twice-1',
    });
    const second = await repo.decide({
      postId: 'bp-1001',
      applicationId: pending.id,
      decision: 'ACCEPTED',
      actorId: 'u_4096',
      idempotencyKey: 'key-decide-twice-2',
    });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect((second.error.details as { reason?: string }).reason).toBe('APPLICATION_NOT_PENDING');
  });
});

describe('close：发起人关闭招募（OPEN/FULL → CLOSED）', () => {
  it('非发起人 → FORBIDDEN', async () => {
    const repo = makeRepo();
    const result = await repo.close({
      postId: 'bp-1001',
      actorId: DEMO_BUDDY_USER_ID,
      idempotencyKey: 'key-close-forbidden',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('FORBIDDEN');
  });

  it('发起人关闭成功，之后重复关闭 → CONFLICT（终态）', async () => {
    const repo = makeRepo();
    const first = await repo.close({
      postId: 'bp-1001',
      actorId: 'u_4096',
      idempotencyKey: 'key-close-1',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    expect(first.value.status).toBe('CLOSED');

    const second = await repo.close({
      postId: 'bp-1001',
      actorId: 'u_4096',
      idempotencyKey: 'key-close-2',
    });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.error.code).toBe('CONFLICT');
  });

  it('关闭后不能申请（POST_NOT_OPEN）', async () => {
    const repo = makeRepo();
    await repo.close({ postId: 'bp-1001', actorId: 'u_4096', idempotencyKey: 'key-close-3' });
    const result = await repo.join({
      postId: 'bp-1001',
      applicant: applicant(),
      idempotencyKey: 'key-join-after-close',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect((result.error.details as { reason?: string }).reason).toBe('POST_NOT_OPEN');
  });
});

describe('发起人视角：演示会话自己的活动（bp-1013）', () => {
  it('我发布的活动能看到收到的申请（规格 §6.1）', async () => {
    const repo = makeRepo();
    const detail = await repo.postDetail('bp-1013', DEMO_BUDDY_USER_ID);
    expect(detail.ok).toBe(true);
    if (!detail.ok) throw new Error('unreachable');
    expect(detail.value.viewerIsCreator).toBe(true);
    expect(detail.value.applications).toHaveLength(2);
    expect(detail.value.applications.every((a) => a.status === 'PENDING')).toBe(true);
    expect(detail.value.post.joinedCount).toBe(1);
  });

  it('我接受一条申请 → joinedCount 递增；随后关闭 → CLOSED', async () => {
    const repo = makeRepo();
    const before = await repo.postDetail('bp-1013', DEMO_BUDDY_USER_ID);
    if (!before.ok) throw new Error('unreachable');
    const pending = before.value.applications.find((a) => a.status === 'PENDING');
    if (!pending) throw new Error('unreachable');

    const decided = await repo.decide({
      postId: 'bp-1013',
      applicationId: pending.id,
      decision: 'ACCEPTED',
      actorId: DEMO_BUDDY_USER_ID,
      idempotencyKey: 'key-own-decide',
    });
    expect(decided.ok).toBe(true);
    if (!decided.ok) throw new Error('unreachable');
    expect(decided.value.post.joinedCount).toBe(2);

    const closed = await repo.close({
      postId: 'bp-1013',
      actorId: DEMO_BUDDY_USER_ID,
      idempotencyKey: 'key-own-close',
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) throw new Error('unreachable');
    expect(closed.value.status).toBe('CLOSED');
  });

  it('我发布的活动不会被推荐给我自己（F3 硬过滤）', async () => {
    const repo = makeRepo();
    const ids = await recommendationIds(repo, 'academic');
    expect(ids).not.toContain('bp-1013');
  });
});

/* ------------------------------------------------------------------ *
 * 详情可见性（规格 §6.1）
 * ------------------------------------------------------------------ */

describe('详情：申请人列表只有发起人可见', () => {
  it('发起人视角拿到申请列表，申请人视角为空但能看到自己那条', async () => {
    const repo = makeRepo();
    const creator = await repo.postDetail('bp-1001', 'u_4096');
    const applicantView = await repo.postDetail('bp-1001', DEMO_BUDDY_USER_ID);
    if (!creator.ok || !applicantView.ok) throw new Error('unreachable');

    expect(creator.value.viewerIsCreator).toBe(true);
    expect(creator.value.applications.length).toBeGreaterThan(0);
    expect(creator.value.viewerApplication).toBeNull();

    expect(applicantView.value.viewerIsCreator).toBe(false);
    expect(applicantView.value.applications).toEqual([]);
    expect(applicantView.value.viewerApplication).toBeNull();
  });

  it('不存在的活动 → NOT_FOUND', async () => {
    const repo = makeRepo();
    const result = await repo.postDetail('bp-nope', DEMO_BUDDY_USER_ID);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

/* ------------------------------------------------------------------ *
 * 发布
 * ------------------------------------------------------------------ */

describe('createPost：校验、幂等与初值语义', () => {
  const draft = {
    activity: 'sport' as const,
    title: '周六下午羽毛球',
    description: '体育馆 3 号场。',
    location: '体育馆',
    startsAt: '2026-10-21T14:00:00+08:00',
    durationMin: 120,
    capacity: 4,
    genderPreference: 'any' as const,
    tags: ['badminton'],
    minSkillLevel: null,
    creator: { id: DEMO_BUDDY_USER_ID, nickname: '鸭鸭先冲', avatarUrl: null },
  };

  it('成功发布：joinedCount 初值为 1（契约 §11.10-D）', async () => {
    const repo = makeRepo();
    const result = await repo.createPost({ ...draft, idempotencyKey: 'key-create-1' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.joinedCount).toBe(1);
    expect(result.value.status).toBe('OPEN');
    expect(result.value.creator.id).toBe(DEMO_BUDDY_USER_ID);
  });

  it('未知标签 → VALIDATION_FAILED / UNKNOWN_TAG:<key>（封闭标签硬要求）', async () => {
    const repo = makeRepo();
    const result = await repo.createPost({
      ...draft,
      tags: ['打羽毛球'],
      idempotencyKey: 'key-create-badtag',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect((result.error.details as { reason?: string }).reason).toBe('UNKNOWN_TAG:打羽毛球');
  });

  it('正文含手机号 → CONTACT_INFO_IN_DESCRIPTION', async () => {
    const repo = makeRepo();
    const result = await repo.createPost({
      ...draft,
      description: '联系我 13800000000',
      idempotencyKey: 'key-create-contact',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect((result.error.details as { reason?: string }).reason).toBe(
      'CONTACT_INFO_IN_DESCRIPTION',
    );
  });

  it('同一幂等键 + 同 body 只创建一条；换 body 复用同键 → CONFLICT / IDEMPOTENCY_KEY_REUSED', async () => {
    const repo = makeRepo();
    const first = await repo.createPost({ ...draft, idempotencyKey: 'key-create-idem' });
    const second = await repo.createPost({ ...draft, idempotencyKey: 'key-create-idem' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(second.value.id).toBe(first.value.id);

    const third = await repo.createPost({
      ...draft,
      title: '换个标题',
      idempotencyKey: 'key-create-idem',
    });
    expect(third.ok).toBe(false);
    if (third.ok) throw new Error('unreachable');
    expect(third.error.code).toBe('CONFLICT');
    expect((third.error.details as { reason?: string }).reason).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

/* ------------------------------------------------------------------ *
 * 推荐：explainMatch 理由 + 硬过滤 + 降级（规格 §3.3 / §5.7）
 * ------------------------------------------------------------------ */

describe('recommendations：理由来自 explainMatch，且带 matchMode', () => {
  it('hash 模式：academic 推荐带「同一个院系」等结构化理由，score 保留 3 位小数', async () => {
    const repo = makeRepo();
    const result = await repo.recommendations({ userId: DEMO_BUDDY_USER_ID, section: 'academic' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    expect(result.value.matchMode).toBe('hash');
    expect(result.value.items.map((item) => item.post.id)).toEqual(['bp-1009']);

    const item = result.value.items[0];
    expect(item).toBeDefined();
    if (!item) throw new Error('unreachable');
    expect(item.reason.length).toBeGreaterThan(0);
    expect(item.reasons.map((r) => r.code)).toContain('same-department');
    expect(item.reasons.map((r) => r.label)).toContain('同一个院系');
    expect(item.reasons.map((r) => r.code)).toContain('same-area');
    // 3 位小数
    expect(String(item.score).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
    expect(item.score).toBeGreaterThan(0);
  });

  it('sport 模式：共同活动 / 时间能碰上 / 水平接近 都来自 explainMatch', async () => {
    const repo = makeRepo();
    const result = await repo.recommendations({ userId: DEMO_BUDDY_USER_ID, section: 'sport' });
    if (!result.ok) throw new Error('unreachable');

    const ids = result.value.items.map((item) => item.post.id);
    // F5：bp-1007 仅限男生（发起人 male，我 female）→ 被硬过滤
    expect(ids).not.toContain('bp-1007');
    // F6：bp-1012 要求 regular，我 casual → 被硬过滤
    expect(ids).not.toContain('bp-1012');
    expect(ids).toContain('bp-1001');
    expect(ids).toContain('bp-1004');

    const badminton = result.value.items.find((item) => item.post.id === 'bp-1001');
    expect(badminton?.reasons.map((r) => r.code)).toContain('shared-activities');
    expect(badminton?.reasons.map((r) => r.label)).toContain('共同活动 1 项');
    // ⚠️ **sport 不应出现"时间能碰上"**：`ruleScoreFor` 只在 `daily` 给这 0.2 分，
    // 在 sport 展示该理由会让用户看到一个解释不了分数的理由。
    // （Lead 已裁决改共享包 `explainMatch` 与打分表对齐；本条由断言旧行为改为断言新行为。）
    expect(badminton?.reasons.map((r) => r.code)).not.toContain('availability-overlap');
    expect(badminton?.reasons.map((r) => r.label)).not.toContain('时间能碰上');

    const running = result.value.items.find((item) => item.post.id === 'bp-1004');
    // 发起人 u_5120 与我同为 casual → 「水平接近」
    expect(running?.reasons.map((r) => r.label)).toContain('水平接近');
  });

  it('F7 硬过滤：时段对不上的活动不出现（bp-1006 周三 07:00）', async () => {
    const repo = makeRepo();
    const ids = await recommendationIds(repo, 'daily');
    expect(ids).not.toContain('bp-1006');
    expect(ids).toContain('bp-1003');
    expect(ids).toContain('bp-1011');
  });

  it('F3 硬过滤：不推荐自己发布的活动', async () => {
    const repo = makeRepo();
    await repo.createPost({
      activity: 'study',
      title: '我自己发的自习',
      description: '',
      location: '图书馆',
      startsAt: '2026-10-21T14:00:00+08:00',
      durationMin: 120,
      capacity: 4,
      genderPreference: 'any',
      tags: ['self-study'],
      minSkillLevel: null,
      creator: { id: DEMO_BUDDY_USER_ID, nickname: '鸭鸭先冲', avatarUrl: null },
      idempotencyKey: 'key-create-own',
    });
    const ids = await recommendationIds(repo, 'academic');
    expect(ids).toHaveLength(1);
    expect(ids).toContain('bp-1009');
  });

  it('F4 硬过滤：已申请过的活动不再推荐（bp-1002 我有 PENDING 申请）', async () => {
    const repo = makeRepo();
    const ids = await recommendationIds(repo, 'academic');
    expect(ids).not.toContain('bp-1002');
  });

  it('未开启匹配资料 → rule 模式，score 为 0，reason 为「按时间排序」（规格 §5.7）', async () => {
    const repo = makeRepo({ seed: { profiles: {} } });
    const result = await repo.recommendations({ userId: DEMO_BUDDY_USER_ID, section: 'sport' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.matchMode).toBe('rule');
    for (const item of result.value.items) {
      expect(item.score).toBe(0);
      expect(item.reason).toBe('按时间排序');
    }
    // 仍按 startsAt 升序
    const starts = result.value.items.map((item) => item.post.startsAt);
    expect([...starts].sort()).toEqual(starts);
  });

  it('matchEnabled=false 的资料同样降级为 rule（默认不参与匹配）', async () => {
    const repo = makeRepo();
    const profile = await repo.getProfile(DEMO_BUDDY_USER_ID);
    if (!profile.ok) throw new Error('unreachable');
    repo.setProfile({ ...profile.value, matchEnabled: false });

    const result = await repo.recommendations({ userId: DEMO_BUDDY_USER_ID, section: 'sport' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.matchMode).toBe('rule');
  });

  it('删除匹配资料后立即移出推荐池（验收 T30）', async () => {
    const repo = makeRepo();
    const before = await repo.recommendations({ userId: DEMO_BUDDY_USER_ID, section: 'academic' });
    if (!before.ok) throw new Error('unreachable');
    expect(before.value.matchMode).toBe('hash');

    const deleted = await repo.deleteProfile(DEMO_BUDDY_USER_ID);
    expect(deleted.ok).toBe(true);

    const after = await repo.recommendations({ userId: DEMO_BUDDY_USER_ID, section: 'academic' });
    if (!after.ok) throw new Error('unreachable');
    expect(after.value.matchMode).toBe('rule');
    const profile = await repo.getProfile(DEMO_BUDDY_USER_ID);
    if (!profile.ok) throw new Error('unreachable');
    expect(profile.value.matchEnabled).toBe(false);
    expect(profile.value.interestTags).toEqual([]);
  });

  it('非法 section → VALIDATION_FAILED', async () => {
    const repo = makeRepo();
    const result = await repo.recommendations({
      userId: DEMO_BUDDY_USER_ID,
      section: 'nope' as 'sport',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('推荐也走游标分页（limit=1 不重不漏）', async () => {
    const repo = makeRepo();
    const full = await repo.recommendations({ userId: DEMO_BUDDY_USER_ID, section: 'sport', limit: 50 });
    if (!full.ok) throw new Error('unreachable');
    const expected = full.value.items.map((item) => item.post.id);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard += 1) {
      const page = await repo.recommendations({
        userId: DEMO_BUDDY_USER_ID,
        section: 'sport',
        limit: 1,
        ...(cursor ? { cursor } : {}),
      });
      if (!page.ok) throw new Error('unreachable');
      seen.push(...page.value.items.map((item) => item.post.id));
      if (page.value.nextCursor === null) break;
      cursor = page.value.nextCursor;
    }
    expect(seen).toEqual(expected);
  });
});

describe('反馈：UPSERT + 板块隔离（规格 §3.6，验收 T6）', () => {
  async function scoreOf(repo: MockBuddyRepository, postId: string): Promise<number> {
    const result = await repo.recommendations({ userId: DEMO_BUDDY_USER_ID, section: 'academic' });
    if (!result.ok) throw new Error('unreachable');
    const item = result.value.items.find((entry) => entry.post.id === postId);
    return item?.score ?? -1;
  }

  it('反馈是 UPSERT：同一 (user, post, section) 只有一条记录', async () => {
    const repo = makeRepo();
    const first = await repo.feedback({
      postId: 'bp-1009',
      userId: DEMO_BUDDY_USER_ID,
      section: 'academic',
      action: 'like',
      idempotencyKey: 'key-fb-1',
    });
    const second = await repo.feedback({
      postId: 'bp-1009',
      userId: DEMO_BUDDY_USER_ID,
      section: 'academic',
      action: 'dislike',
      idempotencyKey: 'key-fb-2',
    });
    expect(first.ok && second.ok).toBe(true);
    if (!second.ok) throw new Error('unreachable');
    expect(second.value.action).toBe('dislike');
  });

  it('academic 的 dislike 降低 academic 分数；daily 的 dislike **不**影响它', async () => {
    const base = makeRepo({ seed: { feedbacks: [] } });
    const academicDislike = makeRepo({
      seed: {
        feedbacks: [
          {
            userId: DEMO_BUDDY_USER_ID,
            targetPostId: 'bp-1009',
            section: 'academic',
            action: 'dislike',
            createdAt: NOW.toISOString(),
          } satisfies BuddyMatchFeedback,
        ],
      },
    });
    const dailyDislike = makeRepo({
      seed: {
        feedbacks: [
          {
            userId: DEMO_BUDDY_USER_ID,
            targetPostId: 'bp-1009',
            section: 'daily',
            action: 'dislike',
            createdAt: NOW.toISOString(),
          } satisfies BuddyMatchFeedback,
        ],
      },
    });

    const baseScore = await scoreOf(base, 'bp-1009');
    const academicScore = await scoreOf(academicDislike, 'bp-1009');
    const dailyScore = await scoreOf(dailyDislike, 'bp-1009');

    expect(baseScore).toBeGreaterThan(0);
    expect(academicScore).toBeLessThan(baseScore);
    // 板块隔离：daily 的反馈对 academic 分数**零影响**（验收 T6）
    expect(dailyScore).toBe(baseScore);
  });

  it('like 反馈提高该帖分数', async () => {
    const base = makeRepo({ seed: { feedbacks: [] } });
    const liked = makeRepo({
      seed: {
        feedbacks: [
          {
            userId: DEMO_BUDDY_USER_ID,
            targetPostId: 'bp-1009',
            section: 'academic',
            action: 'like',
            createdAt: NOW.toISOString(),
          } satisfies BuddyMatchFeedback,
        ],
      },
    });
    expect(await scoreOf(liked, 'bp-1009')).toBeGreaterThan(await scoreOf(base, 'bp-1009'));
  });

  it('反馈不存在的帖子 → NOT_FOUND；缺幂等键 → VALIDATION_FAILED', async () => {
    const repo = makeRepo();
    const missing = await repo.feedback({
      postId: 'bp-nope',
      userId: DEMO_BUDDY_USER_ID,
      section: 'academic',
      action: 'like',
      idempotencyKey: 'key-fb-404',
    });
    expect(missing.ok).toBe(false);

    const noKey = await repo.feedback({
      postId: 'bp-1009',
      userId: DEMO_BUDDY_USER_ID,
      section: 'academic',
      action: 'like',
    });
    expect(noKey.ok).toBe(false);
    if (noKey.ok) throw new Error('unreachable');
    expect((noKey.error.details as { reason?: string }).reason).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('MMR 多样性重排（规格 §3.3 第 9 步）', () => {
  it('λ=0 时第二个选中的是与第一个最不相似的候选', () => {
    const candidates = [
      { value: 'a', relevance: 1, vector: [1, 0] },
      { value: 'b', relevance: 0.9, vector: [1, 0] }, // 与 a 完全相似
      { value: 'c', relevance: 0.1, vector: [0, 1] }, // 与 a 正交（最不相似）
    ];
    const ranked = mmrRerank(candidates, 0);
    expect(ranked.map((entry) => entry.value)).toEqual(['a', 'c', 'b']);
  });

  it('λ=1 时退化为按相关度排序', () => {
    const candidates = [
      { value: 'a', relevance: 0.2, vector: [1, 0] },
      { value: 'b', relevance: 0.9, vector: [0, 1] },
    ];
    expect(mmrRerank(candidates, 1).map((entry) => entry.value)).toEqual(['b', 'a']);
  });
});

/* ------------------------------------------------------------------ *
 * 资料读写 / 故障演练
 * ------------------------------------------------------------------ */

describe('匹配资料读写与校验', () => {
  it('getProfile 返回已开启匹配的资料（含跨零点时段）', async () => {
    const repo = makeRepo();
    const result = await repo.getProfile(DEMO_BUDDY_USER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.matchEnabled).toBe(true);
    expect(result.value.sections).toEqual(['academic', 'sport']);
    expect(result.value.availability.some((slot) => slot.endMin < slot.startMin)).toBe(true);
  });

  it('没有资料时返回**默认关闭**的空资料，而不是 404', async () => {
    const repo = makeRepo({ seed: { profiles: {} } });
    const result = await repo.getProfile('u_nobody');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.matchEnabled).toBe(false);
    expect(result.value.sections).toEqual([]);
  });

  it('putProfile 校验失败 → VALIDATION_FAILED / NO_SECTION', async () => {
    const repo = makeRepo();
    const result = await repo.putProfile({
      userId: DEMO_BUDDY_USER_ID,
      sections: [],
      interestTags: [],
      activityTags: [],
      skillLevel: 'casual',
      availability: [],
      preferredAreas: [],
      department: null,
      bio: null,
      matchEnabled: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect((result.error.details as { reason?: string }).reason).toBe('NO_SECTION');
  });

  it('putProfile 成功后可读回（含跨零点时段）', async () => {
    const repo = makeRepo();
    const result = await repo.putProfile({
      userId: DEMO_BUDDY_USER_ID,
      sections: ['sport'],
      interestTags: ['running'],
      activityTags: ['running'],
      skillLevel: 'regular',
      availability: [{ dow: 5, startMin: 23 * 60, endMin: 60 }],
      preferredAreas: ['田径场'],
      department: '信息科学与技术学院',
      bio: '夜跑选手。',
      matchEnabled: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.availability).toEqual([{ dow: 5, startMin: 1380, endMin: 60 }]);

    const readBack = await repo.getProfile(DEMO_BUDDY_USER_ID);
    if (!readBack.ok) throw new Error('unreachable');
    expect(readBack.value.bio).toBe('夜跑选手。');
  });
});

describe('故障演练与 reset', () => {
  it('setFailureMode(error) 让所有请求返回 UPSTREAM_UNAVAILABLE', async () => {
    const repo = makeRepo();
    repo.setFailureMode('error');
    expect(repo.getFailureMode()).toBe('error');

    const list = await repo.listPosts({});
    const detail = await repo.postDetail('bp-1001', DEMO_BUDDY_USER_ID);
    const recs = await repo.recommendations({ userId: DEMO_BUDDY_USER_ID, section: 'sport' });
    const profile = await repo.getProfile(DEMO_BUDDY_USER_ID);
    for (const result of [list, detail, recs, profile]) {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.code).toBe('UPSTREAM_UNAVAILABLE');
    }
  });

  it('reset() 恢复数据集与故障模式', async () => {
    const repo = makeRepo();
    await repo.join({
      postId: 'bp-1001',
      applicant: applicant(),
      idempotencyKey: 'key-reset',
    });
    repo.setFailureMode('error');
    repo.reset();

    expect(repo.getFailureMode()).toBe('none');
    const detail = await repo.postDetail('bp-1001', DEMO_BUDDY_USER_ID);
    if (!detail.ok) throw new Error('unreachable');
    expect(detail.value.viewerApplication).toBeNull();
    expect(await allPostIds(repo)).toHaveLength(10);
  });
});

describe('我的申请列表', () => {
  it('只返回自己的申请，按创建时间倒序', async () => {
    const repo = makeRepo();
    const result = await repo.listMyApplications(DEMO_BUDDY_USER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.length).toBe(2);
    for (const application of result.value) {
      expect(application.applicantId).toBe(DEMO_BUDDY_USER_ID);
    }
    const created = result.value.map((a) => a.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
  });
});
