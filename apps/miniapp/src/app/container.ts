import { createBuddyPostDetailUseCase } from '../application/buddy/buddyPostDetail'
import type { BuddyPostDetailUseCase } from '../application/buddy/buddyPostDetail'
import { createBuddyProfileUseCase } from '../application/buddy/buddyProfile'
import type { BuddyProfileUseCase } from '../application/buddy/buddyProfile'
import { createBuddyRecommendationsUseCase } from '../application/buddy/buddyRecommendations'
import type { BuddyRecommendationUseCase } from '../application/buddy/buddyRecommendations'
import { createCreateBuddyPostUseCase } from '../application/buddy/createBuddyPost'
import type { CreateBuddyPostUseCase } from '../application/buddy/createBuddyPost'
import { createListBuddyPostsUseCase } from '../application/buddy/listBuddyPosts'
import type { ListBuddyPostsUseCase } from '../application/buddy/listBuddyPosts'
import { createBrowseFaqUseCase } from '../application/faq/browseFaq'
import type { BrowseFaqUseCase } from '../application/faq/browseFaq'
import { createMyTicketsUseCase } from '../application/faq/myTickets'
import type { MyTicketsUseCase } from '../application/faq/myTickets'
import { createCreateForumPostUseCase } from '../application/forum/createForumPost'
import type { CreateForumPostUseCase } from '../application/forum/createForumPost'
import { createForumPostDetailUseCase } from '../application/forum/forumPostDetail'
import type { ForumPostDetailUseCase } from '../application/forum/forumPostDetail'
import { createListForumBoardsUseCase } from '../application/forum/listForumBoards'
import type { ListForumBoardsUseCase } from '../application/forum/listForumBoards'
import { createListForumPostsUseCase } from '../application/forum/listForumPosts'
import type { ListForumPostsUseCase } from '../application/forum/listForumPosts'
import { createReplyToPostUseCase } from '../application/forum/replyToPost'
import type { ReplyToPostUseCase } from '../application/forum/replyToPost'
import { createReportForumContentUseCase } from '../application/forum/reportForumContent'
import type { ReportForumContentUseCase } from '../application/forum/reportForumContent'
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
import { createBindCampusUseCase } from '../application/techpie/bindCampus'
import type { BindCampusUseCase } from '../application/techpie/bindCampus'
import { createCampusCardUseCase } from '../application/techpie/campusCard'
import type { CampusCardUseCase } from '../application/techpie/campusCard'
import { createCapabilitiesUseCase } from '../application/techpie/capabilities'
import type { CapabilitiesUseCase } from '../application/techpie/capabilities'
import { createListBindingsUseCase } from '../application/techpie/listBindings'
import type { ListBindingsUseCase } from '../application/techpie/listBindings'
import { createReportSightingUseCase } from '../application/wildlife/reportSighting'
import type { ReportSightingUseCase } from '../application/wildlife/reportSighting'
import { createWildlifeTracksUseCase } from '../application/wildlife/tracks'
import type { WildlifeTracksUseCase } from '../application/wildlife/tracks'
import { createWildlifeMapUseCase } from '../application/wildlife/wildlifeMap'
import type { WildlifeMapUseCase } from '../application/wildlife/wildlifeMap'
import { createFleaMarketUseCases } from '../application/fleaMarket/fleaMarketUseCases'
import type { FleaMarketUseCases } from '../application/fleaMarket/fleaMarketUseCases'
import { createErrandUseCases } from '../application/errand/errandUseCases'
import type { ErrandUseCases } from '../application/errand/errandUseCases'
import { createLostFoundUseCases } from '../application/lostFound/lostFoundUseCases'
import type { LostFoundUseCases } from '../application/lostFound/lostFoundUseCases'
import { createCanteenUseCases } from '../application/canteen/canteenUseCases'
import type { CanteenUseCases } from '../application/canteen/canteenUseCases'
import { createTakeoutGuardUseCases } from '../application/takeoutGuard/takeoutGuardUseCases'
import type { TakeoutGuardUseCases } from '../application/takeoutGuard/takeoutGuardUseCases'
import { createWellbeingUseCases } from '../application/wellbeing/wellbeingUseCases'
import type { WellbeingUseCases } from '../application/wellbeing/wellbeingUseCases'
import { createAiPortraitUseCases } from '../application/aiPortrait/aiPortraitUseCases'
import type { AiPortraitUseCases } from '../application/aiPortrait/aiPortraitUseCases'
import { createDormHarmonyUseCases } from '../application/dormHarmony/dormHarmonyUseCases'
import type { DormHarmonyUseCases } from '../application/dormHarmony/dormHarmonyUseCases'
import { createCampusUseCases } from '../application/campus/campusUseCases'
import type { CampusUseCases } from '../application/campus/campusUseCases'
import { createPrivacyUseCase } from '../application/privacy/privacyUseCases'
import type { PrivacyUseCase } from '../application/privacy/privacyUseCases'
import { createHomeLayoutUseCase } from '../application/homeLayout/homeLayoutUseCases'
import type { HomeLayoutUseCase } from '../application/homeLayout/homeLayoutUseCases'
import { createAgentUseCase } from '../application/agent/agentUseCases'
import type { AgentUseCase } from '../application/agent/agentUseCases'
import { createMediaUseCases } from '../application/media/mediaUseCases'
import type { MediaUseCases } from '../application/media/mediaUseCases'
import { createReportUseCases } from '../application/report/reportUseCases'
import type { ReportUseCases } from '../application/report/reportUseCases'
import { createApiClient, createAuthRefresher, createTaroHttpPort, createTracePort } from '../data/api'
import type { ApiClient } from '../data/api'
import { createTaroMediaUploader } from '../data/api/mediaUpload'
import { createHttpBuddyRepository } from '../data/repositories/httpBuddyRepository'
import { createHttpFaqRepository } from '../data/repositories/httpFaqRepository'
import { createHttpForumRepository } from '../data/repositories/httpForumRepository'
import { createHttpGroupBuyRepository } from '../data/repositories/httpGroupBuyRepository'
import { createHttpTechpieRepository } from '../data/repositories/httpTechpieRepository'
import { createHttpWildlifeRepository } from '../data/repositories/httpWildlifeRepository'
import { createMockBuddyRepository } from '../data/repositories/mockBuddyRepository'
import type { MockBuddyRepository } from '../data/repositories/mockBuddyRepository'
import { createMockFaqRepository } from '../data/repositories/mockFaqRepository'
import type { MockFaqRepository } from '../data/repositories/mockFaqRepository'
import { createMockForumRepository } from '../data/repositories/mockForumRepository'
import type { MockForumRepository } from '../data/repositories/mockForumRepository'
import { createMockGroupBuyRepository } from '../data/repositories/mockGroupBuyRepository'
import type { MockGroupBuyRepository } from '../data/repositories/mockGroupBuyRepository'
import { createMockTechpieRepository } from '../data/repositories/mockTechpieRepository'
import type { MockTechpieRepository } from '../data/repositories/mockTechpieRepository'
import { createMockWildlifeRepository } from '../data/repositories/mockWildlifeRepository'
import type { MockWildlifeRepository } from '../data/repositories/mockWildlifeRepository'
import { createHttpNotificationRepository } from '../data/repositories/httpNotificationRepository'
import { createMockNotificationRepository } from '../data/repositories/mockNotificationRepository'
import { createHttpAuthRepository } from '../data/repositories/httpAuthRepository'
import { createMockAuthRepository } from '../data/repositories/mockAuthRepository'
import { createHttpFleaMarketRepository } from '../data/repositories/httpFleaMarketRepository'
import { createMockFleaMarketRepository } from '../data/repositories/mockFleaMarketRepository'
import { createHttpErrandRepository } from '../data/repositories/httpErrandRepository'
import { createMockErrandRepository } from '../data/repositories/mockErrandRepository'
import { createHttpLostFoundRepository } from '../data/repositories/httpLostFoundRepository'
import { createMockLostFoundRepository } from '../data/repositories/mockLostFoundRepository'
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
import { createHttpReportRepository } from '../data/repositories/httpReportRepository'
import { createMockMediaRepository } from '../data/repositories/mockMediaRepository'
import { createMockReportRepository } from '../data/repositories/mockReportRepository'
import { createHttpCanteenRepository } from '../data/repositories/httpCanteenRepository'
import { createMockCanteenRepository } from '../data/repositories/mockCanteenRepository'
import { createHttpTakeoutGuardRepository } from '../data/repositories/httpTakeoutGuardRepository'
import { createMockTakeoutGuardRepository } from '../data/repositories/mockTakeoutGuardRepository'
import { createHttpWellbeingRepository } from '../data/repositories/httpWellbeingRepository'
import { createMockWellbeingRepository } from '../data/repositories/mockWellbeingRepository'
import { createHttpAiPortraitRepository } from '../data/repositories/httpAiPortraitRepository'
import { createMockAiPortraitRepository } from '../data/repositories/mockAiPortraitRepository'
import { createHttpTelemetryRepository } from '../data/repositories/httpTelemetryRepository'
import { createConsoleTelemetryRepository } from '../data/repositories/consoleTelemetryRepository'
import { mockNow } from '../data/mock/fixtures'
import { createAvatarPickerPort } from '../platform/avatarPicker'
import { createImagePickerPort } from '../platform/imagePicker'
import { createTelemetryReporter } from '../platform/telemetry'
import { createWechatCodePort } from '../platform/wechatLogin'
import { setUnreadBadge } from '../platform/tabBar'
import { createLogPort } from '../platform/log'
import { PAGE_PATHS } from './routes'
import { createMemoryStorage } from '../data/storage/memoryStorage'
import { createSessionStore, createTokenStore } from '../data/storage/sessionStore'
import { StorageKeys } from '../data/storage/keys'
import { createTaroStorage } from '../data/storage/taroStorage'
import { CAMPUS_CARD_PAYMENT_CODE_REGISTERED } from '../domain/models/campusCard'
import type { CachePort } from '../domain/ports/cachePort'
import type { ClockPort } from '../domain/ports/clockPort'
import type { LogPort } from '../domain/ports/logPort'
import type { AgentRepository } from '../domain/ports/agentRepository'
import type { AiPortraitRepository } from '../domain/ports/aiPortraitRepository'
import type { AuthRepository } from '../domain/ports/authRepository'
import type { AvatarPickerPort, ImagePickerPort } from '../domain/ports/mediaPort'
import type { BuddyRepository } from '../domain/ports/buddyRepository'
import type { CampusCardRepository } from '../domain/ports/campusCardRepository'
import type { CanteenRepository } from '../domain/ports/canteenRepository'
import type { DormHarmonyRepository } from '../domain/ports/dormHarmonyRepository'
import type { ErrandTaskRepository } from '../domain/ports/errandRepository'
import type { FaqRepository } from '../domain/ports/faqRepository'
import type { FleaItemRepository } from '../domain/ports/fleaMarketRepository'
import type { ForumRepository } from '../domain/ports/forumRepository'
import type { GroupBuyRepository } from '../domain/ports/groupbuyRepository'
import type { IdentityRepository } from '../domain/ports/identityRepository'
import type { LostFoundRepository } from '../domain/ports/lostFoundRepository'
import type { MediaRepository } from '../domain/ports/mediaRepository'
import type { NotificationRepository } from '../domain/ports/notificationRepository'
import type { PrivacyRepository } from '../domain/ports/privacyRepository'
import type { ReportRepository } from '../domain/ports/reportRepository'
import type { ScheduleRepository } from '../domain/ports/scheduleRepository'
import type { AuthRefresherPort, SessionStorePort, TokenStorePort } from '../domain/ports/sessionPort'
import type { TakeoutGuardRepository } from '../domain/ports/takeoutGuardRepository'
import type { TechpieRepository } from '../domain/ports/techpieRepository'
import type { TelemetryRepository } from '../domain/ports/telemetryRepository'
import type { WechatCodePort } from '../domain/ports/wechatPort'
import type { WellbeingRepository } from '../domain/ports/wellbeingRepository'
import type { WildlifeRepository } from '../domain/ports/wildlifeRepository'
import type { TelemetryReporter } from '../platform/telemetry'
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
  /** 日志端口（规格 §10.3：白名单外剔除 + 凭证清洗，凭证绝不到达 sink） */
  log: LogPort
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
  reportRepository: ReportRepository
  telemetryRepository: TelemetryRepository
  /** 客户端遥测上报器（错误边界 / 全局错误钩子 / 服务端故障都走它） */
  telemetry: TelemetryReporter
  groupBuyRepository: GroupBuyRepository
  notificationRepository: NotificationRepository
  authRepository: AuthRepository
  fleaMarketRepository: FleaItemRepository
  errandRepository: ErrandTaskRepository
  buddyRepository: BuddyRepository
  lostFoundRepository: LostFoundRepository
  forumRepository: ForumRepository
  canteenRepository: CanteenRepository
  faqRepository: FaqRepository
  wildlifeRepository: WildlifeRepository
  takeoutGuardRepository: TakeoutGuardRepository
  techpieRepository: TechpieRepository
  wellbeingRepository: WellbeingRepository
  aiPortraitRepository: AiPortraitRepository
  dormHarmonyRepository: DormHarmonyRepository
  identityRepository: IdentityRepository
  scheduleRepository: ScheduleRepository
  campusCardRepository: CampusCardRepository
  privacyRepository: PrivacyRepository
  agentRepository: AgentRepository
  /** 仅 mock 模式下非空 —— 页面用它演示「三态」 */
  mockControls: MockGroupBuyRepository | null
  /** 论坛的 mock 演示控制面（仅 mock 模式下非空） */
  mockForumControls: MockForumRepository | null
  /** FAQ 的 mock 演示控制面（仅 mock 模式下非空） */
  mockFaqControls: MockFaqRepository | null
  /** 野生动物的 mock 演示控制面（仅 mock 模式下非空） */
  mockWildlifeControls: MockWildlifeRepository | null
  /** 找搭子的 mock 演示控制面（仅 mock 模式下非空） */
  mockBuddyControls: MockBuddyRepository | null
  /** TechPie / 校园能力的 mock 演示控制面（仅 mock 模式下非空） */
  mockTechpieControls: MockTechpieRepository | null
  useCases: {
    session: SessionUseCase
    auth: AuthAccountUseCase
    // 拼单
    listGroupBuys: ListGroupBuysUseCase
    groupBuyDetail: GroupBuyDetailUseCase
    createGroupBuy: CreateGroupBuyUseCase
    joinGroupBuy: JoinGroupBuyUseCase
    myGroupBuys: MyGroupBuysUseCase
    // 站内通知
    notifications: NotificationUseCases
    // 六个业务模块（跳蚤 / 跑腿 / 找搭子 / 失物招领 / 论坛 / 拼单已在上面）
    fleaMarket: FleaMarketUseCases
    errand: ErrandUseCases
    lostFound: LostFoundUseCases
    // 共建型模块（食堂 / FAQ / 动物观察点 / 偷外卖）
    canteen: CanteenUseCases
    takeoutGuard: TakeoutGuardUseCases
    // 论坛 / 找搭子 / FAQ / 动物观测 / TechPie 用的是细粒度用例（见下）
    listForumBoards: ListForumBoardsUseCase
    listForumPosts: ListForumPostsUseCase
    forumPostDetail: ForumPostDetailUseCase
    createForumPost: CreateForumPostUseCase
    replyToPost: ReplyToPostUseCase
    reportForumContent: ReportForumContentUseCase
    browseFaq: BrowseFaqUseCase
    myTickets: MyTicketsUseCase
    wildlifeMap: WildlifeMapUseCase
    wildlifeTracks: WildlifeTracksUseCase
    reportSighting: ReportSightingUseCase
    listBuddyPosts: ListBuddyPostsUseCase
    buddyPostDetail: BuddyPostDetailUseCase
    createBuddyPost: CreateBuddyPostUseCase
    buddyProfile: BuddyProfileUseCase
    buddyRecommendations: BuddyRecommendationUseCase
    listBindings: ListBindingsUseCase
    capabilities: CapabilitiesUseCase
    bindCampus: BindCampusUseCase
    campusCard: CampusCardUseCase
    // 敏感 / 高敏模块
    wellbeing: WellbeingUseCases
    aiPortrait: AiPortraitUseCases
    dormHarmony: DormHarmonyUseCases
    // 四个核心模块 + 全局助手
    campus: CampusUseCases
    privacy: PrivacyUseCase
    /** 首页展示哪些入口（本机偏好，按登录用户分片） */
    homeLayout: HomeLayoutUseCase
    agent: AgentUseCase
    media: MediaUseCases
    report: ReportUseCases
  }
}

export interface ContainerOverrides {
  cache?: CachePort
  clock?: ClockPort
  repository?: GroupBuyRepository
  forumRepository?: ForumRepository
  faqRepository?: FaqRepository
  wildlifeRepository?: WildlifeRepository
  buddyRepository?: BuddyRepository
  techpieRepository?: TechpieRepository
  authRepository?: AuthRepository
  mediaRepository?: MediaRepository
  reportRepository?: ReportRepository
  telemetryRepository?: TelemetryRepository
  telemetry?: TelemetryReporter
  wechatCode?: WechatCodePort
  avatarPicker?: AvatarPickerPort
  imagePicker?: ImagePickerPort
  log?: LogPort
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
  /**
   * 日志端口（规格 §10.3）。
   *
   * ⚠️ 它是**白名单制**的：未登记的事件整条丢弃，未登记的字段整条剔除，
   * 字符串值再走一遍内联凭证清洗。因此「把 credential 传进日志」这件事
   * 在结构上不可能生效 —— 见 `platform/log.ts`。
   */
  const log = overrides.log ?? createLogPort()

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

  /**
   * 遥测与 apiClient 互相依赖（遥测仓储要发请求；apiClient 要在服务端 5xx 时回调遥测），
   * 用一层**延迟委托**打破构造环 —— 比"先塞一个空实现、建好后再替换"更难写错
   * （后者容易在替换之前就真的发出去，静默丢日志）。
   */
  let telemetrySink: TelemetryRepository | null = null
  const telemetryRepository: TelemetryRepository = {
    send: (payload) =>
      telemetrySink === null
        ? Promise.resolve({
            ok: true as const,
            value: { accepted: false },
          })
        : telemetrySink.send(payload),
  }

  const telemetry = overrides.telemetry ?? createTelemetryReporter({ repository: telemetryRepository })

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
    onServerError: (info) => {
      telemetry.report({
        kind: 'api-failure',
        message: `${info.method} ${info.path} → HTTP ${info.status}（${info.code}）：${info.message}`,
        traceId: info.traceId,
        context: { status: info.status, code: info.code, method: info.method, path: info.path },
      })
    },
  })

  telemetrySink =
    overrides.telemetryRepository ??
    (env.useMock ? createConsoleTelemetryRepository() : createHttpTelemetryRepository(apiClient))

  const mockRepository = env.useMock
    ? createMockGroupBuyRepository({ latencyMs: env.mockLatencyMs, now: clock.now, viewerId })
    : null
  const mockForumRepository = env.useMock
    ? createMockForumRepository({ latencyMs: env.mockLatencyMs, now: clock.now })
    : null
  const mockFaqRepository = env.useMock
    ? createMockFaqRepository({ latencyMs: env.mockLatencyMs, now: clock.now })
    : null
  const mockWildlifeRepository = env.useMock
    ? createMockWildlifeRepository({ latencyMs: env.mockLatencyMs, now: clock.now })
    : null
  /**
   * TechPie / 校园能力的 mock 演示控制面。
   *
   * ⚠️ `log` 从第一天就注入：绑定动作是**日志脱敏的第一现场**
   * （白名单外的字段整条剔除），离线演示也必须跑在同一条链路上。
   */
  const mockTechpieRepository = env.useMock
    ? createMockTechpieRepository({ latencyMs: env.mockLatencyMs, now: clock.now, log })
    : null
  /**
   * 找搭子仓储。
   *
   * ⚠️ `currentUser` 由**会话**注入，而不是作为端口参数到处传：
   * 真后端模式下身份来自 `Authorization: Bearer`，端口签名里没有 userId
   * （与 `groupbuy` 不同 —— 那个模块的 `join` body 本身就要带 displayName）。
   * 身份是环境属性，不是参数。
   */
  const mockBuddyRepository = env.useMock
    ? createMockBuddyRepository({
        latencyMs: env.mockLatencyMs,
        now: clock.now,
        currentUser: () => {
          const profile = sessionStore.getSnapshot().profile
          return profile === null ? null : { id: profile.id, nickname: profile.nickname }
        },
      })
    : null

  const groupBuyRepository: GroupBuyRepository =
    overrides.repository ?? mockRepository ?? createHttpGroupBuyRepository(apiClient)
  const forumRepository: ForumRepository =
    overrides.forumRepository ?? mockForumRepository ?? createHttpForumRepository(apiClient)
  const faqRepository: FaqRepository =
    overrides.faqRepository ?? mockFaqRepository ?? createHttpFaqRepository(apiClient)
  /**
   * 野生动物仓储。
   *
   * ⚠️ 真后端模式下，照片上传走**独立的 multipart 端口**
   * （`ApiClient` 只发 JSON，`wx.request` 不支持传文件）。
   * 见 `data/api/mediaUpload.ts`。
   */
  const wildlifeUploader = createTaroMediaUploader({
    baseUrl: env.apiBaseUrl,
    tokens: tokenStore,
    trace,
    timeoutMs: env.requestTimeoutMs * 2,
  })
  const wildlifeRepository: WildlifeRepository =
    overrides.wildlifeRepository ??
    mockWildlifeRepository ??
    createHttpWildlifeRepository(apiClient, wildlifeUploader)

  const buddyRepository: BuddyRepository =
    overrides.buddyRepository ?? mockBuddyRepository ?? createHttpBuddyRepository(apiClient)

  /**
   * TechPie / 校园能力仓储（含校园卡）。
   *
   * ⚠️ 本端**没有** webview-session 的实现（契约 §11.10-F：小程序 `web-view`
   * 无法注入 cookie，I3 在本端没有出口）。校园系统走 W4 —— 用户自己登录。
   */
  const techpieRepository: TechpieRepository =
    overrides.techpieRepository ?? mockTechpieRepository ?? createHttpTechpieRepository(apiClient, { log })

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

  /**
   * 举报仓储：mock 模式同样**真的能用**（内存里去重 + 阈值升级），
   * 这样演示时能把「举报 → 已举报 → 已加急」整条走完，
   * 而不是上线才发现举报入口点了没反应。
   */
  const reportRepository: ReportRepository =
    overrides.reportRepository ??
    (env.useMock ? createMockReportRepository() : createHttpReportRepository(apiClient))

  const report = createReportUseCases({ repository: reportRepository })

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

  /**
   * 四个「共建型」模块（食堂菜品 / 常见问题 / 动物观察点 / 偷外卖报备）。
   *
   * 前三个是**匿名共建**（没有归属，因此不需要 viewerId）；
   * 偷外卖是**本人可见**的报备记录，需要 viewerId 来在发请求前挡住注定 401 的动作。
   */
  const canteenRepository: CanteenRepository = env.useMock
    ? createMockCanteenRepository({ cache, latencyMs: env.mockLatencyMs, now: clock.now })
    : createHttpCanteenRepository(apiClient)
  const canteen = createCanteenUseCases({
    repository: canteenRepository,
    cache,
    clock,
    cacheKey: StorageKeys.canteenListCache,
  })

  const takeoutGuardRepository: TakeoutGuardRepository = env.useMock
    ? createMockTakeoutGuardRepository({ viewerId, latencyMs: env.mockLatencyMs, now: clock.now })
    : createHttpTakeoutGuardRepository(apiClient)
  const takeoutGuard = createTakeoutGuardUseCases({
    repository: takeoutGuardRepository,
    cache,
    clock,
    cacheKey: StorageKeys.takeoutGuardListCache,
    viewerId,
  })

  // 心理支持是 **有归属** 的敏感模块：列表只有本人预约，因此和偷外卖一样注入 viewerId，
  // 让用例在发请求之前就能挡住注定 401 的动作。危机出口不需要登录，走单独的 detail 用例。
  const wellbeingRepository: WellbeingRepository = env.useMock
    ? createMockWellbeingRepository({ viewerId, latencyMs: env.mockLatencyMs, now: clock.now })
    : createHttpWellbeingRepository(apiClient)
  const wellbeing = createWellbeingUseCases({
    repository: wellbeingRepository,
    cache,
    clock,
    cacheKey: StorageKeys.wellbeingListCache,
    viewerId,
  })

  // AI 画像是「本人的」，但没有列表/发布：只读 me + 公开来源清单。
  // 只缓存来源清单（非敏感），画像本体不落盘 —— 见 `StorageKeys.aiPortraitSourcesCache` 注释。
  const aiPortraitRepository: AiPortraitRepository = env.useMock
    ? createMockAiPortraitRepository({ viewerId, latencyMs: env.mockLatencyMs, now: clock.now })
    : createHttpAiPortraitRepository(apiClient)
  const aiPortrait = createAiPortraitUseCases({
    repository: aiPortraitRepository,
    cache,
    clock,
    cacheKey: StorageKeys.aiPortraitSourcesCache,
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
   * 首页布局（本机偏好）：key 里拼用户标识，换账号就换一份 ——
   * 同一台手机上换号是真实场景，不能把上一个人的常用服务留给下一个人。
   */
  const homeLayout = createHomeLayoutUseCase({
    cache,
    viewerId,
    cacheKeyFor: (viewer) => `${StorageKeys.homeLayout}:${viewer ?? 'anonymous'}`,
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

  /* ---------------- 论坛 ---------------- */

  const listForumBoards = createListForumBoardsUseCase({
    repository: forumRepository,
    cache,
    clock,
    cacheKey: StorageKeys.forumBoardListCache,
  })
  const listForumPosts = createListForumPostsUseCase({
    repository: forumRepository,
    cache,
    clock,
    cacheKey: StorageKeys.forumPostListCache,
  })
  const forumPostDetail = createForumPostDetailUseCase({
    repository: forumRepository,
    cache,
    clock,
    cacheKeyFor: (id) => `${StorageKeys.forumPostDetailCache}:${id}`,
  })
  const createForumPost = createCreateForumPostUseCase({
    repository: forumRepository,
    session: sessionStore,
    clock,
  })
  const replyToPost = createReplyToPostUseCase({
    repository: forumRepository,
    session: sessionStore,
    clock,
  })
  const reportForumContent = createReportForumContentUseCase({
    repository: forumRepository,
    session: sessionStore,
    clock,
  })

  /* ---------------- 常见问题 ---------------- */

  const browseFaq = createBrowseFaqUseCase({
    repository: faqRepository,
    cache,
    clock,
    cacheKey: StorageKeys.faqArticleListCache,
    votesCacheKey: StorageKeys.faqHelpfulVotes,
    session: sessionStore,
  })
  const myTickets = createMyTicketsUseCase({
    repository: faqRepository,
    cache,
    clock,
    cacheKey: StorageKeys.faqTicketListCache,
    session: sessionStore,
  })

  /* ---------------- 野生动物（档案 / 观察点 / 轨迹 / 上报） ---------------- */

  const wildlifeMap = createWildlifeMapUseCase({
    repository: wildlifeRepository,
    cache,
    clock,
    cacheKey: StorageKeys.wildlifeMapCache,
  })
  const wildlifeTracks = createWildlifeTracksUseCase({
    repository: wildlifeRepository,
    cache,
    clock,
    cacheKey: StorageKeys.wildlifeTracksCache,
  })
  const reportSighting = createReportSightingUseCase({
    repository: wildlifeRepository,
    session: sessionStore,
    cache,
    clock,
    cacheKey: StorageKeys.wildlifeReportCache,
    ethicsCacheKey: StorageKeys.wildlifeEthicsAck,
  })

  /* ---------------- 找搭子（`buddy`） ---------------- */

  const listBuddyPosts = createListBuddyPostsUseCase({
    repository: buddyRepository,
    cache,
    clock,
    // 缓存按板块分片 —— 否则切板块时 hydrate() 会把上一个板块的数据渲染出来
    cacheKeyFor: (section) => `${StorageKeys.buddyListCache}:${section}`,
  })
  const buddyPostDetail = createBuddyPostDetailUseCase({
    repository: buddyRepository,
    cache,
    clock,
    cacheKeyFor: (id) => `${StorageKeys.buddyDetailCache}:${id}`,
    session: sessionStore,
  })
  const createBuddyPost = createCreateBuddyPostUseCase({
    repository: buddyRepository,
    session: sessionStore,
    clock,
  })
  const buddyProfile = createBuddyProfileUseCase({
    repository: buddyRepository,
    cache,
    clock,
    session: sessionStore,
    cacheKey: StorageKeys.buddyProfileCache,
  })
  const buddyRecommendations = createBuddyRecommendationsUseCase({
    repository: buddyRepository,
    cache,
    clock,
    session: sessionStore,
    cacheKeyFor: (section) => `${StorageKeys.buddyRecommendationCache}:${section}`,
    feedbackCacheKey: StorageKeys.buddyFeedback,
  })

  /* ---------------- TechPie 整合 / 校园能力（Phase 0） ---------------- */

  const listBindings = createListBindingsUseCase({
    repository: techpieRepository,
    cache,
    clock,
    cacheKey: StorageKeys.techpieBindingListCache,
    log,
  })
  const capabilities = createCapabilitiesUseCase({
    repository: techpieRepository,
    cache,
    clock,
    cacheKey: StorageKeys.techpieCapabilityCache,
    log,
  })
  const bindCampus = createBindCampusUseCase({
    repository: techpieRepository,
    session: sessionStore,
    clock,
    log,
  })
  const campusCard = createCampusCardUseCase({
    repository: techpieRepository,
    cache,
    clock,
    cacheKey: StorageKeys.campusCardTransactionCache,
    log,
    session: sessionStore,
    // 付款码端点尚未登记进冻结契约 —— 这个布尔值让 UI 能如实告知，而不是让用户猜
    paymentCodeRegistered: CAMPUS_CARD_PAYMENT_CODE_REGISTERED,
  })

  return {
    env,
    trace,
    log,
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
    reportRepository,
    telemetryRepository,
    telemetry,
    groupBuyRepository,
    notificationRepository,
    authRepository,
    fleaMarketRepository,
    errandRepository,
    buddyRepository,
    lostFoundRepository,
    forumRepository,
    canteenRepository,
    faqRepository,
    wildlifeRepository,
    takeoutGuardRepository,
    techpieRepository,
    wellbeingRepository,
    aiPortraitRepository,
    dormHarmonyRepository,
    identityRepository,
    scheduleRepository,
    campusCardRepository,
    privacyRepository,
    agentRepository,
    mockControls: mockRepository,
    mockForumControls: mockForumRepository,
    mockFaqControls: mockFaqRepository,
    mockWildlifeControls: mockWildlifeRepository,
    mockBuddyControls: mockBuddyRepository,
    mockTechpieControls: mockTechpieRepository,
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
      lostFound,
      canteen,
      takeoutGuard,
      listForumBoards,
      listForumPosts,
      forumPostDetail,
      createForumPost,
      replyToPost,
      reportForumContent,
      browseFaq,
      myTickets,
      wildlifeMap,
      wildlifeTracks,
      reportSighting,
      listBuddyPosts,
      buddyPostDetail,
      createBuddyPost,
      buddyProfile,
      buddyRecommendations,
      listBindings,
      capabilities,
      bindCampus,
      campusCard,
      wellbeing,
      aiPortrait,
      dormHarmony,
      campus,
      privacy,
      homeLayout,
      agent,
      media,
      report,
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
