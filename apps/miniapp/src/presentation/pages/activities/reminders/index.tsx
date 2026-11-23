import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useCallback, useState } from 'react'

import { getContainer } from '../../../../app/container'
import { activityDetailPath, activityListPath } from '../../../../app/routes'
import type { ActivityReminderWithActivity } from '../../../../domain/models/activity'
import { navigateTo } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyListSkeleton, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { buildReminderView, type ReminderRow } from './reminderView'
import './index.scss'

/**
 * 我的提醒（站内信）。
 *
 * 这是**应用内**提醒状态：没有真实模板 ID，所以微信订阅消息不出现为可选项，
 * 页面上明确写「尚未接通」。提醒到点后由服务端派发站内信，
 * 这里只展示 pending / sent / failed 的真实状态。
 */

const STATUS_TONES: Readonly<Record<string, 'info' | 'success' | 'danger' | 'neutral'>> = {
  pending: 'info',
  sending: 'info',
  sent: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

function ReminderCard({
  row,
  deleting,
  disabled,
  onDelete,
}: {
  row: ReminderRow
  deleting: boolean
  disabled: boolean
  onDelete: () => void
}) {
  return (
    <KdyCard elevated={false}>
      <View className='kdy-reminders__card'>
        <View className='kdy-reminders__head'>
          <Text className='kdy-reminders__title'>{row.activityTitle}</Text>
          <KdyTag tone={STATUS_TONES[row.status] ?? 'neutral'}>{row.statusLabel}</KdyTag>
        </View>
        <Text className='kdy-reminders__kind'>
          {row.kindLabel} · {row.whenLabel}
        </Text>
        <View className='kdy-reminders__foot'>
          <KdyTag tone={row.channel === 'inapp' ? 'neutral' : 'warning'}>{row.channelLabel}</KdyTag>
          <View className='kdy-reminders__actions'>
            <KdyButton
              size='sm'
              variant='secondary'
              onClick={() => void navigateTo(activityDetailPath(row.activityId))}
            >
              查看活动
            </KdyButton>
            <KdyButton
              size='sm'
              variant='ghost'
              loading={deleting}
              disabled={disabled}
              onClick={onDelete}
            >
              删除
            </KdyButton>
          </View>
        </View>
      </View>
    </KdyCard>
  )
}

export default function ActivityRemindersPage() {
  const activities = getContainer().useCases.activities
  const [items, setItems] = useState<ActivityReminderWithActivity[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const result = await activities.reminders()
    if (!result.ok) {
      setStatus('error')
      setError(result.error.message)
      return
    }
    setItems(result.value)
    setStatus('ready')
    setError(null)
  }, [activities])

  useDidShow(() => {
    void load()
  })

  async function handleDelete(id: string): Promise<void> {
    if (deletingId !== null) return
    const confirmed = await Taro.showModal({
      title: '删除这条提醒？',
      content: '删除后不会再收到这条站内信提醒。',
      confirmText: '删除',
      confirmColor: '#d94f4f',
    })
    if (!confirmed.confirm) return

    setDeletingId(id)
    setError(null)
    try {
      const result = await activities.deleteReminder(id)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setNotice('提醒已删除。')
      await load()
    } finally {
      setDeletingId(null)
    }
  }

  const view = buildReminderView(items, new Date())

  return (
    <View className='kdy-page kdy-reminders'>
      <KdyHeading
        title='我的提醒'
        subtitle='默认在报名截止前 24 小时、开始前 1 小时提醒；只发站内信。'
      />

      <Text className='kdy-reminders__notice'>{view.notice}</Text>

      {notice !== null ? (
        <View className='kdy-reminders__ok' aria-label={notice}>
          {notice}
        </View>
      ) : null}
      {error !== null ? (
        <View className='kdy-reminders__error' aria-label={error}>
          {error}
        </View>
      ) : null}

      {status === 'loading' ? <KdyListSkeleton rows={3} /> : null}

      {status === 'error' ? (
        <KdyEmpty
          mode='error'
          title='提醒加载失败'
          description={error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => void load()}
        />
      ) : null}

      {status === 'ready' && items.length === 0 ? (
        <KdyEmpty
          title='还没有提醒'
          description='确认活动后会自动安排报名截止前 24 小时与开始前 1 小时的站内信提醒。'
          actionText='去看活动'
          onAction={() => void navigateTo(activityListPath())}
        />
      ) : null}

      {view.pending.length > 0 ? (
        <View className='kdy-reminders__section'>
          <Text className='kdy-reminders__section-title'>待发送</Text>
          <View className='kdy-reminders__list' aria-role='list'>
            {view.pending.map((row) => (
              <View key={row.id} aria-role='listitem'>
                <ReminderCard
                  row={row}
                  deleting={deletingId === row.id}
                  disabled={deletingId !== null}
                  onDelete={() => void handleDelete(row.id)}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {view.done.length > 0 ? (
        <View className='kdy-reminders__section'>
          <Text className='kdy-reminders__section-title'>已结束</Text>
          <View className='kdy-reminders__list' aria-role='list'>
            {view.done.map((row) => (
              <View key={row.id} aria-role='listitem'>
                <ReminderCard
                  row={row}
                  deleting={deletingId === row.id}
                  disabled={deletingId !== null}
                  onDelete={() => void handleDelete(row.id)}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <Text className='kdy-disclaimer'>
        微信订阅消息尚未接通（没有真实模板 ID）；当前提醒只出现在站内，不会发微信推送。
      </Text>
    </View>
  )
}
