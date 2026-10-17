import { createListGroupBuysUseCase } from '../application/groupbuy/listGroupBuys'
import type { ListGroupBuysUseCase } from '../application/groupbuy/listGroupBuys'
import { createGroupBuyDetailUseCase } from '../application/groupbuy/groupBuyDetail'
import type { GroupBuyDetailUseCase } from '../application/groupbuy/groupBuyDetail'
import { createJoinGroupBuyUseCase } from '../application/groupbuy/joinGroupBuy'
import type { JoinGroupBuyUseCase } from '../application/groupbuy/joinGroupBuy'
import { createSessionUseCase } from '../application/auth/session'
import type { SessionUseCase } from '../application/auth/session'
import { createAuthAccountUseCase } from '../application/auth/authAccount'
import type { AuthAccountUseCase } from '../application/auth/authAccount'
import { createFleaMarketUseCases } from '../application/fleaMarket/fleaMarketUseCases'
import type { FleaMarketUseCases } from '../application/fleaMarket/fleaMarketUseCases'
import { createErrandUseCases } from '../application/errand/errandUseCases'
import type { ErrandUseCases } from '../application/errand/errandUseCases'
import { createBuddyUseCases } from '../application/buddy/buddyUseCases'
import type { BuddyUseCases } from '../application/buddy/buddyUseCases'
import { createLostFoundUseCases } from '../application/lostFound/lostFoundUseCases'
import type { LostFoundUseCases } from '../application/lostFound/lostFoundUseCases'
import { createForumUseCases } from '../application/forum/forumUseCases'
import type { ForumUseCases } from '../application/forum/forumUseCases'
import { createDormHarmonyUseCases } from '../application/dormHarmony/dormHarmonyUseCases'
import type { DormHarmonyUseCases } from '../application/dormHarmony/dormHarmonyUseCases'
import { createApiClient, createAuthRefresher, createTaroHttpPort, createTracePort } from '../data/api'
import type { ApiClient } from '../data/api'
import { createHttpGroupBuyRepository } from '../data/repositories/httpGroupBuyRepository'
import { createMockGroupBuyRepository } from '../data/repositories/mockGroupBuyRepository'
import { createHttpAuthRepository } from '../data/repositories/httpAuthRepository'
import { createMockAuthRepository } from '../data/repositories/mockAuthRepository'
import { createHttpFleaMarketRepository } from '../data/repositories/httpFleaMarketRepository'
import { createMockFleaMarketRepository } from '../data/repositories/mockFleaMarketRepository'
import { createHttpErrandRepository } from '../data/repositories/httpErrandRepository'
import { createMockErrandRepository } from '../data/repositories/mockErrandRepository'
import { createHttpBuddyRepository } from '../data/repositories/httpBuddyRepository'
import { createMockBuddyRepository } from '../data/repositories/mockBuddyRepository'
import { createHttpLostFoundRepository } from '../data/repositories/httpLostFoundRepository'
import { createMockLostFoundRepository } from '../data/repositories/mockLostFoundRepository'
import { createHttpForumRepository } from '../data/repositories/httpForumRepository'
import { createMockForumRepository } from '../data/repositories/mockForumRepository'
import { createHttpDormHarmonyRepository } from '../data/repositories/httpDormHarmonyRepository'
import { createMockDormHarmonyRepository } from '../data/repositories/mockDormHarmonyRepository'
import { mockNow } from '../data/mock/fixtures'
import { createAvatarPickerPort } from '../platform/avatarPicker'
import { createWechatCodePort } from '../platform/wechatLogin'
import type { MockGroupBuyRepository } from '../data/repositories/mockGroupBuyRepository'
import { createMemoryStorage } from '../data/storage/memoryStorage'
import { createSessionStore, createTokenStore } from '../data/storage/sessionStore'
import { StorageKeys } from '../data/storage/keys'
import { createTaroStorage } from '../data/storage/taroStorage'
import type { AuthRepository } from '../domain/ports/authRepository'
import type { AvatarPickerPort } from '../domain/ports/mediaPort'
import type { WechatCodePort } from '../domain/ports/wechatPort'
import type { CachePort } from '../domain/ports/cachePort'
import type { ClockPort } from '../domain/ports/clockPort'
import type { BuddyRepository } from '../domain/ports/buddyRepository'
import type { DormHarmonyRepository } from '../domain/ports/dormHarmonyRepository'
import type { ErrandTaskRepository } from '../domain/ports/errandRepository'
import type { FleaItemRepository } from '../domain/ports/fleaMarketRepository'
import type { ForumRepository } from '../domain/ports/forumRepository'
import type { LostFoundRepository } from '../domain/ports/lostFoundRepository'
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
  /** 微信登录凭证（平台能力：真实 `Taro.login()` 或开发模拟） */
  wechatCode: WechatCodePort
  /** 本地头像选择（平台能力：`chooseAvatar` → 压缩后的 data URL） */
  avatarPicker: AvatarPickerPort
  groupBuyRepository: GroupBuyRepository
  authRepository: AuthRepository
  fleaMarketRepository: FleaItemRepository
  errandRepository: ErrandTaskRepository
  buddyRepository: BuddyRepository
  lostFoundRepository: LostFoundRepository
  forumRepository: ForumRepository
  dormHarmonyRepository: DormHarmonyRepository
  /** 仅 mock 模式下非空 —— 页面用它演示「三态」 */
  mockControls: MockGroupBuyRepository | null
  useCases: {
    session: SessionUseCase
    auth: AuthAccountUseCase
    listGroupBuys: ListGroupBuysUseCase
    groupBuyDetail: GroupBuyDetailUseCase
    joinGroupBuy: JoinGroupBuyUseCase
    fleaMarket: FleaMarketUseCases
    errand: ErrandUseCases
    buddy: BuddyUseCases
    lostFound: LostFoundUseCases
    forum: ForumUseCases
    dormHarmony: DormHarmonyUseCases
  }
}

export interface ContainerOverrides {
  cache?: CachePort
  clock?: ClockPort
  repository?: GroupBuyRepository
  authRepository?: AuthRepository
  wechatCode?: WechatCodePort
  avatarPicker?: AvatarPickerPort
  env?: Partial<AppEnv>
}

/** 默认时钟（真实时间）。测试可注入固定时钟。 */
function systemClock(): ClockPort {
  return { now: () => new Date() }
}

export function createContainer(overrides: ContainerOverrides = {}): AppContainer {
  const env: AppEnv = { ...readEnv(), ...overrides.env }

  const cache = overrides.cache ?? createTaroStorage()
  // Mock 数据使用固定演示日期，页面校验必须与 Mock 仓储使用同一时钟。
  const clock = overrides.clock ?? (env.useMock ? { now: mockNow } : systemClock())
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
    ? createMockGroupBuyRepository({ latencyMs: env.mockLatencyMs, now: clock.now })
    : null

  const groupBuyRepository: GroupBuyRepository =
    overrides.repository ?? mockRepository ?? createHttpGroupBuyRepository(apiClient)

  /**
   * 账号仓储：mock 模式走内存实现，真实模式直连 `/auth/account/*`。
   * 两个实现的**行为契约一致**（验证码一次性、错误文案统一），
   * 因此页面逻辑不需要分叉。
   */
  const authRepository: AuthRepository =
    overrides.authRepository ??
    (env.useMock
      ? createMockAuthRepository({ latencyMs: env.mockLatencyMs, now: clock.now })
      : createHttpAuthRepository(apiClient))

  const wechatCode = overrides.wechatCode ?? createWechatCodePort()
  const avatarPicker = overrides.avatarPicker ?? createAvatarPickerPort()

  const session = createSessionUseCase(sessionStore, { now: clock.now })
  const auth = createAuthAccountUseCase({
    repository: authRepository,
    session: sessionStore,
    wechatCode,
    now: clock.now,
  })

  /**
   * 当前登录用户 —— 六个业务模块都需要它来判定「这是我发布的 / 我能否操作」。
   *
   * 做成**函数**而不是快照：用户可能在页面停留期间登录/登出，
   * 函数形式能让 `list.load()` 或详情页刷新时立刻拿到最新的主体，
   * 而不是停留在容器创建那一刻的旧值。
   */
  const viewerId = (): string | null => sessionStore.getSnapshot().profile?.id ?? null

  const fleaMarketRepository: FleaItemRepository = env.useMock
    ? createMockFleaMarketRepository({ cache, viewerId, latencyMs: env.mockLatencyMs, now: clock.now })
    : createHttpFleaMarketRepository(apiClient)

  const fleaMarket = createFleaMarketUseCases({
    repository: fleaMarketRepository,
    cache,
    clock,
    cacheKey: StorageKeys.fleaMarketListCache,
    viewerId,
  })

  // 其余业务模块：同一套装配形状（仓储 = mock 或 http；用例吃 cache/clock/viewerId）
  const errandRepository: ErrandTaskRepository = env.useMock
    ? createMockErrandRepository({ cache, viewerId, latencyMs: env.mockLatencyMs, now: clock.now })
    : createHttpErrandRepository(apiClient)
  const errand = createErrandUseCases({
    repository: errandRepository,
    cache,
    clock,
    cacheKey: StorageKeys.errandListCache,
    viewerId,
  })

  const buddyRepository: BuddyRepository = env.useMock
    ? createMockBuddyRepository({ cache, viewerId, latencyMs: env.mockLatencyMs, now: clock.now })
    : createHttpBuddyRepository(apiClient)
  const buddy = createBuddyUseCases({
    repository: buddyRepository,
    cache,
    clock,
    cacheKey: StorageKeys.buddyListCache,
    viewerId,
  })

  const lostFoundRepository: LostFoundRepository = env.useMock
    ? createMockLostFoundRepository({ cache, viewerId, latencyMs: env.mockLatencyMs, now: clock.now })
    : createHttpLostFoundRepository(apiClient)
  const lostFound = createLostFoundUseCases({
    repository: lostFoundRepository,
    cache,
    clock,
    cacheKey: StorageKeys.lostFoundListCache,
    viewerId,
  })

  const forumRepository: ForumRepository = env.useMock
    ? createMockForumRepository({ cache, viewerId, latencyMs: env.mockLatencyMs, now: clock.now })
    : createHttpForumRepository(apiClient)
  const forum = createForumUseCases({
    repository: forumRepository,
    cache,
    clock,
    cacheKey: StorageKeys.forumListCache,
    viewerId,
  })

  // 宿舍矛盾是匿名模块：没有「我的」概念，也不用缓存列表
  const dormHarmonyRepository: DormHarmonyRepository = env.useMock
    ? createMockDormHarmonyRepository({ cache, latencyMs: env.mockLatencyMs, now: clock.now })
    : createHttpDormHarmonyRepository(apiClient)
  const dormHarmony = createDormHarmonyUseCases({
    repository: dormHarmonyRepository,
    cache,
    clock,
  })
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
    wechatCode,
    avatarPicker,
    groupBuyRepository,
    authRepository,
    fleaMarketRepository,
    errandRepository,
    buddyRepository,
    lostFoundRepository,
    forumRepository,
    dormHarmonyRepository,
    mockControls: mockRepository,
    useCases: {
      session,
      auth,
      listGroupBuys,
      groupBuyDetail,
      joinGroupBuy,
      fleaMarket,
      errand,
      buddy,
      lostFound,
      forum,
      dormHarmony,
    },
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
