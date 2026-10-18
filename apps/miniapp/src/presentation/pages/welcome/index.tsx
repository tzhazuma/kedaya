import { Image, Text, View } from '@tarojs/components'
import { MODULES } from '@kedaya/contracts/modules'

import { PAGE_PATHS, couPath } from '../../../app/routes'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyButton, KdyDock, KdyFeatureArtwork } from '../../components'
import { CampusArrow, CampusBrand } from '../../components/CampusChrome'
import { AnimatedContent, SpotlightCard } from '../../components/ReactBits'

import './index.scss'

/**
 * 入口页（welcome）—— 应用的**第一屏**。
 *
 * ## 为什么要有它
 *
 * 首页是"工具目录"（今天想做点什么），一上来就抛目录会让第一次打开的人
 * 不知道这里是干什么的。入口页只回答两件事：**这是哪儿**（校园 + 可达鸭）
 * 和**能干什么**（两块最大的功能卡），然后给一个「进入主页」。
 *
 * 首页左上角保留「返回入口」，两边随时可互跳 —— 入口页不是一次性的启动画面，
 * 它是一个真实可达的页面（所以它有 `index.config.ts`、也被 `routes.test.ts` 锁住）。
 *
 * ## 两块功能卡
 *
 * 「凑凑」（拼单 + 找搭子）与「野生居民档案」是产品的一级入口，和首页
 * 用的是同一套淡色卡（粉 / 淡绿）+ 立绘。`cou` **不是契约模块**（契约里
 * `groupbuy` / `buddy` 是两个独立模块，聚合关系只在 `domain/models/homeEntries`
 * 里声明）所以它的名字写在这里；另一块的名字与说明取自契约，避免两处漂移。
 */

const WILDLIFE = MODULES.find((module) => module.id === 'wildlife')

export default function WelcomePage() {
  function open(path: string): void {
    void navigateTo(path).then((result) => {
      if (!result.ok) toast('打开页面失败，请重试')
    })
  }

  return (
    <View className='kdy-page kdy-page--dock campus-page kdy-welcome'>
      <View className='campus-top'>
        <CampusBrand />
      </View>

      <AnimatedContent className='kdy-welcome__heading' delay={50}>
        <View className='campus-heading-art'>
          <Text className='campus-title'>{'我的校园，\n有点意思。'}</Text>
          <Image
            className='campus-duck'
            src='/assets/campus/duck.png'
            mode='aspectFit'
            aria-hidden='true'
          />
        </View>
        <Text className='campus-subtitle'>上科大，什么需求都可以到达</Text>
        <View className='kdy-welcome__cta'>
          <KdyButton size='lg' block onClick={() => open(PAGE_PATHS.home)}>
            <Text>进入主页</Text>
            <CampusArrow />
          </KdyButton>
        </View>
      </AnimatedContent>

      <Text className='kdy-welcome__section-title'>从这里，发现校园</Text>

      <AnimatedContent delay={100}>
        <SpotlightCard className='kdy-welcome__card kdy-welcome__card--pink' onClick={() => open(couPath())}>
          <View className='kdy-welcome__card-copy'>
            <Text className='kdy-welcome__card-title'>凑凑</Text>
            <Text className='kdy-welcome__card-summary'>拼单一起买，找搭子一起做</Text>
          </View>
          <View className='kdy-welcome__art'>
            <KdyFeatureArtwork kind='together' />
          </View>
          <View className='campus-circle-arrow'>
            <CampusArrow />
          </View>
        </SpotlightCard>
      </AnimatedContent>

      <AnimatedContent delay={170}>
        <SpotlightCard
          className='kdy-welcome__card kdy-welcome__card--lime'
          onClick={() => open(PAGE_PATHS.wildlifeArchive)}
        >
          <View className='kdy-welcome__card-copy'>
            <Text className='kdy-welcome__card-title'>{WILDLIFE?.nameZh ?? '野生居民档案'}</Text>
            <Text className='kdy-welcome__card-summary'>
              {WILDLIFE?.summary ?? '记录偶遇，认识校园里的小居民'}
            </Text>
          </View>
          <View className='kdy-welcome__art'>
            <KdyFeatureArtwork kind='wildlife' />
          </View>
          <View className='campus-circle-arrow'>
            <CampusArrow />
          </View>
        </SpotlightCard>
      </AnimatedContent>

      <View className='kdy-welcome__peek' onClick={() => open(PAGE_PATHS.homeServices)}>
        <Text>更多校园服务 / 查看全部</Text>
        <CampusArrow />
      </View>

      <Text className='kdy-disclaimer'>可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。</Text>

      {/* 入口页不是 tabBar 页，所以要自己挂 dock；高亮「首页」暗示家在哪边 */}
      <KdyDock highlight='home' />
    </View>
  )
}
