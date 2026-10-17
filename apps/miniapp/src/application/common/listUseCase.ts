import type { Result } from '@kedaya/shared'

import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'

/**
 * 通用「列表用例」骨架 —— 契约 §8 启动时序的统一实现。
 *
 * 为什么要有这个文件：
 *   六个业务模块（跳蚤 / 跑腿 / 找搭子 / 失物招领 / 论坛 …）的列表行为**完全同构**：
 *   同步 hydrate 缓存 → 后台刷新 → 失败静默降级 → 游标续页 → 筛选。如果每个模块
 *   各写一遍，几百行几乎相同的代码会迅速漂移（有的模块忘记静默降级、有的忘记
 *   把累积结果写回缓存）。所以这里把机制收敛成一份**被测试覆盖**的实现，
 *   模块只需要提供三样东西：
 *
 *   1. `fetchPage(query, cursor)` —— 怎么取一页（模块自己的仓储端口）
 *   2. `mapItem(item, now)` —— 行数据怎么变成 UI 直接可用的视图对象
 *   3. 缓存形状守卫 —— 旧版本缓存不可信，必须校验
 *
 * 状态对象只在变更时换引用，因此可以直接喂给 React 的 `useSyncExternalStore`。
 */

export type ListStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface ListState<TView> {
  status: ListStatus
  items: TView[]
  nextCursor: string | null
  total: number | null
  /** 用户可读的错误文案；成功时为 null */
  error: string | null
  /** 当前展示的数据来自本地缓存（即还没被网络刷新过） */
  fromCache: boolean
  updatedAt: string | null
  loadingMore: boolean
  /** 当前生效的筛选条件，页面用它回显筛选器 */
  query: Record<string, unknown>
}

export interface ListPage<TItem> {
  items: TItem[]
  nextCursor: string | null
  total?: number
}

/** 缓存载荷（模块自带守卫来校验它） */
export interface CachedListPage<TItem> {
  items: TItem[]
  nextCursor: string | null
  total?: number
  updatedAt: string
}

export interface ListUseCase<TQuery extends Record<string, unknown>, TView> {
  getSnapshot(): ListState<TView>
  subscribe(listener: () => void): () => void
  /** 契约 §8 第 1 步：同步 hydrate（禁止网络） */
  hydrate(): ListState<TView>
  /** 契约 §8 第 3 步：后台刷新；失败静默降级到缓存 */
  load(query?: Partial<TQuery>): Promise<ListState<TView>>
  /** 续页（游标为空时是空操作） */
  loadMore(query?: Partial<TQuery>): Promise<ListState<TView>>
  /** 改筛选条件：只改状态、不发请求，由页面随后调用 `load()` */
  setQuery(patch: Partial<TQuery>): ListState<TView>
  reset(): void
}

export interface ListUseCaseDeps<TQuery extends Record<string, unknown>, TItem, TView> {
  cache: CachePort
  clock: ClockPort
  /** 缓存 key 由装配层注入 —— application 不感知存储实现 */
  cacheKey: string
  defaultQuery: TQuery
  fetchPage: (
    query: TQuery,
    cursor: string | null,
  ) => Promise<Result<ListPage<TItem>, RepositoryError>>
  mapItem: (item: TItem, now: Date) => TView
  /** 缓存形状守卫（旧版本写入的缓存不可信） */
  isCachedPage: (value: unknown) => value is CachedListPage<TItem>
}

export function initialListState<TView>(query: Record<string, unknown>): ListState<TView> {
  return {
    status: 'idle',
    items: [],
    nextCursor: null,
    total: null,
    error: null,
    fromCache: false,
    updatedAt: null,
    loadingMore: false,
    query,
  }
}

export function createListUseCase<TQuery extends Record<string, unknown>, TItem, TView>(
  deps: ListUseCaseDeps<TQuery, TItem, TView>,
): ListUseCase<TQuery, TView> {
  const { cache, clock, cacheKey, defaultQuery, fetchPage, mapItem, isCachedPage } = deps

  let query: TQuery = { ...defaultQuery }
  let state: ListState<TView> = initialListState<TView>({ ...query })
  let hydrated = false
  /** 原始条目：用于把**累积**结果写回缓存，而不是只写最后一页 */
  let rawItems: TItem[] = []
  const listeners = new Set<() => void>()

  function patch(next: Partial<ListState<TView>>): ListState<TView> {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function view(items: readonly TItem[]): TView[] {
    const now = clock.now()
    return items.map((item) => mapItem(item, now))
  }

  function writeCache(page: ListPage<TItem>): string {
    const updatedAt = clock.now().toISOString()
    const payload: CachedListPage<TItem> = {
      items: page.items,
      nextCursor: page.nextCursor,
      ...(page.total === undefined ? {} : { total: page.total }),
      updatedAt,
    }
    cache.write(cacheKey, payload)
    return updatedAt
  }

  function hydrate(): ListState<TView> {
    if (hydrated) return state
    hydrated = true

    const cached = cache.read<unknown>(cacheKey)
    if (!isCachedPage(cached)) return state

    rawItems = cached.items
    const items = view(cached.items)
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

  async function load(partial: Partial<TQuery> = {}): Promise<ListState<TView>> {
    query = { ...query, ...partial }
    // 已有内容时保持 ready（不要把首屏打回骨架屏），只更新筛选条件
    patch({ status: state.items.length > 0 ? 'ready' : 'loading', error: null, query: { ...query } })

    const result = await fetchPage(query, null)
    if (!result.ok) {
      // 契约 §8：失败静默降级 —— 有缓存就继续用缓存，只把错误文案挂上
      return patch({
        status: state.items.length > 0 ? 'ready' : 'error',
        error: result.error.message,
        fromCache: state.items.length > 0,
      })
    }

    rawItems = result.value.items
    const items = view(result.value.items)
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

  async function loadMore(partial: Partial<TQuery> = {}): Promise<ListState<TView>> {
    if (state.nextCursor === null || state.loadingMore) return state
    if (Object.keys(partial).length > 0) {
      query = { ...query, ...partial }
    }

    patch({ loadingMore: true, error: null })
    const result = await fetchPage(query, state.nextCursor)

    if (!result.ok) {
      return patch({ loadingMore: false, error: result.error.message })
    }

    rawItems = [...rawItems, ...result.value.items]
    const appended = [...state.items, ...view(result.value.items)]
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
    setQuery(patch_): ListState<TView> {
      query = { ...query, ...patch_ }
      return patch({ query: { ...query } })
    },
    reset(): void {
      hydrated = false
      rawItems = []
      state = initialListState<TView>({ ...query })
      for (const listener of listeners) listener()
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 生成一个「最小值校验」的缓存守卫：只要 `items` 是数组、`updatedAt` 是字符串就认。
 *
 * 对列表缓存来说这已经足够 —— 真正的字段级校验发生在 `mapItem`：
 * 缺字段的条目会渲染成占位文案，而不会让整页崩掉。
 * 需要更严校验的模块（含嵌套成员列表）可以传入 `isItem`。
 */
export function createCachedPageGuard<TItem>(
  isItem?: (value: unknown) => value is TItem,
): (value: unknown) => value is CachedListPage<TItem> {
  return (value: unknown): value is CachedListPage<TItem> => {
    if (!isRecord(value)) return false
    if (!Array.isArray(value.items)) return false
    if (typeof value.updatedAt !== 'string') return false
    if (value.nextCursor !== null && typeof value.nextCursor !== 'string') return false
    if (isItem === undefined) return true
    return value.items.every((item) => isItem(item))
  }
}
