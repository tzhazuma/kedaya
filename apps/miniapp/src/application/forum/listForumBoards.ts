import { summarizeBoard } from '../../domain/models/forum'
import type { ForumBoard, ForumBoardSummary } from '../../domain/models/forum'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { ForumRepository } from '../../domain/ports/forumRepository'

/**
 * 论坛版块用例 —— 与拼单列表同构：同步 hydrate → 后台刷新 → 三态齐全。
 *
 * 版块列表变化极少，因此缓存命中后**不强制**重新拉取（页面只在 `boards.length === 0` 时 load），
 * 但下拉刷新时仍会重新拉一次，保证「新开版块」能被看到。
 */

export type ForumBoardsStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface ListForumBoardsState {
  status: ForumBoardsStatus
  boards: ForumBoardSummary[]
  error: string | null
  fromCache: boolean
  updatedAt: string | null
}

export interface CachedForumBoardList {
  boards: ForumBoard[]
  updatedAt: string
}

export interface ListForumBoardsDeps {
  repository: ForumRepository
  cache: CachePort
  clock: ClockPort
  cacheKey: string
}

export interface ListForumBoardsUseCase {
  getSnapshot(): ListForumBoardsState
  subscribe(listener: () => void): () => void
  /** 契约 §8 第 1 步：同步 hydrate（禁止网络） */
  hydrate(): ListForumBoardsState
  /** 契约 §8 第 3 步：后台刷新（失败静默降级） */
  load(): Promise<ListForumBoardsState>
  reset(): void
}

const INITIAL_STATE: ListForumBoardsState = {
  status: 'idle',
  boards: [],
  error: null,
  fromCache: false,
  updatedAt: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isCachedForumBoardList(value: unknown): value is CachedForumBoardList {
  if (!isRecord(value)) return false
  return Array.isArray(value.boards) && typeof value.updatedAt === 'string'
}

export function createListForumBoardsUseCase(deps: ListForumBoardsDeps): ListForumBoardsUseCase {
  const { repository, cache, clock, cacheKey } = deps

  let state: ListForumBoardsState = INITIAL_STATE
  let hydrated = false
  const listeners = new Set<() => void>()

  function patch(next: Partial<ListForumBoardsState>): ListForumBoardsState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function hydrate(): ListForumBoardsState {
    if (hydrated) return state
    hydrated = true

    const cached = cache.read<unknown>(cacheKey)
    if (!isCachedForumBoardList(cached)) return state

    const boards = cached.boards.map(summarizeBoard)
    return patch({
      status: boards.length === 0 ? 'empty' : 'ready',
      boards,
      error: null,
      fromCache: true,
      updatedAt: cached.updatedAt,
    })
  }

  async function load(): Promise<ListForumBoardsState> {
    patch({ status: state.boards.length > 0 ? 'ready' : 'loading', error: null })

    const result = await repository.listBoards()
    if (!result.ok) {
      // 契约 §8：失败静默降级 —— 有缓存就继续用缓存，只把错误文案挂上
      return patch({
        status: state.boards.length > 0 ? 'ready' : 'error',
        error: result.error.message,
        fromCache: state.boards.length > 0,
      })
    }

    const boards = result.value.map(summarizeBoard)
    const updatedAt = clock.now().toISOString()
    cache.write(cacheKey, { boards: result.value, updatedAt } satisfies CachedForumBoardList)

    return patch({
      status: boards.length === 0 ? 'empty' : 'ready',
      boards,
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
    reset(): void {
      hydrated = false
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
