import {
  explainMatch,
  type FeedbackAction,
  type MatchMode,
  type MatchReason,
  type MatchSubject,
} from '@kedaya/shared'

import { availabilityOverlapsPost, summarizeBuddyPost } from '../../domain/models/buddy'
import type { BuddyPost, BuddyPostSummary, BuddyProfile, BuddySection } from '../../domain/models/buddy'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { BuddyRepository } from '../../domain/ports/buddyRepository'
import type { SessionStorePort } from '../../domain/ports/sessionPort'

/**
 * 推荐页用例（规格 §3 / §5.7 / G3）—— **本模块的可解释性落点**。
 *
 * ## 为什么必须调 `explainMatch()`
 *
 * 规格 G3 要求「每条推荐必须给出中文理由」，而任务要求更严格：
 * 理由**必须**由 `@kedaya/shared` 的 `explainMatch()` 产出 ——
 * 它是服务端排序用的**同一套**纯函数。自己拼一句「为你智能推荐」会让
 * 用户看到与服务端排序不一致的理由，那比不给理由更糟。
 *
 * ## 客户端能算出哪些理由（诚实边界，规格 §6.1）
 *
 * `BuddyProfile` **对任何人都不直接可见**，包括发起人。因此客户端**拿不到**
 * 其它同学的院系 / 兴趣标签 —— 也就**不可能**独立算出「同一个院系」
 * 或「共同兴趣 N 项」。硬算只能靠编造，那正是隐私与诚实性的双重违规。
 *
 * 所以理由分两路，且**显式标注来源**：
 *
 * | 来源 | 依据 | 覆盖的理由 |
 * | --- | --- | --- |
 * | `server` | 服务端下发（它看得到双方资料） | 全部，含「同一个院系」「共同兴趣 N 项」 |
 * | `client` | 公开的帖子数据（`tags` / `location` / `minSkillLevel`）+ 我自己的资料 | 「共同活动 N 项」「时间能碰上」「常在同一个区域」「水平接近」 |
 *
 * 服务端**没有**下发结构化理由时（例如 OpenAPI 只回了 `reason` 字符串），
 * 客户端用 `explainMatch()` 补齐它能诚实支撑的那部分 —— 而不是给一个分数了事。
 *
 * ## 降级
 *
 * `matchMode` **必须原样暴露**（规格 §5.7）：`rule` 模式下不能说「为你智能推荐」。
 */

/** 理由来源：诚实标注，便于排查「客户端与服务端理由不一致」 */
export type ReasonSource = 'server' | 'client'

export interface BuddyRecommendationView {
  postId: string
  post: BuddyPostSummary
  /** 0–1，保留 3 位小数 */
  score: number
  /** 展示用的中文理由（**保证非空**） */
  reason: string
  /** 结构化理由条目（按权重降序）——「公开共同点」标签 */
  reasons: MatchReason[]
  /**
   * `reasons`（标签）的来源。
   * ⚠️ 它**不**描述 `reason`（标题）：标题永远优先用服务端原文。
   */
  reasonSource: ReasonSource
  /**
   * 服务端下发的理由原文（**排序依据**的表述）；`null` = 服务端没给。
   * 与 `reasons` 分开是因为服务端目前只回字符串，而字符串是用双方完整资料算的，
   * 客户端无法复现 —— 把两者混在一起会造出「解释与排序不一致」的假象。
   */
  serverReason: string | null
  matchMode: MatchMode
  /** 我对这条推荐提交过的反馈（null = 还没反馈） */
  myFeedback: FeedbackAction | null
}

export type BuddyRecommendationStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface BuddyRecommendationState {
  status: BuddyRecommendationStatus
  section: BuddySection
  items: BuddyRecommendationView[]
  matchMode: MatchMode
  /** 当前展示的数据来自本地缓存（还没被网络刷新过） */
  fromCache: boolean
  updatedAt: string | null
  error: string | null
  /** 正在提交反馈的帖子 id */
  feedbackPending: string | null
  feedbackError: string | null
  /** 我的匹配资料（用于算理由与 F7；`null` = 还没填） */
  profile: BuddyProfile | null
  /** 匹配资料未开启 → 页面要如实说明「当前按时间排序」 */
  matchEnabled: boolean
}

export interface BuddyRecommendationDeps {
  repository: BuddyRepository
  cache: CachePort
  clock: ClockPort
  session: SessionStorePort
  cacheKeyFor: (section: BuddySection) => string
  feedbackCacheKey: string
}

export interface BuddyRecommendationUseCase {
  getSnapshot(): BuddyRecommendationState
  subscribe(listener: () => void): () => void
  hydrate(section?: BuddySection): BuddyRecommendationState
  load(section?: BuddySection): Promise<BuddyRecommendationState>
  feedback(postId: string, action: FeedbackAction): Promise<BuddyRecommendationState>
  reset(): void
}

export const DEFAULT_RECOMMEND_SECTION: BuddySection = 'sport'

/* ------------------------------------------------------------------ *
 * 纯函数：从「我的资料 + 公开的帖子数据」导出理由（可单测）
 * ------------------------------------------------------------------ */

/** 我的资料 → 匹配特征 */
export function toMatchSubject(profile: BuddyProfile): MatchSubject {
  return {
    department: profile.department,
    interestTags: profile.interestTags,
    activityTags: profile.activityTags,
    preferredAreas: profile.preferredAreas,
    skillLevel: profile.skillLevel,
  }
}

/**
 * 帖子里**公开**的匹配特征。
 *
 * ⚠️ 这里刻意把 `department` / `interestTags` 留空 —— 发起人的院系与兴趣
 * **不对客户端公开**（规格 §6.1）。客户端因此永远不会凭空说出「同一个院系」；
 * 那句话只能来自服务端。
 *
 * `activityTags` 用帖子的 `tags`：帖子标签是公开的，且这正是
 * 「共同活动 N 项」这条理由唯一诚实的数据来源。
 * `preferredAreas` 用活动地点：地点公开，且「常在同一个区域」是真实成立的陈述。
 */
export function publicSubjectOf(post: Pick<BuddyPost, 'tags' | 'location' | 'minSkillLevel'>): MatchSubject {
  return {
    department: null,
    interestTags: [],
    activityTags: post.tags,
    preferredAreas: [post.location],
    skillLevel: post.minSkillLevel,
  }
}

/** 用 `explainMatch` 算客户端能诚实支撑的理由（与服务端同一套算法） */
export function deriveReasons(
  section: BuddySection,
  profile: BuddyProfile,
  post: Pick<BuddyPost, 'tags' | 'location' | 'minSkillLevel' | 'startsAt' | 'durationMin'>,
): MatchReason[] {
  const availabilityOverlaps = availabilityOverlapsPost(profile.availability, post)
  return explainMatch(
    section,
    toMatchSubject(profile),
    { creator: publicSubjectOf(post), tags: post.tags },
    { availabilityOverlaps },
  )
}

/** 理由 → 中文文案（取前 3 条，对齐 `matching.py:265-301`）；无命中时回落「有潜在匹配」 */
export function reasonText(reasons: readonly MatchReason[]): string {
  if (reasons.length === 0) return '有潜在匹配'
  return reasons
    .slice(0, 3)
    .map((r) => r.label)
    .join('、')
}

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */

interface CachedRecommendations {
  items: Array<{ post: BuddyPost; score: number; reason: string }>
  matchMode: MatchMode
  updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isCachedRecommendations(value: unknown): value is CachedRecommendations {
  if (!isRecord(value)) return false
  return Array.isArray(value.items) && typeof value.updatedAt === 'string'
}

export function createBuddyRecommendationsUseCase(
  deps: BuddyRecommendationDeps,
): BuddyRecommendationUseCase {
  const { repository, cache, clock, session, cacheKeyFor, feedbackCacheKey } = deps

  let state: BuddyRecommendationState = {
    status: 'idle',
    section: DEFAULT_RECOMMEND_SECTION,
    items: [],
    matchMode: 'rule',
    fromCache: false,
    updatedAt: null,
    error: null,
    feedbackPending: null,
    feedbackError: null,
    profile: null,
    matchEnabled: false,
  }
  const hydratedSections = new Set<BuddySection>()
  /** 本地记住的反馈（UPSERT 语义：同一帖只保留最后一次） */
  let myFeedback: Record<string, FeedbackAction> = {}
  const listeners = new Set<() => void>()

  function patch(next: Partial<BuddyRecommendationState>): BuddyRecommendationState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function readFeedbackMemory(): Record<string, FeedbackAction> {
    const raw = cache.read<unknown>(feedbackCacheKey)
    if (!isRecord(raw)) return {}
    const out: Record<string, FeedbackAction> = {}
    for (const [key, value] of Object.entries(raw)) {
      if (value === 'like' || value === 'dislike' || value === 'skip') out[key] = value
    }
    return out
  }

  function writeFeedbackMemory(): void {
    cache.write(feedbackCacheKey, myFeedback)
  }

  /**
   * 组装展示视图。
   *
   * ## 为什么「标题理由」与「结构化标签」要分开标注来源
   *
   * 服务端的 `/buddy/recommendations` **只回一个 `reason` 字符串**
   * （`services/api/.../buddy-recommend.service.ts:185` 的
   * `items.push({ post, score, reason })`），**没有**结构化条目。
   * 而那个字符串是用**双方完整资料**算出来的 —— 客户端拿不到（规格 §6.1），
   * 因此客户端用 `explainMatch()` 只能算出**公开信息**支撑的那部分。
   *
   * 于是两者是**不同的东西**，不能混为一谈：
   * - `reason`（标题）= 服务端下发的原文 —— 它才是**排序依据**的表述；
   * - `reasons`（标签）= 服务端结构化条目（有则用），否则客户端按公开信息推算；
   * - `reasonSource` = **`reasons` 的来源**；
   * - `serverReason` = 服务端原文（`null` 表示服务端没给）。
   *
   * ⚠️ 早先版本在客户端能推算时**用推算结果覆盖了服务端的 `reason`** ——
   * 那会让用户看到一句与服务端排序**不一致**的解释，正是本模块最要避免的失败模式。
   * 现在标题永远优先用服务端原文，客户端的推算只作为「公开共同点」标签展示。
   */
  function toView(
    section: BuddySection,
    item: { post: BuddyPost; score: number; reason: string; reasons: MatchReason[] },
    profile: BuddyProfile | null,
    matchMode: MatchMode,
  ): BuddyRecommendationView {
    const now = clock.now()
    const serverReasons = item.reasons
    const serverReason = item.reason.trim() === '' ? null : item.reason

    const chips = serverReasons.length > 0 ? serverReasons : profile === null ? [] : deriveReasons(section, profile, item.post)

    const reason = serverReason ?? (chips.length > 0 ? reasonText(chips) : '有潜在匹配')

    return {
      postId: item.post.id,
      post: summarizeBuddyPost(item.post, now),
      score: item.score,
      reason,
      reasons: chips,
      // `reasonSource` 描述的是 `reasons`（标签）的来源，不是 `reason`（标题）
      reasonSource: serverReasons.length > 0 ? 'server' : 'client',
      serverReason,
      matchMode,
      myFeedback: myFeedback[item.post.id] ?? null,
    }
  }

  function hydrateFn(section: BuddySection = state.section): BuddyRecommendationState {
      if (hydratedSections.has(section)) return state
      hydratedSections.add(section)
      myFeedback = readFeedbackMemory()

      const cached = cache.read<unknown>(cacheKeyFor(section))
      if (!isCachedRecommendations(cached)) {
        if (section !== state.section) {
          return patch({
            status: 'idle',
            section,
            items: [],
            error: null,
            fromCache: false,
            updatedAt: null,
          })
        }
        return state
      }

      const items = cached.items.map((item) =>
        toView(
          section,
          { post: item.post, score: item.score, reason: item.reason, reasons: [] },
          state.profile,
          cached.matchMode,
        ),
      )

      return patch({
        status: items.length === 0 ? 'empty' : 'ready',
        section,
        items,
        matchMode: cached.matchMode,
        fromCache: true,
        updatedAt: cached.updatedAt,
        error: null,
        feedbackError: null,
      })
  }

  async function loadFn(
    section: BuddySection = state.section,
  ): Promise<BuddyRecommendationState> {
      myFeedback = readFeedbackMemory()

      if (section !== state.section) {
        patch({
          status: 'loading',
          section,
          items: [],
          error: null,
          fromCache: false,
          updatedAt: null,
        })
      } else {
        patch({ status: state.items.length > 0 ? 'ready' : 'loading', error: null })
      }

      // 我的匹配资料：既是理由的输入，也是「是否开启匹配」的判定依据。
      // 拉取失败不阻塞推荐（降级为「按时间排序」，规格 §5.7 末段）。
      const profileResult = await repository.getProfile()
      const profile = profileResult.ok ? profileResult.value : null

      const result = await repository.recommendations(section, 10)
      if (!result.ok) {
        return patch({
          status: state.items.length > 0 ? 'ready' : 'error',
          error: result.error.message,
          fromCache: state.items.length > 0,
          profile,
          matchEnabled: profile?.matchEnabled ?? false,
        })
      }

      const items = result.value.items.map((item) => toView(section, item, profile, result.value.matchMode))
      const updatedAt = clock.now().toISOString()
      cache.write(cacheKeyFor(section), {
        items: result.value.items.map((i) => ({
          post: i.post,
          score: i.score,
          reason: i.reason,
        })),
        matchMode: result.value.matchMode,
        updatedAt,
      } satisfies CachedRecommendations)

      return patch({
        status: items.length === 0 ? 'empty' : 'ready',
        section,
        items,
        matchMode: result.value.matchMode,
        fromCache: false,
        updatedAt,
        error: null,
        profile,
        matchEnabled: profile?.matchEnabled ?? false,
      })
  }

  async function feedbackFn(
    postId: string,
    action: FeedbackAction,
  ): Promise<BuddyRecommendationState> {
    const viewer = session.getSnapshot().profile
    if (viewer === null) {
      return patch({ feedbackError: '请先登录后再反馈' })
    }

    patch({ feedbackPending: postId, feedbackError: null })
    const result = await repository.feedback(postId, { section: state.section, action })
    if (!result.ok) {
      return patch({ feedbackPending: null, feedbackError: result.error.message })
    }

    // 本地记住（UPSERT：同一帖只保留最后一次），并即时反映到按钮态
    myFeedback = { ...myFeedback, [postId]: action }
    writeFeedbackMemory()

    const items = state.items.map((item) =>
      item.postId === postId ? { ...item, myFeedback: action } : item,
    )
    patch({ feedbackPending: null, feedbackError: null, items })

    // 反馈会改变排序（规格 §3.6）—— 立刻重拉一次，让用户看到效果
    return loadFn(state.section)
  }

  function resetFn(): void {
    hydratedSections.clear()
    myFeedback = {}
    state = { ...state, status: 'idle', items: [], error: null, fromCache: false, updatedAt: null }
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    hydrate: hydrateFn,
    load: loadFn,
    feedback: feedbackFn,
    reset: resetFn,
  }
}
