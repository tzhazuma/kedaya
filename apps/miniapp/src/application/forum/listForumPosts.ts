import { summarizePost } from '../../domain/models/forum'
import type { ForumPost, ForumPostSummary } from '../../domain/models/forum'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { ForumRepository, ListForumPostsQuery } from '../../domain/ports/forumRepository'

/**
 * 论坛主题列表用例 —— 契约 §8 启动时序的落点：
 *
 * 1. `hydrate()`：**同步**读本地缓存（禁止网络）→ 页面立刻有内容
 * 2. 页面先渲染 `hydrate()` 的结果
 * 3. `load()`：后台拉取 → 成功替换、失败静默保留缓存
 *
 * 小程序特性所需的游标分页也在这里收口：`load()` 拉第一页（`cursor: null`），
 * `loadMore()` 用上一页的 `nextCursor` 续页并**追加**（供 `onReachBottom` 调用）。
 *
 * 状态对象在变更时才换引用，因此可以直接喂给 React 的 `useSyncExternalStore`。
 */

export type ForumListStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface ListForumPostsState {
  status: ForumListStatus
  /** 当前版块筛选；`null` = 全部版块 */
  activeBoardId: string | null
  /** 当前关键词（透传给仓储） */
  keyword: string
  posts: ForumPostSummary[]
  nextCursor: string | null
  total: number | null
  error: string | null
  fromCache: boolean
  updatedAt: string | null
  loadingMore: boolean
}

export interface CachedForumPostList {
  posts: ForumPost[]
  activeBoardId: string | null
  keyword: string
  nextCursor: string | null
  total?: number
  updatedAt: string
}

export interface ListForumPostsDeps {
  repository: ForumRepository
  cache: CachePort
  clock: ClockPort
  /** 缓存 key 由装配层（app/container）注入 —— application 不感知存储实现 */
  cacheKey: string
  defaultLimit?: number
}

export interface LoadForumPostsQuery {
  boardId?: string | null
  keyword?: string
  limit?: number
}

export interface ListForumPostsUseCase {
  getSnapshot(): ListForumPostsState
  subscribe(listener: () => void): () => void
  /** 契约 §8 第 1 步：同步 hydrate */
  hydrate(): ListForumPostsState
  /** 契约 §8 第 3 步：后台刷新（失败静默降级）；同时把版块筛选写进状态 */
  load(query?: LoadForumPostsQuery): Promise<ListForumPostsState>
  /** 触底加载下一页（游标续页） */
  loadMore(): Promise<ListForumPostsState>
  /** 切换版块：只改筛选并清空列表，由调用方接着 `load()` */
  selectBoard(boardId: string | null): ListForumPostsState
  reset(): void
}

const INITIAL_STATE: ListForumPostsState = {
  status: 'idle',
  activeBoardId: null,
  keyword: '',
  posts: [],
  nextCursor: null,
  total: null,
  error: null,
  fromCache: false,
  updatedAt: null,
  loadingMore: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 缓存可能由旧版本写入，必须做形状校验后再用 */
export function isCachedForumPostList(value: unknown): value is CachedForumPostList {
  if (!isRecord(value)) return false
  return Array.isArray(value.posts) && typeof value.updatedAt === 'string'
}

export function createListForumPostsUseCase(deps: ListForumPostsDeps): ListForumPostsUseCase {
  const { repository, cache, clock, cacheKey, defaultLimit } = deps

  let state: ListForumPostsState = INITIAL_STATE
  let hydrated = false
  /** 原始（未派生）条目，用于把**累积**结果写回缓存，而不是只写最后一页 */
  let rawPosts: ForumPost[] = []
  const listeners = new Set<() => void>()

  function patch(next: Partial<ListForumPostsState>): ListForumPostsState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function toSummaries(posts: readonly ForumPost[]): ForumPostSummary[] {
    const now = clock.now()
    return posts.map((post) => summarizePost(post, now))
  }

  function hydrate(): ListForumPostsState {
    if (hydrated) return state
    hydrated = true

    const cached = cache.read<unknown>(cacheKey)
    if (!isCachedForumPostList(cached)) return state

    rawPosts = cached.posts
    const posts = toSummaries(cached.posts)
    return patch({
      status: posts.length === 0 ? 'empty' : 'ready',
      activeBoardId: cached.activeBoardId,
      keyword: cached.keyword,
      posts,
      nextCursor: cached.nextCursor,
      total: cached.total ?? null,
      error: null,
      fromCache: true,
      updatedAt: cached.updatedAt,
    })
  }

  function writeCache(page: {
    posts: ForumPost[]
    activeBoardId: string | null
    keyword: string
    nextCursor: string | null
    total?: number
  }): string {
    const updatedAt = clock.now().toISOString()
    cache.write(cacheKey, { ...page, updatedAt } satisfies CachedForumPostList)
    return updatedAt
  }

  async function load(query: LoadForumPostsQuery = {}): Promise<ListForumPostsState> {
    const boardId = query.boardId === undefined ? state.activeBoardId : query.boardId
    const keyword = query.keyword === undefined ? state.keyword : query.keyword

    const request: ListForumPostsQuery = {
      boardId,
      keyword,
      cursor: null,
      ...(query.limit === undefined && defaultLimit === undefined ? {} : { limit: query.limit ?? defaultLimit }),
    }

    // 已有缓存时保持 ready（不要把首屏打回骨架屏）
    patch({
      status: state.posts.length > 0 ? 'ready' : 'loading',
      error: null,
      activeBoardId: boardId,
      keyword,
    })

    const result = await repository.listPosts(request)
    if (!result.ok) {
      // 契约 §8：失败静默降级 —— 有缓存就继续用缓存，只把错误文案挂上
      return patch({
        status: state.posts.length > 0 ? 'ready' : 'error',
        error: result.error.message,
        fromCache: state.posts.length > 0,
      })
    }

    rawPosts = result.value.items
    const posts = toSummaries(result.value.items)
    const updatedAt = writeCache({
      posts: result.value.items,
      activeBoardId: boardId,
      keyword,
      nextCursor: result.value.nextCursor,
      ...(result.value.total === undefined ? {} : { total: result.value.total }),
    })

    return patch({
      status: posts.length === 0 ? 'empty' : 'ready',
      posts,
      nextCursor: result.value.nextCursor,
      total: result.value.total ?? null,
      error: null,
      fromCache: false,
      updatedAt,
    })
  }

  async function loadMore(): Promise<ListForumPostsState> {
    if (state.nextCursor === null || state.loadingMore) return state

    patch({ loadingMore: true, error: null })
    const result = await repository.listPosts({
      boardId: state.activeBoardId,
      keyword: state.keyword,
      cursor: state.nextCursor,
      ...(defaultLimit === undefined ? {} : { limit: defaultLimit }),
    })

    if (!result.ok) {
      return patch({ loadingMore: false, error: result.error.message })
    }

    rawPosts = [...rawPosts, ...result.value.items]
    const appended = [...state.posts, ...toSummaries(result.value.items)]
    const updatedAt = writeCache({
      posts: rawPosts,
      activeBoardId: state.activeBoardId,
      keyword: state.keyword,
      nextCursor: result.value.nextCursor,
      ...(result.value.total === undefined ? {} : { total: result.value.total }),
    })

    return patch({
      status: appended.length === 0 ? 'empty' : 'ready',
      posts: appended,
      nextCursor: result.value.nextCursor,
      total: result.value.total ?? state.total,
      error: null,
      fromCache: false,
      updatedAt,
      loadingMore: false,
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
    loadMore,

    selectBoard(boardId: string | null): ListForumPostsState {
      rawPosts = []
      return patch({
        activeBoardId: boardId,
        posts: [],
        nextCursor: null,
        total: null,
        error: null,
        status: 'idle',
        fromCache: false,
      })
    },

    reset(): void {
      hydrated = false
      rawPosts = []
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
