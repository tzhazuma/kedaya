/**
 * 页面路由表 —— 纯常量，不依赖 Taro（便于在测试/非 UI 场景引用）。
 *
 * 路径规则：Taro 的页面路径 = `sourceRoot` 之后的相对路径（不含扩展名）。
 * 由于契约 §7 冻结了六边形目录，页面真实位于 `src/presentation/pages/**`，
 * 因此路径统一以 `presentation/` 开头。
 */

export const PAGE_PATHS = {
  welcome: '/presentation/pages/welcome/index',
  home: '/presentation/pages/home/index',
  discover: '/presentation/pages/discover/index',
  messages: '/presentation/pages/messages/index',
  profile: '/presentation/pages/profile/index',
  groupBuyList: '/presentation/pages/groupbuy/list/index',
  groupBuyDetail: '/presentation/pages/groupbuy/detail/index',
  groupBuyCreate: '/presentation/pages/groupbuy/create/index',
  wildlife: '/presentation/pages/wildlife/map/index',
} as const

export type PagePath = (typeof PAGE_PATHS)[keyof typeof PAGE_PATHS]

/**
 * 底部悬浮导航（KdyDock）上的四个主页面。
 *
 * 顺序即 dock 从左到右的顺序；`DockTab` 是这四个页面在 dock 上的身份。
 * 原生 tabBar 已移除（做不出浮动胶囊样式），所以这四个页面是**同级普通页面**：
 * 相互切换走 `redirectTo`，避免页面栈越堆越深（见 platform/navigation.ts）。
 */
export const DOCK_PATHS: readonly string[] = [
  PAGE_PATHS.home,
  PAGE_PATHS.discover,
  PAGE_PATHS.messages,
  PAGE_PATHS.profile,
]

export type DockTab = 'home' | 'discover' | 'messages' | 'profile'

export const DOCK_TAB_PATHS: Readonly<Record<DockTab, string>> = {
  home: PAGE_PATHS.home,
  discover: PAGE_PATHS.discover,
  messages: PAGE_PATHS.messages,
  profile: PAGE_PATHS.profile,
}

export function isDockPath(path: string): boolean {
  const [base] = path.split('?')
  return base !== undefined && DOCK_PATHS.includes(base)
}

export function groupBuyDetailPath(id: string): string {
  return `${PAGE_PATHS.groupBuyDetail}?id=${encodeURIComponent(id)}`
}

/** 从页面参数里安全取 id（`useRouter().params.id` 可能是 string | undefined） */
export function readIdParam(params: Record<string, string | undefined>): string | null {
  const id = params.id
  return id === undefined || id === '' ? null : id
}
