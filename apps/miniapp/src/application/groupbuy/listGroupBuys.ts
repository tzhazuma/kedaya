import { summarize } from '../../domain/models/groupbuy'
import type { GroupBuy, GroupBuySummary } from '../../domain/models/groupbuy'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { GroupBuyRepository, ListGroupBuysQuery } from '../../domain/ports/groupbuyRepository'

/**
 * 拼单列表用例 —— 契约 §8 启动时序的落点：
 *
 * 1. `hydrate()`：**同步**读本地缓存（禁止网络）→ 页面立刻有内容
 * 2. 页面先渲染 `hydrate()` 的结果
 * 3. `load()`：后台拉取 → 成功替换、失败静默保留缓存
 *
 * 状态机三态齐全：`loading` / `empty` / `error`（外加 `ready`）。
 * 状态对象在变更时才换引用，因此可以直接喂给 React 的 `useSyncExternalStore`。
 */

export type ListStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface ListGroupBuysState {
  status: ListStatus
  items: GroupBuySummary[]
  nextCursor: string | null
  total: number | null
  /** 用户可读的错误文案；成功时为 null */
  error: string | null
  /** 当前展示的数据来自本地缓存（即还没被网络刷新过） */
  fromCache: boolean
  updatedAt: string | null
  loadingMore: boolean
}

export interface CachedGroupBuyList {
  items: GroupBuy[]
  nextCursor: string | null
  total?: number
  updatedAt: string
}

export interface ListGroupBuysDeps {
  repository: GroupBuyRepository
  cache: CachePort
  clock: ClockPort
  /** 缓存 key 由装配层（app/container）注入 —— application 不感知存储实现 */
  cacheKey: string
  defaultQuery?: ListGroupBuysQuery
}

export interface ListGroupBuysUseCase {
  getSnapshot(): ListGroupBuysState
  subscribe(listener: () => void): () => void
  /** 契约 §8 第 1 步：同步 hydrate */
  hydrate(): ListGroupBuysState
  /** 契约 §8 第 3 步：后台刷新（失败静默降级） */
  load(query?: ListGroupBuysQuery): Promise<ListGroupBuysState>
  loadMore(query?: ListGroupBuysQuery): Promise<ListGroupBuysState>
  reset(): void
}

const INITIAL_STATE: ListGroupBuysState = {
  status: 'idle',
  items: [],
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
export function isCachedGroupBuyList(value: unknown): value is CachedGroupBuyList {
  if (!isRecord(value)) return false
  return Array.isArray(value.items) && typeof value.updatedAt === 'string'
}

export function createListGroupBuysUseCase(deps: ListGroupBuysDeps): ListGroupBuysUseCase {
  const { repository, cache, clock, cacheKey, defaultQuery = {} } = deps

  let state: ListGroupBuysState = INITIAL_STATE
  let hydrated = false
  /** 原始（未派生）条目，用于把**累积**结果写回缓存，而不是只写最后一页 */
  let rawItems: GroupBuy[] = []
  const listeners = new Set<() => void>()

  function patch(next: Partial<ListGroupBuysState>): ListGroupBuysState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function toSummaries(items: readonly GroupBuy[]): GroupBuySummary[] {
    const now = clock.now()
    return items.map((item) => summarize(item, now))
  }

  function hydrate(): ListGroupBuysState {
    if (hydrated) return state
    hydrated = true

    const cached = cache.read<unknown>(cacheKey)
    if (!isCachedGroupBuyList(cached)) return state

    rawItems = cached.items
    const items = toSummaries(cached.items)
    return patch({
      status: items.length === 0 ? 'empty' : 'ready',
      items,
      nextCursor: cached.nextCursor,
      total: cached.total ?? null,
      error: null,
      fromCache: true,
      updatedAt: cached.updatedAt,
    })
  }

  function writeCache(page: {
    items: GroupBuy[]
    nextCursor: string | null
    total?: number
  }): string {
    const updatedAt = clock.now().toISOString()
    const payload: CachedGroupBuyList = {
      items: page.items,
      nextCursor: page.nextCursor,
      ...(page.total === undefined ? {} : { total: page.total }),
      updatedAt,
    }
    cache.write(cacheKey, payload)
    return updatedAt
  }

  async function load(query: ListGroupBuysQuery = {}): Promise<ListGroupBuysState> {
    const effective: ListGroupBuysQuery = { ...defaultQuery, ...query }
    // 已有缓存时保持 ready（不要把首屏打回骨架屏）
    patch({ status: state.items.length > 0 ? 'ready' : 'loading', error: null })

    const result = await repository.list(effective)
    if (!result.ok) {
      // 契约 §8：失败静默降级 —— 有缓存就继续用缓存，只把错误文案挂上
      return patch({
        status: state.items.length > 0 ? 'ready' : 'error',
        error: result.error.message,
        fromCache: state.items.length > 0,
      })
    }

    rawItems = result.value.items
    const items = toSummaries(result.value.items)
    const updatedAt = writeCache(result.value)
    return patch({
      status: items.length === 0 ? 'empty' : 'ready',
      items,
      nextCursor: result.value.nextCursor,
      total: result.value.total ?? null,
      error: null,
      fromCache: false,
      updatedAt,
    })
  }

  async function loadMore(query: ListGroupBuysQuery = {}): Promise<ListGroupBuysState> {
    if (state.nextCursor === null || state.loadingMore) return state

    patch({ loadingMore: true, error: null })
    const result = await repository.list({ ...defaultQuery, ...query, cursor: state.nextCursor })

    if (!result.ok) {
      return patch({ loadingMore: false, error: result.error.message })
    }

    rawItems = [...rawItems, ...result.value.items]
    const appended = [...state.items, ...toSummaries(result.value.items)]
    const updatedAt = writeCache({
      items: rawItems,
      nextCursor: result.value.nextCursor,
      ...(result.value.total === undefined ? {} : { total: result.value.total }),
    })
    return patch({
      status: appended.length === 0 ? 'empty' : 'ready',
      items: appended,
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
    reset(): void {
      hydrated = false
      rawItems = []
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
