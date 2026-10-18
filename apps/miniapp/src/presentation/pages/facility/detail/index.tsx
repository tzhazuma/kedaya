import { Text, View } from '@tarojs/components'
import { useRouter } from '@tarojs/taro'
import { useEffect, useState } from 'react'

import { getContainer } from '../../../../app/container'
import {
  FACILITY_STATUS_LABELS,
  FACILITY_STATUS_TONES,
  durationMinutes,
  formatFeeFen,
} from '../../../../domain/models/facility'
import type { FacilityBooking } from '../../../../domain/models/facility'
import { navigateBack, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyListSkeleton, KdyTag } from '../../../components'
import { useStore } from '../../../hooks'
import { KdyHeading } from '../../../components/KdyHeading'
import './index.scss'

/**
 * 场馆预约 · 详情页。
 *
 * 取消按钮的显示条件**只从用例层取**（`facility.canCancel`），
 * 页面不自己写 `status === 'booked'` —— 否则服务端改了状态机，
 * 页面会继续显示一个点了必然失败的按钮。
 */
export default function FacilityDetailPage() {
  const router = useRouter()
  const id = router.params.id ?? ''
  const { facility, session } = getContainer().useCases
  // 订阅登录态：登录/登出后取消按钮要立刻出现/消失
  const sessionSnapshot = useStore(session)

  const [booking, setBooking] = useState<FacilityBooking | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (id.length === 0) {
      setStatus('error')
      setMessage('缺少预约 id')
      return
    }
    void facility.detail(id).then((result) => {
      if (!result.ok) {
        setStatus('error')
        setMessage(result.error.message)
        return
      }
      setBooking(result.value)
      setStatus('ready')
    })
  }, [facility, id])

  async function handleCancel(): Promise<void> {
    if (booking === null || cancelling) return
    setCancelling(true)
    const result = await facility.cancel(booking.id)
    setCancelling(false)

    if (!result.ok) {
      setMessage(result.error.message)
      toast(result.error.message, 'error')
      return
    }
    setBooking(result.value)
    toast('已取消预约', 'success')
  }

  if (status === 'loading') {
    return (
      <View className='kdy-page kdy-facility'>
        <KdyListSkeleton rows={3} />
      </View>
    )
  }

  if (status === 'error' || booking === null) {
    return (
      <View className='kdy-page kdy-facility'>
        <KdyEmpty
          title='打不开这条预约'
          description={message.length > 0 ? message : '它可能已被删除'}
          actionText='返回'
          onAction={() => void navigateBack()}
        />
      </View>
    )
  }

  // 未登录时 profile 为 null —— 取消按钮自然不显示
  const currentUserId = sessionSnapshot?.profile?.id ?? null
  const cancellable = facility.canCancel(booking, currentUserId)
  const tone = FACILITY_STATUS_TONES[booking.status] ?? 'neutral'

  return (
    <View className='kdy-page kdy-facility'>
      <KdyHeading title={booking.kind} subtitle={booking.facilityName ?? '未填写场馆名称'} />

      <KdyCard tone='milk' elevated>
        <View className='kdy-facility-detail__head'>
          <Text className='kdy-facility-detail__label'>状态</Text>
          <KdyTag tone={tone}>{FACILITY_STATUS_LABELS[booking.status] ?? booking.status}</KdyTag>
        </View>

        <View className='kdy-facility-detail__row'>
          <Text className='kdy-facility-detail__label'>时段</Text>
          <Text className='kdy-facility-detail__value'>
            {booking.startsAt.slice(0, 16).replace('T', ' ')} — {booking.endsAt.slice(11, 16)}
          </Text>
        </View>

        <View className='kdy-facility-detail__row'>
          <Text className='kdy-facility-detail__label'>时长</Text>
          <Text className='kdy-facility-detail__value'>{durationMinutes(booking)} 分钟</Text>
        </View>

        <View className='kdy-facility-detail__row'>
          <Text className='kdy-facility-detail__label'>费用</Text>
          <Text className='kdy-facility-detail__value'>{formatFeeFen(booking.feeFen)}</Text>
        </View>

        {message.length > 0 && <Text className='kdy-facility-detail__error'>{message}</Text>}

        {cancellable ? (
          <View className='kdy-facility-detail__actions'>
            <KdyButton variant='secondary' block loading={cancelling} onClick={() => void handleCancel()}>
              取消预约
            </KdyButton>
          </View>
        ) : null}
      </KdyCard>

      <Text className='kdy-disclaimer'>场馆实际开放时间以场馆管理方为准。</Text>
    </View>
  )
}
