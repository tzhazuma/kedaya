import { Text, View } from '@tarojs/components'
import { AppsOutlined, ArrowRight, LikeOutlined } from '@taroify/icons'
import { useDidShow } from '@tarojs/taro'

import { getContainer } from '../../../app/container'
import { PAGE_PATHS, homeEntryPath, homeServicesPath, profileHomePath } from '../../../app/routes'
import type { HomeEntry } from '../../../domain/models/homeEntries'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyAgentFab, KdyCard } from '../../components'
import { KdyHeading } from '../../components/KdyHeading'
import { KdyModuleIcon } from '../../components/KdyModuleIcon'
import { useStore } from '../../hooks'
import './index.scss'

/**
 * 首页 —— 用户自己挑的服务，加一个常驻的安全出口。
 *
 * ## 为什么不铺「全部模块」
 *
 * 契约有 20 个模块，全部平铺就是一张要在里面**找**东西的目录。首页只放
 * 用户自己挑的入口（默认 9 个、上限 12 个），「全部」交给服务大厅
 * （分组 + 搜索，从最后一格「全部服务」进）。
 *
 * ## 两个固定格子
 *
 * `cou`（凑凑：拼单 + 找搭子）与 `wellbeing`（心理支持）是 `locked`：
 * 用户能排序、不能移除。前者是产品要求的一级入口，后者是安全出口 ——
 * 都不能被一次「自定义」误触藏掉。首页底部那条热线行是第二重兜底。
 *
 * ## 一份数据
 *
 * 入口目录来自 `domain/models/homeEntries`（由契约派生），路径来自
 * `app/routes.ts`。页面里没有写死的模块数组，也没有「角标」之类的额外装饰：
 * 没做出来的模块点开时给一句说明，不做成挂在格子上的小字。
 */
export default function HomePage() {
  const container = getContainer()
  const session = container.useCases.session
  const sessionState = useStore(session)
  const layout = container.useCases.homeLayout
  useStore(layout)

  // 从「首页管理」改完返回首页时立刻是新布局（hydrate 是同步读缓存且幂等）
  useDidShow(() => {
    layout.hydrate()
  })

  const entries = layout.selectedEntries()

  function openEntry(entry: HomeEntry): void {
    const path = homeEntryPath(entry.id)
    if (path !== null) {
      void navigateTo(path)
      return
    }
    toast(`${entry.label}还在开发中`)
  }

  return (
    <View className='kdy-page kdy-home'>
      <KdyHeading
        title={sessionState.profile ? `你好，${sessionState.profile.nickname}` : '你好'}
      />

      <KdyCard
        title='我的常用'
        extra={
          <Text className='kdy-home__edit' onClick={() => void navigateTo(profileHomePath())}>
            编辑
          </Text>
        }
      >
        <View className='kdy-home__grid'>
          {entries.map((entry) => (
            <View key={entry.id} className='kdy-home__grid-item' onClick={() => openEntry(entry)}>
              <KdyModuleIcon id={entry.icon} />
              <Text className='kdy-home__grid-name'>{entry.label}</Text>
            </View>
          ))}

          <View
            className='kdy-home__grid-item'
            onClick={() => void navigateTo(homeServicesPath())}
          >
            <View className='kdy-module-icon kdy-module-icon--plain'>
              <AppsOutlined />
            </View>
            <Text className='kdy-home__grid-name'>全部服务</Text>
          </View>
        </View>
      </KdyCard>

      {/* 安全出口：常驻一行，不属于可自定义的内容 */}
      <View
        className='kdy-home__safety'
        onClick={() => {
          const wellbeing = entries.find((entry) => entry.id === 'wellbeing')
          if (wellbeing !== undefined) openEntry(wellbeing)
        }}
      >
        <LikeOutlined />
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
