import { summarizeBuddyPost } from '../../domain/models/buddy'
import type { BuddyPost, BuddyPostSummary, BuddySection } from '../../domain/models/buddy'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { BuddyRepository, ListBuddyItemsQuery } from '../../domain/ports/buddyRepository'

/**
 * 搭子列表用例 —— 契约 §8 启动时序的落点：
 *
 * 1. `hydrate()`：**同步**读本地缓存（禁止网络）→ 页面立刻有内容
 * 2. 页面先渲染 `hydrate()` 的结果
 * 3. `load()`：后台拉取 → 成功替换、失败静默保留缓存
 *
 * 三板块（`academic` / `daily` / `sport`，契约 §11.10-G）**分栏展示**：
 * 页面把选中的板块传进来，缓存按板块分片（`cacheKeyFor`），
 * 否则切板块时 `hydrate()` 会把上一个板块的缓存当成当前板块的数据渲染出来。
 *
 * 状态对象在变更时才换引用，因此可以直接喂给 React 的 `useSyncExternalStore`。
 */

export type BuddyListStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export type BuddySectionFilter = BuddySection | 'all'

export interface BuddyListState {
  status: BuddyListStatus
  /** 当前展示的板块（与 `items` 一致，避免两者错位） */
  section: BuddySectionFilter
  items: BuddyPostSummary[]
  nextCursor: string | null
  total: number | null
  /** 用户可读的错误文案；成功时为 null */
  error: string | null
  /** 当前展示的数据来自本地缓存（即还没被网络刷新过） */
  fromCache: boolean
  updatedAt: string | null
  loadingMore: boolean
}

export interface CachedBuddyList {
  items: BuddyPost[]
  nextCursor: string | null
  total?: number
  updatedAt: string
}

export interface ListBuddyPostsDeps {
  repository: BuddyRepository
  cache: CachePort
  clock: ClockPort
  /** 缓存 key 由装配层（app/container）注入 —— application 不感知存储实现 */
  cacheKeyFor: (section: BuddySectionFilter) => string
  defaultQuery?: Omit<ListBuddyItemsQuery, 'cursor' | 'section'>
}

export interface ListBuddyPostsUseCase {
  getSnapshot(): BuddyListState
  subscribe(listener: () => void): () => void
  /** 契约 §8 第 1 步：同步 hydrate */
  hydrate(section?: BuddySectionFilter): BuddyListState
  /** 契约 §8 第 3 步：后台刷新（失败静默降级） */
  load(section?: BuddySectionFilter): Promise<BuddyListState>
  loadMore(section?: BuddySectionFilter): Promise<BuddyListState>
  reset(): void
}

const INITIAL_STATE: BuddyListState = {
  status: 'idle',
  section: 'all',
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
export function isCachedBuddyList(value: unknown): value is CachedBuddyList {
  if (!isRecord(value)) return false
  return Array.isArray(value.items) && typeof value.updatedAt === 'string'
}

export function createListBuddyPostsUseCase(deps: ListBuddyPostsDeps): ListBuddyPostsUseCase {
  const { repository, cache, clock, cacheKeyFor, defaultQuery = {} } = deps

  let state: BuddyListState = INITIAL_STATE
  const hydratedSections = new Set<BuddySectionFilter>()
  /** 原始（未派生）条目，用于把**累积**结果写回缓存，而不是只写最后一页 */
  let rawItems: BuddyPost[] = []
  const listeners = new Set<() => void>()

  function patch(next: Partial<BuddyListState>): BuddyListState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function toSummaries(items: readonly BuddyPost[]): BuddyPostSummary[] {
    const now = clock.now()
    return items.map((item) => summarizeBuddyPost(item, now))
  }

  function hydrate(section: BuddySectionFilter = state.section): BuddyListState {
    if (hydratedSections.has(section)) return state
    hydratedSections.add(section)

    const cached = cache.read<unknown>(cacheKeyFor(section))
    if (!isCachedBuddyList(cached)) {
      // 切到一个没有缓存的板块时，必须清空上一个板块的数据，否则会「串板块」
      if (section !== state.section) {
        rawItems = []
        return patch({
          status: 'idle',
          section,
          items: [],
          nextCursor: null,
          total: null,
          error: null,
          fromCache: false,
          updatedAt: null,
          loadingMore: false,
        })
      }
      return state
    }

    rawItems = cached.items
    const items = toSummaries(cached.items)
    return patch({
      status: items.length === 0 ? 'empty' : 'ready',
      section,
      items,
      nextCursor: cached.nextCursor,
      total: cached.total ?? null,
      error: null,
      fromCache: true,
      updatedAt: cached.updatedAt,
      loadingMore: false,
    })
  }

  function writeCache(
    section: BuddySectionFilter,
    page: { items: BuddyPost[]; nextCursor: string | null; total?: number },
  ): string {
    const updatedAt = clock.now().toISOString()
    const payload: CachedBuddyList = {
      items: page.items,
      nextCursor: page.nextCursor,
      ...(page.total === undefined ? {} : { total: page.total }),
      updatedAt,
    }
    cache.write(cacheKeyFor(section), payload)
    return updatedAt
  }

  function queryFor(section: BuddySectionFilter, cursor: string | null): ListBuddyItemsQuery {
    return { ...defaultQuery, section, cursor }
  }

  async function load(section: BuddySectionFilter = state.section): Promise<BuddyListState> {
    // 切换板块时先清空，避免旧板块的数据停留在屏幕上
    if (section !== state.section) {
      rawItems = []
      patch({
        status: 'loading',
        section,
        items: [],
        nextCursor: null,
        total: null,
        error: null,
        fromCache: false,
        updatedAt: null,
        loadingMore: false,
      })
    } else {
      // 已有缓存时保持 ready（不要把首屏打回骨架屏）
      patch({ status: state.items.length > 0 ? 'ready' : 'loading', error: null })
    }

    const result = await repository.listItems(queryFor(section, null))
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
    const updatedAt = writeCache(section, result.value)
    return patch({
      status: items.length === 0 ? 'empty' : 'ready',
      section,
      items,
      nextCursor: result.value.nextCursor,
      total: result.value.total ?? null,
      error: null,
      fromCache: false,
      updatedAt,
      loadingMore: false,
    })
  }

  async function loadMore(section: BuddySectionFilter = state.section): Promise<BuddyListState> {
    if (state.nextCursor === null || state.loadingMore) return state

    patch({ loadingMore: true, error: null })
    const result = await repository.listItems(queryFor(section, state.nextCursor))

    if (!result.ok) {
      return patch({ loadingMore: false, error: result.error.message })
    }

    rawItems = [...rawItems, ...result.value.items]
    const appended = [...state.items, ...toSummaries(result.value.items)]
    const updatedAt = writeCache(section, {
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
      hydratedSections.clear()
      rawItems = []
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
