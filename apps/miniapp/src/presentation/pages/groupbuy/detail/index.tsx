import { Text, View } from '@tarojs/components'
import { useDidShow, useRouter, useShareAppMessage } from '@tarojs/taro'
import Progress from '@taroify/core/progress'
import '@taroify/core/progress/style'
import { fenToYuan } from '@kedaya/shared'
import { useEffect, useState } from 'react'

import { getContainer } from '../../../../app/container'
import {
  PAGE_PATHS,
  groupBuyDetailPath,
  readIdParam,
} from '../../../../app/routes'
import { navigateTo, toast } from '../../../../platform/navigation'
import { openLocation } from '../../../../platform/map'
import { shareToFriend } from '../../../../platform/share'
import {
  SUBSCRIBE_TEMPLATES,
  requestSubscribeMessage,
} from '../../../../platform/subscribeMessage'
import { KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'
import { KdyHeading } from '../../../components/KdyHeading'

/**
 * 拼单详情页 —— 垂直切片的读 + 写。
 *
 * 动作覆盖：参团（写）、分享（微信特有 open-type）、复制链接（降级）、
 * 打开地图（微信原生 / H5 URI 降级）、订阅成团提醒（微信特有）。
 *
 * 三态：loading / error（带重试）/ ready。
 */

/** 上科大地标坐标（骨架占位；真实数据应由后端随拼单一起下发） */
const CAMPUS_POINT = {
  latitude: 31.179_431,
  longitude: 121.592_605,
  name: '上海科技大学',
  address: '上海市浦东新区华夏中路 393 号',
} as const

export default function GroupBuyDetailPage() {
  const router = useRouter()
  const id = readIdParam(router.params as Record<string, string | undefined>)

  const container = getContainer()
  const detail = container.useCases.groupBuyDetail
  const join = container.useCases.joinGroupBuy
  const state = useStore(detail)
  const [joining, setJoining] = useState(false)

  useDidShow(() => {
    if (id === null) return
    detail.hydrate(id)
    void detail.load(id)
  })

  useEffect(() => {
    if (id === null) return
    detail.hydrate(id)
    void detail.load(id)
  }, [detail, id])

  useShareAppMessage(() => ({
    title: state.summary?.title ?? '可达鸭 · 拼单',
    path: id === null ? PAGE_PATHS.groupBuyList : groupBuyDetailPath(id),
  }))

  async function handleJoin(): Promise<void> {
    if (id === null) return
    setJoining(true)
    try {
      const result = await join.join(id, 1)
      if (!result.ok) {
        toast(result.error.message)
        if (result.error.code === 'UNAUTHENTICATED') {
          void navigateTo(PAGE_PATHS.profile)
        }
        return
      }

      // 参团成功后就地更新，避免整页重拉
      detail.applyUpdate(result.value.groupBuy)
      toast('参团成功', 'success')

      // 微信特有：一次性订阅「成团提醒」；H5 会返回 UNSUPPORTED，静默忽略
      const subscribed = await requestSubscribeMessage([
        SUBSCRIBE_TEMPLATES.groupBuyFull,
      ])
      if (!subscribed.ok && subscribed.error.code === 'REJECTED') {
        toast('未开启成团提醒，可在小程序设置里重新打开')
      }
    } finally {
      setJoining(false)
    }
  }

  async function handleShare(): Promise<void> {
    if (state.summary === null) return
    const result = await shareToFriend({
      title: state.summary.title,
      path: id === null ? PAGE_PATHS.groupBuyList : groupBuyDetailPath(id),
    })
    if (result.ok) {
      if (result.value === 'clipboard') toast('链接已复制', 'success')
      if (result.value === 'weapp-menu') toast('请点右上角「···」转发给好友')
      return
    }
    toast(result.error.message)
  }

  async function handleOpenMap(): Promise<void> {
    const place = state.summary?.pickupPlace ?? CAMPUS_POINT.name
    const result = await openLocation({ ...CAMPUS_POINT, name: place })
    if (result.ok) {
      if (result.value === 'clipboard') toast('坐标已复制', 'success')
      return
    }
    toast(result.error.message)
  }

  if (state.status === 'loading') {
    return (
      <View className='kdy-page kdy-gb-detail'>
        <KdyEmpty mode='loading' description='正在加载拼单详情' />
      </View>
    )
  }

  if (state.status === 'error' || state.summary === null) {
    return (
      <View className='kdy-page kdy-gb-detail'>
        <KdyEmpty
          mode='error'
          description={state.error ?? '拼单不存在或已被下架'}
          actionText='重试'
          onAction={() => {
            if (id !== null) void detail.load(id)
          }}
        />
      </View>
    )
  }

  const summary = state.summary
  const groupBuy = state.groupBuy

  return (
    <View className='kdy-page kdy-gb-detail'>
      <KdyHeading
        title='好物一起，快乐加倍'
        subtitle='确认拼单信息后再出发。'
      />
      <KdyCard
        title={summary.title}
        tone='pink'
        extra={
          <KdyTag tone={summary.joinable ? 'brand' : 'neutral'}>
            {summary.statusLabel}
          </KdyTag>
        }
      >
        <View className='kdy-gb-detail__meta'>
          <KdyTag tone='neutral'>{summary.categoryLabel}</KdyTag>
        </View>

        <View className='kdy-gb-detail__price-row'>
          <Text className='kdy-gb-detail__price'>
            ¥{fenToYuan(summary.priceFen)}
          </Text>
          <Text className='kdy-gb-detail__price-unit'>/ 份</Text>
          <Text className='kdy-gb-detail__total'>
            当前合计 ¥{fenToYuan(summary.totalAmountFen)}
          </Text>
        </View>

        <Progress
          className='kdy-gb-detail__bar'
          percent={summary.progressPercent}
          label={false}
        />
        <Text className='kdy-gb-detail__progress-text'>
          {summary.joinedQuantity}/{summary.targetCount} 份（
          {summary.progressPercent}%）· 还差 {summary.remainingSlots} 份 ·{' '}
          {summary.deadlineLabel}
        </Text>

        <View className='kdy-gb-detail__kv'>
          <Text className='kdy-gb-detail__k'>取货地点</Text>
          <Text className='kdy-gb-detail__v'>{summary.pickupPlace}</Text>
        </View>
        <View className='kdy-gb-detail__kv'>
          <Text className='kdy-gb-detail__k'>发起人</Text>
          <Text className='kdy-gb-detail__v'>{summary.initiatorName}</Text>
        </View>
        <View className='kdy-gb-detail__kv'>
          <Text className='kdy-gb-detail__k'>截止时间</Text>
          <Text className='kdy-gb-detail__v'>{summary.deadline}</Text>
        </View>

        {groupBuy !== null && (
          <Text className='kdy-gb-detail__description'>
            {groupBuy.description}
          </Text>
        )}
      </KdyCard>

      <KdyCard title='已参团同学' elevated={false}>
        {groupBuy === null || groupBuy.participants.length === 0 ? (
          <Text className='kdy-gb-detail__empty-participants'>
            还没有人参团，你可以是第一个
          </Text>
        ) : (
          <View>
            {groupBuy.participants.map((participant) => (
              <View
                key={`${participant.id}-${participant.joinedAt}`}
                className='kdy-gb-detail__participant'
              >
                <Text className='kdy-gb-detail__participant-name'>
                  {participant.anonymous ? '匿名同学' : participant.displayName}
                </Text>
                <Text className='kdy-gb-detail__participant-qty'>
                  × {participant.quantity}
                </Text>
              </View>
            ))}
          </View>
        )}
      </KdyCard>

      <View className='kdy-gb-detail__actions'>
        <KdyButton
          block
          size='lg'
          variant='primary'
          loading={joining}
          disabled={!summary.joinable}
          onClick={() => {
            void handleJoin()
          }}
        >
          {summary.joinable ? '参团' : summary.statusLabel}
        </KdyButton>

        <View className='kdy-gb-detail__actions-row'>
          {/* 微信：必须由用户点击 open-type="share" 才会触发转发 */}
          <KdyButton size='sm' variant='ghost' openType='share'>
            分享给好友
          </KdyButton>
          <KdyButton
            size='sm'
            variant='ghost'
            onClick={() => {
              void handleShare()
            }}
          >
            复制链接
          </KdyButton>
          <KdyButton
            size='sm'
            variant='ghost'
            onClick={() => {
              void handleOpenMap()
            }}
          >
            查看地图
          </KdyButton>
        </View>
      </View>

      <Text className='kdy-disclaimer'>
        第三方非官方平台。拼单为同学间自发组织，平台不代收货款。
      </Text>
    </View>
  )
}
