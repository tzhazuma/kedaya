import { Image, Text, View } from '@tarojs/components'

import { PAGE_PATHS } from '../../../app/routes'
import { navigateTo, toast } from '../../../platform/navigation'

import './index.scss'

/**
 * KdyDock —— 贴纸簿的**手绘胶囊导航**。
 *
 * ## 为什么是自绘而不是原生 tabBar
 *
 * 原生 tabBar 只能画「白底 + 图片/文字图标 + 顶部一条描边」，做不出设计稿里的
 * 浮动胶囊（奶白纸面 + 手绘轮廓 + 中间凸起的「＋」）。所以这里用自绘：
 * 底图是 `assets/campus/dock-sketch-frame.svg`（一张手绘轮廓的奶白纸面）。
 *
 * ## 两种挂载方式（**不要重复挂**）
 *
 * 1. 四个主页面（首页 / 发现 / 消息 / 我的）：走微信的**自定义 tabBar**
 *    （`app.config.ts` 的 `tabBar.custom: true` + `src/custom-tab-bar/`），
 *    tab 页里**不要**再写 `<KdyDock />`，否则会叠出两条导航。
 * 2. 非 tab 页面（入口页 `welcome` 等）：显式挂 `<KdyDock />`，
 *    并用 `active` 指定要高亮的格子。
 *
 * ## 五个格子
 *
 * 首页 / 地图 / ＋（发起拼单）/ 发现 / 我的 —— 与设计稿一致。
 * 「消息」不单独占一格（六个格子会挤掉中间的凸起按钮）：它是 tabBar 页，
 * 入口留在「我的」页里，`switchTab` 仍然可用。
 *
 * ## 尺寸基准
 *
 * 375pt（AGENTS.md）。设计稿是 750rpx，搬运时已除以 2。
 */
export type DockTab = 'home' | 'map' | 'create' | 'discover' | 'profile'

export interface KdyDockProps {
  /** 当前所在的格子（非 tab 页面用；tab 页面由 `custom-tab-bar` 自动判定） */
  active?: DockTab | null
  /** 要高亮的格子（`active` 的弱化版：入口页用 `highlight='home'` 暗示"家在这边"） */
  highlight?: DockTab | null
  /** 带红点的格子 */
  badge?: DockTab | null
}

interface DockItem {
  tab: DockTab
  label: string
  path: string
}

const DOCK_ITEMS: readonly DockItem[] = [
  { tab: 'home', label: '首页', path: PAGE_PATHS.home },
  { tab: 'map', label: '地图', path: PAGE_PATHS.wildlifeMap },
  { tab: 'create', label: '发起拼单', path: PAGE_PATHS.groupBuyCreate },
  { tab: 'discover', label: '发现', path: PAGE_PATHS.discover },
  { tab: 'profile', label: '我的', path: PAGE_PATHS.profile },
]

export function KdyDock({ active = null, highlight = null, badge = null }: KdyDockProps) {
  function handleTap(item: DockItem): void {
    if (item.tab === active) return
    // tab 页由 platform/navigation 自动走 switchTab（navigateTo 会直接失败）
    void navigateTo(item.path).then((result) => {
      if (!result.ok) toast('打开页面失败，请重试')
    })
  }

  return (
    <View className='kdy-dock'>
      <Image
        className='kdy-dock__frame'
        src='/assets/campus/dock-sketch-frame.svg'
        mode='scaleToFill'
        aria-hidden='true'
      />
      {DOCK_ITEMS.map((item) => {
        const selected = item.tab === (highlight ?? active)
        return (
          <View
            key={item.tab}
            className={`kdy-dock__item${selected ? ' kdy-dock__item--active' : ''}${
              item.tab === 'create' ? ' kdy-dock__item--create' : ''
            }`}
            hoverClass='kdy-dock__item--pressed'
            hoverStartTime={0}
            hoverStayTime={100}
            aria-label={item.label}
            onClick={() => handleTap(item)}
          >
            <View className='kdy-dock__icon-wrap'>
              <Image
                className='kdy-dock__icon'
                src={`/assets/campus/sketch-${item.tab}.svg`}
                mode='scaleToFill'
                aria-hidden='true'
              />
            </View>
            {item.tab !== 'create' && <Text className='kdy-dock__label'>{item.label}</Text>}
            {selected && <View className='kdy-dock__selected-dot' />}
            {badge === item.tab && <View className='kdy-dock__badge' />}
          </View>
        )
      })}
    </View>
  )
}

export default KdyDock
