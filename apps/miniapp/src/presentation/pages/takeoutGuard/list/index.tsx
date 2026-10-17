import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, takeoutGuardDetailPath } from '../../../../app/routes'
import {
  TAKEOUT_GUARD_NOTICE,
  TAKEOUT_GUARD_STATUS_LABELS,
  TAKEOUT_GUARD_STATUSES,
} from '../../../../domain/models/takeoutGuard'
import type {
  TakeoutGuardReportSummary,
  TakeoutGuardStatus,
} from '../../../../domain/models/takeoutGuard'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyListSkeleton, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 偷外卖列表页 —— **「我的记录」，不是公开举报墙**。
 *
 * 后端 `GET /takeout-guard/items` 强制 `reporterId = 登录主体`：这里没有 `mine`
 * 开关，也没有关键词 / 订单号搜索。任何跨记录的检索都能把一条记录与具体的人对应起来，
 * 而本模块的产品定位是「把我的外卖被拿错经过记清楚 + 需要时请平台协助沟通」，
 * 不是「公审谁偷了外卖」。因此卡片只显示**订单号后四位**，完整订单号留在详情页（仅本人可见）。
 *
 * 未登录时**不发注定 401 的请求**：直接给登录引导（`navigateTo(PAGE_PATHS.authLogin)`），
 * 不拿一份假数据糊弄过去。
 */

const ALL_STATUS = 'all'
type StatusFilter = TakeoutGuardStatus | typeof ALL_STATUS

const STATUS_FILTERS: readonly StatusFilter[] = [ALL_STATUS, ...TAKEOUT_GUARD_STATUSES]

function statusTone(status: TakeoutGuardStatus): KdyTagTone {
  if (status === 'resolved') return 'success'
  if (status === 'escalated') return 'brand'
  return 'warning'
}

function TakeoutGuardCard({ item }: { item: TakeoutGuardReportSummary }) {
  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(takeoutGuardDetailPath(item.id))
      }}
    >
      <View className='kdy-tg-card'>
        <View className='kdy-tg-card__head'>
          <Text className='kdy-tg-card__place'>{item.place}</Text>
          <KdyTag tone={statusTone(item.status)}>{item.statusLabel}</KdyTag>
        </View>
        {item.detailPreview === '' ? null : (
          <Text className='kdy-tg-card__preview'>{item.detailPreview}</Text>
        )}
        <View className='kdy-tg-card__meta'>
          <Text className='kdy-tg-card__meta-item'>发生 {item.happenedLabel}</Text>
          <Text className='kdy-tg-card__meta-item'>订单号后四位 {item.orderNoTail}</Text>
        </View>
        {item.hasEvidence ? <Text className='kdy-tg-card__badge'>已附证据图</Text> : null}
      </View>
    </KdyCard>
  )
}

export default function TakeoutGuardListPage() {
  const container = getContainer()
  const takeoutGuard = container.useCases.takeoutGuard
  const state = useStore(takeoutGuard.list)
  const session = useStore(container.useCases.session)
  const loggedIn = session.tokens !== null

  const filters = state.query as { status?: TakeoutGuardStatus }

  function refresh(patch: { status?: TakeoutGuardStatus } = {}): void {
    void takeoutGuard.list.load(patch)
  }

  useDidShow(() => {
    takeoutGuard.list.hydrate()
    // 未登录时不请求：既省一次注定 401 的往返，也避免把错误态当成"没有记录"
    if (container.useCases.session.getSnapshot().tokens === null) return
    refresh()
  })

  /**
   * 下拉刷新：保留当前筛选，只把游标重置回第一页；
   * 转圈必须等请求真的结束再收（早收会让用户以为刷完了）。
   */
  usePullDownRefresh(() => {
    if (container.useCases.session.getSnapshot().tokens === null) {
      Taro.stopPullDownRefresh()
      return
    }
    void takeoutGuard.list.load().then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    void takeoutGuard.list.loadMore()
  })

  function requireLogin(next: string): boolean {
    if (container.useCases.session.getSnapshot().tokens !== null) return true
    toast('请先登录')
    void navigateTo(next)
    return false
  }

  if (!loggedIn) {
    return (
      <View className='kdy-page kdy-tg'>
        <KdyHeading
          title='外卖被拿错'
          subtitle='把经过记下来，需要时再请平台或辅导员协助沟通。'
          eyebrow='KEDAYA · 偷外卖'
        />
        <Text className='kdy-tg__notice'>{TAKEOUT_GUARD_NOTICE}</Text>
        <KdyEmpty
          mode='empty'
          title='登录后查看你的记录'
          description='这个页面只展示你自己登记的外卖被拿错经过，登录后才能查看与登记。'
          actionText='去登录'
          onAction={() => {
            void navigateTo(PAGE_PATHS.authLogin)
          }}
        />
        <Text className='kdy-disclaimer'>
          可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。平台不判定谁对谁错，也不代你追责。
        </Text>
      </View>
    )
  }

  return (
    <View className='kdy-page kdy-tg'>
      <KdyHeading
        title='外卖被拿错'
        subtitle='只记录你自己的经历；把经过说清楚，需要时再请平台协助沟通。'
        eyebrow='KEDAYA · 偷外卖'
      />

      <Text className='kdy-tg__notice'>{TAKEOUT_GUARD_NOTICE}</Text>

      <View className='kdy-tg__filters'>
        {STATUS_FILTERS.map((status) => (
          <KdyChip
            key={status}
            active={(filters.status ?? ALL_STATUS) === status}
            onClick={() => refresh({ status: status === ALL_STATUS ? undefined : status })}
          >
            {status === ALL_STATUS ? '全部' : TAKEOUT_GUARD_STATUS_LABELS[status]}
          </KdyChip>
        ))}
      </View>

      {state.fromCache && state.status === 'ready' && (
        <Text className='kdy-tg__cache-hint'>正在后台刷新…</Text>
      )}

      {state.status === 'loading' && <KdyListSkeleton />}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          title='还没有记录'
          description={
            filters.status === undefined
              ? '外卖被拿错时，把取餐点、时间和经过记下来，需要时再请平台协助沟通。'
              : '这个状态下还没有记录，换个筛选条件看看。'
          }
          actionText='记录一次'
          onAction={() => {
            if (requireLogin(PAGE_PATHS.authLogin)) void navigateTo(PAGE_PATHS.takeoutGuardCreate)
          }}
        />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          title='没能拿到你的记录'
          description={state.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => refresh()}
        />
      )}

      {state.items.map((item) => (
        <TakeoutGuardCard key={item.id} item={item} />
      ))}

      {state.nextCursor !== null && state.status === 'ready' && (
        <View className='kdy-tg__more'>
          <KdyButton
            size='sm'
            variant='ghost'
            loading={state.loadingMore}
            onClick={() => {
              void takeoutGuard.list.loadMore()
            }}
          >
            加载更多
          </KdyButton>
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-tg__inline-error'>{state.error}</Text>
      )}

      <View className='kdy-tg__fab'>
        <KdyButton
          onClick={() => {
            if (requireLogin(PAGE_PATHS.authLogin)) void navigateTo(PAGE_PATHS.takeoutGuardCreate)
          }}
        >
          记录一次
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。平台不判定谁对谁错，请勿公开点名或在群里扩散他人信息。
      </Text>
    </View>
  )
}
