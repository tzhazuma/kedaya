import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useEffect } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, facilityDetailPath } from '../../../../app/routes'
import {
  FACILITY_STATUS_LABELS,
  FACILITY_STATUS_TONES,
  durationMinutes,
  formatFeeFen,
} from '../../../../domain/models/facility'
import type { FacilityBookingSummary } from '../../../../domain/models/facility'
import { navigateTo } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyListSkeleton, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 场馆预约 · 列表页。
 *
 * 契约 §8 启动时序：`useDidShow` → `hydrate()`（同步、秒出缓存）
 * → `load()`（后台刷新，失败静默降级）。
 *
 * 卡片的信息顺序由「怎么决定去不去」决定：
 *   1. **场馆名 + 种类**（我约的是哪儿、什么项目）
 *   2. **时段 + 时长**（能不能赶得上、占多久）
 *   3. **费用 + 状态**（免费还是收费、还能不能取消）
 * `isMine` 的条目额外标「我的预约」，因为它决定点进去有没有取消按钮。
 */
function FacilityCard({ item }: { item: FacilityBookingSummary }) {
  const minutes = durationMinutes(item)
  const tone = FACILITY_STATUS_TONES[item.status] ?? 'neutral'
  const hasName = item.facilityName !== null && item.facilityName.length > 0

  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(facilityDetailPath(item.id))
      }}
    >
      <View className='kdy-facility-card'>
        <View className='kdy-facility-card__head'>
          <Text className='kdy-facility-card__title'>
            {hasName ? (item.facilityName as string) : item.kind}
          </Text>
          <KdyTag tone={tone}>{FACILITY_STATUS_LABELS[item.status] ?? item.status}</KdyTag>
        </View>

        {hasName ? <Text className='kdy-facility-card__kind'>{item.kind}</Text> : null}

        <View className='kdy-facility-card__meta'>
          <Text className='kdy-facility-card__time'>
            {item.startsAt.slice(5, 16).replace('T', ' ')} — {item.endsAt.slice(11, 16)}
          </Text>
          <Text className='kdy-facility-card__duration'>{minutes} 分钟</Text>
        </View>

        <View className='kdy-facility-card__foot'>
          <Text className='kdy-facility-card__fee'>{formatFeeFen(item.feeFen)}</Text>
          {item.isMine ? <Text className='kdy-facility-card__mine'>我的预约</Text> : null}
        </View>
      </View>
    </KdyCard>
  )
}

export default function FacilityListPage() {
  const { facility } = getContainer().useCases
  const state = useStore(facility.list)

  useEffect(() => {
    // 同步出缓存 → 后台刷新（失败静默降级，页面不闪）
    facility.list.hydrate()
    void facility.list.load()
  }, [facility])

  useDidShow(() => {
    // 从创建页返回时要能看到新条目
    void facility.list.load()
  })

  usePullDownRefresh(() => {
    void facility.list.load().finally(() => {
      void Taro.stopPullDownRefresh()
    })
  })

  useReachBottom(() => {
    if (state.nextCursor !== null && !state.loadingMore) void facility.list.loadMore()
  })

  return (
    <View className='kdy-page kdy-facility'>
      <KdyHeading title='场馆预约' subtitle='体育馆、健身房、会议室等校内场馆的预约与取消。' />

      <View className='kdy-facility__actions'>
        <KdyButton
          size='md'
          block
          onClick={() => {
            void navigateTo(PAGE_PATHS.facilityCreate)
          }}
        >
          发起预约
        </KdyButton>
      </View>

      {state.status === 'loading' && state.items.length === 0 ? <KdyListSkeleton rows={4} /> : null}

      {state.status === 'error' ? (
        <KdyEmpty
          title='加载失败'
          description={state.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => {
            void facility.list.load()
          }}
        />
      ) : null}

      {state.status === 'empty' ? (
        <KdyEmpty title='还没有预约' description='点上面的「发起预约」挑个时段吧。' />
      ) : null}

      <View className='kdy-facility__list'>
        {state.items.map((item) => (
          <FacilityCard key={item.id} item={item} />
        ))}
      </View>

      {state.loadingMore ? <Text className='kdy-facility__more'>加载中…</Text> : null}
      {state.nextCursor === null && state.items.length > 0 ? (
        <Text className='kdy-facility__more'>没有更多了</Text>
      ) : null}

      <Text className='kdy-disclaimer'>场馆实际开放时间以场馆管理方为准。</Text>
    </View>
  )
}
