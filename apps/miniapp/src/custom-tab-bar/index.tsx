import { getCurrentInstance, getCurrentPages } from '@tarojs/taro'

import { PAGE_PATHS } from '../app/routes'
import { KdyDock, type DockTab } from '../presentation/components/KdyDock'

/**
 * 微信**自定义 tabBar**（`app.config.ts` 的 `tabBar.custom: true`）。
 *
 * ## 它是什么
 *
 * 开启了 `custom: true` 之后，微信不再画原生 tabBar，而是把
 * `custom-tab-bar/index` 这个组件渲染在底部 tabBar 的位置。四个 tab 页
 * （首页 / 发现 / 消息 / 我的）都会挂上它 —— 于是四个主页面**不需要**自己写
 * `<KdyDock />`（写了就会叠出两条导航）。
 *
 * ## 为什么还要读路由
 *
 * 组件本身不知道"现在在哪一页"。这里从当前页面路径反推高亮格子：
 * 先试 `getCurrentInstance().router.path`（Taro 常规路径，带前导 `/`），
 * 失败再退回 `getCurrentPages()` 的最后一个页面（它的 `route` 没有前导 `/`）。
 *
 * - 消息页不在 dock 的五个格子里（第六格会挤掉中间的凸起按钮），
 *   所以停在消息页时 dock 不高亮任何格子 —— 这是**有意的**，不是漏判。
 * - `isTabBarPath` / `switchTab` 仍然认这四个页面，功能一个都没少。
 */
const TAB_BY_PATH: Record<string, DockTab> = {
  [PAGE_PATHS.home]: 'home',
  [PAGE_PATHS.discover]: 'discover',
  [PAGE_PATHS.profile]: 'profile',
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function currentPagePath(): string | null {
  const routerPath = getCurrentInstance()?.router?.path
  if (typeof routerPath === 'string' && routerPath !== '') {
    return normalizePath(routerPath.split('?')[0] ?? routerPath)
  }
  const pages = getCurrentPages()
  const last = pages[pages.length - 1] as { route?: string } | undefined
  const route = last?.route
  return typeof route === 'string' && route !== '' ? normalizePath(route) : null
}

export default function CustomTabBar() {
  const path = currentPagePath()
  return <KdyDock active={path === null ? null : TAB_BY_PATH[path] ?? null} />
}
