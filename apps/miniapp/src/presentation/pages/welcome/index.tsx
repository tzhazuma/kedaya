import { Image, Text, View } from '@tarojs/components'
import { MODULES } from '@kedaya/contracts/modules'
import { PAGE_PATHS } from '../../../app/routes'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyButton, KdyDock, KdyFeatureArtwork } from '../../components'
import { CampusArrow, CampusBrand, CampusThemeToggle } from '../../components/CampusChrome'
import { AnimatedContent, SpotlightCard } from '../../components/ReactBits'
import { useThemeMode } from '../../theme/useThemeMode'
import './index.scss'

const TEASERS = MODULES.filter(module => module.parentId === undefined && ['groupbuy', 'wildlife'].includes(module.id))

export default function WelcomePage() {
  const { mode, toggleTheme } = useThemeMode()
  function open(path: string): void {
    void navigateTo(path).then(result => { if (!result.ok) toast('打开页面失败，请重试') })
  }
  return (
    <View className={`kdy-page kdy-page--dock campus-page kdy-welcome kdy-theme--${mode}`}>
      <View className='campus-top'><CampusBrand /><CampusThemeToggle mode={mode} onClick={toggleTheme} /></View>
      <AnimatedContent className='kdy-welcome__heading' delay={50}>
        <View className='campus-heading-art'>
          <Text className='campus-title'>我的校园，{'\n'}有点意思。</Text>
          <Image className='campus-duck' src='/assets/campus/duck.png' mode='aspectFit' aria-hidden='true' />
        </View>
        <Text className='campus-subtitle'>上科大，什么需求都可以到达</Text>
        <View className='kdy-welcome__cta'><KdyButton size='lg' block onClick={() => open(PAGE_PATHS.home)}><Text>进入主页</Text><CampusArrow /></KdyButton></View>
      </AnimatedContent>
      <Text className='kdy-welcome__section-title'>从这里，发现校园</Text>
      {TEASERS.map((module, index) => (
        <AnimatedContent key={module.id} delay={100 + index * 70}>
          <SpotlightCard className={`kdy-welcome__card kdy-welcome__card--${module.id === 'wildlife' ? 'lime' : 'pink'}`} onClick={() => open(module.id === 'groupbuy' ? PAGE_PATHS.groupBuyList : PAGE_PATHS.wildlife)}>
            <View className='kdy-welcome__card-copy'><Text className='kdy-welcome__card-title'>{module.nameZh}</Text><Text className='kdy-welcome__card-summary'>{module.id === 'groupbuy' ? '拼单统计已上线，找搭子筹备中' : '记录偶遇，认识校园里的小居民'}</Text></View>
            <View className='kdy-welcome__art'><KdyFeatureArtwork kind={module.id === 'wildlife' ? 'wildlife' : 'together'} /></View>
            <View className='campus-circle-arrow'><CampusArrow /></View>
          </SpotlightCard>
        </AnimatedContent>
      ))}
      <View className='kdy-welcome__peek' onClick={() => open(PAGE_PATHS.home)}><Text>更多校园服务 / 查看全部</Text><CampusArrow /></View>
      <Text className='kdy-disclaimer'>可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。</Text>
      <KdyDock highlight='home' />
    </View>
  )
}
