import { Image, Text, View } from '@tarojs/components'
import { useState } from 'react'
import { MODULES } from '@kedaya/contracts/modules'
import type { KedayaModule } from '@kedaya/contracts'
import { PAGE_PATHS } from '../../../app/routes'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyDock, KdyFeatureArtwork, KdyTag } from '../../components'
import type { KdyTagTone } from '../../components'
import { CampusArrow, CampusBrand, CampusThemeToggle } from '../../components/CampusChrome'
import { AnimatedContent, SpotlightCard } from '../../components/ReactBits'
import { useThemeMode } from '../../theme/useThemeMode'
import './index.scss'

const HOME_MODULES = MODULES.filter(module => module.parentId === undefined)
const FEATURED_MODULES = HOME_MODULES.filter(module => ['groupbuy', 'wildlife'].includes(module.id))
const OTHER_MODULES = HOME_MODULES.filter(module => !['groupbuy', 'wildlife'].includes(module.id))
const SHORT_SUMMARIES: Record<string, string> = {
  auth: '管理你的校园身份', schedule: '查看本学期课表',
  'campus-card': '校园卡服务入口', profile: '个性化设置与管理',
}
function moduleTone(module: KedayaModule): KdyTagTone {
  if (module.requiresConsent) return 'danger'
  if (module.sensitivity === 'high' || module.sensitivity === 'critical') return 'warning'
  return 'neutral'
}
function moduleBadge(module: KedayaModule): string {
  if (module.requiresConsent) return '需二次同意'
  if (module.sensitivity === 'high' || module.sensitivity === 'critical') return '高敏感'
  return '开发中'
}
export default function HomePage() {
  const { mode, toggleTheme } = useThemeMode()
  const [expanded, setExpanded] = useState(false)
  function open(path: string): void {
    void navigateTo(path).then(result => { if (!result.ok) toast('打开页面失败，请重试') })
  }
  function handleModuleTap(module: KedayaModule): void {
    if (module.id === 'wildlife') { open(PAGE_PATHS.wildlife); return }
    if (module.id === 'groupbuy') { open(PAGE_PATHS.groupBuyList); return }
    toast(module.requiresConsent ? `${module.nameZh}：需先二次同意，功能筹备中` : `${module.nameZh}：功能筹备中`)
  }
  return (
    <View className={`kdy-page kdy-page--dock campus-page kdy-home kdy-theme--${mode}`}>
      <View className='campus-top'>
        <View className='kdy-home__back' onClick={() => open(PAGE_PATHS.welcome)}><CampusArrow back /><Text>返回入口</Text></View>
        <CampusBrand /><CampusThemeToggle mode={mode} onClick={toggleTheme} />
      </View>
      <AnimatedContent className='kdy-home__heading' delay={50}>
        <View className='campus-heading-art'><Text className='campus-title'>今天，{'\n'}想做点什么？</Text><Image className='campus-duck' src='/assets/campus/duck.png' mode='aspectFit' aria-hidden='true' /></View>
        <Text className='campus-subtitle'>校园里的大小事，都能找到入口。</Text>
        <View className='kdy-home__create' aria-label='发起拼单' onClick={() => open(PAGE_PATHS.groupBuyCreate)}><Text>发起拼单</Text><CampusArrow /></View>
      </AnimatedContent>
      <View className='kdy-home__features'>
        {FEATURED_MODULES.map((module, index) => (
          <AnimatedContent key={module.id} delay={100 + index * 70}>
            <SpotlightCard className={`kdy-home__hero-card kdy-home__hero-card--${module.id === 'wildlife' ? 'lime' : 'pink'}`} onClick={() => handleModuleTap(module)}>
              <View className='campus-circle-arrow'><CampusArrow /></View>
              <Text className='kdy-home__hero-title'>{module.nameZh}</Text>
              <Text className='kdy-home__hero-summary'>{module.id === 'groupbuy' ? '拼单统计已上线' : '记录校园里的偶遇'}</Text>
              <View className='kdy-home__art'><KdyFeatureArtwork kind={module.id === 'wildlife' ? 'wildlife' : 'together'} /></View>
            </SpotlightCard>
          </AnimatedContent>
        ))}
      </View>
      <View className='kdy-home__map' onClick={() => open(PAGE_PATHS.wildlife)}>
        <Image className='kdy-home__map-image' src='/assets/campus/map-preview.webp' mode='aspectFill' />
        <View className='kdy-home__map-copy'><Text className='kdy-home__map-title'>校园地图</Text><Text className='kdy-home__map-sub'>沿着地图，寻找新邻居</Text></View>
        <View className='campus-circle-arrow'><CampusArrow /></View>
      </View>
      <View className='kdy-home__section'><Text className='kdy-home__section-title'>全部模块</Text><Text className='kdy-home__section-count'>共 {HOME_MODULES.length} 个</Text></View>
      <View className='kdy-home__grid'>
        {(expanded ? OTHER_MODULES : OTHER_MODULES.slice(0, 4)).map((module, index) => (
          <View key={module.id} className='kdy-home__grid-item' onClick={() => handleModuleTap(module)}>
            <View className={`kdy-home__grid-orb kdy-home__grid-orb--${index % 4}`}><Image className='kdy-home__module-icon' src={`/assets/campus/module-${module.id}.svg`} mode='scaleToFill' /></View>
            <View className='kdy-home__grid-copy'><View className='kdy-home__grid-title'><Text className='kdy-home__grid-name'>{module.nameZh}</Text><KdyTag tone={moduleTone(module)}>{moduleBadge(module)}</KdyTag></View><Text className='kdy-home__grid-summary'>{SHORT_SUMMARIES[module.id] ?? module.summary}</Text></View>
          </View>
        ))}
      </View>
      <View className='kdy-home__more' aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><Text>{expanded ? '收起模块' : '更多模块，继续探索'}</Text><CampusArrow /></View>
      <Text className='kdy-disclaimer'>可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。</Text>
      <KdyDock active='home' />
    </View>
  )
}
