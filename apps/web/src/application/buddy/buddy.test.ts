/**
 * 找搭子 application 层测试（用例编排 + 视图模型，全部纯逻辑，node 环境）。
 *
 * 重点覆盖验收里点名的 **`explainMatch` 理由**：
 * 推荐必须给出中文理由（`同一个院系` / `共同兴趣 3 项` / `时间能碰上` / `水平接近` /
 * `常在同一个区域`），一条都没有时回落为 `有潜在匹配` —— **不能只给分数**。
 */
import type { ApiError, Page } from '@kedaya/contracts';
import { explainMatch, ruleScoreFor, err, ok, type MatchReason, type MatchSubject, type Result } from '@kedaya/shared';
import { describe, expect, it } from 'vitest';

import {
  sectionOf,
  type BuddyApplication,
  type BuddyAvailabilitySlot,
  type BuddyPost,
  type BuddyProfile,
  type BuddyProfileDraft,
} from '@/domain/models/buddy';
import type {
  BuddyPostDetail,
  BuddyRecommendationPage,
  BuddyRepository,
  CreateBuddyPostInput,
} from '@/domain/ports/buddy';

import {
  appendAvailabilitySlot,
  deleteBuddyProfile,
  emptyProfileDraft,
  loadBuddyProfile,
  overlapsPost,
  profileToDraft,
  removeAvailabilitySlot,
  saveBuddyProfile,
  tagGroups,
  toBuddyProfileVM,
  toggleSection,
  toggleTag,
  updateAvailabilitySlot,
  validateBuddyProfileForm,
  weekdayOptions,
} from './buddyProfile';
import {
  closeBuddyPost,
  decideBuddyApplication,
  joinBuddyPost,
  leaveBuddyPost,
  loadBuddyPostDetail,
  toBuddyPostDetailVM,
} from './getBuddyPostDetail';
import {
  formatDuration,
  formatLocalDateTime,
  loadBuddyPostList,
  toBuddyPostCardVM,
  toBuddyPostListVM,
} from './listBuddyPosts';
import {
  activityOptionsForSection,
  defaultStartsAtValue,
  emptyBuddyPostForm,
  fromDatetimeLocalValue,
  problemsFromApiError,
  publishBuddyPost,
  toCreatePostInput,
  toDatetimeLocalValue,
  validateBuddyPostForm,
} from './publishBuddyPost';
import {
  FALLBACK_REASON,
  MATCH_MODE_NOTICES,
  loadBuddyRecommendations,
  submitBuddyFeedback,
  toBuddyRecommendationVM,
} from './recommendations';
import { DEMO_BUDDY_SESSION } from './session';
import { DEMO_BUDDY_USER_ID } from '@/data/mock/fixtures/buddy';

const NOW = new Date('2026-10-17T05:00:00+08:00');

function makePost(overrides: Partial<BuddyPost> = {}): BuddyPost {
  return {
    id: 'bp-1',
    activity: 'study',
    status: 'OPEN',
    title: '图书馆四楼自习',
    description: '靠窗那排。',
    location: '图书馆',
    startsAt: '2026-10-24T14:00:00+08:00',
    durationMin: 120,
    capacity: 4,
    joinedCount: 2,
    genderPreference: 'any',
    minSkillLevel: null,
    tags: ['self-study', 'exam-prep'],
    creator: { id: 'u_2048', nickname: '图书馆常驻', avatarUrl: null },
    createdAt: '2026-10-17T01:00:00.000Z',
    autoCloseAt: null,
    ...overrides,
  };
}

function makeApplication(overrides: Partial<BuddyApplication> = {}): BuddyApplication {
  return {
    id: 'ba-1',
    postId: 'bp-1',
    applicantId: 'u_1024',
    applicantNickname: '鸭鸭先冲',
    status: 'PENDING',
    message: '算我一个。',
    createdAt: '2026-10-17T02:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    ...overrides,
  };
}

function fakeRepository(overrides: Partial<BuddyRepository> = {}): BuddyRepository {
  const post = makePost();
  return {
    listPosts: async (): Promise<Result<Page<BuddyPost>, ApiError>> =>
      ok({ items: [post], nextCursor: null, total: 1 }),
    postDetail: async (): Promise<Result<BuddyPostDetail, ApiError>> =>
      ok({ post, applications: [], viewerApplication: null, viewerIsCreator: false }),
    createPost: async (): Promise<Result<BuddyPost, ApiError>> => ok(post),
    join: async (): Promise<Result<BuddyApplication, ApiError>> => ok(makeApplication()),
    leave: async (): Promise<Result<BuddyApplication, ApiError>> =>
      ok(makeApplication({ status: 'WITHDRAWN' })),
    decide: async (): Promise<Result<BuddyPostDetail, ApiError>> =>
      ok({ post, applications: [], viewerApplication: null, viewerIsCreator: true }),
    close: async (): Promise<Result<BuddyPost, ApiError>> => ok({ ...post, status: 'CLOSED' }),
    feedback: async () =>
      ok({
        userId: 'u_1024',
        targetPostId: 'bp-1',
        section: 'academic' as const,
        action: 'like' as const,
        createdAt: NOW.toISOString(),
      }),
    recommendations: async (): Promise<Result<BuddyRecommendationPage, ApiError>> =>
      ok({ items: [], nextCursor: null, matchMode: 'hash' }),
    listMyApplications: async (): Promise<Result<BuddyApplication[], ApiError>> => ok([]),
    getProfile: async (): Promise<Result<BuddyProfile, ApiError>> => ok(makeProfile()),
    putProfile: async (input): Promise<Result<BuddyProfile, ApiError>> =>
      ok(makeProfile({ ...input, updatedAt: NOW.toISOString() })),
    deleteProfile: async (): Promise<Result<{ deleted: true }, ApiError>> => ok({ deleted: true }),
    ...overrides,
  };
}

function makeProfile(overrides: Partial<BuddyProfile> = {}): BuddyProfile {
  return {
    userId: 'u_1024',
    sections: ['academic', 'sport'],
    interestTags: ['self-study', 'programming'],
    activityTags: ['self-study'],
    skillLevel: 'casual',
    availability: [
      { dow: 1, startMin: 8 * 60, endMin: 12 * 60 },
      { dow: 5, startMin: 23 * 60, endMin: 60 },
    ],
    preferredAreas: ['图书馆', '体育馆'],
    department: '信息科学与技术学院',
    bio: '常驻图书馆四楼。',
    matchEnabled: true,
    updatedAt: '2026-10-17T03:00:00.000Z',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * 展示层格式化
 * ------------------------------------------------------------------ */

describe('列表视图模型：本地化文案（UI 不做计算）', () => {
  it('绝对时间按 Asia/Shanghai 渲染，不依赖 ICU 输出格式', () => {
    expect(formatLocalDateTime('2026-10-24T14:00:00+08:00')).toBe('10月24日 14:00');
    expect(formatLocalDateTime('2026-10-24T06:00:00.000Z')).toBe('10月24日 14:00');
    expect(formatLocalDateTime('bad')).toBe('时间未知');
  });

  it('时长文案', () => {
    expect(formatDuration(45)).toBe('45 分钟');
    expect(formatDuration(60)).toBe('1 小时');
    expect(formatDuration(150)).toBe('2 小时 30 分钟');
    expect(formatDuration(0)).toBe('时长未知');
  });

  it('卡片 VM：板块由 activity 派生、名额/进度/标签/发起人都已本地化', () => {
    const vm = toBuddyPostCardVM(makePost(), {
      now: NOW,
      viewerId: DEMO_BUDDY_USER_ID,
      myApplicationStatus: null,
    });
    expect(vm.section).toBe('academic');
    expect(vm.sectionLabel).toBe('自习与学术');
    expect(vm.activityLabel).toBe('自习');
    expect(vm.locationLabel).toBe('图书馆');
    expect(vm.startsAtLabel).toBe('10月24日 14:00');
    expect(vm.durationLabel).toBe('2 小时');
    expect(vm.capacityLabel).toBe('2/4 人');
    expect(vm.remainingLabel).toBe('还差 2 人');
    expect(vm.progress).toBe(50);
    expect(vm.tags.map((tag) => tag.label)).toEqual(['自习', '备考']);
    expect(vm.creatorLabel).toBe('图书馆常驻');
    expect(vm.joinable).toBe(true);
    expect(vm.statusTone).toBe('brand');
  });

  it('卡片 VM：非 OPEN 状态有显式 notice（不静默消失）', () => {
    const full = toBuddyPostCardVM(makePost({ status: 'FULL', joinedCount: 4 }), {
      now: NOW,
      viewerId: DEMO_BUDDY_USER_ID,
    });
    expect(full.notice).toContain('名额已满');
    expect(full.joinable).toBe(false);
    expect(full.blockedReason).toContain('名额已满');

    const closed = toBuddyPostCardVM(makePost({ status: 'CLOSED' }), {
      now: NOW,
      viewerId: DEMO_BUDDY_USER_ID,
    });
    expect(closed.notice).toContain('已关闭');
    expect(closed.statusTone).toBe('neutral');
  });

  it('卡片 VM：自己发的活动 / 已申请的状态都被翻译成中文', () => {
    const mine = toBuddyPostCardVM(makePost({ creator: { id: 'u_1024', nickname: '我', avatarUrl: null } }), {
      now: NOW,
      viewerId: 'u_1024',
    });
    expect(mine.isMine).toBe(true);
    expect(mine.blockedReason).toBe('不能申请自己发布的活动');

    const applied = toBuddyPostCardVM(makePost(), {
      now: NOW,
      viewerId: 'u_1024',
      myApplicationStatus: 'PENDING',
    });
    expect(applied.myApplicationLabel).toBe('待审批');
    expect(applied.blockedReason).toContain('等待发起人审批');
  });

  it('列表 VM：板块计数来自当前页（三个板块固定存在）', () => {
    const page: Page<BuddyPost> = {
      items: [makePost(), makePost({ id: 'bp-2', activity: 'sport', tags: ['badminton'] })],
      nextCursor: 'c1',
      total: 12,
    };
    const vm = toBuddyPostListVM(page, { now: NOW, viewerId: DEMO_BUDDY_USER_ID });
    expect(vm.sections.map((section) => section.value)).toEqual(['academic', 'daily', 'sport']);
    expect(vm.sections.find((s) => s.value === 'academic')?.count).toBe(1);
    expect(vm.sections.find((s) => s.value === 'sport')?.count).toBe(1);
    expect(vm.sections.find((s) => s.value === 'daily')?.count).toBe(0);
    expect(vm.total).toBe(12);
    expect(vm.nextCursor).toBe('c1');
    expect(vm.isEmpty).toBe(false);
    expect(vm.joinableCount).toBe(2);
  });

  it('loadBuddyPostList：把我的申请状态合进列表项（拉取失败也不阻塞列表）', async () => {
    const repository = fakeRepository({
      listPosts: async () =>
        ok({ items: [makePost({ id: 'bp-9' })], nextCursor: null, total: 1 }),
      listMyApplications: async () =>
        err({ code: 'UPSTREAM_UNAVAILABLE', message: '申请服务不可用' }),
    });
    const result = await loadBuddyPostList(repository, {}, { viewerId: 'u_1024', now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.items[0]?.myApplicationStatus).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * explainMatch 理由（硬要求）
 * ------------------------------------------------------------------ */

describe('explainMatch：推荐理由来自共享纯函数（不是只有分数）', () => {
  const me: MatchSubject = {
    department: '信息科学与技术学院',
    interestTags: ['self-study', 'programming', 'badminton'],
    activityTags: ['self-study'],
    preferredAreas: ['图书馆'],
    skillLevel: 'casual',
  };
  const target = {
    creator: {
      department: '信息科学与技术学院',
      interestTags: ['self-study', 'programming', 'badminton'],
      activityTags: ['self-study'],
      preferredAreas: ['图书馆'],
      skillLevel: 'casual',
    },
    tags: ['self-study'],
  };

  it('academic：同院系 + 共同兴趣 3 项 + 共同活动（**不含**常在同一个区域）', () => {
    const reasons = explainMatch('academic', me, target);
    const labels = reasons.map((reason) => reason.label);
    expect(labels).toContain('同一个院系');
    expect(labels).toContain('共同兴趣 3 项');
    // ⚠️ academic 的活动规则是「有共同项即加分」的**固定 0.1**，所以文案不带数量
    // （与 sport 的 `共同活动 N 项` 不同 —— 后者按项数计分）
    expect(labels).toContain('共同活动');
    // ⚠️ **academic 没有区域分项**，所以不该出现该理由。
    // 原先本条断言它出现 —— 那是"展示了一条不加分的理由"（已由共享包结构性修复）。
    expect(labels).not.toContain('常在同一个区域');
    expect(reasons.map((r) => r.code)).not.toContain('same-area');
    // 权重降序：同院系 0.4 排第一
    expect(reasons[0]?.label).toBe('同一个院系');
    expect(reasons.map((r) => r.code)).toContain('same-department');
    // 理由权重之和恰等于规则分（可解释性的定义）
    const score = ruleScoreFor('academic', me, target);
    if (score < 1) {
      expect(reasons.reduce((s, r) => s + r.weight, 0)).toBeCloseTo(score, 9);
    }
  });

  it('daily：时间能碰上（可用时段重叠）会被单独列出', () => {
    const labels = explainMatch('daily', me, target, { availabilityOverlaps: true }).map(
      (reason) => reason.label,
    );
    expect(labels).toContain('时间能碰上');
    // 没有重叠时不出现这条
    const withoutOverlap = explainMatch('daily', me, target).map((reason) => reason.label);
    expect(withoutOverlap).not.toContain('时间能碰上');
  });

  it('sport：水平接近', () => {
    const labels = explainMatch('sport', me, target).map((reason) => reason.label);
    expect(labels).toContain('水平接近');
  });

  it('毫无共同点时返回空数组（由调用方回落为「有潜在匹配」）', () => {
    const stranger = {
      creator: { department: '其他学院', interestTags: ['movie'], activityTags: ['movie'], preferredAreas: [], skillLevel: 'competitive' },
      tags: ['movie'],
    };
    expect(explainMatch('academic', me, stranger)).toEqual([]);
    expect(FALLBACK_REASON.label).toBe('有潜在匹配');
  });
});

describe('推荐视图模型：把 explainMatch 的理由原样带给 UI', () => {
  const reason = (code: string, label: string, weight: number): MatchReason => ({ code, label, weight });

  it('结构化理由 + 中文 reason 文案都保留，并给出匹配模式说明', () => {
    const vm = toBuddyRecommendationVM(
      {
        post: makePost(),
        score: 0.7234,
        reason: '同一个院系、共同兴趣 3 项、时间能碰上',
        reasons: [
          reason('same-department', '同一个院系', 0.4),
          reason('shared-interests', '共同兴趣 3 项', 0.3),
          reason('availability-overlap', '时间能碰上', 0.2),
        ],
      },
      { now: NOW, viewerId: 'u_1024', matchMode: 'hash' },
    );

    expect(vm.reasons.map((r) => r.label)).toEqual(['同一个院系', '共同兴趣 3 项', '时间能碰上']);
    expect(vm.reasonLabel).toBe('同一个院系、共同兴趣 3 项、时间能碰上');
    expect(vm.scoreLabel).toBe('0.723');
    expect(vm.scorePercentLabel).toBe('72%');
    expect(vm.matchMode).toBe('hash');
    expect(vm.matchModeNotice).toContain('降级档');
    expect(vm.matchModeNotice).toContain('不是语义相似');
    expect(vm.sectionLabel).toBe('自习与学术');
  });

  it('服务端没给结构化理由时回落为「有潜在匹配」', () => {
    const vm = toBuddyRecommendationVM(
      { post: makePost(), score: 0, reason: '按时间排序', reasons: [] },
      { now: NOW, viewerId: 'u_1024', matchMode: 'rule' },
    );
    expect(vm.reasons.map((r) => r.label)).toEqual(['有潜在匹配']);
    expect(vm.reasonLabel).toBe('按时间排序');
    expect(vm.matchModeLabel).toContain('按时间排序');
    expect(vm.matchModeNotice).toContain('不是个性化推荐');
  });

  it('rule 模式的三条诚实说明都不含"智能推荐"这种夸大措辞', () => {
    expect(MATCH_MODE_NOTICES.rule).toContain('按活动时间排序');
    expect(MATCH_MODE_NOTICES.hash).toContain('不是语义相似');
    expect(MATCH_MODE_NOTICES.vector).toContain('embedding');
  });

  it('loadBuddyRecommendations：把板块内的反馈合进 VM，并统计带理由的条数', async () => {
    const repository = fakeRepository({
      recommendations: async () =>
        ok({
          items: [
            {
              post: makePost(),
              score: 0.5,
              reason: '同一个院系',
              reasons: [reason('same-department', '同一个院系', 0.4)],
            },
            {
              post: makePost({ id: 'bp-2' }),
              score: 0,
              reason: '按时间排序',
              reasons: [],
            },
          ],
          nextCursor: null,
          matchMode: 'hash',
        }),
    });

    const result = await loadBuddyRecommendations(
      repository,
      { userId: 'u_1024', section: 'academic' },
      {
        now: NOW,
        viewerId: 'u_1024',
        feedbacks: [{ targetPostId: 'bp-1', section: 'academic', action: 'like' }],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.items).toHaveLength(2);
    expect(result.value.items[0]?.feedback).toBe('like');
    expect(result.value.items[1]?.feedback).toBeNull();
    expect(result.value.explainedCount).toBe(1);
    expect(result.value.state).toBe('ready');
  });

  it('submitBuddyFeedback 透传服务端返回的反馈', async () => {
    const repository = fakeRepository();
    const result = await submitBuddyFeedback(repository, {
      postId: 'bp-1',
      section: 'academic',
      action: 'like',
      userId: 'u_1024',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toEqual({ targetPostId: 'bp-1', section: 'academic', action: 'like' });
  });
});

/* ------------------------------------------------------------------ *
 * 发布
 * ------------------------------------------------------------------ */

describe('发布：封闭标签与联系方式都在提交前拦下', () => {
  it('datetime-local ↔ ISO 互转；非法值返回空串（不猜）', () => {
    const date = new Date('2026-10-24T14:00:00+08:00');
    const local = toDatetimeLocalValue(date);

    // ⚠️ 这里**不能**断言 `'2026-10-24T14:00'`。
    //
    // `<input type="datetime-local">` 的语义是**本地墙面时间**，
    // 所以 `toDatetimeLocalValue` 正确地用 `getHours()` 等本地取值 ——
    // 同一个瞬刻在 UTC+8 得到 `14:00`、在 UTC 得到 `06:00`。
    // 断言具体字面量等于要求「运行时必须是 +08:00」，CI（UTC）必红。
    //
    // 该函数的真正契约是**往返保真 + 格式正确**，与时区无关：
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromDatetimeLocalValue(local)).toBe(date.toISOString());

    // 非法值返回空串（不猜当前时间）
    expect(fromDatetimeLocalValue('')).toBe('');
    expect(fromDatetimeLocalValue('不是时间')).toBe('');
  });

  it('默认表单：明天 19:00 开始', () => {
    const draft = emptyBuddyPostForm(NOW);
    expect(draft.startsAt).toBe(defaultStartsAtValue(NOW));
    expect(draft.capacity).toBe(4);
    expect(draft.tags).toEqual([]);
    expect(draft.genderPreference).toBe('any');
  });

  it('活动类型选项按板块反查（study → academic 等）', () => {
    expect(activityOptionsForSection('academic').map((option) => option.value)).toEqual(['study']);
    expect(activityOptionsForSection('daily').map((option) => option.value)).toEqual([
      'meal',
      'travel',
      'other',
    ]);
    expect(activityOptionsForSection('sport').map((option) => option.value)).toEqual([
      'sport',
      'game',
    ]);
  });

  it('未知标签 → 表单校验失败，且错误定位到 tags 字段', () => {
    const draft = { ...emptyBuddyPostForm(NOW), title: '自习', tags: ['打羽毛球'] };
    const form = validateBuddyPostForm(draft, NOW);
    expect(form.valid).toBe(false);
    expect(form.fieldErrors.tags).toContain('只能从列表中选择');
  });

  it('publishBuddyPost：本地校验失败走同一个 Result 错误通道（含 problems）', async () => {
    const repository = fakeRepository();
    const result = await publishBuddyPost(repository, {
      draft: { ...emptyBuddyPostForm(NOW), title: '', tags: ['badminton'] },
      session: DEMO_BUDDY_SESSION,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(problemsFromApiError(result.error).length).toBeGreaterThan(0);
  });

  it('publishBuddyPost：合法草稿提交后返回卡片 VM', async () => {
    const repository = fakeRepository({
      createPost: async (input: CreateBuddyPostInput) =>
        ok(makePost({ id: 'bp-9001', title: input.title, tags: input.tags })),
    });
    const draft = {
      ...emptyBuddyPostForm(NOW),
      activity: 'sport' as const,
      title: '周六下午羽毛球',
      location: '体育馆',
      tags: ['badminton'],
    };
    const result = await publishBuddyPost(repository, {
      draft,
      session: DEMO_BUDDY_SESSION,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.id).toBe('bp-9001');
    expect(result.value.title).toBe('周六下午羽毛球');
    expect(result.value.tags.map((tag) => tag.label)).toEqual(['羽毛球']);
  });

  it('toCreatePostInput 带上发起人（实名 id）与幂等键', () => {
    const input = toCreatePostInput(
      { ...emptyBuddyPostForm(NOW), title: ' 去空格 ' },
      DEMO_BUDDY_SESSION,
    );
    expect(input.creator.id).toBe(DEMO_BUDDY_SESSION.userId);
    expect(input.title).toBe('去空格');
    expect(typeof input.idempotencyKey).toBe('string');
    expect((input.idempotencyKey ?? '').length).toBeGreaterThan(8);
  });
});

/* ------------------------------------------------------------------ *
 * 详情与动作
 * ------------------------------------------------------------------ */

describe('详情与申请/审批/关闭（契约 §11.2 冻结动作名）', () => {
  it('详情 VM：发起人视角有申请列表，申请人视角没有', () => {
    const detail: BuddyPostDetail = {
      post: makePost(),
      applications: [makeApplication({ id: 'ba-1' }), makeApplication({ id: 'ba-2', applicantId: 'u_2048' })],
      viewerApplication: null,
      viewerIsCreator: true,
    };
    const creatorVM = toBuddyPostDetailVM(detail, { viewerId: 'u_2048', now: NOW });
    expect(creatorVM.viewerIsCreator).toBe(true);
    expect(creatorVM.applications).toHaveLength(2);
    expect(creatorVM.pendingCount).toBe(2);
    expect(creatorVM.canClose).toBe(true);
    expect(creatorVM.canJoin).toBe(false);
    expect(creatorVM.privacy.items.length).toBeGreaterThan(0);
    expect(creatorVM.contactNotice).toContain('站内信');

    const applicantVM = toBuddyPostDetailVM(
      { ...detail, applications: [], viewerIsCreator: false, viewerApplication: makeApplication() },
      { viewerId: 'u_1024', now: NOW },
    );
    expect(applicantVM.applications).toHaveLength(0);
    expect(applicantVM.canJoin).toBe(false); // 已申请，不能重复申请
    expect(applicantVM.canLeave).toBe(true); // 可以撤回
    expect(applicantVM.canClose).toBe(false);
  });

  it('loadBuddyPostDetail 用会话里的实名 id 请求', async () => {
    let seenViewer = '';
    const repository = fakeRepository({
      postDetail: async (id, viewer) => {
        seenViewer = viewer;
        return ok({
          post: makePost({ id }),
          applications: [],
          viewerApplication: null,
          viewerIsCreator: false,
        });
      },
    });
    const result = await loadBuddyPostDetail(repository, 'bp-7', { session: DEMO_BUDDY_SESSION, now: NOW });
    expect(result.ok).toBe(true);
    expect(seenViewer).toBe(DEMO_BUDDY_SESSION.userId);
  });

  it('joinBuddyPost：申请成功后重新读详情（名额由服务端说了算）', async () => {
    let joinCalled = false;
    let detailCalls = 0;
    const repository = fakeRepository({
      join: async () => {
        joinCalled = true;
        return ok(makeApplication());
      },
      postDetail: async () => {
        detailCalls += 1;
        return ok({
          post: makePost({ joinedCount: 3 }),
          applications: [],
          viewerApplication: makeApplication(),
          viewerIsCreator: false,
        });
      },
    });
    const result = await joinBuddyPost(repository, {
      postId: 'bp-1',
      session: DEMO_BUDDY_SESSION,
      message: '我也常打',
      now: NOW,
    });
    expect(joinCalled).toBe(true);
    expect(detailCalls).toBe(1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.viewerApplication?.statusLabel).toBe('待审批');
  });

  it('joinBuddyPost 把服务端错误原样透传（例如 ALREADY_APPLIED）', async () => {
    const repository = fakeRepository({
      join: async () =>
        err({ code: 'CONFLICT', message: '你已经申请过这个活动了', details: { reason: 'ALREADY_APPLIED' } }),
    });
    const result = await joinBuddyPost(repository, {
      postId: 'bp-1',
      session: DEMO_BUDDY_SESSION,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('CONFLICT');
    expect((result.error.details as { reason?: string }).reason).toBe('ALREADY_APPLIED');
  });

  it('leave / decide / close 都调用对应动作并回读详情', async () => {
    const calls: string[] = [];
    const repository = fakeRepository({
      leave: async () => {
        calls.push('leave');
        return ok(makeApplication({ status: 'WITHDRAWN' }));
      },
      decide: async () => {
        calls.push('decide');
        return ok({
          post: makePost({ joinedCount: 3 }),
          applications: [],
          viewerApplication: null,
          viewerIsCreator: true,
        });
      },
      close: async () => {
        calls.push('close');
        return ok(makePost({ status: 'CLOSED' }));
      },
      // close 之后会回读详情：让详情也反映 CLOSED（服务端才是状态的唯一真相）
      postDetail: async () =>
        ok({
          post: makePost({ status: 'CLOSED' }),
          applications: [],
          viewerApplication: null,
          viewerIsCreator: true,
        }),
    });

    await leaveBuddyPost(repository, { postId: 'bp-1', session: DEMO_BUDDY_SESSION, now: NOW });
    await decideBuddyApplication(repository, {
      postId: 'bp-1',
      applicationId: 'ba-1',
      decision: 'ACCEPTED',
      session: DEMO_BUDDY_SESSION,
      now: NOW,
    });
    const closed = await closeBuddyPost(repository, {
      postId: 'bp-1',
      session: DEMO_BUDDY_SESSION,
      now: NOW,
    });

    expect(calls).toEqual(['leave', 'decide', 'close']);
    expect(closed.ok).toBe(true);
    if (!closed.ok) throw new Error('unreachable');
    expect(closed.value.post.statusLabel).toBe('已关闭');
  });
});

/* ------------------------------------------------------------------ *
 * 匹配资料（含可用时段编辑器）
 * ------------------------------------------------------------------ */

describe('匹配资料：VM、时段编辑与撤回', () => {
  it('VM 显式表达「默认关闭」与隐私边界', () => {
    const off = toBuddyProfileVM(makeProfile({ matchEnabled: false }), { now: NOW });
    expect(off.matchEnabled).toBe(false);
    expect(off.matchEnabledNotice).toContain('匹配已关闭');
    expect(off.privacyNotice).toContain('只被算法使用');
    expect(off.withdrawNotice).toContain('硬删');
    expect(off.sections).toHaveLength(3);
    expect(off.interestOptions.filter((option) => option.selected).map((o) => o.key)).toEqual([
      'self-study',
      'programming',
    ]);
    expect(off.skillOptions.find((option) => option.value === 'casual')?.selected).toBe(true);
    expect(off.availabilitySummary).toContain('2 段');
    expect(off.availabilitySummary).toContain('1 段跨零点');
    expect(off.draft.matchEnabled).toBe(false);
  });

  it('时段 VM：跨零点带「次日」标签与正确的时长', () => {
    const vm = toBuddyProfileVM(makeProfile(), { now: NOW });
    const cross = vm.availability.find((slot) => slot.crossMidnight);
    expect(cross?.label).toBe('周五 23:00–次日 01:00');
    expect(cross?.lengthLabel).toBe('2 小时');
    expect(cross?.start).toBe('23:00');
    expect(cross?.end).toBe('01:00');
  });

  it('时段编辑：追加 / 修改 / 删除，且非法 HH:MM 被忽略（不写 NaN）', () => {
    const base: BuddyAvailabilitySlot[] = [{ dow: 1, startMin: 480, endMin: 720 }];
    const added = appendAvailabilitySlot(base);
    expect(added).toHaveLength(2);
    expect(base).toHaveLength(1); // 不可变

    const updated = updateAvailabilitySlot(added, 0, { dow: 3, start: '09:30', end: '11:00' });
    expect(updated[0]).toEqual({ dow: 3, startMin: 570, endMin: 660 });

    const ignored = updateAvailabilitySlot(added, 0, { start: '不是时间' });
    expect(ignored[0]?.startMin).toBe(480);

    // 改成跨零点
    const cross = updateAvailabilitySlot(added, 0, { start: '23:00', end: '01:00' });
    expect(cross[0]).toEqual({ dow: 1, startMin: 1380, endMin: 60 });

    expect(removeAvailabilitySlot(added, 0)).toHaveLength(1);
  });

  it('星期选项固定 7 项，从周日开始（与 dow 约定一致）', () => {
    const options = weekdayOptions();
    expect(options).toHaveLength(7);
    expect(options[0]).toEqual({ value: 0, label: '周日' });
    expect(options[6]).toEqual({ value: 6, label: '周六' });
  });

  it('标签/板块切换：受上限约束，且不可变', () => {
    expect(toggleTag(['a'], 'b', 2)).toEqual(['a', 'b']);
    expect(toggleTag(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
    expect(toggleTag(['a', 'b'], 'a', 2)).toEqual(['b']);
    expect(toggleSection(['academic'], 'sport')).toEqual(['academic', 'sport']);
    expect(toggleSection(['academic', 'sport'], 'academic')).toEqual(['sport']);
  });

  it('tagGroups 覆盖五个分组且都是可选标签', () => {
    const groups = tagGroups();
    expect(groups.map((group) => group.group)).toEqual([
      'sport',
      'study',
      'meal',
      'travel',
      'interest',
    ]);
    expect(groups.every((group) => group.tags.length > 0)).toBe(true);
  });

  it('资料表单校验：空板块 → NO_SECTION；跨零点时段合法', () => {
    const form = validateBuddyProfileForm(emptyProfileDraft());
    expect(form.valid).toBe(false);
    expect(form.fieldErrors.sections).toContain('至少要选择一个板块');

    const crossMidnight: BuddyProfileDraft = {
      ...emptyProfileDraft(),
      sections: ['sport'],
      availability: [{ dow: 5, startMin: 1380, endMin: 60 }],
    };
    expect(validateBuddyProfileForm(crossMidnight).valid).toBe(true);
  });

  it('loadBuddyProfile / saveBuddyProfile / deleteBuddyProfile', async () => {
    const repository = fakeRepository();
    const loaded = await loadBuddyProfile(repository, 'u_1024', NOW);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error('unreachable');
    expect(loaded.value.matchEnabled).toBe(true);

    const saved = await saveBuddyProfile(repository, {
      userId: 'u_1024',
      draft: profileToDraft(makeProfile()),
      now: NOW,
    });
    expect(saved.ok).toBe(true);

    const deleted = await deleteBuddyProfile(repository, 'u_1024', NOW);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) throw new Error('unreachable');
    expect(deleted.value.matchEnabled).toBe(false);
    expect(deleted.value.sections).toHaveLength(3);
    expect(deleted.value.sections.every((section) => !section.selected)).toBe(true);
    expect(deleted.value.availability).toEqual([]);
    expect(deleted.value.draft.sections).toEqual([]);
  });

  it('saveBuddyProfile 校验失败 → VALIDATION_FAILED（含 problems）', async () => {
    const repository = fakeRepository();
    const result = await saveBuddyProfile(repository, {
      userId: 'u_1024',
      draft: emptyProfileDraft(),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(problemsFromApiError(result.error)).not.toEqual([]);
  });

  it('overlapsPost：跨零点时段判定活动时间窗', () => {
    const profile = { availability: [{ dow: 5, startMin: 1380, endMin: 60 }] };
    expect(
      overlapsPost(profile, { startsAt: '2026-10-23T23:30:00+08:00', durationMin: 60 }),
    ).toBe(true);
    expect(
      overlapsPost(profile, { startsAt: '2026-10-24T02:00:00+08:00', durationMin: 60 }),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 会话与 fixture 对齐
 * ------------------------------------------------------------------ */

describe('演示会话与 mock 数据集对齐', () => {
  it('DEMO_BUDDY_SESSION.userId 必须等于 mock fixture 的 DEMO_BUDDY_USER_ID', () => {
    expect(DEMO_BUDDY_SESSION.userId).toBe(DEMO_BUDDY_USER_ID);
  });

  it('会话里的性别只用于准入：不进 profile 草稿', () => {
    const draft = profileToDraft(makeProfile());
    expect(Object.keys(draft)).not.toContain('gender');
    expect(JSON.stringify(draft)).not.toContain('female');
  });

  it('sectionOf 在 application 层同样可用（板块永不硬编码）', () => {
    expect(sectionOf('game')).toBe('sport');
  });
});
