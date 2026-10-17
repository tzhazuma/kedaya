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
import { createJoinGroupBuyUseCase } from '../application/groupbuy/joinGroupBuy'
import type { JoinGroupBuyUseCase } from '../application/groupbuy/joinGroupBuy'
import { createSessionUseCase } from '../application/auth/session'
import type { SessionUseCase } from '../application/auth/session'
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
import { createMemoryStorage } from '../data/storage/memoryStorage'
import { createSessionStore, createTokenStore } from '../data/storage/sessionStore'
import { StorageKeys } from '../data/storage/keys'
import { createTaroStorage } from '../data/storage/taroStorage'
import { CAMPUS_CARD_PAYMENT_CODE_REGISTERED } from '../domain/models/campusCard'
import { createLogPort } from '../platform/log'
import type { CachePort } from '../domain/ports/cachePort'
import type { ClockPort } from '../domain/ports/clockPort'
import type { BuddyRepository } from '../domain/ports/buddyRepository'
import type { FaqRepository } from '../domain/ports/faqRepository'
import type { ForumRepository } from '../domain/ports/forumRepository'
import type { GroupBuyRepository } from '../domain/ports/groupbuyRepository'
import type { LogPort } from '../domain/ports/logPort'
import type { AuthRefresherPort, SessionStorePort, TokenStorePort } from '../domain/ports/sessionPort'
import type { TechpieRepository } from '../domain/ports/techpieRepository'
import type { TracePort } from '../domain/ports/tracePort'
import type { WildlifeRepository } from '../domain/ports/wildlifeRepository'

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
  groupBuyRepository: GroupBuyRepository
  forumRepository: ForumRepository
  faqRepository: FaqRepository
  wildlifeRepository: WildlifeRepository
  buddyRepository: BuddyRepository
  techpieRepository: TechpieRepository
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
    listGroupBuys: ListGroupBuysUseCase
    groupBuyDetail: GroupBuyDetailUseCase
    joinGroupBuy: JoinGroupBuyUseCase
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
  const clock = overrides.clock ?? systemClock()
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
  const mockForumRepository = env.useMock
    ? createMockForumRepository({ latencyMs: env.mockLatencyMs })
    : null
  const mockFaqRepository = env.useMock
    ? createMockFaqRepository({ latencyMs: env.mockLatencyMs })
    : null
  const mockWildlifeRepository = env.useMock
    ? createMockWildlifeRepository({ latencyMs: env.mockLatencyMs })
    : null
  /**
   * 找搭子仓储。
   *
   * ⚠️ `currentUser` 由**会话**注入，而不是作为端口参数到处传：
   * 真后端模式下身份来自 `Authorization: Bearer`，端口签名里没有 userId
   * （与 `groupbuy` 不同 —— 那个模块的 `join` body 本身就要带 displayName）。
   * 身份是环境属性，不是参数。
   */
  const mockTechpieRepository = env.useMock
    ? createMockTechpieRepository({ latencyMs: env.mockLatencyMs, log })
    : null
  const mockBuddyRepository = env.useMock
    ? createMockBuddyRepository({
        latencyMs: env.mockLatencyMs,
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
   * TechPie / 校园能力仓储。
   *
   * ⚠️ 本端**没有** webview-session 的实现（契约 §11.10-F：小程序 `web-view`
   * 无法注入 cookie，I3 在本端没有出口）。校园系统走 W4 —— 用户自己登录。
   */
  const techpieRepository: TechpieRepository =
    overrides.techpieRepository ?? mockTechpieRepository ?? createHttpTechpieRepository(apiClient, { log })

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
    groupBuyRepository,
    forumRepository,
    faqRepository,
    wildlifeRepository,
    buddyRepository,
    techpieRepository,
    mockControls: mockRepository,
    mockForumControls: mockForumRepository,
    mockFaqControls: mockFaqRepository,
    mockWildlifeControls: mockWildlifeRepository,
    mockBuddyControls: mockBuddyRepository,
    mockTechpieControls: mockTechpieRepository,
    useCases: {
      session,
      listGroupBuys,
      groupBuyDetail,
      joinGroupBuy,
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
