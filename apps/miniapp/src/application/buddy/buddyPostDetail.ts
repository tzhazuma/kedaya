import type { FeedbackAction } from '@kedaya/shared'

import { canApplyToPost, sectionOf, summarizeBuddyPost } from '../../domain/models/buddy'
import type {
  BuddyApplication,
  BuddyJoinEligibility,
  BuddyPost,
  BuddyPostSummary,
} from '../../domain/models/buddy'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { BuddyDecision, BuddyRepository } from '../../domain/ports/buddyRepository'
import type { SessionStorePort } from '../../domain/ports/sessionPort'
import { createIdempotencyKey } from '../idempotency'

/**
 * 搭子详情用例（规格 §5.5 / §5.6 + 契约 §11.2 的动作名）。
 *
 * 页面需要的全部信息与动作都在这里：
 *
 * | 动作 | 谁可以做 | 服务端语义 |
 * | --- | --- | --- |
 * | `join` | 任何非发起人 | 建 `BuddyApplication`（`PENDING`）。**不占名额** |
 * | `leave` | 申请人 | `PENDING → WITHDRAWN` |
 * | `decide` | **仅发起人** | `PENDING → ACCEPTED/REJECTED`；`ACCEPTED` 才 `joinedCount += 1` |
 * | `close` | **仅发起人** | `OPEN/FULL → CLOSED` |
 *
 * ⚠️ **`join` 是「申请」不是「入队」**（规格 §5.5 的重要语义澄清）：
 * `join` **不**递增 `joinedCount`，只有 `decide(ACCEPTED)` 才递增。
 * 页面文案必须与此一致，否则用户会以为申请成功就等于加入了。
 *
 * ⚠️ **申请列表仅发起人可见**（规格 §6.1 可见性矩阵）：
 * 非发起人请求 `listApplications` 会得到 `FORBIDDEN`；用例据此把
 * `applicationsVisible` 置为 `false` 且**不**把该错误暴露成页面错误态
 * （它是权限边界，不是故障）。
 */

export type BuddyDetailStatus = 'idle' | 'loading' | 'ready' | 'error'

export type BuddyDetailAction = 'join' | 'leave' | 'decide' | 'close'

export interface BuddyDetailState {
  status: BuddyDetailStatus
  post: BuddyPost | null
  summary: BuddyPostSummary | null
  /** 申请列表（仅发起人拿得到；其它人恒为空数组） */
  applications: BuddyApplication[]
  /** 我是否是发起人 —— 决定 UI 是否显示审批 / 关闭入口 */
  isCreator: boolean
  /** 申请列表是否对本视角可见 */
  applicationsVisible: boolean
  /** 我的申请资格（未登录 / 已申请 / 已满 等） */
  eligibility: BuddyJoinEligibility | null
  error: string | null
  fromCache: boolean
  updatedAt: string | null
  /** 正在执行某个动作（按钮 loading） */
  acting: boolean
  actionError: string | null
  lastAction: BuddyDetailAction | null
  /** 我对这条搭子提交过的匹配反馈（`null` = 还没反馈） */
  myFeedback: FeedbackAction | null
}

export interface CachedBuddyDetail {
  post: BuddyPost
  updatedAt: string
}

export interface BuddyPostDetailDeps {
  repository: BuddyRepository
  cache: CachePort
  clock: ClockPort
  cacheKeyFor: (id: string) => string
  session: SessionStorePort
}

export interface BuddyPostDetailUseCase {
  getSnapshot(): BuddyDetailState
  subscribe(listener: () => void): () => void
  hydrate(id: string): BuddyDetailState
  load(id: string): Promise<BuddyDetailState>
  join(id: string, message?: string | null): Promise<BuddyDetailState>
  leave(id: string): Promise<BuddyDetailState>
  decide(id: string, applicationId: string, decision: BuddyDecision): Promise<BuddyDetailState>
  close(id: string): Promise<BuddyDetailState>
  /** 匹配反馈（规格 §5.8 / 契约 §11.2 的 `feedback` 动作） */
  feedback(id: string, action: FeedbackAction): Promise<BuddyDetailState>
  reset(): void
}

const INITIAL_STATE: BuddyDetailState = {
  status: 'idle',
  post: null,
  summary: null,
  applications: [],
  isCreator: false,
  applicationsVisible: false,
  eligibility: null,
  error: null,
  fromCache: false,
  updatedAt: null,
  acting: false,
  actionError: null,
  lastAction: null,
  myFeedback: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isCachedBuddyDetail(value: unknown): value is CachedBuddyDetail {
  if (!isRecord(value)) return false
  return isRecord(value.post) && typeof value.updatedAt === 'string'
}

export function createBuddyPostDetailUseCase(deps: BuddyPostDetailDeps): BuddyPostDetailUseCase {
  const { repository, cache, clock, cacheKeyFor, session } = deps

  let state: BuddyDetailState = INITIAL_STATE
  let hydratedId: string | null = null
  const listeners = new Set<() => void>()

  function patch(next: Partial<BuddyDetailState>): BuddyDetailState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function myId(): string | null {
    return session.getSnapshot().profile?.id ?? null
  }

  function decorate(post: BuddyPost): Partial<BuddyDetailState> {
    const now = clock.now()
    const viewer = myId()
    const isCreator = viewer !== null && post.creator.id === viewer
    return {
      post,
      summary: summarizeBuddyPost(post, now),
      isCreator,
      eligibility: canApplyToPost(post, viewer, now),
    }
  }

  /** 拉申请列表（仅发起人会成功；`FORBIDDEN` 视为「不可见」而不是错误） */
  async function loadApplications(id: string): Promise<Partial<BuddyDetailState>> {
    const result = await repository.listApplications(id)
    if (!result.ok) {
      return {
        applications: [],
        applicationsVisible: false,
      }
    }
    return { applications: result.value.items, applicationsVisible: true }
  }

  function hydrate(id: string): BuddyDetailState {
    if (hydratedId === id) return state
    hydratedId = id

    const cached = cache.read<unknown>(cacheKeyFor(id))
    if (!isCachedBuddyDetail(cached)) return state

    return patch({
      status: 'ready',
      ...decorate(cached.post),
      fromCache: true,
      updatedAt: cached.updatedAt,
      error: null,
      actionError: null,
      acting: false,
      lastAction: null,
    })
  }

  async function load(id: string): Promise<BuddyDetailState> {
    patch({
      status: state.post === null ? 'loading' : 'ready',
      error: null,
      actionError: null,
    })

    const result = await repository.itemDetail(id)
    if (!result.ok) {
      return patch({
        status: state.post === null ? 'error' : 'ready',
        error: result.error.message,
        fromCache: state.post !== null,
      })
    }

    const updatedAt = clock.now().toISOString()
    cache.write(cacheKeyFor(id), { post: result.value, updatedAt } satisfies CachedBuddyDetail)

    const applications = await loadApplications(id)

    return patch({
      status: 'ready',
      ...decorate(result.value),
      ...applications,
      error: null,
      fromCache: false,
      updatedAt,
    })
  }

  /** 动作的统一外壳：置 acting、跑动作、成功后用返回的 post 就地更新 */
  async function runAction(
    action: BuddyDetailAction,
    id: string,
    work: () => Promise<{ ok: true; value: BuddyPost } | { ok: false; error: { message: string } }>,
  ): Promise<BuddyDetailState> {
    patch({ acting: true, actionError: null })

    const result = await work()
    if (!result.ok) {
      return patch({ acting: false, actionError: result.error.message })
    }

    const updatedAt = clock.now().toISOString()
    cache.write(cacheKeyFor(id), { post: result.value, updatedAt } satisfies CachedBuddyDetail)
    const applications = await loadApplications(id)

    return patch({
      status: 'ready',
      ...decorate(result.value),
      ...applications,
      acting: false,
      actionError: null,
      lastAction: action,
      error: null,
      fromCache: false,
      updatedAt,
    })
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    hydrate,
    load,

    async join(id, message = null): Promise<BuddyDetailState> {
      const viewer = myId()
      if (viewer === null) {
        return patch({ actionError: '请先登录后再申请', acting: false })
      }

      return runAction('join', id, async () => {
        const result = await repository.join(id, {
          message,
          // 契约 §11.3：`POST` 必须带 `Idempotency-Key`；
          // 同一 (帖, 人) 复用同一个 key，弱网重试不会产生第二条申请
          idempotencyKey: `buddy:join:${id}:${viewer}`,
        })
        if (!result.ok) return { ok: false, error: { message: result.error.message } }
        // `join` 返回的是申请，不是更新后的帖子 —— 重新拉一次详情
        const refreshed = await repository.itemDetail(id)
        if (!refreshed.ok) return { ok: false, error: { message: refreshed.error.message } }
        return { ok: true, value: refreshed.value }
      })
    },

    async leave(id): Promise<BuddyDetailState> {
      const viewer = myId()
      if (viewer === null) {
        return patch({ actionError: '请先登录后再操作', acting: false })
      }

      return runAction('leave', id, async () => {
        const result = await repository.leave(
          id,
          `buddy:leave:${id}:${viewer}:${createIdempotencyKey('buddy-leave', clock.now())}`,
        )
        if (!result.ok) return { ok: false, error: { message: result.error.message } }
        const refreshed = await repository.itemDetail(id)
        if (!refreshed.ok) return { ok: false, error: { message: refreshed.error.message } }
        return { ok: true, value: refreshed.value }
      })
    },

    async decide(id, applicationId, decision): Promise<BuddyDetailState> {
      const viewer = myId()
      if (viewer === null) {
        return patch({ actionError: '请先登录后再操作', acting: false })
      }

      return runAction('decide', id, async () => {
        const result = await repository.decide(id, {
          applicationId,
          decision,
          idempotencyKey: `buddy:decide:${applicationId}:${decision}`,
        })
        if (!result.ok) return { ok: false, error: { message: result.error.message } }
        return { ok: true, value: result.value }
      })
    },

    async close(id): Promise<BuddyDetailState> {
      const viewer = myId()
      if (viewer === null) {
        return patch({ actionError: '请先登录后再操作', acting: false })
      }

      return runAction('close', id, async () => {
        const result = await repository.close(id, `buddy:close:${id}:${viewer}`)
        if (!result.ok) return { ok: false, error: { message: result.error.message } }
        return { ok: true, value: result.value }
      })
    },

    async feedback(id, action): Promise<BuddyDetailState> {
      const viewer = myId()
      if (viewer === null) {
        return patch({ actionError: '请先登录后再反馈', acting: false })
      }
      const post = state.post
      if (post === null) {
        return patch({ actionError: '还没有加载到这条搭子', acting: false })
      }

      patch({ acting: true, actionError: null })
      const result = await repository.feedback(id, {
        section: sectionOf(post.activity),
        action,
      })
      if (!result.ok) {
        return patch({ acting: false, actionError: result.error.message })
      }
      // 反馈只影响排序，不改帖子本身 —— 就地更新按钮态即可，不必重拉
      return patch({ acting: false, actionError: null, myFeedback: action })
    },

    reset(): void {
      hydratedId = null
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
