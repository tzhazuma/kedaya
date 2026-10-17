import { hasForbiddenCredentialKeys } from '../../domain/models/credentials'
import {
  type CampusBindingSummary,
  isBindingUsable,
} from '../../domain/models/techpie'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { LogPort } from '../../domain/ports/logPort'
import type { TechpieRepository } from '../../domain/ports/techpieRepository'

/**
 * 绑定列表用例 —— 契约 §8 启动时序的落点（与 `groupbuy` / `buddy` 完全同构）：
 *
 * 1. `hydrate()`：**同步**读本地缓存（禁止网络）→ 页面立刻有内容；
 * 2. 页面先渲染 `hydrate()` 的结果；
 * 3. `load()`：后台拉取 → 成功替换、失败**静默保留缓存**。
 *
 * ## 缓存安全（本用例独有）
 *
 * 绑定列表是**二级身份元数据**，写缓存前会再做一次禁用键扫描：
 * 缓存里出现 `castgc` 之类的键时**整条丢弃**。
 * 这看起来多余（上游已经归一化过），但缓存是**跨版本**持久化的 ——
 * 一个旧版本写入的脏缓存完全可能带着凭证键复活。
 * 「上游干净」不能推出「磁盘干净」。
 */

export type BindingsStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface BindingsState {
  status: BindingsStatus
  items: CampusBindingSummary[]
  nextCursor: string | null
  total: number | null
  error: string | null
  fromCache: boolean
  updatedAt: string | null
  loadingMore: boolean
}

export interface CachedBindings {
  items: CampusBindingSummary[]
  nextCursor: string | null
  total?: number
  updatedAt: string
}

export interface ListBindingsDeps {
  repository: TechpieRepository
  cache: CachePort
  clock: ClockPort
  cacheKey: string
  log?: LogPort
}

export interface ListBindingsUseCase {
  getSnapshot(): BindingsState
  subscribe(listener: () => void): () => void
  /** 契约 §8 第 1 步：同步 hydrate */
  hydrate(): BindingsState
  /** 契约 §8 第 3 步：后台刷新（失败静默降级） */
  load(): Promise<BindingsState>
  loadMore(): Promise<BindingsState>
  /** 只读派生：可用的绑定平台（供能力页构造 `CampusViewer`） */
  usableBindings(): CampusBindingSummary[]
  reset(): void
}

const INITIAL_STATE: BindingsState = {
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

/**
 * 缓存形状校验 —— **含凭证键扫描**。
 *
 * 旧版本写入的缓存可能带凭证键；`hasForbiddenCredentialKeys` 让这种缓存
 * 在**读**的时候就失效，而不是等到渲染出来才被发现。
 */
export function isCachedBindings(value: unknown): value is CachedBindings {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.items)) return false
  if (typeof value.updatedAt !== 'string') return false
  return !hasForbiddenCredentialKeys(value)
}

export function createListBindingsUseCase(deps: ListBindingsDeps): ListBindingsUseCase {
  const { repository, cache, clock, cacheKey, log } = deps

  let state: BindingsState = INITIAL_STATE
  let hydrated = false
  const listeners = new Set<() => void>()

  function patch(next: Partial<BindingsState>): BindingsState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function activeCount(items: readonly CampusBindingSummary[]): number {
    return items.filter((item) => isBindingUsable(item.status)).length
  }

  function writeCache(page: {
    items: CampusBindingSummary[]
    nextCursor: string | null
    total?: number
  }): string | null {
    // 写之前再扫一次：宁可缓存不写，也不让凭证键落盘
    if (hasForbiddenCredentialKeys(page.items)) {
      log?.warn('techpie.contract.violation', {
        where: 'techpie.links.cache',
        droppedCount: 1,
        reason: 'FORBIDDEN_KEYS_IN_CACHE_WRITE',
      })
      return null
    }
    const updatedAt = clock.now().toISOString()
    const payload: CachedBindings = {
      items: page.items,
      nextCursor: page.nextCursor,
      ...(page.total === undefined ? {} : { total: page.total }),
      updatedAt,
    }
    cache.write(cacheKey, payload)
    return updatedAt
  }

  function hydrate(): BindingsState {
    if (hydrated) return state
    hydrated = true

    const cached = cache.read<unknown>(cacheKey)
    if (!isCachedBindings(cached)) return state

    return patch({
      status: cached.items.length === 0 ? 'empty' : 'ready',
      items: cached.items,
      nextCursor: cached.nextCursor,
      total: cached.total ?? null,
      error: null,
      fromCache: true,
      updatedAt: cached.updatedAt,
      loadingMore: false,
    })
  }

  async function load(): Promise<BindingsState> {
    log?.info('techpie.bindings.load.started')
    const startedAt = clock.now().getTime()
    // 已有数据时保持 ready（不要把首屏打回骨架屏）
    patch({ status: state.items.length > 0 ? 'ready' : 'loading', error: null })

    const result = await repository.listBindings()
    const durationMs = clock.now().getTime() - startedAt

    if (!result.ok) {
      log?.warn('techpie.bindings.load.failed', { code: result.error.code, durationMs })
      // 契约 §8：失败静默降级 —— 有缓存就继续用缓存，只把错误文案挂上
      return patch({
        status: state.items.length > 0 ? 'ready' : 'error',
        error: result.error.message,
        fromCache: state.items.length > 0,
      })
    }

    const items = result.value.items
    const updatedAt = writeCache(result.value)
    log?.info('techpie.bindings.load.succeeded', {
      count: items.length,
      activeCount: activeCount(items),
      durationMs,
    })

    return patch({
      status: items.length === 0 ? 'empty' : 'ready',
      items,
      nextCursor: result.value.nextCursor,
      total: result.value.total ?? null,
      error: null,
      fromCache: false,
      updatedAt: updatedAt ?? state.updatedAt,
      loadingMore: false,
    })
  }

  async function loadMore(): Promise<BindingsState> {
    if (state.nextCursor === null || state.loadingMore) return state

    patch({ loadingMore: true, error: null })
    const result = await repository.listBindings({ cursor: state.nextCursor })

    if (!result.ok) {
      log?.warn('techpie.bindings.load.failed', { code: result.error.code, durationMs: 0 })
      return patch({ loadingMore: false, error: result.error.message })
    }

    const appended = [...state.items, ...result.value.items]
    const updatedAt = writeCache({
      items: appended,
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
      updatedAt: updatedAt ?? state.updatedAt,
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
    usableBindings: () => state.items.filter((item) => isBindingUsable(item.status)),
    reset(): void {
      hydrated = false
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
