/**
 * 页面路由表 —— 纯常量，不依赖 Taro（便于在测试/非 UI 场景引用）。
 *
 * 路径规则：Taro 的页面路径 = `sourceRoot` 之后的相对路径（不含扩展名）。
 * 由于契约 §7 冻结了六边形目录，页面真实位于 `src/presentation/pages/**`，
 * 因此路径统一以 `presentation/` 开头。
 */

export const PAGE_PATHS = {
  home: '/presentation/pages/home/index',
  discover: '/presentation/pages/discover/index',
  messages: '/presentation/pages/messages/index',
  profile: '/presentation/pages/profile/index',
  // 拼单
  groupBuyList: '/presentation/pages/groupbuy/list/index',
  groupBuyCreate: '/presentation/pages/groupbuy/create/index',
  groupBuyDetail: '/presentation/pages/groupbuy/detail/index',
  forumList: '/presentation/pages/forum/list/index',
  forumDetail: '/presentation/pages/forum/detail/index',
  forumCreate: '/presentation/pages/forum/create/index',
  forumReport: '/presentation/pages/forum/report/index',
  faq: '/presentation/pages/faq/index/index',
  faqTickets: '/presentation/pages/faq/tickets/index',
  wildlifeMap: '/presentation/pages/wildlife/map/index',
  wildlifeReport: '/presentation/pages/wildlife/report/index',
  wildlifeTracks: '/presentation/pages/wildlife/tracks/index',
  buddyList: '/presentation/pages/buddy/list/index',
  buddyDetail: '/presentation/pages/buddy/detail/index',
  buddyCreate: '/presentation/pages/buddy/create/index',
  buddyProfile: '/presentation/pages/buddy/profile/index',
  buddyRecommendations: '/presentation/pages/buddy/recommendations/index',
  /* ---------------- TechPie 整合 / 校园能力（Phase 0） ---------------- */
  techpieLinks: '/presentation/pages/techpie/links/index',
  techpieCapabilities: '/presentation/pages/techpie/capabilities/index',
  techpieWebview: '/presentation/pages/techpie/webview/index',
  campusCard: '/presentation/pages/campus-card/index/index',
} as const

export type PagePath = (typeof PAGE_PATHS)[keyof typeof PAGE_PATHS]

/**
 * 模块 id（契约 §4）→ 已实现页面的映射。
 *
 * 首页宫格完全由 `@kedaya/contracts` 的 `MODULES` 驱动，**不允许**硬编码模块清单；
 * 这里只声明「哪些模块在端上已经有真实页面」，其余模块点击后如实提示「未实现」。
 * 新增垂直切片时只改这一张表，首页不用动。
 */
export const MODULE_ENTRY_PATHS: Readonly<Record<string, string>> = {
  groupbuy: PAGE_PATHS.groupBuyList,
  forum: PAGE_PATHS.forumList,
  faq: PAGE_PATHS.faq,
  // `wildlife` 的入口是**地图页**（模块主界面），上报与轨迹从地图页进入
  wildlife: PAGE_PATHS.wildlifeMap,
  // `buddy` 的入口是**三板块列表**（模块主界面），发布 / 资料 / 推荐从列表页进入
  buddy: PAGE_PATHS.buddyList,
  // `techpie` 的入口是**绑定管理页**（用户来这里的第一个问题是"我绑了什么"），
  // 能力清单与 WebView 直连从绑定页进入
  techpie: PAGE_PATHS.techpieLinks,
  // `campus-card` 的入口是**校园卡页**（余额 / 流水 / 付款码），走独立 OPENID 通道
  'campus-card': PAGE_PATHS.campusCard,
}

export function moduleEntryPath(moduleId: string): string | null {
  return MODULE_ENTRY_PATHS[moduleId] ?? null
}

/** tabBar 上的四个主页面（必须与 app.config.ts 的 tabBar.list 完全一致） */
export const TAB_BAR_PATHS: readonly string[] = [
  PAGE_PATHS.home,
  PAGE_PATHS.discover,
  PAGE_PATHS.messages,
  PAGE_PATHS.profile,
]

export function isTabBarPath(path: string): boolean {
  const [base] = path.split('?')
  return base !== undefined && TAB_BAR_PATHS.includes(base)
}

/**
 * tabBar 下标 —— `Taro.setTabBarBadge` 只认数字下标，不认页面路径。
 *
 * 从 `TAB_BAR_PATHS` 推导而不是在平台层写死 `2`：将来调整 tabBar 顺序时，
 * 红点会跟着走，而不是悄悄挂到错误的 tab 上。
 */
export function tabBarIndex(path: string): number {
  const [base] = path.split('?')
  return base === undefined ? -1 : TAB_BAR_PATHS.indexOf(base)
}

/**
 * 已实现垂直切片的模块 → 入口页。
 *
 * 这里只做「契约模块 id → 页面路径」的映射，模块清单本身仍然来自
 * `@kedaya/contracts`（契约 §4 硬规则：禁止各端硬编码模块清单）。
 * 未登记的模块点击后明确提示「开发中」，不假装可用。
 *
 * 放在 `app/routes.ts` 而不是页面里：首页宫格与「发现」页都要用它，
 * 各写一份必然漂移（新增页面时只改了一处，另一处静默点不进去）。
 */
export const MODULE_ENTRY_PATHS: Readonly<Record<string, string>> = {
  groupbuy: PAGE_PATHS.groupBuyList,
  'flea-market': PAGE_PATHS.fleaList,
  errand: PAGE_PATHS.errandList,
  buddy: PAGE_PATHS.buddyList,
  'lost-found': PAGE_PATHS.lostFoundList,
  forum: PAGE_PATHS.forumList,
  wildlife: PAGE_PATHS.wildlifeList,
  canteen: PAGE_PATHS.canteenList,
  faq: PAGE_PATHS.faqList,
  'takeout-guard': PAGE_PATHS.takeoutGuardList,
  techpie: PAGE_PATHS.techpieList,
  wellbeing: PAGE_PATHS.wellbeingList,
  'ai-portrait': PAGE_PATHS.aiPortraitHome,
  'dorm-harmony': PAGE_PATHS.dormHarmonyHome,
  // 站内通知：就是 tabBar 上的「消息」页（用 switchTab 跳，navigateTo 会失败）
  notifications: PAGE_PATHS.messages,
  // 四个核心模块（身份 / 课表 / 校园卡 / 我的）
  auth: PAGE_PATHS.identity,
  schedule: PAGE_PATHS.schedule,
  'campus-card': PAGE_PATHS.campusCard,
  profile: PAGE_PATHS.profile,
}

export function forumDetailPath(id: string): string {
  return `${PAGE_PATHS.forumDetail}?id=${encodeURIComponent(id)}`
}

/** 发帖页；可选带上当前版块，进入后默认选中 */
export function forumCreatePath(boardId?: string | null): string {
  return boardId === undefined || boardId === null || boardId === ''
    ? PAGE_PATHS.forumCreate
    : `${PAGE_PATHS.forumCreate}?boardId=${encodeURIComponent(boardId)}`
}

export interface ForumReportParams {
  targetType: 'POST' | 'REPLY'
  targetId: string
}

export function forumReportPath(params: ForumReportParams): string {
  return `${PAGE_PATHS.forumReport}?targetType=${encodeURIComponent(
    params.targetType,
  )}&targetId=${encodeURIComponent(params.targetId)}`
}

/** 从页面参数里安全取 id（`useRouter().params.id` 可能是 string | undefined） */
export function readIdParam(params: Record<string, string | undefined>): string | null {
  const id = params.id
  return id === undefined || id === '' ? null : id
}

/* ------------------------------------------------------------------ *
 * wildlife（猫 / 鸟 / 黑天鹅）
 * ------------------------------------------------------------------ */

/**
 * 上报页；可选带上物种与区域，进入后默认选中。
 *
 * 注意：**不带坐标参数**。坐标一律由上报页自己采集
 * （定位 = WGS84 / 地图点选 = GCJ-02），并显式声明来源坐标系 ——
 * 通过 URL 传坐标会让「这个点是什么坐标系」变得不可追溯（规格 §3.2 硬要求 5）。
 */
export function wildlifeReportPath(params?: {
  speciesId?: string | null
  zoneId?: string | null
}): string {
  const query: string[] = []
  if (params?.speciesId != null && params.speciesId !== '') {
    query.push(`speciesId=${encodeURIComponent(params.speciesId)}`)
  }
  if (params?.zoneId != null && params.zoneId !== '') {
    query.push(`zoneId=${encodeURIComponent(params.zoneId)}`)
  }
  return query.length === 0
    ? PAGE_PATHS.wildlifeReport
    : `${PAGE_PATHS.wildlifeReport}?${query.join('&')}`
}

export function wildlifeTracksPath(): string {
  return PAGE_PATHS.wildlifeTracks
}

export function wildlifeMapPath(): string {
  return PAGE_PATHS.wildlifeMap
}

/* ------------------------------------------------------------------ *
 * buddy（找搭子）
 * ------------------------------------------------------------------ */

export function buddyDetailPath(id: string): string {
  return `${PAGE_PATHS.buddyDetail}?id=${encodeURIComponent(id)}`
}

/** 发布页；可选带上板块，进入后默认选中该板块的活动类型 */
export function buddyCreatePath(section?: string | null): string {
  return section == null || section === ''
    ? PAGE_PATHS.buddyCreate
    : `${PAGE_PATHS.buddyCreate}?section=${encodeURIComponent(section)}`
}

export function buddyProfilePath(): string {
  return PAGE_PATHS.buddyProfile
}

/** 推荐页；可选带上板块，进入后默认选中 */
export function buddyRecommendationsPath(section?: string | null): string {
  return section == null || section === ''
    ? PAGE_PATHS.buddyRecommendations
    : `${PAGE_PATHS.buddyRecommendations}?section=${encodeURIComponent(section)}`
}

/* ------------------------------------------------------------------ *
 * techpie（TechPie 整合 / 校园能力）
 * ------------------------------------------------------------------ */

/**
 * WebView 直连页 —— 打开**校园系统**页面。
 *
 * ⚠️ 只传 `target`（校园系统的**标识**），**不传 URL**：
 * URL 由 `domain/models/techpie.ts` 的 `CAMPUS_WEBVIEW_TARGETS` 决定。
 * 让 URL 从页面参数进来会打开一个「用户可构造任意地址的 WebView」，
 * 那是一个开放重定向面（契约 §11.18-B 对服务端 `targetUrl` 的要求同理）。
 */
export function techpieWebviewPath(targetId: string): string {
  return `${PAGE_PATHS.techpieWebview}?target=${encodeURIComponent(targetId)}`
}

export function techpieLinksPath(): string {
  return PAGE_PATHS.techpieLinks
}

export function techpieCapabilitiesPath(): string {
  return PAGE_PATHS.techpieCapabilities
}

export function campusCardPath(): string {
  return PAGE_PATHS.campusCard
}
