import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, canteenDetailPath } from '../../../../app/routes'
import { CANTEEN_DISCLAIMER, CANTEEN_OPTIONS } from '../../../../domain/models/canteen'
import type { CalorieLevel, CanteenDishSummary } from '../../../../domain/models/canteen'
import { navigateTo } from '../../../../platform/navigation'
import {
  KdyButton,
  KdyCard,
  KdyChip,
  KdyEmpty,
  KdyField,
  KdyListSkeleton,
  KdyTag,
} from '../../../components'
import type { KdyTagTone } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 食堂营养列表页。
 *
 * 契约 §8 启动时序在这里落地：`useDidShow` → `hydrate()`（同步、秒出缓存）
 * → `load()`（后台刷新，失败静默降级）。
 *
 * 筛选维度与后端一一对应：食堂（`canteen` 精确）+ 菜名关键词（`q` 模糊），
 * 由 `canteen.controller.ts` 的 `listQuerySchema` 白名单校验；排序固定**最新在前**。
 * 食堂 chip 直接取自 `CANTEEN_OPTIONS`（单一真相），页面不另写一份。
 */

const CALORIE_TONES: Readonly<Record<CalorieLevel, KdyTagTone>> = {
  light: 'success',
  moderate: 'info',
  heavy: 'warning',
}

function CanteenCard({ dish }: { dish: CanteenDishSummary }) {
  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(canteenDetailPath(dish.id))
      }}
    >
      <View className='kdy-canteen-card'>
        <View className='kdy-canteen-card__head'>
          <Text className='kdy-canteen-card__name'>{dish.name}</Text>
          <KdyTag tone={CALORIE_TONES[dish.calorieLevel]}>{dish.calorieLevelLabel}</KdyTag>
        </View>
        <Text className='kdy-canteen-card__meta'>
          {dish.canteen} · {dish.caloriesLabel}
        </Text>
        <Text className='kdy-canteen-card__macro'>{dish.macroSummary}</Text>
        <View className='kdy-canteen-card__foot'>
          <Text className='kdy-canteen-card__price'>{dish.priceLabel}</Text>
          <Text className='kdy-canteen-card__time'>{dish.createdLabel}录入</Text>
        </View>
      </View>
    </KdyCard>
  )
}

export default function CanteenListPage() {
  const container = getContainer()
  const canteen = container.useCases.canteen
  const state = useStore(canteen.list)
  const [keyword, setKeyword] = useState('')

  const filters = state.query as { canteen?: string; q?: string }

  function refresh(patch: Parameters<typeof canteen.list.load>[0] = {}): void {
    void canteen.list.load({ cursor: null, ...patch })
  }

  useDidShow(() => {
    canteen.list.hydrate()
    refresh()
  })

  /**
   * 下拉刷新：保留当前筛选条件，只把游标重置回第一页。
   * 转圈必须等请求真的结束再收 —— 早收会让用户以为刷完了，其实还没到。
   */
  usePullDownRefresh(() => {
    void canteen.list.load({ cursor: null }).then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    void canteen.list.loadMore()
  })

  return (
    <View className='kdy-page kdy-canteen'>
      <KdyHeading
        title='食堂营养'
        subtitle='看菜品的估算热量与营养，帮助你决定今天吃什么。'
        eyebrow='KEDAYA · 食堂营养'
      />

      <View className='kdy-canteen__toolbar'>
        <View className='kdy-canteen__search'>
          <KdyField
            value={keyword}
            onChange={setKeyword}
            placeholder='搜索菜品名称'
            maxLength={60}
          />
        </View>
        <KdyButton
          size='sm'
          onClick={() => {
            refresh({ q: keyword.trim() === '' ? undefined : keyword.trim() })
          }}
        >
          搜索
        </KdyButton>
      </View>

      <View className='kdy-canteen__chips'>
        <KdyChip
          active={filters.canteen === undefined}
          onClick={() => refresh({ canteen: undefined })}
        >
          全部食堂
        </KdyChip>
        {CANTEEN_OPTIONS.map((name) => (
          <KdyChip
            key={name}
            active={filters.canteen === name}
            onClick={() => refresh({ canteen: name })}
          >
            {name}
          </KdyChip>
        ))}
      </View>

      {state.fromCache && state.status === 'ready' && (
        <Text className='kdy-canteen__cache-hint'>正在后台刷新…</Text>
      )}

      {state.status === 'loading' && <KdyListSkeleton />}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          title='还没有符合条件的菜品'
          description='换个食堂或关键词，或者把你知道的菜品补充进来。'
          actionText='补充菜品'
          onAction={() => {
            void navigateTo(PAGE_PATHS.canteenCreate)
          }}
        />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          title='没能拿到菜品列表'
          description={state.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => refresh()}
        />
      )}

      {state.items.map((dish) => (
        <CanteenCard key={dish.id} dish={dish} />
      ))}

      {state.nextCursor !== null && state.status === 'ready' && (
        <View className='kdy-canteen__more'>
          <KdyButton
            size='sm'
            variant='ghost'
            loading={state.loadingMore}
            onClick={() => {
              void canteen.list.loadMore()
            }}
          >
            加载更多
          </KdyButton>
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-canteen__inline-error'>{state.error}</Text>
      )}

      <View className='kdy-canteen__fab'>
        <KdyButton
          onClick={() => {
            void navigateTo(PAGE_PATHS.canteenCreate)
          }}
        >
          补充菜品
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        {CANTEEN_DISCLAIMER}。可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
