import { MINIAPP_PAGES } from '@kedaya/contracts'
import { describe, expect, it } from 'vitest'

import appConfig from '../../app.config'
import { PAGE_PATHS, TAB_BAR_PATHS, isTabBarPath } from '../routes'

/**
 * 路由表的一致性闸门（这一类 bug 的共同点是「不报错，只是没反应」）。
 *
 * 三个真会踩的坑：
 *   1. 后端 agent 下发的动作路径来自契约 `MINIAPP_PAGES`，小程序如果少登记一条，
 *      用户点"打开课表"就跳到一个不存在的页面 —— 微信只会静默失败；
 *   2. `app.config.ts` 的 `pages` 少一条，页面能跳过去但**白屏**；
 *   3. tabBar 页必须用 `switchTab`，路径判断错了会直接抛错。
 *
 * 因此这里把「契约 / 路由表 / 构建配置」三方锁在一起：谁改了路径，
 * 只要没同步另外两处，测试立刻红。
 */

describe('页面路由表', () => {
  it('逐条覆盖契约 MINIAPP_PAGES（agent 的动作跳转依赖它）', () => {
    for (const [key, path] of Object.entries(MINIAPP_PAGES)) {
      expect(Object.keys(PAGE_PATHS), `PAGE_PATHS 缺少 ${key}`).toContain(key)
      expect(PAGE_PATHS[key as keyof typeof PAGE_PATHS]).toBe(path)
    }
  })

  it('app.config.ts 的 pages + 子包页面与 PAGE_PATHS 完全一致（少一条就是白屏页面）', () => {
    const declared = [
      ...appConfig.pages,
      ...appConfig.subPackages.flatMap((subPackage) =>
        subPackage.pages.map((page) => `${subPackage.root}/${page}`),
      ),
    ].map((page) => `/${page}`)

    expect(new Set(declared)).toEqual(new Set(Object.values(PAGE_PATHS)))
  })

  it('tabBar 页必须在主包（微信硬性要求：分包里的页面不能是 tabBar）', () => {
    const subPackageRoots = appConfig.subPackages.map((subPackage) => `${subPackage.root}/`)

    for (const tabPath of TAB_BAR_PATHS) {
      const relative = tabPath.replace(/^\//, '')
      expect(
        subPackageRoots.some((root) => relative.startsWith(root)),
        `tabBar 页 ${tabPath} 被放进了子包`,
      ).toBe(false)
      expect(appConfig.pages).toContain(relative)
    }
  })

  it('子包声明本身合法：root 不互相嵌套、页面不重复、每包都有页面', () => {
    const roots = appConfig.subPackages.map((subPackage) => subPackage.root)

    for (const subPackage of appConfig.subPackages) {
      expect(subPackage.pages.length, `${subPackage.root} 是空包`).toBeGreaterThan(0)
      // root 互相嵌套（例如 a 与 a/b）会让同一份代码被打进两个包
      for (const other of roots) {
        if (other === subPackage.root) continue
        expect(other.startsWith(`${subPackage.root}/`), `${other} 嵌套在 ${subPackage.root} 里`).toBe(
          false,
        )
      }
    }

    const all = [
      ...appConfig.pages,
      ...appConfig.subPackages.flatMap((subPackage) =>
        subPackage.pages.map((page) => `${subPackage.root}/${page}`),
      ),
    ]
    expect(new Set(all).size, '存在重复页面（重复会让 Taro 覆盖页面配置）').toBe(all.length)
  })

  it('预下载规则只指向真实存在的子包，且不在移动网络下白烧用户流量', () => {
    const roots = new Set(appConfig.subPackages.map((subPackage) => subPackage.root))

    for (const [page, rule] of Object.entries(appConfig.preloadRule)) {
      expect(appConfig.pages, `preloadRule 的入口 ${page} 必须是主包页面`).toContain(page)
      for (const target of rule.packages) {
        expect(roots.has(target), `preloadRule 指向了不存在的子包 ${target}`).toBe(true)
      }
      expect(rule.network).toBe('wifi')
    }
  })

  it('没有重复路径（重复会让 Taro 覆盖页面配置）', () => {
    const values = Object.values(PAGE_PATHS)
    expect(new Set(values).size).toBe(values.length)
  })

  it('tabBar 列表与 TAB_BAR_PATHS 一致，且 isTabBarPath 能区分两类页面', () => {
    const tabBarPaths = appConfig.tabBar.list.map((item) => `/${item.pagePath}`)
    expect(tabBarPaths).toEqual([...TAB_BAR_PATHS])

    for (const path of TAB_BAR_PATHS) expect(isTabBarPath(path)).toBe(true)
    expect(isTabBarPath(PAGE_PATHS.agent)).toBe(false)
    expect(isTabBarPath(PAGE_PATHS.schedule)).toBe(false)
    // 带查询串时也要判断正确（可达鸭悬浮球的入口就带着上下文参数）
    expect(isTabBarPath(`${PAGE_PATHS.profile}?x=1`)).toBe(true)
  })

  it('四个核心模块与可达鸭都已登记页面路径', () => {
    expect(PAGE_PATHS.identity).toBe('/presentation/pages/identity/index')
    expect(PAGE_PATHS.schedule).toBe('/presentation/pages/schedule/index')
    expect(PAGE_PATHS.campusCard).toBe('/presentation/pages/campusCard/index')
    expect(PAGE_PATHS.profileSettings).toBe('/presentation/pages/profile/settings/index')
    expect(PAGE_PATHS.agent).toBe('/presentation/pages/agent/index')
  })
})
