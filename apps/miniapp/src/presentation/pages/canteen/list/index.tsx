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
  KdyProgress,
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

/** 三条营养条的定义（顺序固定：蛋白 / 脂肪 / 碳水） */
const MACRO_ROWS = [
  { key: 'protein', label: '蛋白', tone: 'brand' },
  { key: 'fat', label: '脂肪', tone: 'warning' },
  { key: 'carb', label: '碳水', tone: 'success' },
] as const

/**
 * 营养卡 —— 食堂模块的**定制化**外观：把「蛋白 32g · 脂肪 28g · 碳水 96g」
 * 这句谁也不会读的文字，变成三条**一眼能比**的比例条。
 *
 * 三条条的长度是**克数占比**（口径写在卡片底部，不做热量换算 —— 见
 * `domain/models/canteen.ts` 的 `macroShares`）。克数原值同时给出，
 * 因为"占比好看"和"够不够吃"是两件事。
 */
function CanteenCard({ dish }: { dish: CanteenDishSummary }) {
  const grams: Readonly<Record<(typeof MACRO_ROWS)[number]['key'], number>> = {
    protein: dish.proteinG,
    fat: dish.fatG,
    carb: dish.carbG,
  }

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

        <View className='kdy-canteen-card__meta'>
          <Text className='kdy-canteen-card__canteen'>{dish.canteen}</Text>
          <Text className='kdy-canteen-card__price'>{dish.priceLabel}</Text>
        </View>

        <View className='kdy-canteen-card__calories'>
          <Text className='kdy-canteen-card__calories-value'>{dish.caloriesKcal}</Text>
          <Text className='kdy-canteen-card__calories-unit'>千卡</Text>
        </View>

        <View className='kdy-canteen-card__macros'>
          {MACRO_ROWS.map((row) => (
            <View className='kdy-canteen-card__macro-row' key={row.key}>
              <Text className='kdy-canteen-card__macro-key'>{row.label}</Text>
              <KdyProgress
                className='kdy-canteen-card__macro-bar'
                percent={dish.macroShares[row.key]}
                tone={row.tone}
              />
              <Text className='kdy-canteen-card__macro-value'>{grams[row.key]}g</Text>
            </View>
          ))}
        </View>

        <Text className='kdy-canteen-card__foot'>
          按克数占比 · {dish.createdLabel}录入
        </Text>
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
        subtitle='热量由同学估算，仅供参考。'
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
        {CANTEEN_DISCLAIMER}。第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
