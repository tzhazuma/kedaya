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
} as const

export type PagePath = (typeof PAGE_PATHS)[keyof typeof PAGE_PATHS]

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

/** 从页面参数里安全取 id（`useRouter().params.id` 可能是 string | undefined） */
export function readIdParam(params: Record<string, string | undefined>): string | null {
  const id = params.id
  return id === undefined || id === '' ? null : id
}
