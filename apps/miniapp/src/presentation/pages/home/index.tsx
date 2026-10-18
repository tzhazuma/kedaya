import { Image, Text, View } from '@tarojs/components'
import { AppsOutlined, ArrowRight, LikeOutlined } from '@taroify/icons'
import { MODULES } from '@kedaya/contracts/modules'
import { useDidShow } from '@tarojs/taro'

import { getContainer } from '../../../app/container'
import {
  PAGE_PATHS,
  couPath,
  homeEntryPath,
  homeServicesPath,
  profileHomePath,
} from '../../../app/routes'
import type { HomeEntry } from '../../../domain/models/homeEntries'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyAgentFab, KdyFeatureArtwork } from '../../components'
import { CampusArrow, CampusBrand } from '../../components/CampusChrome'
import { KdyModuleIcon } from '../../components/KdyModuleIcon'
import { AnimatedContent, SpotlightCard } from '../../components/ReactBits'
import { useStore } from '../../hooks'

import './index.scss'

/**
 * 首页 —— 贴纸簿的"工作台"。
 *
 * ## 版式（来自 `feature/pingdan` 的设计稿）
 *
 * 品牌行 → 40px 大标题「今天，想做点什么？」（可达鸭探出右下角）→
 * 淡黄胶囊「发起拼单」→ 两张淡色功能卡（凑凑 / 野生居民档案）→
 * 校园地图卡 → 「我的常用」宫格 → 更多服务 → 安全出口 → 免责声明。
 *
 * 底部导航**不在本页**：首页是 tabBar 页，dock 由微信自定义 tabBar
 * （`src/custom-tab-bar/`）统一渲染 —— 这里再写一个就会叠成两条。
 *
 * ## 保留了原首页的全部能力
 *
 * - 宫格仍然是**用户自己挑的**入口（`homeLayout`，默认 9 个 / 上限 12 个，
 *   「我的 → 首页管理」可增删排序），不是把 20 个模块铺满一张要找的目录；
 * - `cou`（凑凑）与 `wellbeing`（心理支持）是 `locked` 入口：能排序、不能移除 ——
 *   前者是产品要求的一级入口，后者是安全出口；
 * - 底部那条热线是**第二重兜底**（心理支持的热线必须在首屏可达；
 *   第一重是入口页与首页宫格里的固定格子）。
 */
export default function HomePage() {
  const container = getContainer()
  const layout = container.useCases.homeLayout
  useStore(layout)

  // 从「首页管理」改完返回首页时立刻是新布局（hydrate 是同步读缓存且幂等）
  useDidShow(() => {
    layout.hydrate()
  })

  const entries = layout.selectedEntries()
  const wildlife = MODULES.find((module) => module.id === 'wildlife')

  function open(path: string): void {
    void navigateTo(path).then((result) => {
      if (!result.ok) toast('打开页面失败，请重试')
    })
  }

  function openEntry(entry: HomeEntry): void {
    const path = homeEntryPath(entry.id)
    if (path !== null) {
      open(path)
      return
    }
    toast(`${entry.label}还在开发中`)
  }

  return (
    <View className='kdy-page kdy-page--dock campus-page kdy-home'>
      <View className='campus-top'>
        <View className='kdy-home__back' onClick={() => open(PAGE_PATHS.welcome)}>
          <CampusArrow back />
          <Text>返回入口</Text>
        </View>
        <CampusBrand />
      </View>

      <AnimatedContent className='kdy-home__heading' delay={50}>
        <View className='campus-heading-art'>
          <Text className='campus-title'>{'今天，\n想做点什么？'}</Text>
          <Image
            className='campus-duck'
            src='/assets/campus/duck.png'
            mode='aspectFit'
            aria-hidden='true'
          />
        </View>
        <Text className='campus-subtitle'>校园里的大小事，都能找到入口。</Text>
        <View
          className='kdy-home__create'
          aria-label='发起拼单'
          onClick={() => open(PAGE_PATHS.groupBuyCreate)}
          hoverClass='kdy-home__create--pressed'
          hoverStayTime={70}
        >
          <Text>发起拼单</Text>
          <CampusArrow />
        </View>
      </AnimatedContent>

      <View className='kdy-home__features'>
        <AnimatedContent delay={100}>
          <SpotlightCard
            className='kdy-home__hero-card kdy-home__hero-card--pink'
            onClick={() => open(couPath())}
          >
            <View className='campus-circle-arrow'>
              <CampusArrow />
            </View>
            <Text className='kdy-home__hero-title'>凑凑</Text>
            <Text className='kdy-home__hero-summary'>拼单一起买，找搭子一起做</Text>
            <View className='kdy-home__art'>
              <KdyFeatureArtwork kind='together' />
            </View>
          </SpotlightCard>
        </AnimatedContent>

        <AnimatedContent delay={170}>
          <SpotlightCard
            className='kdy-home__hero-card kdy-home__hero-card--lime'
            onClick={() => open(PAGE_PATHS.wildlifeArchive)}
          >
            <View className='campus-circle-arrow'>
              <CampusArrow />
            </View>
            <Text className='kdy-home__hero-title'>{wildlife?.nameZh ?? '野生居民档案'}</Text>
            <Text className='kdy-home__hero-summary'>记录偶遇，认识校园里的小居民</Text>
            <View className='kdy-home__art'>
              <KdyFeatureArtwork kind='wildlife' />
            </View>
          </SpotlightCard>
        </AnimatedContent>
      </View>

      <View className='kdy-home__map' onClick={() => open(PAGE_PATHS.wildlifeMap)}>
        <Image
          className='kdy-home__map-image'
          src='/assets/campus/map-preview.webp'
          mode='aspectFill'
          aria-hidden='true'
        />
        <View className='kdy-home__map-copy'>
          <Text className='kdy-home__map-title'>校园地图</Text>
          <Text className='kdy-home__map-sub'>沿着地图，寻找新邻居</Text>
        </View>
        <View className='campus-circle-arrow'>
          <CampusArrow />
        </View>
      </View>

      <View className='kdy-home__section'>
        <Text className='kdy-home__section-title'>我的常用</Text>
        <Text className='kdy-home__section-count'>共 {entries.length} 个</Text>
        <View
          className='kdy-home__manage'
          onClick={() => open(profileHomePath())}
          hoverClass='kdy-home__manage--pressed'
          hoverStayTime={70}
        >
          <Text>管理</Text>
        </View>
      </View>

      <View className='kdy-home__grid'>
        {entries.map((entry) => (
          <View
            key={entry.id}
            className='kdy-home__grid-item'
            onClick={() => openEntry(entry)}
            hoverClass='kdy-home__grid-item--pressed'
            hoverStayTime={70}
          >
            <KdyModuleIcon id={entry.icon} />
            <Text className='kdy-home__grid-name'>{entry.label}</Text>
          </View>
        ))}

        <View
          className='kdy-home__grid-item'
          onClick={() => open(homeServicesPath())}
          hoverClass='kdy-home__grid-item--pressed'
          hoverStayTime={70}
        >
          <View className='kdy-module-icon kdy-module-icon--plain'>
            <AppsOutlined />
          </View>
          <Text className='kdy-home__grid-name'>全部服务</Text>
        </View>
      </View>

      <View className='kdy-home__more' onClick={() => open(homeServicesPath())}>
        <Text>更多校园服务，继续探索</Text>
        <CampusArrow />
      </View>

      {/* 安全出口：常驻一行，不属于可自定义的内容 */}
      <View
        className='kdy-home__safety'
        onClick={() => {
          const wellbeing = entries.find((entry) => entry.id === 'wellbeing')
          if (wellbeing !== undefined) openEntry(wellbeing)
        }}
        hoverClass='kdy-home__safety--pressed'
        hoverStayTime={70}
      >
        <View className='kdy-home__safety-icon'>
          <LikeOutlined />
        </View>
        <View className='kdy-home__safety-body'>
          <Text className='kdy-home__safety-title'>心理支持</Text>
          <Text className='kdy-home__safety-description'>24 小时热线 12356</Text>
        </View>
        <ArrowRight />
      </View>

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>

      <KdyAgentFab module='home' page={PAGE_PATHS.home} />
    </View>
  )
}
