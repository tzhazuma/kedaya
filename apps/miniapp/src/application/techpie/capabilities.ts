import type { Session } from '../../domain/models/session'
import { isAuthenticated } from '../../domain/models/session'
import { hasForbiddenCredentialKeys } from '../../domain/models/credentials'
import {
  campusCapabilityDelivery,
  campusViewerFromBindings,
  countUnboundCapabilities,
  resolveCapabilityEntry,
  type CampusBindingSummary,
  type CampusCapability,
  type CampusCapabilityDelivery,
  type CampusEntryDecision,
  type CampusViewer,
} from '../../domain/models/techpie'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { LogPort } from '../../domain/ports/logPort'
import type { TechpieRepository } from '../../domain/ports/techpieRepository'

/**
 * 校园能力清单用例（`GET /techpie/capabilities`）。
 *
 * ## 这个用例存在的理由
 *
 * 契约不变式 **I4** 要求：「已登录但未绑定」是**合法状态**，
 * 校园功能返回 `CAMPUS_BINDING_REQUIRED`（409）而**不是** `UNAUTHENTICATED`（401）。
 * 401 会误导客户端去重新登录，而用户其实已经登录了。
 *
 * 在客户端，这条不变式体现为**渲染语义**：
 * 未绑定项必须画成**引导卡片**（「还差一步：绑定校园卡」+ 去绑定按钮），
 * 不是红色错误态。本用例把这件事收敛成一个纯选择器 `entries(viewer)`，
 * 于是「引导 vs 报错」不再取决于某个页面的写法，而是**数据**。
 *
 * 为什么 `viewer` 是**入参**而不是用例内部状态：
 * 「已登录」来自会话，「已绑定」来自绑定列表 —— 两者是不同的数据源，
 * 用例不该偷偷去读另一个用例的状态（那会让测试必须装配半个应用）。
 * 页面把两者拼好传进来，选择器保持纯函数。
 */

export type CapabilitiesStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface CapabilitiesState {
  status: CapabilitiesStatus
  items: CampusCapability[]
  error: string | null
  fromCache: boolean
  updatedAt: string | null
}

/** 一条能力 + 它对应的入口决策（页面直接渲染这个） */
export interface CampusCapabilityEntry {
  capability: CampusCapability
  decision: CampusEntryDecision
  delivery: CampusCapabilityDelivery
}

export interface CachedCapabilities {
  items: CampusCapability[]
  updatedAt: string
}

export interface CapabilitiesDeps {
  repository: TechpieRepository
  cache: CachePort
  clock: ClockPort
  cacheKey: string
  log?: LogPort
}

export interface CapabilitiesUseCase {
  getSnapshot(): CapabilitiesState
  subscribe(listener: () => void): () => void
  hydrate(): CapabilitiesState
  load(): Promise<CapabilitiesState>
  /** 纯选择器：能力 + 观看者 → 可渲染条目（**含 CAMPUS_BINDING_REQUIRED 引导**） */
  entries(viewer: CampusViewer): CampusCapabilityEntry[]
  /** 未绑定项数量（用于「去绑定」引导条） */
  unboundCount(viewer: CampusViewer): number
  reset(): void
}

const INITIAL_STATE: CapabilitiesState = {
  status: 'idle',
  items: [],
  error: null,
  fromCache: false,
  updatedAt: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isCachedCapabilities(value: unknown): value is CachedCapabilities {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.items)) return false
  if (typeof value.updatedAt !== 'string') return false
  return !hasForbiddenCredentialKeys(value)
}

/**
 * 从「会话 + 绑定列表」构造观看者 —— 页面用这个，避免自己拼错。
 *
 * 这个函数是**唯一的**「未登录 vs 未绑定」判定入口：
 * 所有页面都必须经过它，否则迟早有一页把未绑定误判成未登录。
 */
export function campusViewerOf(
  session: Session,
  bindings: readonly CampusBindingSummary[],
): CampusViewer {
  return campusViewerFromBindings(isAuthenticated(session), bindings)
}

export function createCapabilitiesUseCase(deps: CapabilitiesDeps): CapabilitiesUseCase {
  const { repository, cache, clock, cacheKey, log } = deps

  let state: CapabilitiesState = INITIAL_STATE
  let hydrated = false
  const listeners = new Set<() => void>()

  function patch(next: Partial<CapabilitiesState>): CapabilitiesState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function hydrate(): CapabilitiesState {
    if (hydrated) return state
    hydrated = true

    const cached = cache.read<unknown>(cacheKey)
    if (!isCachedCapabilities(cached)) return state

    log?.info('techpie.capabilities.hydrated', { count: cached.items.length })
    return patch({
      status: cached.items.length === 0 ? 'empty' : 'ready',
      items: cached.items,
      error: null,
      fromCache: true,
      updatedAt: cached.updatedAt,
    })
  }

  async function load(): Promise<CapabilitiesState> {
    log?.info('techpie.capabilities.load.started')
    const startedAt = clock.now().getTime()
    patch({ status: state.items.length > 0 ? 'ready' : 'loading', error: null })

    const result = await repository.capabilities()
    const durationMs = clock.now().getTime() - startedAt

    if (!result.ok) {
      log?.warn('techpie.capabilities.load.failed', { code: result.error.code, durationMs })
      return patch({
        status: state.items.length > 0 ? 'ready' : 'error',
        error: result.error.message,
        fromCache: state.items.length > 0,
      })
    }

    const items = result.value
    const updatedAt = clock.now().toISOString()
    if (!hasForbiddenCredentialKeys(items)) {
      cache.write(cacheKey, { items, updatedAt } satisfies CachedCapabilities)
    } else {
      log?.warn('techpie.contract.violation', {
        where: 'techpie.capabilities.cache',
        droppedCount: 1,
        reason: 'FORBIDDEN_KEYS_IN_CACHE_WRITE',
      })
    }

    // ⚠️ 这里**不**上报 unboundCount：未绑定数量取决于「谁在看」（viewer），
    // 而 load() 拿不到 viewer。上报一个 0 会让日志说谎 —— 宁可不报。
    log?.info('techpie.capabilities.load.succeeded', { count: items.length, durationMs })

    return patch({
      status: items.length === 0 ? 'empty' : 'ready',
      items,
      error: null,
      fromCache: false,
      updatedAt,
    })
  }

  function entries(viewer: CampusViewer): CampusCapabilityEntry[] {
    return state.items.map((capability) => {
      const delivery = campusCapabilityDelivery(capability.key)
      return {
        capability,
        delivery,
        decision: resolveCapabilityEntry(capability, viewer, delivery),
      }
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
    entries,
    unboundCount: (viewer) => countUnboundCapabilities(state.items, viewer),
    reset(): void {
      hydrated = false
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
