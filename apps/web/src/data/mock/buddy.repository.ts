/**
 * 找搭子 mock 适配器（契约 §7 硬规则 4：必须有 mock，UI 才能脱离后端开发）。
 *
 * 行为对齐真实后端的**契约形状**：返回 `Result<Page<...>, ApiError>`，
 * 错误码只用冻结的 `ApiErrorCode`，`details.reason` 只用规格 §5.4 / §5.5 的冻结值。
 * 所有出站数据都过一遍 zod schema —— mock 也不能绕过契约校验。
 *
 * 本文件同时是**服务端替身**，因此承担了客户端不该做的事：
 * - 游标编解码（契约 §11.10-E：`startsAt_asc` 需要 `(startsAt, id)` **复合**游标；
 *   对客户端完全不透明，`application` / `presentation` 只原样回传）；
 * - 匹配打分（复用 `@kedaya/shared` 的 `explainMatch` / `ruleScoreFor` / `applyHardFilters` /
 *   `fuseScore` / `overlapsAvailability` —— **本端不重写算法**，否则理由与服务端排序必然漂移）；
 * - 性别只用于 F5 准入判定，存在私有 `userGenders` 映射里，**绝不进出站对象**。
 */
import type { ApiError, ApiErrorCode, Page } from '@kedaya/contracts';
import {
  applyHardFilters,
  baseScoreFromCosineDistance,
  cosineDistance,
  err,
  explainMatch,
  feedbackAdjustment,
  fuseScore,
  hashVector,
  ok,
  profileText,
  ruleScoreFor,
  type MatchSubject,
  type Result,
} from '@kedaya/shared';

import {
  availabilityOverlapsPost,
  BUDDY_REASONS,
  canTransitionPost,
  emptyBuddyProfile,
  genderCompatible,
  genderMismatchReason,
  hasStarted,
  isBuddyActivity,
  isBuddySection,
  meetsMinSkillLevel,
  remainingSlots,
  sectionOf,
  skillRank,
  skillTooLowReason,
  toMatchSubject,
  validateBuddyPostDraft,
  validateBuddyProfileDraft,
  type BuddyApplication,
  type BuddyAvailabilitySlot,
  type BuddyGender,
  type BuddyMatchFeedback,
  type BuddyPost,
  type BuddyProfile,
  type BuddySection,
  type BuddySkillLevel,
} from '@/domain/models/buddy';
import type {
  BuddyFeedbackInput,
  BuddyPostDetail,
  BuddyPostListQuery,
  BuddyPostSort,
  BuddyRecommendation,
  BuddyRecommendationPage,
  BuddyRecommendationQuery,
  BuddyRepository,
  CloseBuddyPostInput,
  CreateBuddyPostInput,
  DecideBuddyApplicationInput,
  JoinBuddyPostInput,
  LeaveBuddyPostInput,
  MockFailureMode,
} from '@/domain/ports/buddy';

import {
  safeParseBuddyApplication,
  safeParseBuddyApplications,
  safeParseBuddyFeedback,
  safeParseBuddyPost,
  safeParseBuddyPostDetail,
  safeParseBuddyPostPage,
  safeParseBuddyProfile,
  safeParseBuddyRecommendationPage,
} from '../schemas/buddy';
import {
  createBuddySeed,
  DEMO_BUDDY_USER_ID,
  type BuddySeed,
} from './fixtures/buddy';

/* ------------------------------------------------------------------ *
 * 游标（**服务端替身**，客户端不得解析）
 * ------------------------------------------------------------------ */

interface BuddyCursorPayload {
  /** 排序方式：切换 sort 即失效（契约 §11.10-E） */
  s: BuddyPostSort;
  /** 排序键（ISO 字符串） */
  k: string;
  /** 次级键（ULID / id），保证同键多行时不重不漏 */
  i: string;
}

function toBase64Url(text: string): string {
  // Node ≥16 与所有浏览器都有 btoa；载荷是纯 ASCII（ISO 时间 + id）
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    return atob(padded);
  } catch {
    return null;
  }
}

/** 复合游标编码：`(sort, sortKey, id)` → base64url(JSON) */
export function encodeBuddyCursor(sort: BuddyPostSort, sortKey: string, id: string): string {
  return toBase64Url(JSON.stringify({ s: sort, k: sortKey, i: id } satisfies BuddyCursorPayload));
}

/** 解码失败返回 `null`（调用方返回 `VALIDATION_FAILED` / `INVALID_CURSOR`） */
export function decodeBuddyCursor(cursor: string): BuddyCursorPayload | null {
  const json = fromBase64Url(cursor);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<BuddyCursorPayload>;
    if (typeof parsed.s !== 'string' || typeof parsed.k !== 'string' || typeof parsed.i !== 'string') {
      return null;
    }
    if (parsed.s !== 'startsAt_asc' && parsed.s !== 'createdAt_desc') return null;
    return { s: parsed.s, k: parsed.k, i: parsed.i };
  } catch {
    return null;
  }
}

/** 推荐列表的游标：只含偏移量（不透明） */
export function encodeRecommendationCursor(offset: number): string {
  return toBase64Url(JSON.stringify({ o: offset }));
}

export function decodeRecommendationCursor(cursor: string): number | null {
  const json = fromBase64Url(cursor);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { o?: unknown };
    if (typeof parsed.o !== 'number' || !Number.isInteger(parsed.o) || parsed.o < 0) return null;
    return parsed.o;
  } catch {
    return null;
  }
}

export function clampBuddyLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(limit)));
}

/* ------------------------------------------------------------------ *
 * 纯函数：过滤 / 排序（可单测，与 mock 状态无关）
 * ------------------------------------------------------------------ */

export function sortKeyOf(post: BuddyPost, sort: BuddyPostSort): string {
  return sort === 'startsAt_asc' ? post.startsAt : post.createdAt;
}

export function sortBuddyPosts(
  posts: readonly BuddyPost[],
  sort: BuddyPostSort,
): BuddyPost[] {
  const out = [...posts];
  out.sort((a, b) => {
    const ka = sortKeyOf(a, sort);
    const kb = sortKeyOf(b, sort);
    if (ka === kb) return sort === 'startsAt_asc' ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
    return sort === 'startsAt_asc' ? ka.localeCompare(kb) : kb.localeCompare(ka);
  });
  return out;
}

export function filterBuddyPosts(
  posts: readonly BuddyPost[],
  query: BuddyPostListQuery,
  now: Date,
): BuddyPost[] {
  const startsAfter = query.startsAfter ? new Date(query.startsAfter) : now;
  const tags = query.tags ?? [];
  return posts.filter((post) => {
    // 默认只给 OPEN（规格 §5.9 的 where 子句）；includeClosed 是本端的显式扩展
    if (query.includeClosed) {
      if (post.status === 'CANCELLED') return false;
    } else if (post.status !== 'OPEN') {
      return false;
    }
    if (query.section && sectionOf(post.activity) !== query.section) return false;
    if (query.activity && post.activity !== query.activity) return false;
    if (tags.length > 0 && !tags.some((tag) => post.tags.includes(tag))) return false;
    const startsAt = new Date(post.startsAt).getTime();
    if (Number.isNaN(startsAt) || startsAt <= startsAfter.getTime()) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * MMR 多样性重排（规格 §3.3 第 9 步，移植 STUMatch matching.py:303-347）
 * ------------------------------------------------------------------ */

export interface MmrCandidate<T> {
  value: T;
  relevance: number;
  vector: readonly number[];
}

/**
 * `mmr(i) = λ × relevance(i) − (1 − λ) × max_{s ∈ selected} cos(vec_i, vec_s)`
 * 首个必选相关度最高者（对齐 STUMatch `matching.py:324-327`）。
 */
export function mmrRerank<T>(
  candidates: readonly MmrCandidate<T>[],
  lambda = 0.7,
): MmrCandidate<T>[] {
  const remaining = [...candidates];
  const selected: MmrCandidate<T>[] = [];
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i] as MmrCandidate<T>;
      let maxSim = 0;
      for (const chosen of selected) {
        const sim = 1 - cosineDistance(candidate.vector, chosen.vector);
        if (sim > maxSim) maxSim = sim;
      }
      const score = lambda * candidate.relevance - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0] as MmrCandidate<T>);
  }
  return selected;
}

/* ------------------------------------------------------------------ *
 * mock 工厂
 * ------------------------------------------------------------------ */

export interface MockBuddyOptions {
  /** 注入时钟（测试用固定时间） */
  now?: () => Date;
  /** 模拟网络延迟，用于演示骨架屏 */
  latencyMs?: number;
  /** 故障演练：'error' 时所有请求返回 UPSTREAM_UNAVAILABLE */
  failureMode?: MockFailureMode;
  /** 覆盖数据集（部分覆盖，其余用默认种子） */
  seed?: Partial<BuddySeed>;
  /** 默认页大小 */
  pageSize?: number;
  /** 推荐页默认条数 */
  recommendationSize?: number;
  /**
   * 降级档（规格 §3.5）。mock 默认 `hash`（有匹配资料时），
   * 没有资料或未开启匹配时**强制** `rule`（规格 §5.7）。
   */
  matchMode?: 'hash' | 'rule';
  /** MMR 的 λ（规格 §3.3 默认 0.7） */
  mmrLambda?: number;
  /** 「我」的实名 id（真实 API 从 Bearer token 取身份；mock 用这个字段） */
  viewerId?: string;
  /** 撤回后重新申请的冷却（毫秒），规格 §6.4 的 10 分钟防骚扰 */
  reapplyCooldownMs?: number;
}

export interface MockBuddyRepository extends BuddyRepository {
  setFailureMode(mode: MockFailureMode): void;
  getFailureMode(): MockFailureMode;
  /** 恢复到初始数据集 */
  reset(): void;
  /** 测试用：直接写入一份匹配资料（绕过表单校验） */
  setProfile(profile: BuddyProfile): void;
  /** 测试用：读取内部档案快照 */
  peekProfiles(): Record<string, BuddyProfile>;
}

function apiError(code: ApiErrorCode, message: string, details?: unknown): ApiError {
  return details === undefined ? { code, message } : { code, message, details };
}

function validationFailed(reason: string, message: string, extra?: unknown): ApiError {
  return apiError('VALIDATION_FAILED', message, {
    reason,
    ...(extra === undefined ? {} : { extra }),
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createMockBuddyRepository(options: MockBuddyOptions = {}): MockBuddyRepository {
  const now = options.now ?? (() => new Date());
  const latencyMs = options.latencyMs ?? 260;
  const pageSize = options.pageSize ?? 20;
  const recommendationSize = options.recommendationSize ?? 10;
  const defaultMatchMode = options.matchMode ?? 'hash';
  const mmrLambda = options.mmrLambda ?? 0.7;
  const viewerId = options.viewerId ?? DEMO_BUDDY_USER_ID;
  const reapplyCooldownMs = options.reapplyCooldownMs ?? 10 * 60_000;

  let failureMode: MockFailureMode = options.failureMode ?? 'none';

  const seed = options.seed ?? {};
  const initial = (): BuddySeed => {
    const base = createBuddySeed(now());
    return {
      posts: clone(seed.posts ?? base.posts),
      applications: clone(seed.applications ?? base.applications),
      profiles: clone(seed.profiles ?? base.profiles),
      feedbacks: clone(seed.feedbacks ?? base.feedbacks),
      userGenders: clone(seed.userGenders ?? base.userGenders),
    };
  };

  let state: BuddySeed = initial();
  /** 幂等键 → 指纹 + 结果（契约 §11.3 / 规格 T17） */
  let idempotency = new Map<string, { fingerprint: string; result: unknown }>();
  /** 撤回时刻（防"反复申请后撤回"骚扰，规格 §6.4） */
  let lastWithdrawnAt = new Map<string, number>();

  const delay = async (): Promise<void> => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
  };

  const failIfNeeded = (): ApiError | null =>
    failureMode === 'error'
      ? apiError('UPSTREAM_UNAVAILABLE', '找搭子服务暂时不可用（mock 故障演练）')
      : null;

  const requireKey = (key: string | undefined): ApiError | null =>
    key
      ? null
      : validationFailed(
          BUDDY_REASONS.IDEMPOTENCY_KEY_REQUIRED,
          '写操作必须带 Idempotency-Key（契约 §11.3）',
        );

  /** 幂等包裹：同键同指纹 → 复用结果；同键不同指纹 → CONFLICT */
  function idempotent<T>(
    key: string | undefined,
    fingerprint: string,
    produce: () => Result<T, ApiError>,
  ): Result<T, ApiError> {
    const cacheKey = key as string;
    const hit = idempotency.get(cacheKey);
    if (hit) {
      if (hit.fingerprint !== fingerprint) {
        return err(
          apiError('CONFLICT', '同一个 Idempotency-Key 被用于不同的请求体', {
            reason: 'IDEMPOTENCY_KEY_REUSED',
          }),
        );
      }
      return ok(clone(hit.result) as T);
    }
    const produced = produce();
    if (produced.ok) {
      idempotency.set(cacheKey, { fingerprint, result: clone(produced.value) });
    }
    return produced;
  }

  /**
   * 幂等缓存命中检查。**必须在业务前置校验之前调用** ——
   * 否则"重放同一个请求"会先撞上 `ALREADY_APPLIED` / `APPLICATION_NOT_PENDING`
   * 这类守卫，幂等键就白带了（契约 §11.3 的语义是"重放返回同样的结果"）。
   */
  function cachedResult<T>(
    key: string | undefined,
    fingerprint: string,
  ): Result<T, ApiError> | null {
    if (!key) return null;
    const hit = idempotency.get(key);
    if (!hit) return null;
    if (hit.fingerprint !== fingerprint) {
      return err(
        apiError('CONFLICT', '同一个 Idempotency-Key 被用于不同的请求体', {
          reason: 'IDEMPOTENCY_KEY_REUSED',
        }),
      );
    }
    return ok(clone(hit.result) as T);
  }

  const findPost = (id: string): BuddyPost | undefined => state.posts.find((p) => p.id === id);

  const applicationsOf = (postId: string): BuddyApplication[] =>
    state.applications.filter((a) => a.postId === postId);

  const applicationOf = (postId: string, applicantId: string): BuddyApplication | undefined =>
    state.applications.find((a) => a.postId === postId && a.applicantId === applicantId);

  function detailOf(post: BuddyPost, viewer: string): BuddyPostDetail {
    const viewerIsCreator = post.creator.id === viewer;
    const all = applicationsOf(post.id);
    // 规格 §6.1：申请人列表与留言只有发起人可见；申请人只看得到自己那条
    const applications = viewerIsCreator
      ? all
          .slice()
          .sort((a, b) =>
            a.status === b.status
              ? b.createdAt.localeCompare(a.createdAt)
              : a.status === 'PENDING'
                ? -1
                : 1,
          )
      : [];
    return {
      post,
      applications,
      viewerApplication: applicationOf(post.id, viewer) ?? null,
      viewerIsCreator,
    };
  }

  const appliedPostIds = (userId: string): Set<string> =>
    new Set(
      state.applications
        .filter(
          (a) => a.applicantId === userId && (a.status === 'PENDING' || a.status === 'ACCEPTED'),
        )
        .map((a) => a.postId),
    );

  const subjectOf = (userId: string): MatchSubject => {
    const profile = state.profiles[userId];
    if (!profile) {
      return { department: null, interestTags: [], activityTags: [], preferredAreas: [], skillLevel: null };
    }
    return toMatchSubject(profile);
  };

  function recommendationsFor(query: BuddyRecommendationQuery, at: Date): Result<
    { items: BuddyRecommendation[]; nextCursor: string | null; matchMode: 'vector' | 'hash' | 'rule' },
    ApiError
  > {
    if (!isBuddySection(query.section)) {
      return err(
        validationFailed(BUDDY_REASONS.INVALID_ACTIVITY, 'section 必填且只能是三个板块之一'),
      );
    }
    const section: BuddySection = query.section;
    const limit = clampBuddyLimit(query.limit, recommendationSize, 50);
    const profile = state.profiles[query.userId];
    const applied = appliedPostIds(query.userId);

    const inSection = state.posts.filter((post) => sectionOf(post.activity) === section);

    // ---- 降级档 rule：没有匹配资料 / 未开启匹配（规格 §5.7） ----
    if (!profile || !profile.matchEnabled || defaultMatchMode === 'rule') {
      const items = inSection
        .filter(
          (post) =>
            post.status === 'OPEN' &&
            remainingSlots(post) > 0 &&
            !hasStarted(post, at) &&
            post.creator.id !== query.userId &&
            !applied.has(post.id),
        )
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .map<BuddyRecommendation>((post) => ({
          post: clone(post),
          score: 0,
          reason: '按时间排序',
          reasons: [{ code: 'rule-order', label: '按时间排序', weight: 0 }],
        }));

      const offset = query.cursor ? decodeRecommendationCursor(query.cursor) : 0;
      if (offset === null) {
        return err(validationFailed(BUDDY_REASONS.INVALID_CURSOR, '推荐游标无效，请重新加载'));
      }
      const page = items.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return ok({
        items: page,
        nextCursor: nextOffset < items.length ? encodeRecommendationCursor(nextOffset) : null,
        matchMode: 'rule',
      });
    }

    // ---- 有资料：规则分 + 哈希向量基础分 + 反馈调整（规格 §3.4 模式 B） ----
    const me = toMatchSubject(profile);
    const feedbacks = state.feedbacks
      .filter((fb) => fb.userId === query.userId && fb.section === section)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const adjustments = feedbackAdjustment(
      feedbacks.map((fb) => ({
        targetPostId: fb.targetPostId,
        action: fb.action,
        createdAt: new Date(fb.createdAt),
      })),
      at,
    );
    const viewerGender: BuddyGender = state.userGenders[query.userId] ?? 'unspecified';

    const scored: MmrCandidate<BuddyRecommendation>[] = [];
    for (const post of inSection) {
      const creatorProfile = state.profiles[post.creator.id];
      const target = { creator: subjectOf(post.creator.id), tags: post.tags };
      const availabilityOverlaps = availabilityOverlapsPost(profile.availability, post);
      const gate = applyHardFilters(
        {
          status: post.status,
          joinedCount: post.joinedCount,
          capacity: post.capacity,
          startsAt: new Date(post.startsAt),
          creatorId: post.creator.id,
          viewerId: query.userId,
          alreadyApplied: applied.has(post.id),
          genderCompatible: genderCompatible(
            post.genderPreference,
            state.userGenders[post.creator.id] ?? 'unspecified',
            viewerGender,
          ),
          minSkillLevel: post.minSkillLevel,
          viewerSkillLevel: profile.skillLevel,
          availabilityOverlaps,
          skillRank: (level: string) => skillRank(level as BuddySkillLevel),
        },
        at,
      );
      if (!gate.pass) continue;

      const ruleScore = ruleScoreFor(section, me, target, { availabilityOverlaps });
      const baseScore = baseScoreFromCosineDistance(
        cosineDistance(
          hashVector(
            profileText({
              bio: profile.bio,
              interestTags: profile.interestTags,
              activityTags: profile.activityTags,
            }),
          ),
          hashVector(
            profileText({
              description: post.description,
              tags: post.tags,
              interestTags: creatorProfile?.interestTags,
              activityTags: creatorProfile?.activityTags,
            }),
          ),
        ),
      );
      const score = fuseScore({
        mode: defaultMatchMode,
        baseScore,
        ruleScore,
        feedbackAdjustment: adjustments.get(post.id) ?? 0,
      });
      const reasons = explainMatch(section, me, target, { availabilityOverlaps });
      scored.push({
        value: {
          post: clone(post),
          score: Math.round(score * 1000) / 1000,
          // 无任何规则命中时的回落（规格 §5.7：`reason` 必须非空）
          reason: reasons.length > 0 ? reasons.map((r) => r.label).join('、') : '有潜在匹配',
          reasons:
            reasons.length > 0
              ? reasons
              : [{ code: 'potential', label: '有潜在匹配', weight: 0 }],
        },
        relevance: score,
        vector: hashVector(profileText({ description: post.description, tags: post.tags })),
      });
    }

    scored.sort((a, b) => b.relevance - a.relevance);
    const ranked = mmrRerank(scored, mmrLambda).map((candidate) => candidate.value);

    const offset = query.cursor ? decodeRecommendationCursor(query.cursor) : 0;
    if (offset === null) {
      return err(validationFailed(BUDDY_REASONS.INVALID_CURSOR, '推荐游标无效，请重新加载'));
    }
    const page = ranked.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return ok({
      items: page,
      nextCursor: nextOffset < ranked.length ? encodeRecommendationCursor(nextOffset) : null,
      matchMode: defaultMatchMode,
    });
  }

  return {
    async listPosts(query: BuddyPostListQuery): Promise<Result<Page<BuddyPost>, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const at = now();
      const sort: BuddyPostSort = query.sort ?? 'startsAt_asc';
      const filtered = filterBuddyPosts(state.posts, query, at);
      const sorted = sortBuddyPosts(filtered, sort);

      let startIndex = 0;
      if (query.cursor) {
        const decoded = decodeBuddyCursor(query.cursor);
        if (!decoded || decoded.s !== sort) {
          return err(
            validationFailed(
              BUDDY_REASONS.INVALID_CURSOR,
              '游标无效或与当前排序不一致，请重新加载列表',
            ),
          );
        }
        const index = sorted.findIndex(
          (post) => sortKeyOf(post, sort) === decoded.k && post.id === decoded.i,
        );
        if (index < 0) {
          return err(
            validationFailed(BUDDY_REASONS.INVALID_CURSOR, '游标已失效（筛选条件可能已变化）'),
          );
        }
        startIndex = index + 1;
      }

      const limit = clampBuddyLimit(query.limit, pageSize, 100);
      const items = sorted.slice(startIndex, startIndex + limit);
      const last = items[items.length - 1];
      const nextCursor =
        last && startIndex + items.length < sorted.length
          ? encodeBuddyCursor(sort, sortKeyOf(last, sort), last.id)
          : null;

      const parsed = safeParseBuddyPostPage({
        items,
        nextCursor,
        total: sorted.length,
      });
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 数据不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(parsed.value);
    },

    async postDetail(id: string, viewer: string): Promise<Result<BuddyPostDetail, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const post = findPost(id);
      if (!post) return err(apiError('NOT_FOUND', `活动不存在或不可见：${id}`));

      const parsed = safeParseBuddyPostDetail(detailOf(post, viewer));
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 数据不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(parsed.value);
    },

    async createPost(input: CreateBuddyPostInput): Promise<Result<BuddyPost, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const keyError = requireKey(input.idempotencyKey);
      if (keyError) return err(keyError);

      const fingerprint = JSON.stringify(input);
      const cached = cachedResult<BuddyPost>(input.idempotencyKey, fingerprint);
      if (cached) return cached;

      if (cached) return cached;

      const at = now();
      const problems = validateBuddyPostDraft(input, { now: at });
      if (problems.length > 0) {
        const first = problems[0] as (typeof problems)[number];
        return err(validationFailed(first.reason, first.message, { problems }));
      }

      return idempotent(input.idempotencyKey, fingerprint, () => {
        const id = `bp-${9000 + state.posts.length + 1}`;
        const post: BuddyPost = {
          id,
          activity: input.activity,
          status: 'OPEN',
          title: input.title.trim(),
          description: input.description.trim() ? input.description.trim() : null,
          location: input.location,
          startsAt: new Date(input.startsAt).toISOString(),
          durationMin: input.durationMin,
          capacity: input.capacity,
          // 契约 §11.10-D：发起人计入，初值为 1
          joinedCount: 1,
          genderPreference: input.genderPreference,
          minSkillLevel: sectionOf(input.activity) === 'sport' ? input.minSkillLevel : null,
          tags: [...new Set(input.tags)],
          creator: {
            id: input.creator.id,
            nickname: input.creator.nickname,
            avatarUrl: input.creator.avatarUrl ?? null,
          },
          createdAt: at.toISOString(),
          autoCloseAt: new Date(input.startsAt).toISOString(),
        };
        state.posts = [...state.posts, post];
        const parsed = safeParseBuddyPost(post);
        if (!parsed.ok) {
          return err(apiError('INTERNAL', 'mock 发布产生了非法数据', { issues: parsed.issues }));
        }
        return ok(parsed.value);
      });
    },

    async join(input: JoinBuddyPostInput): Promise<Result<BuddyApplication, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const keyError = requireKey(input.idempotencyKey);
      if (keyError) return err(keyError);

      const fingerprint = JSON.stringify(input);
      const cached = cachedResult<BuddyApplication>(input.idempotencyKey, fingerprint);
      if (cached) return cached;

      const at = now();
      const post = findPost(input.postId);
      if (!post) return err(apiError('NOT_FOUND', `活动不存在或不可见：${input.postId}`));

      if (post.creator.id === input.applicant.id) {
        return err(apiError('CONFLICT', '不能申请自己发布的活动', { reason: BUDDY_REASONS.CANNOT_JOIN_OWN_POST }));
      }
      if (post.status !== 'OPEN') {
        return err(
          apiError('CONFLICT', '活动当前不可申请', { reason: BUDDY_REASONS.POST_NOT_OPEN }),
        );
      }
      if (remainingSlots(post) <= 0) {
        return err(apiError('CONFLICT', '名额已满', { reason: BUDDY_REASONS.POST_FULL }));
      }
      if (hasStarted(post, at)) {
        return err(apiError('CONFLICT', '活动已开始', { reason: BUDDY_REASONS.POST_NOT_OPEN }));
      }
      if (input.message !== undefined && input.message.length > 200) {
        return err(validationFailed(BUDDY_REASONS.INVALID_DESCRIPTION, '申请留言不能超过 200 字'));
      }

      const existing = applicationOf(input.postId, input.applicant.id);
      if (existing && (existing.status === 'PENDING' || existing.status === 'ACCEPTED')) {
        return err(
          apiError('CONFLICT', '你已经申请过这个活动了', { reason: BUDDY_REASONS.ALREADY_APPLIED }),
        );
      }
      if (existing && existing.status === 'REJECTED') {
        return err(
          apiError('CONFLICT', '这条申请已被拒绝，不能重复申请', {
            reason: BUDDY_REASONS.ALREADY_APPLIED,
          }),
        );
      }
      const withdrawnAt = lastWithdrawnAt.get(`${input.postId}|${input.applicant.id}`);
      if (withdrawnAt !== undefined && at.getTime() - withdrawnAt < reapplyCooldownMs) {
        return err(
          apiError('RATE_LIMITED', '撤回后 10 分钟内不能重新申请（防反复申请骚扰）'),
        );
      }

      if (
        !genderCompatible(
          post.genderPreference,
          state.userGenders[post.creator.id] ?? 'unspecified',
          input.applicant.gender,
        )
      ) {
        return err(
          apiError('FORBIDDEN', genderMismatchReason(post.genderPreference), {
            reason: BUDDY_REASONS.GENDER_PREFERENCE_MISMATCH,
          }),
        );
      }
      if (!meetsMinSkillLevel(input.applicant.skillLevel, post.minSkillLevel)) {
        return err(
          apiError('FORBIDDEN', skillTooLowReason(post.minSkillLevel as BuddySkillLevel), {
            reason: BUDDY_REASONS.SKILL_LEVEL_TOO_LOW,
          }),
        );
      }

      return idempotent(input.idempotencyKey, fingerprint, () => {
        const message = input.message?.trim() ? input.message.trim() : null;
        if (existing) {
          // `@@unique([postId, applicantId])`：撤回后重新申请是**更新**该行回 PENDING
          existing.status = 'PENDING';
          existing.message = message;
          existing.createdAt = at.toISOString();
          existing.decidedAt = null;
          existing.decidedBy = null;
          const parsed = safeParseBuddyApplication(existing);
          if (!parsed.ok) {
            return err(apiError('INTERNAL', 'mock 申请数据非法', { issues: parsed.issues }));
          }
          return ok(parsed.value);
        }

        const application: BuddyApplication = {
          id: `ba-${9000 + state.applications.length + 1}`,
          postId: input.postId,
          applicantId: input.applicant.id,
          applicantNickname: input.applicant.nickname,
          status: 'PENDING',
          message,
          createdAt: at.toISOString(),
          decidedAt: null,
          decidedBy: null,
        };
        state.applications = [...state.applications, application];
        // ⚠️ join 只是**申请**，不占名额：joinedCount 只在 decide(ACCEPTED) 时递增（规格 §5.5）
        const parsed = safeParseBuddyApplication(application);
        if (!parsed.ok) {
          return err(apiError('INTERNAL', 'mock 申请数据非法', { issues: parsed.issues }));
        }
        return ok(parsed.value);
      });
    },

    async leave(input: LeaveBuddyPostInput): Promise<Result<BuddyApplication, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const keyError = requireKey(input.idempotencyKey);
      if (keyError) return err(keyError);

      const application = applicationOf(input.postId, input.applicantId);
      if (!application) return err(apiError('NOT_FOUND', '没有找到你的申请'));
      if (application.status !== 'PENDING') {
        return err(
          apiError('CONFLICT', '只有待审批的申请可以撤回', {
            reason: BUDDY_REASONS.APPLICATION_NOT_PENDING,
          }),
        );
      }

      application.status = 'WITHDRAWN';
      lastWithdrawnAt.set(`${input.postId}|${input.applicantId}`, now().getTime());
      const parsed = safeParseBuddyApplication(application);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 申请数据非法', { issues: parsed.issues }));
      }
      return ok(parsed.value);
    },

    async decide(input: DecideBuddyApplicationInput): Promise<Result<BuddyPostDetail, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const keyError = requireKey(input.idempotencyKey);
      if (keyError) return err(keyError);

      const fingerprint = JSON.stringify(input);
      const cached = cachedResult<BuddyPostDetail>(input.idempotencyKey, fingerprint);
      if (cached) return cached;

      const at = now();
      const post = findPost(input.postId);
      if (!post) return err(apiError('NOT_FOUND', `活动不存在或不可见：${input.postId}`));
      if (post.creator.id !== input.actorId) {
        return err(apiError('FORBIDDEN', '只有发起人可以审批申请', { reason: BUDDY_REASONS.NOT_CREATOR }));
      }
      const application = state.applications.find(
        (a) => a.id === input.applicationId && a.postId === input.postId,
      );
      if (!application) return err(apiError('NOT_FOUND', '申请不存在'));
      if (application.status !== 'PENDING') {
        return err(
          apiError('CONFLICT', '这条申请已经处理过了', {
            reason: BUDDY_REASONS.APPLICATION_NOT_PENDING,
          }),
        );
      }

      return idempotent(input.idempotencyKey, fingerprint, () => {
        if (input.decision === 'ACCEPTED') {
          if (remainingSlots(post) <= 0) {
            return err(apiError('CONFLICT', '名额已满，无法再接受申请', { reason: BUDDY_REASONS.POST_FULL }));
          }
          post.joinedCount += 1;
          if (post.joinedCount >= post.capacity) post.status = 'FULL';
        }
        application.status = input.decision;
        application.decidedAt = at.toISOString();
        application.decidedBy = input.actorId;

        const parsed = safeParseBuddyPostDetail(detailOf(post, input.actorId));
        if (!parsed.ok) {
          return err(apiError('INTERNAL', 'mock 审批产生了非法数据', { issues: parsed.issues }));
        }
        return ok(parsed.value);
      });
    },

    async close(input: CloseBuddyPostInput): Promise<Result<BuddyPost, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const keyError = requireKey(input.idempotencyKey);
      if (keyError) return err(keyError);

      const fingerprint = JSON.stringify(input);
      const cached = cachedResult<BuddyPost>(input.idempotencyKey, fingerprint);
      if (cached) return cached;

      const post = findPost(input.postId);
      if (!post) return err(apiError('NOT_FOUND', `活动不存在或不可见：${input.postId}`));
      if (post.creator.id !== input.actorId) {
        return err(apiError('FORBIDDEN', '只有发起人可以关闭活动', { reason: BUDDY_REASONS.NOT_CREATOR }));
      }
      if (!canTransitionPost(post.status, 'CLOSED')) {
        return err(apiError('CONFLICT', '当前状态不能关闭'));
      }

      return idempotent(input.idempotencyKey, fingerprint, () => {
        post.status = 'CLOSED';
        const parsed = safeParseBuddyPost(post);
        if (!parsed.ok) {
          return err(apiError('INTERNAL', 'mock 关闭产生了非法数据', { issues: parsed.issues }));
        }
        return ok(parsed.value);
      });
    },

    async feedback(input: BuddyFeedbackInput): Promise<Result<BuddyMatchFeedback, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const keyError = requireKey(input.idempotencyKey);
      if (keyError) return err(keyError);

      const fingerprint = JSON.stringify(input);
      const cached = cachedResult<BuddyMatchFeedback>(input.idempotencyKey, fingerprint);
      if (cached) return cached;

      const post = findPost(input.postId);
      if (!post) return err(apiError('NOT_FOUND', `活动不存在或不可见：${input.postId}`));
      if (!['like', 'dislike', 'skip'].includes(input.action)) {
        return err(validationFailed(BUDDY_REASONS.INVALID_ACTIVITY, 'action 只能是 like / dislike / skip'));
      }
      if (!isBuddySection(input.section)) {
        return err(validationFailed(BUDDY_REASONS.INVALID_ACTIVITY, 'section 非法'));
      }
      if (!isBuddyActivity(post.activity)) {
        return err(apiError('INTERNAL', 'mock 帖子数据非法'));
      }

      return idempotent(input.idempotencyKey, fingerprint, () => {
        // `@@unique([userId, targetPostId, section])` → UPSERT，不累积
        const index = state.feedbacks.findIndex(
          (fb) =>
            fb.userId === input.userId &&
            fb.targetPostId === input.postId &&
            fb.section === input.section,
        );
        const record: BuddyMatchFeedback = {
          userId: input.userId,
          targetPostId: input.postId,
          section: input.section,
          action: input.action,
          createdAt: now().toISOString(),
        };
        if (index >= 0) {
          state.feedbacks = state.feedbacks.map((fb, i) => (i === index ? record : fb));
        } else {
          state.feedbacks = [...state.feedbacks, record];
        }
        const parsed = safeParseBuddyFeedback(record);
        if (!parsed.ok) {
          return err(apiError('INTERNAL', 'mock 反馈数据非法', { issues: parsed.issues }));
        }
        return ok(parsed.value);
      });
    },

    async recommendations(query: BuddyRecommendationQuery) {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      const result = recommendationsFor(query, now());
      if (!result.ok) return result;
      const parsed = safeParseBuddyRecommendationPage(result.value);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 推荐数据不符合冻结契约', { issues: parsed.issues }));
      }
      return ok({
        items: parsed.value.items.map((item) => ({
          post: item.post,
          score: item.score,
          reason: item.reason,
          reasons: item.reasons ?? [],
        })),
        nextCursor: parsed.value.nextCursor,
        matchMode: parsed.value.matchMode,
      }) satisfies Result<BuddyRecommendationPage, ApiError>;
    },

    async listMyApplications(userId: string): Promise<Result<BuddyApplication[], ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const mine = state.applications
        .filter((a) => a.applicantId === userId)
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const parsed = safeParseBuddyApplications(mine);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 申请列表不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(parsed.value);
    },

    async getProfile(userId: string): Promise<Result<BuddyProfile, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      // 没有资料时返回**默认关闭**的空资料，而不是 404 ——
      // 「还没开匹配」是常态，不是错误（规格 §6.3）
      const profile = state.profiles[userId] ?? emptyBuddyProfile(userId, now());
      const parsed = safeParseBuddyProfile(profile);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 资料不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(parsed.value);
    },

    async putProfile(input) {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const problems = validateBuddyProfileDraft(input);
      if (problems.length > 0) {
        const first = problems[0] as (typeof problems)[number];
        return err(validationFailed(first.reason, first.message, { problems }));
      }

      const profile: BuddyProfile = {
        userId: input.userId,
        sections: [...new Set(input.sections)],
        interestTags: [...new Set(input.interestTags)],
        activityTags: [...new Set(input.activityTags)],
        skillLevel: input.skillLevel,
        availability: input.availability.map((slot: BuddyAvailabilitySlot) => ({ ...slot })),
        preferredAreas: [...new Set(input.preferredAreas)],
        department: input.department?.trim() ? input.department.trim() : null,
        bio: input.bio?.trim() ? input.bio.trim() : null,
        matchEnabled: input.matchEnabled,
        updatedAt: now().toISOString(),
      };
      state.profiles = { ...state.profiles, [input.userId]: profile };
      const parsed = safeParseBuddyProfile(profile);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 资料不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(parsed.value);
    },

    async deleteProfile(userId: string): Promise<Result<{ deleted: true }, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const next = { ...state.profiles };
      delete next[userId];
      state.profiles = next;
      // 立即从推荐池移除（规格 §6.3 / 验收 T30）
      return ok({ deleted: true as const });
    },

    setFailureMode(mode: MockFailureMode): void {
      failureMode = mode;
    },

    getFailureMode(): MockFailureMode {
      return failureMode;
    },

    reset(): void {
      state = initial();
      idempotency = new Map();
      lastWithdrawnAt = new Map();
      failureMode = 'none';
    },

    setProfile(profile: BuddyProfile): void {
      state.profiles = { ...state.profiles, [profile.userId]: clone(profile) };
    },

    peekProfiles(): Record<string, BuddyProfile> {
      return clone(state.profiles);
    },
  };
}
