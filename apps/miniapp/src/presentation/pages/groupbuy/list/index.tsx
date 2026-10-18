import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { fenToYuan } from '@kedaya/shared'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, groupBuyDetailPath } from '../../../../app/routes'
import { GROUP_BUY_CATEGORIES, GROUP_BUY_CATEGORY_LABELS } from '../../../../domain/models/groupbuy'
import type { GroupBuyCategoryFilter, GroupBuySummary } from '../../../../domain/models/groupbuy'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { useStore } from '../../../hooks'
import { useThemeMode } from '../../../theme/useThemeMode'
import './index.scss'

/**
 * 凑凑入口 —— 拼单列表与找搭子子功能。
 *
 * 三态齐全：
 * - `loading`：首次进入、无缓存
 * - `empty`：后端返回 0 条（或筛选后为空）
 * - `error`：请求失败且**没有**缓存可降级
 * - `ready`：正常；若数据来自缓存，会额外提示「正在后台刷新」
 *
 * 契约 §8 的启动时序在这里落地：`hydrate()` 同步给出缓存 → `load()` 后台刷新。
 * 页面顶部提供三个演示按钮，用来**真实**触发空态 / 错误态（走 mock 控制面，
 * 不是硬编码假状态）。
 */

const CATEGORY_FILTERS: readonly GroupBuyCategoryFilter[] = ['all', ...GROUP_BUY_CATEGORIES]

function categoryFilterLabel(filter: GroupBuyCategoryFilter): string {
  return filter === 'all' ? '全部' : GROUP_BUY_CATEGORY_LABELS[filter]
}

function statusTone(status: GroupBuySummary['status']): KdyTagTone {
  if (status === 'open') return 'brand'
  if (status === 'full') return 'success'
  if (status === 'closed') return 'warning'
  if (status === 'cancelled') return 'danger'
  return 'neutral'
}

function GroupBuyCard({ item }: { item: GroupBuySummary }) {
  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(groupBuyDetailPath(item.id))
      }}
    >
      <View className='kdy-gb-card'>
        <View className='kdy-gb-card__head'>
          <Text className='kdy-gb-card__title'>{item.title}</Text>
          <KdyTag tone={statusTone(item.status)}>{item.statusLabel}</KdyTag>
        </View>

        <View className='kdy-gb-card__meta'>
          <KdyTag tone='neutral'>{item.categoryLabel}</KdyTag>
          <KdyTag tone={item.kind === 'membership' ? 'info' : 'neutral'}>
            {item.kind === 'membership' ? '会员代购·发起人自述持卡' : '普通拼单'}
          </KdyTag>
          <Text className='kdy-gb-card__place'>{item.pickupPlace}</Text>
        </View>

        <View className='kdy-gb-card__row'>
          <Text className='kdy-gb-card__price'>{item.itemCount > 1 ? '多商品·线下核价' : item.priceFen > 0 ? `参考 ¥${fenToYuan(item.priceFen)}` : '线下商议价格'}</Text>
          <Text className='kdy-gb-card__progress'>
            {item.joinedQuantity}/{item.targetCount} 份 · {item.joinedCount} 人 · 还差 {item.remainingSlots} 份
          </Text>
        </View>

        <View className='kdy-gb-card__bar'>
          <View
            className='kdy-gb-card__bar-inner'
            style={`width: ${item.progressPercent}%`}
          />
        </View>

        <View className='kdy-gb-card__foot'>
          <Text className='kdy-gb-card__deadline'>{item.deadlineLabel}</Text>
          <Text className='kdy-gb-card__initiator'>发起人 {item.initiatorName}</Text>
        </View>
      </View>
    </KdyCard>
  )
}

export default function GroupBuyListPage() {
  const { mode } = useThemeMode()
  const container = getContainer()
  const list = container.useCases.listGroupBuys
  const state = useStore(list)
  const [category, setCategory] = useState<GroupBuyCategoryFilter>('all')
  const [activeFeature, setActiveFeature] = useState<'groupbuy' | 'buddy'>('groupbuy')

  function reload(next: GroupBuyCategoryFilter): void {
    void list.load({ category: next, cursor: null })
  }

  useDidShow(() => {
    // 契约 §8 第 1 步（幂等）+ 第 3 步
    list.hydrate()
    reload(category)
  })

  usePullDownRefresh(() => {
    if (activeFeature === 'buddy') {
      void Taro.stopPullDownRefresh()
      return
    }
    void list.load({ category, cursor: null }).then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    if (activeFeature === 'groupbuy') void list.loadMore({ category })
  })

  function handleSelectCategory(next: GroupBuyCategoryFilter): void {
    setCategory(next)
    reload(next)
  }

  function handleSimulateError(): void {
    const mock = container.mockControls
    if (mock === null) {
      toast('当前是真实后端模式，无法模拟错误')
      return
    }
    mock.failNextRequests(1)
    reload(category)
  }

  function handleSimulateEmpty(): void {
    const mock = container.mockControls
    if (mock === null) {
      toast('当前是真实后端模式，无法清空数据')
      return
    }
    mock.clearAll()
    reload(category)
  }

  function handleResetDemo(): void {
    container.mockControls?.reset()
    reload(category)
  }

  return (
    <View className={`kdy-page kdy-gb-list kdy-theme--${mode}`}>
      <View className='kdy-gb-list__intro'>
        <Text className='kdy-gb-list__title'>凑凑</Text>
        <Text className='kdy-gb-list__subtitle'>在这里拼单，也可以找搭子。</Text>
      </View>
      <View className='kdy-gb-list__features'>
        <KdyButton variant={activeFeature === 'groupbuy' ? 'primary' : 'ghost'} onClick={() => setActiveFeature('groupbuy')}>拼单</KdyButton>
        <KdyButton variant={activeFeature === 'buddy' ? 'primary' : 'ghost'} onClick={() => setActiveFeature('buddy')}>找搭子</KdyButton>
      </View>

      {activeFeature === 'groupbuy' ? <>
      <View className='kdy-gb-list__filters'>
        {CATEGORY_FILTERS.map((filter) => (
          <View
            key={filter}
            className='kdy-gb-list__filter'
            onClick={() => handleSelectCategory(filter)}
          >
            <KdyTag tone={filter === category ? 'brand' : 'neutral'}>
              {categoryFilterLabel(filter)}
            </KdyTag>
          </View>
        ))}
      </View>

      <View className='kdy-gb-list__create'>
        <KdyButton block variant='primary' onClick={() => { void navigateTo(PAGE_PATHS.groupBuyCreate) }}>
          发起拼单
        </KdyButton>
      </View>

      <View className='kdy-gb-list__demo'>
        <KdyButton size='sm' variant='ghost' onClick={handleSimulateError}>
          模拟错误态
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={handleSimulateEmpty}>
          模拟空态
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={handleResetDemo}>
          重置演示数据
        </KdyButton>
      </View>

      {state.status === 'loading' && (
        <KdyEmpty mode='loading' description='首次进入，正在拉取拼单列表' />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '未知错误'}
          actionText='重试'
          onAction={() => reload(category)}
        />
      )}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          description='这个分类下还没有拼单，去发起一个吧'
          actionText='重置演示数据'
          onAction={handleResetDemo}
        />
      )}

      {state.status === 'ready' && (
        <View>
          {state.fromCache && (
            <Text className='kdy-gb-list__hint'>当前展示本地缓存，正在后台刷新…</Text>
          )}

          {state.items.map((item) => (
            <GroupBuyCard key={item.id} item={item} />
          ))}

          {state.loadingMore && <Text className='kdy-gb-list__more'>正在加载更多…</Text>}
          {!state.loadingMore && state.nextCursor === null && state.items.length > 0 && (
            <Text className='kdy-gb-list__more'>没有更多了</Text>
          )}
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-gb-list__soft-error'>
          后台刷新失败：{state.error}（已继续展示缓存数据，契约 §8 静默降级）
        </Text>
      )}
      </> : <KdyCard title='找搭子' elevated={false}>
        <Text className='kdy-gb-list__buddy-hint'>想约同学一起运动、自习、吃饭或出行？找搭子的发布与报名页面正在建设中。</Text>
      </KdyCard>}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
