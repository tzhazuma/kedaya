import { Text, View } from '@tarojs/components'
import Taro, {
  useDidShow,
  usePullDownRefresh,
  useReachBottom,
} from '@tarojs/taro'
import { fenToYuan } from '@kedaya/shared'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { groupBuyDetailPath } from '../../../../app/routes'
import {
  GROUP_BUY_CATEGORIES,
  GROUP_BUY_CATEGORY_LABELS,
} from '../../../../domain/models/groupbuy'
import type {
  GroupBuyCategoryFilter,
  GroupBuySummary,
} from '../../../../domain/models/groupbuy'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'
import Progress from '@taroify/core/progress'
import '@taroify/core/progress/style'
import { KdyHeading } from '../../../components/KdyHeading'
import { KdyDemoTools } from '../../../components/KdyDemoTools'

/**
 * 拼单列表页 —— 垂直切片的入口。
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

const CATEGORY_FILTERS: readonly GroupBuyCategoryFilter[] = [
  'all',
  ...GROUP_BUY_CATEGORIES,
]

function categoryFilterLabel(filter: GroupBuyCategoryFilter): string {
  return filter === 'all' ? '全部' : GROUP_BUY_CATEGORY_LABELS[filter]
}

function statusTone(status: GroupBuySummary['status']): KdyTagTone {
  if (status === 'open') return 'brand'
  if (status === 'full') return 'success'
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
          <Text className='kdy-gb-card__place'>{item.pickupPlace}</Text>
        </View>

        <View className='kdy-gb-card__row'>
          <Text className='kdy-gb-card__price'>
            ¥{fenToYuan(item.priceFen)}
          </Text>
          <Text className='kdy-gb-card__progress'>
            {item.joinedQuantity}/{item.targetCount} 份 · 还差{' '}
            {item.remainingSlots} 份
          </Text>
        </View>

        <Progress
          className='kdy-gb-card__bar'
          percent={item.progressPercent}
          label={false}
        />

        <View className='kdy-gb-card__foot'>
          <Text className='kdy-gb-card__deadline'>{item.deadlineLabel}</Text>
          <Text className='kdy-gb-card__initiator'>
            发起人 {item.initiatorName}
          </Text>
        </View>
      </View>
    </KdyCard>
  )
}

export default function GroupBuyListPage() {
  const container = getContainer()
  const list = container.useCases.listGroupBuys
  const state = useStore(list)
  const [category, setCategory] = useState<GroupBuyCategoryFilter>('all')

  function reload(next: GroupBuyCategoryFilter): void {
    void list.load({ category: next, cursor: null })
  }

  useDidShow(() => {
    // 契约 §8 第 1 步（幂等）+ 第 3 步
    list.hydrate()
    reload(category)
  })

  usePullDownRefresh(() => {
    void list
      .load({ category, cursor: null })
      .then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    void list.loadMore({ category })
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
    <View className='kdy-page kdy-gb-list'>
      <KdyHeading
        title='一起拼单，好物共享'
        subtitle='和身边的同学，凑一份刚刚好的快乐。'
        eyebrow='KEDAYA · 校园拼单'
      />
      <View className='kdy-gb-list__filters'>
        {CATEGORY_FILTERS.map((filter) => (
          <View key={filter} className='kdy-gb-list__filter'>
            <KdyButton
              size='sm'
              variant={filter === category ? 'primary' : 'ghost'}
              onClick={() => handleSelectCategory(filter)}
            >
              {categoryFilterLabel(filter)}
            </KdyButton>
          </View>
        ))}
      </View>

      <KdyDemoTools>
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
      </KdyDemoTools>

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
            <Text className='kdy-gb-list__hint'>
              当前展示本地缓存，正在后台刷新…
            </Text>
          )}

          {state.items.map((item) => (
            <GroupBuyCard key={item.id} item={item} />
          ))}

          {state.loadingMore && (
            <Text className='kdy-gb-list__more'>正在加载更多…</Text>
          )}
          {!state.loadingMore &&
            state.nextCursor === null &&
            state.items.length > 0 && (
              <Text className='kdy-gb-list__more'>没有更多了</Text>
            )}
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-gb-list__soft-error'>
          暂时无法刷新：{state.error}，已为你保留上次的内容。
        </Text>
      )}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
