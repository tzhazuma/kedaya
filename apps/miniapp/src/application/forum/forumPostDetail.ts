import { buildReplyThreads, summarizePost, visibleReplies } from '../../domain/models/forum'
import type {
  ForumPost,
  ForumPostSummary,
  ForumReply,
  ForumReplyThread,
} from '../../domain/models/forum'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { ForumRepository } from '../../domain/ports/forumRepository'

/**
 * 论坛主题详情用例 —— 与拼单详情同构：同步 hydrate → 后台刷新 → 三态齐全。
 *
 * 详情页有两份可独立分页的数据：
 * - 主题本身（单条）
 * - 回复列表（游标分页，`onReachBottom` 续页）
 *
 * 因此错误也分成 `error`（主题加载失败 → 整页错误态）与 `repliesError`
 * （只有回复失败 → 主题照常展示，回复区局部提示）。把两者混成一个 error
 * 会让「主题已加载但回复失败」这种常见情况退化成整页错误页。
 */

export type ForumPostDetailStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ForumPostDetailState {
  status: ForumPostDetailStatus
  post: ForumPost | null
  summary: ForumPostSummary | null
  replies: ForumReply[]
  threads: ForumReplyThread[]
  nextReplyCursor: string | null
  loadingReplies: boolean
  /** 主题加载失败（整页错误态） */
  error: string | null
  /** 仅回复加载失败（局部提示） */
  repliesError: string | null
  fromCache: boolean
  updatedAt: string | null
}

export interface CachedForumPostDetail {
  post: ForumPost
  replies: ForumReply[]
  nextReplyCursor: string | null
  updatedAt: string
}

export interface ForumPostDetailDeps {
  repository: ForumRepository
  cache: CachePort
  clock: ClockPort
  /** 例如 `StorageKeys.forumPostDetailCache` + id */
  cacheKeyFor(id: string): string
}

export interface ForumPostDetailUseCase {
  getSnapshot(): ForumPostDetailState
  subscribe(listener: () => void): () => void
  hydrate(id: string): ForumPostDetailState
  load(id: string): Promise<ForumPostDetailState>
  /** 触底加载更多回复 */
  loadMoreReplies(): Promise<ForumPostDetailState>
  /** 写动作成功后就地更新主题，避免整页重拉 */
  applyPost(post: ForumPost): ForumPostDetailState
  /** 回复成功后把新回复插入列表（同时把主题的 replyCount 乐观 +1） */
  appendReply(reply: ForumReply): ForumPostDetailState
  reset(): void
}

const INITIAL_STATE: ForumPostDetailState = {
  status: 'idle',
  post: null,
  summary: null,
  replies: [],
  threads: [],
  nextReplyCursor: null,
  loadingReplies: false,
  error: null,
  repliesError: null,
  fromCache: false,
  updatedAt: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isCachedForumPostDetail(value: unknown): value is CachedForumPostDetail {
  if (!isRecord(value)) return false
  return (
    typeof value.post === 'object' &&
    value.post !== null &&
    Array.isArray(value.replies) &&
    typeof value.updatedAt === 'string'
  )
}

export function createForumPostDetailUseCase(deps: ForumPostDetailDeps): ForumPostDetailUseCase {
  const { repository, cache, clock, cacheKeyFor } = deps

  let state: ForumPostDetailState = INITIAL_STATE
  let hydratedId: string | null = null
  const listeners = new Set<() => void>()

  function patch(next: Partial<ForumPostDetailState>): ForumPostDetailState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function deriveReplies(replies: readonly ForumReply[]): {
    replies: ForumReply[]
    threads: ForumReplyThread[]
  } {
    const visible = visibleReplies(replies)
    return { replies: visible, threads: buildReplyThreads(visible) }
  }

  function apply(
    post: ForumPost,
    replies: readonly ForumReply[],
    nextReplyCursor: string | null,
    fromCache: boolean,
    updatedAt: string,
  ): ForumPostDetailState {
    const derived = deriveReplies(replies)
    return patch({
      status: 'ready',
      post,
      summary: summarizePost(post, clock.now()),
      replies: derived.replies,
      threads: derived.threads,
      nextReplyCursor,
      error: null,
      repliesError: null,
      fromCache,
      updatedAt,
    })
  }

  function writeCache(post: ForumPost, replies: readonly ForumReply[], nextReplyCursor: string | null): string {
    const updatedAt = clock.now().toISOString()
    const payload: CachedForumPostDetail = {
      post,
      replies: [...replies],
      nextReplyCursor,
      updatedAt,
    }
    cache.write(cacheKeyFor(post.id), payload)
    return updatedAt
  }

  function hydrate(id: string): ForumPostDetailState {
    if (hydratedId === id) return state
    hydratedId = id

    const cached = cache.read<unknown>(cacheKeyFor(id))
    if (!isCachedForumPostDetail(cached)) return state

    return apply(cached.post, cached.replies, cached.nextReplyCursor, true, cached.updatedAt)
  }

  async function load(id: string): Promise<ForumPostDetailState> {
    hydratedId = id
    patch({ status: state.post === null ? 'loading' : 'ready', error: null })

    const [postResult, repliesResult] = await Promise.all([
      repository.postDetail(id),
      repository.listReplies(id, { cursor: null }),
    ])

    if (!postResult.ok) {
      return patch({
        status: state.post === null ? 'error' : 'ready',
        error: postResult.error.message,
      })
    }

    const replies = repliesResult.ok ? repliesResult.value.items : []
    const nextReplyCursor = repliesResult.ok ? repliesResult.value.nextCursor : null
    const updatedAt = writeCache(postResult.value, replies, nextReplyCursor)
    const next = apply(postResult.value, replies, nextReplyCursor, false, updatedAt)

    if (!repliesResult.ok) {
      return patch({ repliesError: repliesResult.error.message })
    }
    return next
  }

  async function loadMoreReplies(): Promise<ForumPostDetailState> {
    if (state.nextReplyCursor === null || state.loadingReplies || state.post === null) return state

    patch({ loadingReplies: true, repliesError: null })
    const result = await repository.listReplies(state.post.id, { cursor: state.nextReplyCursor })
    if (!result.ok) {
      return patch({ loadingReplies: false, repliesError: result.error.message })
    }

    const merged = [...state.replies, ...result.value.items]
    const derived = deriveReplies(merged)
    writeCache(state.post, merged, result.value.nextCursor)

    return patch({
      replies: derived.replies,
      threads: derived.threads,
      nextReplyCursor: result.value.nextCursor,
      loadingReplies: false,
      repliesError: null,
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
    loadMoreReplies,

    applyPost(post: ForumPost): ForumPostDetailState {
      const updatedAt = writeCache(post, state.replies, state.nextReplyCursor)
      return apply(post, state.replies, state.nextReplyCursor, false, updatedAt)
    },

    appendReply(reply: ForumReply): ForumPostDetailState {
      const post = state.post
      if (post === null) return state

      const merged = [...state.replies, reply]
      const bumped: ForumPost = { ...post, replyCount: post.replyCount + 1 }
      const updatedAt = writeCache(bumped, merged, state.nextReplyCursor)
      return apply(bumped, merged, state.nextReplyCursor, false, updatedAt)
    },

    reset(): void {
      hydratedId = null
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
