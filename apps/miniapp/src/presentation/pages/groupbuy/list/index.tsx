import { Text, View } from '@tarojs/components'
import Taro, {
  useDidShow,
  usePullDownRefresh,
  useReachBottom,
} from '@tarojs/taro'
import Progress from '@taroify/core/progress'
import '@taroify/core/progress/style'
import { fenToYuan } from '@kedaya/shared'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, groupBuyDetailPath } from '../../../../app/routes'
import {
  GROUP_BUY_CATEGORIES,
  GROUP_BUY_CATEGORY_LABELS,
} from '../../../../domain/models/groupbuy'
import type {
  GroupBuyCategoryFilter,
  GroupBuySummary,
} from '../../../../domain/models/groupbuy'
import type { GroupBuyRole, GroupBuySort } from '../../../../domain/ports/groupbuyRepository'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'
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
 *
 * **筛选分三组**（分类 / 范围 / 排序），三组都会在每次 `load` / `loadMore` 时
 * 一起带上：`load(query)` 只合并这一次的参数，不带就会"翻页时悄悄换了筛选条件"。
 *
 * 「我发起的 / 我参与的」需要登录：未登录时先引导登录，而不是发一个注定 401 的请求
 * （服务端对 `mine=1` 会返回 UNAUTHENTICATED，这是刻意的）。
 */

const CATEGORY_FILTERS: readonly GroupBuyCategoryFilter[] = ['all', ...GROUP_BUY_CATEGORIES]

type Scope = 'all' | GroupBuyRole

const SCOPES: readonly { id: Scope; label: string }[] = [
  { id: 'all', label: '全部拼单' },
  { id: 'owner', label: '我发起的' },
  { id: 'member', label: '我参与的' },
]

const SORTS: readonly { id: GroupBuySort; label: string }[] = [
  { id: 'latest', label: '最新发布' },
  { id: 'deadline', label: '即将截止' },
]

function categoryFilterLabel(filter: GroupBuyCategoryFilter): string {
  return filter === 'all' ? '全部分类' : GROUP_BUY_CATEGORY_LABELS[filter]
}

function scopeLabel(scope: Scope): string {
  return SCOPES.find((item) => item.id === scope)?.label ?? '全部拼单'
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
          <Text className='kdy-gb-card__price'>¥{fenToYuan(item.priceFen)}</Text>
          <Text className='kdy-gb-card__progress'>
            {item.joinedQuantity}/{item.targetCount} 份 · 还差 {item.remainingSlots} 份
          </Text>
        </View>

        <Progress className='kdy-gb-card__bar' percent={item.progressPercent} label={false} />

        <View className='kdy-gb-card__foot'>
          <Text className='kdy-gb-card__deadline'>{item.deadlineLabel}</Text>
          <Text className='kdy-gb-card__initiator'>发起人 {item.initiatorName}</Text>
        </View>
      </View>
    </KdyCard>
  )
}

export default function GroupBuyListPage() {
  const container = getContainer()
  const list = container.useCases.listGroupBuys
  const state = useStore(list)
  const session = useStore(container.useCases.session)

  const [category, setCategory] = useState<GroupBuyCategoryFilter>('all')
  const [scope, setScope] = useState<Scope>('all')
  const [sort, setSort] = useState<GroupBuySort>('latest')

  function queryFor(next: {
    category?: GroupBuyCategoryFilter
    scope?: Scope
    sort?: GroupBuySort
  }): Parameters<typeof list.load>[0] {
    const effectiveCategory = next.category ?? category
    const effectiveScope = next.scope ?? scope
    const effectiveSort = next.sort ?? sort
    return {
      category: effectiveCategory,
      sort: effectiveSort,
      ...(effectiveScope === 'all' ? { mine: false } : { mine: true, role: effectiveScope }),
      cursor: null,
    }
  }

  function reload(next: Parameters<typeof queryFor>[0] = {}): void {
    void list.load(queryFor(next))
  }

  useDidShow(() => {
    // 契约 §8 第 1 步（幂等）+ 第 3 步
    list.hydrate()
    reload()
  })

  usePullDownRefresh(() => {
    void list.load(queryFor({})).then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    void list.loadMore(queryFor({}))
  })

  /** 「我发起的 / 我参与的」要登录 —— 未登录时不给假请求，直接引导 */
  function requireLogin(): boolean {
    if (session.tokens !== null) return true
    toast('登录后查看我的拼单')
    void navigateTo(PAGE_PATHS.authLogin)
    return false
  }

  function handleSelectScope(next: Scope): void {
    if (next !== 'all' && !requireLogin()) return
    setScope(next)
    reload({ scope: next })
  }

  function handleSimulateError(): void {
    const mock = container.mockControls
    if (mock === null) {
      toast('当前是真实后端模式，无法模拟错误')
      return
    }
    mock.failNextRequests(1)
    reload()
  }

  function handleSimulateEmpty(): void {
    const mock = container.mockControls
    if (mock === null) {
      toast('当前是真实后端模式，无法清空数据')
      return
    }
    mock.clearAll()
    reload()
  }

  function handleResetDemo(): void {
    container.mockControls?.reset()
    reload()
  }

  return (
    <View className='kdy-page kdy-gb-list'>
      <KdyHeading
        title='一起拼单，好物共享'
        subtitle='和身边的同学，凑一份刚刚好的快乐。'
        eyebrow='KEDAYA · 校园拼单'
      />

      <View className='kdy-gb-list__chips'>
        {SCOPES.map((item) => (
          <KdyChip key={item.id} active={scope === item.id} onClick={() => handleSelectScope(item.id)}>
            {item.label}
          </KdyChip>
        ))}
      </View>

      <View className='kdy-gb-list__chips'>
        {CATEGORY_FILTERS.map((filter) => (
          <KdyChip
            key={filter}
            active={filter === category}
            onClick={() => {
              setCategory(filter)
              reload({ category: filter })
            }}
          >
            {categoryFilterLabel(filter)}
          </KdyChip>
        ))}
      </View>

      <View className='kdy-gb-list__chips'>
        {SORTS.map((item) => (
          <KdyChip
            key={item.id}
            active={sort === item.id}
            onClick={() => {
              setSort(item.id)
              reload({ sort: item.id })
            }}
          >
            {item.label}
          </KdyChip>
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
          onAction={() => reload()}
        />
      )}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          description={
            scope === 'all'
              ? `${categoryFilterLabel(category)}下还没有拼单，去发起一个吧`
              : `还没有${scopeLabel(scope)}的拼单`
          }
          actionText={
            container.mockControls === null ? '去发起拼单' : '重置演示数据'
          }
          onAction={
            container.mockControls === null
              ? () => void navigateTo(PAGE_PATHS.groupBuyCreate)
              : handleResetDemo
          }
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
          暂时无法刷新：{state.error}，已为你保留上次的内容。
        </Text>
      )}

      <View className='kdy-gb-list__fab'>
        <KdyButton
          onClick={() => {
            if (!requireLogin()) return
            void navigateTo(PAGE_PATHS.groupBuyCreate)
          }}
        >
          发起拼单
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。拼单为同学间自愿拼团，平台不参与资金往来。
      </Text>
    </View>
  )
}
