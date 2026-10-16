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
  groupBuyList: '/presentation/pages/groupbuy/list/index',
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

export function groupBuyDetailPath(id: string): string {
  return `${PAGE_PATHS.groupBuyDetail}?id=${encodeURIComponent(id)}`
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
