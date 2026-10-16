import { createListGroupBuysUseCase } from '../application/groupbuy/listGroupBuys'
import type { ListGroupBuysUseCase } from '../application/groupbuy/listGroupBuys'
import { createGroupBuyDetailUseCase } from '../application/groupbuy/groupBuyDetail'
import type { GroupBuyDetailUseCase } from '../application/groupbuy/groupBuyDetail'
import { createJoinGroupBuyUseCase } from '../application/groupbuy/joinGroupBuy'
import type { JoinGroupBuyUseCase } from '../application/groupbuy/joinGroupBuy'
import { createSessionUseCase } from '../application/auth/session'
import type { SessionUseCase } from '../application/auth/session'
import { createApiClient, createAuthRefresher, createTaroHttpPort, createTracePort } from '../data/api'
import type { ApiClient } from '../data/api'
import { createHttpGroupBuyRepository } from '../data/repositories/httpGroupBuyRepository'
import { createMockGroupBuyRepository } from '../data/repositories/mockGroupBuyRepository'
import type { MockGroupBuyRepository } from '../data/repositories/mockGroupBuyRepository'
import { createMemoryStorage } from '../data/storage/memoryStorage'
import { createSessionStore, createTokenStore } from '../data/storage/sessionStore'
import { StorageKeys } from '../data/storage/keys'
import { createTaroStorage } from '../data/storage/taroStorage'
import type { CachePort } from '../domain/ports/cachePort'
import type { ClockPort } from '../domain/ports/clockPort'
import type { GroupBuyRepository } from '../domain/ports/groupbuyRepository'
import type { AuthRefresherPort, SessionStorePort, TokenStorePort } from '../domain/ports/sessionPort'
import type { TracePort } from '../domain/ports/tracePort'

/**
 * 装配层（契约 §7 `app/`：DI、路由注册、运行时工厂）。
 *
 * 这是全项目**唯一**把端口（domain）与实现（data / platform）接起来的地方。
 * presentation 只通过 `getContainer()` 拿用例，永远看不到 Taro API。
 *
 * 默认走 **mock**：契约 §7 硬规则 4 要求「无后端也能开发」。
 * 接真后端只需设置 `TARO_APP_USE_MOCK=false` + `TARO_APP_API_BASE_URL`。
 */

/** 占位域名：真实后端地址由 `TARO_APP_API_BASE_URL` 注入 */
export const DEFAULT_API_BASE_URL = 'https://api.kedaya.example'

export interface AppEnv {
  apiBaseUrl: string
  useMock: boolean
  requestTimeoutMs: number
  mockLatencyMs: number
}

export function readEnv(): AppEnv {
  const env = typeof process !== 'undefined' ? process.env : {}
  const latency = Number(env.TARO_APP_MOCK_LATENCY_MS ?? '220')

  return {
    apiBaseUrl: env.TARO_APP_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    // 默认 mock：骨架必须开箱可跑
    useMock: env.TARO_APP_USE_MOCK !== 'false',
    requestTimeoutMs: Number(env.TARO_APP_REQUEST_TIMEOUT_MS ?? '15000'),
    mockLatencyMs: Number.isFinite(latency) ? latency : 220,
  }
}

export interface AppContainer {
  env: AppEnv
  trace: TracePort
  cache: CachePort
  clock: ClockPort
  sessionStore: SessionStorePort
  tokenStore: TokenStorePort
  refresher: AuthRefresherPort
  apiClient: ApiClient
  groupBuyRepository: GroupBuyRepository
  /** 仅 mock 模式下非空 —— 页面用它演示「三态」 */
  mockControls: MockGroupBuyRepository | null
  useCases: {
    session: SessionUseCase
    listGroupBuys: ListGroupBuysUseCase
    groupBuyDetail: GroupBuyDetailUseCase
    joinGroupBuy: JoinGroupBuyUseCase
  }
}

export interface ContainerOverrides {
  cache?: CachePort
  clock?: ClockPort
  repository?: GroupBuyRepository
  env?: Partial<AppEnv>
}

/** 默认时钟（真实时间）。测试可注入固定时钟。 */
function systemClock(): ClockPort {
  return { now: () => new Date() }
}

export function createContainer(overrides: ContainerOverrides = {}): AppContainer {
  const env: AppEnv = { ...readEnv(), ...overrides.env }

  const cache = overrides.cache ?? createTaroStorage()
  const clock = overrides.clock ?? systemClock()
  const trace = createTracePort()

  const sessionStore = createSessionStore(cache)
  const tokenStore = createTokenStore(sessionStore)

  const http = createTaroHttpPort()
  const refresher = createAuthRefresher({ baseUrl: env.apiBaseUrl, http, trace })
  const apiClient = createApiClient({
    baseUrl: env.apiBaseUrl,
    http,
    tokens: tokenStore,
    refresh: refresher,
    trace,
    defaultTimeoutMs: env.requestTimeoutMs,
    onUnauthenticated: () => {
      sessionStore.setTokens(null)
    },
  })

  const mockRepository = env.useMock
    ? createMockGroupBuyRepository({ latencyMs: env.mockLatencyMs })
    : null

  const groupBuyRepository: GroupBuyRepository =
    overrides.repository ?? mockRepository ?? createHttpGroupBuyRepository(apiClient)

  const session = createSessionUseCase(sessionStore)
  const listGroupBuys = createListGroupBuysUseCase({
    repository: groupBuyRepository,
    cache,
    clock,
    cacheKey: StorageKeys.groupBuyListCache,
  })
  const groupBuyDetail = createGroupBuyDetailUseCase({
    repository: groupBuyRepository,
    cache,
    clock,
    cacheKeyFor: (id) => `${StorageKeys.groupBuyDetailCache}:${id}`,
  })
  const joinGroupBuy = createJoinGroupBuyUseCase({
    repository: groupBuyRepository,
    session: sessionStore,
    clock,
  })

  return {
    env,
    trace,
    cache,
    clock,
    sessionStore,
    tokenStore,
    refresher,
    apiClient,
    groupBuyRepository,
    mockControls: mockRepository,
    useCases: { session, listGroupBuys, groupBuyDetail, joinGroupBuy },
  }
}

/* ------------------------------------------------------------------ *
 * 全局单例
 * ------------------------------------------------------------------ */

let singleton: AppContainer | null = null

export function getContainer(): AppContainer {
  if (singleton === null) singleton = createContainer()
  return singleton
}

/** 仅供测试：重置单例（并可选换一套 override） */
export function __resetContainerForTests(overrides?: ContainerOverrides): AppContainer {
  singleton = overrides === undefined ? null : createContainer(overrides)
  return getContainer()
}

/** 兜底：Taro 存储完全不可用时（例如 node 环境）的容器 */
export function createHeadlessContainer(): AppContainer {
  return createContainer({ cache: createMemoryStorage() })
}
