import { Text, View } from '@tarojs/components'
import Taro, {
  useDidShow,
  usePullDownRefresh,
  useReachBottom,
} from '@tarojs/taro'
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
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyListSkeleton, KdyProgress, KdyTag } from '../../../components'
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
 * - `ready`：正常（缓存先出、后台刷新，刷新过程不打扰用户）
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

/**
 * 拼单卡 —— 以**进度**为主角的定制化外观。
 *
 * 拼单的用户问题是"还差几个人、什么时候截止、我能不能赶上"，所以卡片顺序固定为：
 *   1. 标题 + 分类标签；
 *   2. 「已拼 6 / 10 份」+ 进度条 + 右侧「还差 4 份」（**催单**信息，品牌色加粗；
 *      满员时改成「已拼满」）；
 *   3. 单价与合计（凑单要看总额）；
 *   4. 截止（临期换醒目样式、已截止划线）+ 自提点 + 发起人。
 */
function GroupBuyCard({ item }: { item: GroupBuySummary }) {
  const full = item.remainingSlots === 0
  const deadlineClass =
    'kdy-gb-card__deadline' +
    (item.deadlinePassed ? ' is-passed' : item.deadlineUrgent ? ' is-urgent' : '')

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
          <Text className='kdy-gb-card__place'>自提 {item.pickupPlace}</Text>
        </View>

        <View className='kdy-gb-card__row'>
          <Text className='kdy-gb-card__progress'>
            已拼 {item.joinedQuantity} / {item.targetCount} 份
          </Text>
          <Text className={full ? 'kdy-gb-card__short is-full' : 'kdy-gb-card__short'}>
            {full ? '已拼满' : `还差 ${item.remainingSlots} 份`}
          </Text>
        </View>

        <KdyProgress className='kdy-gb-card__bar' percent={item.progressPercent} tone={full ? 'success' : 'brand'} />

        <View className='kdy-gb-card__foot'>
          <Text className={deadlineClass}>{item.deadlineLabel}</Text>
          <Text className='kdy-gb-card__price'>
            ¥{fenToYuan(item.priceFen)}/份 · 合计 ¥{fenToYuan(item.totalAmountFen)}
          </Text>
        </View>

        <Text className='kdy-gb-card__initiator'>发起人 {item.initiatorName}</Text>
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
        subtitle='同学间自发拼单，平台不参与资金往来。'
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

      {state.status === 'loading' && <KdyListSkeleton />}

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
        第三方非官方平台 · 与上海科技大学官方系统无关。拼单为同学间自愿拼团，平台不参与资金往来。
      </Text>
    </View>
  )
}
