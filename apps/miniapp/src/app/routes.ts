/**
 * 页面路由表 —— 纯常量，不依赖 Taro（便于在测试/非 UI 场景引用）。
 *
 * 路径规则：Taro 的页面路径 = `sourceRoot` 之后的相对路径（不含扩展名）。
 * 由于契约 §7 冻结了六边形目录，页面真实位于 `src/presentation/pages/**`，
 * 因此路径统一以 `presentation/` 开头。
 */

export const PAGE_PATHS = {
  /**
   * 入口页（welcome）—— 应用的**第一屏**（`app.config.ts` 的 `pages[0]`）。
   *
   * 它只回答"这是哪儿、能干什么"，然后给一个「进入主页」；
   * 首页左上角保留「返回入口」，两边可以互跳（不是一个只闪一次的启动图）。
   */
  welcome: '/presentation/pages/welcome/index',
  home: '/presentation/pages/home/index',
  /** 服务大厅：首页「全部服务」格的落地页（分组 + 搜索） */
  homeServices: '/presentation/pages/home/services/index',
  discover: '/presentation/pages/discover/index',
  messages: '/presentation/pages/messages/index',
  profile: '/presentation/pages/profile/index',
  /**
   * 凑凑 —— 产品一级入口，下设「拼单」与「找搭子」。
   *
   * ⚠️ 它不是契约模块（契约里 `groupbuy` / `buddy` 仍是两个独立模块）：
   * 这里只是一个**导航聚合页**，没有自己的 API 与数据。
   */
  cou: '/presentation/pages/cou/index',
  // 拼单
  groupBuyList: '/presentation/pages/groupbuy/list/index',
  groupBuyCreate: '/presentation/pages/groupbuy/create/index',
  groupBuyDetail: '/presentation/pages/groupbuy/detail/index',
  // 账号（自建账号体系：注册 / 登录 / 找回密码 / 修改密码）
  authLogin: '/presentation/pages/auth/login/index',
  authRegister: '/presentation/pages/auth/register/index',
  authForgot: '/presentation/pages/auth/forgot/index',
  authChangePassword: '/presentation/pages/auth/change-password/index',
  authBindEmail: '/presentation/pages/auth/bind-email/index',
  // 资料（昵称 / 头像：微信一键注册后会直接引到这里）
  profileEdit: '/presentation/pages/profile/edit/index',
  profileSettings: '/presentation/pages/profile/settings/index',
  /** 「首页管理」：选择首页展示哪些服务、排序、恢复默认 */
  profileHome: '/presentation/pages/profile/home/index',
  /** 「我的资产」：我的拼单（发起/参与）+ 各模块入口 */
  profileAssets: '/presentation/pages/profile/assets/index',
  // 跳蚤市场
  fleaList: '/presentation/pages/fleaMarket/list/index',
  fleaCreate: '/presentation/pages/fleaMarket/create/index',
  fleaDetail: '/presentation/pages/fleaMarket/detail/index',
  // 跑腿
  errandList: '/presentation/pages/errand/list/index',
  errandCreate: '/presentation/pages/errand/create/index',
  errandDetail: '/presentation/pages/errand/detail/index',
  // 找搭子
  buddyList: '/presentation/pages/buddy/list/index',
  buddyCreate: '/presentation/pages/buddy/create/index',
  buddyDetail: '/presentation/pages/buddy/detail/index',
  buddyProfile: '/presentation/pages/buddy/profile/index',
  buddyRecommendations: '/presentation/pages/buddy/recommendations/index',
  // 失物招领
  lostFoundList: '/presentation/pages/lostFound/list/index',
  lostFoundCreate: '/presentation/pages/lostFound/create/index',
  lostFoundDetail: '/presentation/pages/lostFound/detail/index',
  facilityList: '/presentation/pages/facility/list/index',
  facilityCreate: '/presentation/pages/facility/create/index',
  facilityDetail: '/presentation/pages/facility/detail/index',
  // 论坛
  forumList: '/presentation/pages/forum/list/index',
  forumCreate: '/presentation/pages/forum/create/index',
  forumDetail: '/presentation/pages/forum/detail/index',
  forumReport: '/presentation/pages/forum/report/index',
  // 野生动物（校园动物观察点）：档案（主界面）/ 地图 / 上报 / 轨迹
  wildlifeArchive: '/presentation/pages/wildlife/archive/index',
  wildlifeMap: '/presentation/pages/wildlife/map/index',
  wildlifeReport: '/presentation/pages/wildlife/report/index',
  wildlifeTracks: '/presentation/pages/wildlife/tracks/index',
  // 食堂营养（同学共建菜品库）
  canteenList: '/presentation/pages/canteen/list/index',
  canteenCreate: '/presentation/pages/canteen/create/index',
  canteenDetail: '/presentation/pages/canteen/detail/index',
  // 营养管家（模块 id 仍是 `canteen`，ADR 0006）：今日 / 记录 / 历史 / 需求 / 推荐 / 菜品库
  nutritionHome: '/presentation/pages/nutrition/index',
  nutritionLog: '/presentation/pages/nutrition/log/index',
  nutritionHistory: '/presentation/pages/nutrition/history/index',
  nutritionTargets: '/presentation/pages/nutrition/targets/index',
  nutritionRecommend: '/presentation/pages/nutrition/recommend/index',
  nutritionDishes: '/presentation/pages/nutrition/dishes/index',
  // 常见问题（问答库）：折叠首页 + 我的工单
  faq: '/presentation/pages/faq/index/index',
  faqTickets: '/presentation/pages/faq/tickets/index',
  // 偷外卖（本人可见的报备记录，不是公开举报墙）
  takeoutGuardList: '/presentation/pages/takeoutGuard/list/index',
  takeoutGuardCreate: '/presentation/pages/takeoutGuard/create/index',
  takeoutGuardDetail: '/presentation/pages/takeoutGuard/detail/index',
  // 校园技术服务目录（同学共建）+ TechPie 整合（绑定 / 能力 / WebView 直连）
  techpieLinks: '/presentation/pages/techpie/links/index',
  techpieCapabilities: '/presentation/pages/techpie/capabilities/index',
  techpieWebview: '/presentation/pages/techpie/webview/index',
  // 心理支持（倾听与预约入口；危机出口在首屏，来自 /wellbeing/crisis-line）
  wellbeingList: '/presentation/pages/wellbeing/list/index',
  wellbeingCreate: '/presentation/pages/wellbeing/create/index',
  wellbeingDetail: '/presentation/pages/wellbeing/detail/index',
  // AI 校园画像（只读两页：画像首页 + 数据来源与开关；没有"列表/发布/详情"）
  aiPortraitHome: '/presentation/pages/aiPortrait/index/index',
  aiPortraitSources: '/presentation/pages/aiPortrait/sources/index',
  // 宿舍矛盾（匿名，凭追踪码查看）
  dormHarmonyHome: '/presentation/pages/dormHarmony/index/index',
  // 四个核心模块：身份 / 课表 / 校园卡 / 我的（隐私与数据）
  identity: '/presentation/pages/identity/index',
  schedule: '/presentation/pages/schedule/index',
  campusCard: '/presentation/pages/campusCard/index',
  /**
   * 校园地点（POI 补充层）—— 快递站 / 车库 / 食堂菜单 / 活动场地 / 自习空间。
   *
   * 这一轮只做**列表 + 下一站**，不画地图、不接地图 SDK；数据来自本机 storage
   * （5 条演示数据，名字带「【演示】」），没有后端接口。
   * 与 `app.config.ts` 的 `pages` 成对登记，否则点进去白屏。
   */
  campusMap: '/presentation/pages/campusMap/index',
  /**
   * 课程 DDL 聚合（Blackboard / Gradescope / Piazza / e云平台）。
   *
   * 与 `app.config.ts` 的 `pages` 必须同时登记：路由表与构建配置由
   * `app/__tests__/routes.test.ts` 双向锁死（少一边就是「点得到但白屏」/「配了但点不到」）。
   * 这一轮还没有 DDL 后端模块，条目只存在本机（见 `data/repositories/deadlineLocalRepository.ts`）。
   */
  deadlines: '/presentation/pages/deadlines/index',
  // 内置全局助手「可达鸭」
  agent: '/presentation/pages/agent/index',
  // 法务页（微信审核必备；内容与 PRIVACY_RULES 同源，避免两处漂移）
  legalTerms: '/presentation/pages/legal/terms/index',
  legalPrivacy: '/presentation/pages/legal/privacy/index',
} as const

export type PagePath = (typeof PAGE_PATHS)[keyof typeof PAGE_PATHS]

/**
 * 已实现垂直切片的模块 → 入口页。
 *
 * 这里只做「契约模块 id → 页面路径」的映射，模块清单本身仍然来自
 * `@kedaya/contracts`（契约 §4 硬规则：禁止各端硬编码模块清单）。
 * 未登记的模块点击后明确提示「开发中」，不假装可用。
 *
 * 放在 `app/routes.ts` 而不是页面里：首页宫格与「发现」页都要用它，
 * 各写一份必然漂移（新增页面时只改了一处，另一处静默点不进去）。
 *
 * ⚠️ 有多个真实页面时，入口取**模块主界面**：
 *   · `wildlife` → **档案页**（野生居民档案是模块主界面），地图 / 上报 / 轨迹从档案页进入；
 *   · `techpie` → 绑定管理页（用户来这里第一个问题是"我绑了什么"）；
 *   · `faq` → 折叠首页（问答库主界面），检索列表从首页进入。
 *
 * ⚠️ `groupbuy` / `buddy` 仍然**各自**登记入口（它们仍是契约模块、仍有独立页面），
 * 但首页宫格对外只给一个聚合入口「凑凑」——聚合关系在
 * `domain/models/homeEntries.ts` 里声明，本表保持「模块 id → 页面」的单一职责。
 */
export const MODULE_ENTRY_PATHS: Readonly<Record<string, string>> = {
  groupbuy: PAGE_PATHS.groupBuyList,
  'flea-market': PAGE_PATHS.fleaList,
  errand: PAGE_PATHS.errandList,
  buddy: PAGE_PATHS.buddyList,
  'lost-found': PAGE_PATHS.lostFoundList,
  forum: PAGE_PATHS.forumList,
  wildlife: PAGE_PATHS.wildlifeArchive,
  /**
   * 营养管家（模块 id 仍是 `canteen`）—— 入口取模块**主界面**（今日营养），
   * 记录 / 历史 / 需求 / 推荐 / 菜品库从主界面进入。
   *
   * 旧的「共建菜品库」三页（`canteenList` / `canteenDetail` / `canteenCreate`）
   * 仍然保留（浏览与纠错可用），但首页宫格不再指向它们：营养管家的主界面
   * 才是这个模块现在的样子（ADR 0006）。
   */
  canteen: PAGE_PATHS.nutritionHome,
  faq: PAGE_PATHS.faq,
  'takeout-guard': PAGE_PATHS.takeoutGuardList,
  facility: PAGE_PATHS.facilityList,
  techpie: PAGE_PATHS.techpieLinks,
  wellbeing: PAGE_PATHS.wellbeingList,
  'ai-portrait': PAGE_PATHS.aiPortraitHome,
  'dorm-harmony': PAGE_PATHS.dormHarmonyHome,
  // 站内通知：就是 tabBar 上的「消息」页（用 switchTab 跳，navigateTo 会失败）
  notifications: PAGE_PATHS.messages,
  // 四个核心模块（身份 / 课表 / 校园卡 / 我的）
  auth: PAGE_PATHS.identity,
  schedule: PAGE_PATHS.schedule,
  /** DDL 聚合：本轮条目只存本机（无后端），但页面与入口已真实可用 */
  deadlines: PAGE_PATHS.deadlines,
  'campus-map': PAGE_PATHS.campusMap,
  'campus-card': PAGE_PATHS.campusCard,
  profile: PAGE_PATHS.profile,
}

/** 场馆预约详情路径 */
export function facilityDetailPath(id: string): string {
  return `${PAGE_PATHS.facilityDetail}?id=${encodeURIComponent(id)}`
}

export function moduleEntryPath(moduleId: string): string | null {
  return MODULE_ENTRY_PATHS[moduleId] ?? null
}

/**
 * 首页 / 服务大厅的**入口 id → 页面路径**（`domain/models/homeEntries` 的目录用）。
 *
 * 为什么需要它而不是让目录自己带 `path`：`app/routes.ts` 是应用层，领域层
 * 不能 import 它（见 `domain/models/notification.ts` 的同一条纪律）。
 * 于是目录只声明「有哪些入口、属于哪一组」，路径在这里解析 ——
 * 聚合入口（凑凑）没有对应的契约模块，所以额外判一次。
 *
 * ⚠️ 第 3 步是 `null`（未上线的模块）：调用方要如实告知「开发中」，
 * 而不是跳到一个不存在的页面（微信只会静默失败）。
 */
export function homeEntryPath(entryId: string): string | null {
  if (entryId === 'cou') return PAGE_PATHS.cou
  return moduleEntryPath(entryId)
}

/** 首页管理（自定义首页展示哪些服务） */
export function profileHomePath(): string {
  return PAGE_PATHS.profileHome
}

/** 服务大厅（全部服务，分组 + 搜索） */
export function homeServicesPath(): string {
  return PAGE_PATHS.homeServices
}

/** 凑凑（拼单 + 找搭子） */
export function couPath(): string {
  return PAGE_PATHS.cou
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

/** 从页面参数里安全取 id（`useRouter().params.id` 可能是 string | undefined） */
export function readIdParam(params: Record<string, string | undefined>): string | null {
  const id = params.id
  return id === undefined || id === '' ? null : id
}

/* ------------------------------------------------------------------ *
 * 详情页路径（统一 `?id=`）
 * ------------------------------------------------------------------ */

function detailPath(base: string, id: string): string {
  return `${base}?id=${encodeURIComponent(id)}`
}

export function groupBuyDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.groupBuyDetail, id)
}

export function fleaDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.fleaDetail, id)
}

export function errandDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.errandDetail, id)
}

export function buddyDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.buddyDetail, id)
}

export function lostFoundDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.lostFoundDetail, id)
}

export function forumDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.forumDetail, id)
}

export function canteenDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.canteenDetail, id)
}

export function takeoutGuardDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.takeoutGuardDetail, id)
}

export function wellbeingDetailPath(id: string): string {
  return detailPath(PAGE_PATHS.wellbeingDetail, id)
}

/* ------------------------------------------------------------------ *
 * 发布页（可选带上分类 / 板块，进入后默认选中）
 * ------------------------------------------------------------------ */

/** 发帖页；可选带上当前版块，进入后默认选中 */
export function forumCreatePath(boardId?: string | null): string {
  return boardId === undefined || boardId === null || boardId === ''
    ? PAGE_PATHS.forumCreate
    : `${PAGE_PATHS.forumCreate}?boardId=${encodeURIComponent(boardId)}`
}

/** 找搭子发布页；可选带上板块，进入后默认选中该板块的活动类型 */
export function buddyCreatePath(section?: string | null): string {
  return section == null || section === ''
    ? PAGE_PATHS.buddyCreate
    : `${PAGE_PATHS.buddyCreate}?section=${encodeURIComponent(section)}`
}

/* ------------------------------------------------------------------ *
 * 举报
 * ------------------------------------------------------------------ */

export interface ForumReportParams {
  targetType: 'POST' | 'REPLY'
  targetId: string
}

export function forumReportPath(params: ForumReportParams): string {
  return `${PAGE_PATHS.forumReport}?targetType=${encodeURIComponent(
    params.targetType,
  )}&targetId=${encodeURIComponent(params.targetId)}`
}

/* ------------------------------------------------------------------ *
 * 宿舍矛盾（匿名，凭追踪码寻址）
 * ------------------------------------------------------------------ */

/** 宿舍矛盾：详情靠追踪码而不是 id 寻址 */
export function dormHarmonyDetailPath(trackCode: string): string {
  return `${PAGE_PATHS.dormHarmonyHome}?trackCode=${encodeURIComponent(trackCode)}`
}

/* ------------------------------------------------------------------ *
 * wildlife（野生动物：档案 / 地图 / 上报 / 轨迹）
 * ------------------------------------------------------------------ */

/**
 * 档案页 —— 模块主界面。
 *
 * 可选 `speciesId`：从服务大厅 / 档案卡的"看它的地图"进来时，
 * 地图页据此预选物种筛选（不带就展示全部）。
 */
export function wildlifeArchivePath(params?: { speciesId?: string | null }): string {
  const speciesId = params?.speciesId
  return speciesId == null || speciesId === ''
    ? PAGE_PATHS.wildlifeArchive
    : `${PAGE_PATHS.wildlifeArchive}?speciesId=${encodeURIComponent(speciesId)}`
}

/**
 * 地图页；可选带上物种，进入后默认选中该物种的筛选。
 *
 * ⚠️ 只接受**物种 id**（契约数据），不接受坐标 —— 坐标一律由页面自己采集。
 */
export function wildlifeMapWithSpeciesPath(speciesId?: string | null): string {
  return speciesId == null || speciesId === ''
    ? PAGE_PATHS.wildlifeMap
    : `${PAGE_PATHS.wildlifeMap}?speciesId=${encodeURIComponent(speciesId)}`
}

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
