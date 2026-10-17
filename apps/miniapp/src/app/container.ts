import { createListGroupBuysUseCase } from '../application/groupbuy/listGroupBuys'
import type { ListGroupBuysUseCase } from '../application/groupbuy/listGroupBuys'
import { createGroupBuyDetailUseCase } from '../application/groupbuy/groupBuyDetail'
import type { GroupBuyDetailUseCase } from '../application/groupbuy/groupBuyDetail'
import { createCreateGroupBuyUseCase } from '../application/groupbuy/createGroupBuy'
import type { CreateGroupBuyUseCase } from '../application/groupbuy/createGroupBuy'
import { createMyGroupBuysUseCase } from '../application/groupbuy/myGroupBuys'
import type { MyGroupBuysUseCase } from '../application/groupbuy/myGroupBuys'
import { createJoinGroupBuyUseCase } from '../application/groupbuy/joinGroupBuy'
import type { JoinGroupBuyUseCase } from '../application/groupbuy/joinGroupBuy'
import { createNotificationUseCases } from '../application/notification/notificationUseCases'
import type { NotificationUseCases } from '../application/notification/notificationUseCases'
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
import { createCampusUseCases } from '../application/campus/campusUseCases'
import type { CampusUseCases } from '../application/campus/campusUseCases'
import { createPrivacyUseCase } from '../application/privacy/privacyUseCases'
import type { PrivacyUseCase } from '../application/privacy/privacyUseCases'
import { createAgentUseCase } from '../application/agent/agentUseCases'
import type { AgentUseCase } from '../application/agent/agentUseCases'
import { createMediaUseCases } from '../application/media/mediaUseCases'
import type { MediaUseCases } from '../application/media/mediaUseCases'
import { createApiClient, createAuthRefresher, createTaroHttpPort, createTracePort } from '../data/api'
import type { ApiClient } from '../data/api'
import { createHttpGroupBuyRepository } from '../data/repositories/httpGroupBuyRepository'
import { createMockGroupBuyRepository } from '../data/repositories/mockGroupBuyRepository'
import { createHttpNotificationRepository } from '../data/repositories/httpNotificationRepository'
import { createMockNotificationRepository } from '../data/repositories/mockNotificationRepository'
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
import { createHttpIdentityRepository } from '../data/repositories/httpIdentityRepository'
import { createHttpScheduleRepository } from '../data/repositories/httpScheduleRepository'
import { createHttpCampusCardRepository } from '../data/repositories/httpCampusCardRepository'
import { createHttpPrivacyRepository } from '../data/repositories/httpPrivacyRepository'
import { createHttpAgentRepository } from '../data/repositories/httpAgentRepository'
import { createMockCampusRepositories } from '../data/repositories/mockCampusRepository'
import { createMockPrivacyRepository } from '../data/repositories/mockPrivacyRepository'
import { createMockAgentRepository } from '../data/repositories/mockAgentRepository'
import { createHttpMediaRepository } from '../data/repositories/httpMediaRepository'
import { createMockMediaRepository } from '../data/repositories/mockMediaRepository'
import { mockNow } from '../data/mock/fixtures'
import { createAvatarPickerPort } from '../platform/avatarPicker'
import { createImagePickerPort } from '../platform/imagePicker'
import { createWechatCodePort } from '../platform/wechatLogin'
import { setUnreadBadge } from '../platform/tabBar'
import { PAGE_PATHS } from './routes'
import type { MockGroupBuyRepository } from '../data/repositories/mockGroupBuyRepository'
import { createMemoryStorage } from '../data/storage/memoryStorage'
import { createSessionStore, createTokenStore } from '../data/storage/sessionStore'
import { StorageKeys } from '../data/storage/keys'
import { createTaroStorage } from '../data/storage/taroStorage'
import type { AuthRepository } from '../domain/ports/authRepository'
import type { AvatarPickerPort, ImagePickerPort } from '../domain/ports/mediaPort'
import type { MediaRepository } from '../domain/ports/mediaRepository'
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
import type { NotificationRepository } from '../domain/ports/notificationRepository'
import type { AuthRefresherPort, SessionStorePort, TokenStorePort } from '../domain/ports/sessionPort'
import type { TracePort } from '../domain/ports/tracePort'
import type { IdentityRepository } from '../domain/ports/identityRepository'
import type { ScheduleRepository } from '../domain/ports/scheduleRepository'
import type { CampusCardRepository } from '../domain/ports/campusCardRepository'
import type { PrivacyRepository } from '../domain/ports/privacyRepository'
import type { AgentRepository } from '../domain/ports/agentRepository'

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
  /** 相册选图（平台能力：`chooseMedia` → 逐张压缩后的 data URL） */
  imagePicker: ImagePickerPort
  mediaRepository: MediaRepository
  groupBuyRepository: GroupBuyRepository
  notificationRepository: NotificationRepository
  authRepository: AuthRepository
  fleaMarketRepository: FleaItemRepository
  errandRepository: ErrandTaskRepository
  buddyRepository: BuddyRepository
  lostFoundRepository: LostFoundRepository
  forumRepository: ForumRepository
  dormHarmonyRepository: DormHarmonyRepository
  identityRepository: IdentityRepository
  scheduleRepository: ScheduleRepository
  campusCardRepository: CampusCardRepository
  privacyRepository: PrivacyRepository
  agentRepository: AgentRepository
  /** 仅 mock 模式下非空 —— 页面用它演示「三态」 */
  mockControls: MockGroupBuyRepository | null
  useCases: {
    session: SessionUseCase
    auth: AuthAccountUseCase
    listGroupBuys: ListGroupBuysUseCase
    groupBuyDetail: GroupBuyDetailUseCase
    createGroupBuy: CreateGroupBuyUseCase
    joinGroupBuy: JoinGroupBuyUseCase
    myGroupBuys: MyGroupBuysUseCase
    notifications: NotificationUseCases
    fleaMarket: FleaMarketUseCases
    errand: ErrandUseCases
    buddy: BuddyUseCases
    lostFound: LostFoundUseCases
    forum: ForumUseCases
    dormHarmony: DormHarmonyUseCases
    campus: CampusUseCases
    privacy: PrivacyUseCase
    agent: AgentUseCase
    media: MediaUseCases
  }
}

export interface ContainerOverrides {
  cache?: CachePort
  clock?: ClockPort
  repository?: GroupBuyRepository
  authRepository?: AuthRepository
  wechatCode?: WechatCodePort
  avatarPicker?: AvatarPickerPort
  imagePicker?: ImagePickerPort
  mediaRepository?: MediaRepository
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

  /**
   * 当前登录用户 —— 六个业务模块都需要它来判定「这是我发布的 / 我能否操作」。
   *
   * 做成**函数**而不是快照：用户可能在页面停留期间登录/登出，
   * 函数形式能让 `list.load()` 或详情页刷新时立刻拿到最新的主体，
   * 而不是停留在容器创建那一刻的旧值。
   */
  const viewerId = (): string | null => sessionStore.getSnapshot().profile?.id ?? null

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
    ? createMockGroupBuyRepository({ latencyMs: env.mockLatencyMs, now: clock.now, viewerId })
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
  const imagePicker = overrides.imagePicker ?? createImagePickerPort()

  /**
   * 媒体仓储：mock 模式下也别把「发图」这条链路断掉 —— mock 实现返回的是
   * data URL（可直接渲染），于是离线也能把「选图 → 发布 → 看到图」走完，
   * 而不是画个假占位糊弄过去。
   */
  const mediaRepository: MediaRepository =
    overrides.mediaRepository ??
    (env.useMock
      ? createMockMediaRepository({ latencyMs: env.mockLatencyMs })
      : createHttpMediaRepository(apiClient))

  const media = createMediaUseCases({ repository: mediaRepository, picker: imagePicker })

  const session = createSessionUseCase(sessionStore, { now: clock.now })
  const auth = createAuthAccountUseCase({
    repository: authRepository,
    session: sessionStore,
    wechatCode,
    now: clock.now,
  })

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

  /* ---------------- 校园第二级能力：身份 / 课表 / 校园卡 ---------------- */

  /**
   * 三个模块共用一个"校园上游"。mock 模式下由**本地模拟上游**同时扮演
   * 身份系统、教务系统与校园卡系统（三者状态互相咬合：先绑定才有数据），
   * 这样 UI 的空态 → 绑定 → 有数据这条链路在离线时也能被真正验证。
   */
  const mockCampus = env.useMock
    ? createMockCampusRepositories({ cache, viewerId, latencyMs: env.mockLatencyMs, now: clock.now })
    : null

  const identityRepository: IdentityRepository = mockCampus?.identity ?? createHttpIdentityRepository(apiClient)
  const scheduleRepository: ScheduleRepository = mockCampus?.schedule ?? createHttpScheduleRepository(apiClient)
  const campusCardRepository: CampusCardRepository = mockCampus?.campusCard ?? createHttpCampusCardRepository(apiClient)

  const campus = createCampusUseCases({
    identityRepository,
    scheduleRepository,
    campusCardRepository,
    cache,
    clock,
    viewerId,
    cacheKeys: {
      identity: (owner) => `${StorageKeys.campusBindings}:${owner}`,
      scheduleToday: StorageKeys.scheduleTodayCache,
      scheduleWeek: StorageKeys.scheduleWeekCache,
      campusCard: StorageKeys.campusCardCache,
    },
  })

  const privacyRepository: PrivacyRepository = env.useMock
    ? createMockPrivacyRepository({ cache, viewerId, latencyMs: env.mockLatencyMs, now: clock.now })
    : createHttpPrivacyRepository(apiClient)

  const privacy = createPrivacyUseCase({
    repository: privacyRepository,
    cache,
    clock,
    viewerId,
    cacheKeys: { settings: (owner) => `${StorageKeys.privacySettingsCache}:${owner}` },
  })

  /**
   * 可达鸭 agent：mock 模式下是一个本地规则实现（复用上面的 mock 校园仓储），
   * 因此"离线也能问课表和余额"这条**演示路径**成立。
   * 接真后端时只是换掉仓储 —— 页面与用例完全不变。
   */
  const agentRepository: AgentRepository = env.useMock
    ? createMockAgentRepository({
        schedule: scheduleRepository,
        campusCard: campusCardRepository,
        identity: identityRepository,
        privacy: privacyRepository,
        viewerId,
        latencyMs: env.mockLatencyMs,
        now: clock.now,
      })
    : createHttpAgentRepository(apiClient)

  const agent = createAgentUseCase({ repository: agentRepository, clock })
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
  const createGroupBuy = createCreateGroupBuyUseCase({
    repository: groupBuyRepository,
    session: sessionStore,
    clock,
    // 新建的拼单必须能立刻出现在列表里：列表用例清掉状态后由页面重新 load
    onCreated: () => listGroupBuys.reset(),
  })
  const joinGroupBuy = createJoinGroupBuyUseCase({
    repository: groupBuyRepository,
    session: sessionStore,
    clock,
  })
  /** 「我的资产」页专用：独立 state + 独立缓存 key，避免与拼单广场互相污染 */
  const myGroupBuys = createMyGroupBuysUseCase({
    repository: groupBuyRepository,
    cache,
    clock,
    cacheKey: `${StorageKeys.groupBuyListCache}:mine`,
  })

  /**
   * 站内信：未读数变化时同步 tabBar 红点。
   *
   * `setUnreadBadge` 是唯一调用 tabBar 角标 API 的地方（`platform/tabBar.ts`），
   * 且它内部吞掉了 H5 / 旧基础库的报错 —— 红点失败不能影响页面。
   */
  const notificationRepository: NotificationRepository = env.useMock
    ? createMockNotificationRepository({ latencyMs: env.mockLatencyMs, now: clock.now })
    : createHttpNotificationRepository(apiClient)

  const notifications = createNotificationUseCases({
    repository: notificationRepository,
    cache,
    clock,
    cacheKey: StorageKeys.notificationListCache,
    knownPaths: Object.values(PAGE_PATHS),
    onUnreadChange: setUnreadBadge,
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
    imagePicker,
    mediaRepository,
    groupBuyRepository,
    notificationRepository,
    authRepository,
    fleaMarketRepository,
    errandRepository,
    buddyRepository,
    lostFoundRepository,
    forumRepository,
    dormHarmonyRepository,
    identityRepository,
    scheduleRepository,
    campusCardRepository,
    privacyRepository,
    agentRepository,
    mockControls: mockRepository,
    useCases: {
      session,
      auth,
      listGroupBuys,
      groupBuyDetail,
      createGroupBuy,
      joinGroupBuy,
      myGroupBuys,
      notifications,
      fleaMarket,
      errand,
      buddy,
      lostFound,
      forum,
      dormHarmony,
      campus,
      privacy,
      agent,
      media,
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
