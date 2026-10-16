import { summarize } from '../../domain/models/groupbuy'
import type { GroupBuy, GroupBuySummary } from '../../domain/models/groupbuy'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { GroupBuyRepository } from '../../domain/ports/groupbuyRepository'
import { isCachedGroupBuyList, type CachedGroupBuyList } from './listGroupBuys'

/**
 * 拼单详情用例 —— 与列表同构：同步 hydrate → 后台刷新 → 三态齐全。
 *
 * 缓存结构复用列表的 `CachedGroupBuyList`（同一个 key 前缀下按 id 分片），
 * 好处是「列表点进详情」时首屏必然有数据，不会白屏。
 */

export type DetailStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface GroupBuyDetailState {
  status: DetailStatus
  groupBuy: GroupBuy | null
  summary: GroupBuySummary | null
  error: string | null
  fromCache: boolean
  updatedAt: string | null
}

export interface GroupBuyDetailDeps {
  repository: GroupBuyRepository
  cache: CachePort
  clock: ClockPort
  /** 例如 `StorageKeys.groupBuyDetailCache` + id */
  cacheKeyFor(id: string): string
}

export interface GroupBuyDetailUseCase {
  getSnapshot(): GroupBuyDetailState
  subscribe(listener: () => void): () => void
  hydrate(id: string): GroupBuyDetailState
  load(id: string): Promise<GroupBuyDetailState>
  /** 参团成功后就地更新，避免整页重拉 */
  applyUpdate(groupBuy: GroupBuy): GroupBuyDetailState
  reset(): void
}

const INITIAL_STATE: GroupBuyDetailState = {
  status: 'idle',
  groupBuy: null,
  summary: null,
  error: null,
  fromCache: false,
  updatedAt: null,
}

export function createGroupBuyDetailUseCase(deps: GroupBuyDetailDeps): GroupBuyDetailUseCase {
  const { repository, cache, clock, cacheKeyFor } = deps

  let state: GroupBuyDetailState = INITIAL_STATE
  let hydratedId: string | null = null
  const listeners = new Set<() => void>()

  function patch(next: Partial<GroupBuyDetailState>): GroupBuyDetailState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function apply(groupBuy: GroupBuy, fromCache: boolean, updatedAt: string): GroupBuyDetailState {
    const now = clock.now()
    return patch({
      status: 'ready',
      groupBuy,
      summary: summarize(groupBuy, now),
      error: null,
      fromCache,
      updatedAt,
    })
  }

  function hydrate(id: string): GroupBuyDetailState {
    if (hydratedId === id) return state
    hydratedId = id

    const cached = cache.read<unknown>(cacheKeyFor(id))
    if (!isCachedGroupBuyList(cached)) return state

    const first = cached.items[0]
    if (first === undefined) return state
    return apply(first, true, cached.updatedAt)
  }

  async function load(id: string): Promise<GroupBuyDetailState> {
    hydratedId = id
    patch({ status: state.groupBuy === null ? 'loading' : 'ready', error: null })

    const result = await repository.detail(id)
    if (!result.ok) {
      return patch({
        status: state.groupBuy === null ? 'error' : 'ready',
        error: result.error.message,
      })
    }

    const updatedAt = clock.now().toISOString()
    const payload: CachedGroupBuyList = { items: [result.value], nextCursor: null, updatedAt }
    cache.write(cacheKeyFor(id), payload)
    return apply(result.value, false, updatedAt)
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
    applyUpdate(groupBuy: GroupBuy): GroupBuyDetailState {
      return apply(groupBuy, false, clock.now().toISOString())
    },
    reset(): void {
      hydratedId = null
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
