import { Image, Text, View } from '@tarojs/components'
import { PAGE_PATHS, type DockTab } from '../../../app/routes'
import { navigateTo, toast } from '../../../platform/navigation'
import './index.scss'

type SketchTab = DockTab | 'map'
export interface KdyDockProps {
  active?: SketchTab | null
  highlight?: SketchTab | null
  badge?: DockTab | null
}
const DOCK_ITEMS = [
  { tab: 'home', label: '首页', path: PAGE_PATHS.home },
  { tab: 'map', label: '地图', path: PAGE_PATHS.wildlife },
  { tab: 'create', label: '发起拼单', path: PAGE_PATHS.groupBuyCreate },
  { tab: 'discover', label: '发现', path: PAGE_PATHS.discover },
  { tab: 'profile', label: '我的', path: PAGE_PATHS.profile },
] as const

/** Milk paper, hand drawn contour and one central creation action. */
export function KdyDock({ active = null, highlight = null, badge = null }: KdyDockProps) {
  function handleTap(item: typeof DOCK_ITEMS[number]): void {
    if (item.tab === active) return
    void navigateTo(item.path).then(result => { if (!result.ok) toast('打开页面失败，请重试') })
  }
  return (
    <View className='kdy-dock'>
      <Image className='kdy-dock__frame' src='/assets/campus/dock-sketch-frame.svg' mode='scaleToFill' aria-hidden='true' />
      {DOCK_ITEMS.map(item => {
        const selected = item.tab === (highlight ?? active)
        return (
          <View key={item.tab} className={`kdy-dock__item${selected ? ' kdy-dock__item--active' : ''}${item.tab === 'create' ? ' kdy-dock__item--create' : ''}`} hoverClass='kdy-dock__item--pressed' hoverStartTime={0} hoverStayTime={100} aria-label={item.label} onClick={() => handleTap(item)}>
            <View className='kdy-dock__icon-wrap'><Image className='kdy-dock__icon' src={`/assets/campus/sketch-${item.tab}.svg`} mode='scaleToFill' aria-hidden='true' /></View>
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
