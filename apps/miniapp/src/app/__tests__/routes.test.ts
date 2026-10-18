import { MINIAPP_PAGES, MODULES } from '@kedaya/contracts'
import { describe, expect, it } from 'vitest'

import appConfig from '../../app.config'
import { HOME_ENTRIES } from '../../domain/models/homeEntries'
import {
  MODULE_ENTRY_PATHS,
  PAGE_PATHS,
  TAB_BAR_PATHS,
  homeEntryPath,
  isTabBarPath,
} from '../routes'

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

  /**
   * 宫格角标只看 `module.id in MODULE_ENTRY_PATHS`。
   *
   * 这张表的两种错法都不会报错，只会「没反应」：
   *   1. 模块 id 打错（例如写成 `takeoutGuard`）→ 角标永远停在「开发中」，
   *      而点进去其实是好的，排查时最容易怀疑错方向；
   *   2. 路径打错（例如指向尚未登记的 PAGE_PATHS 键，或手写字符串）→ 点进去白屏。
   * 因此把「模块 id」与「页面路径」两侧都锁到唯一真相上。
   */
  it('首页宫格入口映射只指向真实契约模块与真实页面路径', () => {
    const moduleIds = new Set<string>(MODULES.map((module) => module.id))
    const pagePaths = new Set<string>(Object.values(PAGE_PATHS))

    for (const [moduleId, path] of Object.entries(MODULE_ENTRY_PATHS)) {
      expect(moduleIds.has(moduleId), `MODULE_ENTRY_PATHS 的 ${moduleId} 不是契约里的模块 id`).toBe(
        true,
      )
      expect(pagePaths.has(path), `${moduleId} → ${path} 不在 PAGE_PATHS 里`).toBe(true)
    }
  })

  /**
   * 首页 / 服务大厅的入口目录（`domain/models/homeEntries`）到页面的最后一跳。
   *
   * 这一跳**没有报错**：入口目录里的 id 与路由表是两份数据，写错只会让某个
   * 服务在首页上点不动（或静默跳到别的页面）。因此在这里锁死：
   *   · 聚合入口（凑凑）必须解析到聚合页；
   *   · 除「尚未上线」的模块外，每个入口都必须有页面；
   *   · 解析出来的路径必须真的存在于 PAGE_PATHS（不是手写字符串）。
   */
  it('入口目录的每一个入口都能解析到真实页面（未上线的模块才允许为空）', () => {
    const pagePaths = new Set<string>(Object.values(PAGE_PATHS))
    const notImplemented = new Set(['facility']) // 契约已登记、页面未实现

    for (const entry of HOME_ENTRIES) {
      const path = homeEntryPath(entry.id)
      if (notImplemented.has(entry.id)) {
        expect(path, `${entry.id} 还没有页面，一旦做了就要登记路径`).toBeNull()
        continue
      }
      expect(path, `${entry.id} 没有解析到页面（点进去会没反应）`).not.toBeNull()
      expect(pagePaths.has(path as string), `${entry.id} → ${path} 不在 PAGE_PATHS 里`).toBe(true)
    }

    expect(homeEntryPath('cou')).toBe(PAGE_PATHS.cou)
    expect(homeEntryPath('not-a-module')).toBeNull()
  })

  it('新增的首页相关路径都已登记（服务大厅 / 首页管理 / 凑凑 / 野生动物档案）', () => {
    expect(PAGE_PATHS.homeServices).toBe('/presentation/pages/home/services/index')
    expect(PAGE_PATHS.profileHome).toBe('/presentation/pages/profile/home/index')
    expect(PAGE_PATHS.cou).toBe('/presentation/pages/cou/index')
    expect(PAGE_PATHS.wildlifeArchive).toBe('/presentation/pages/wildlife/archive/index')
  })
})
