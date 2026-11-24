import { Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useEffect, useState } from 'react'

import { getContainer } from '../../../../app/container'
import { activityListPath, activityRemindersPath } from '../../../../app/routes'
import {
  ACTIVITY_KIND_LABELS,
  ACTIVITY_SOURCE_LABELS,
  ACTIVITY_STATUS_LABELS,
  REMINDER_CHANNEL_LABELS,
  REMINDER_KIND_LABELS,
  formatActivityInstant,
  parseShanghaiDateTime,
  shanghaiDateInput,
  type ActivityItem,
} from '../../../../domain/models/activity'
import { addActivityToPhoneCalendar } from '../../../../platform/calendar'
import { copyText } from '../../../../platform/clipboard'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyListSkeleton, KdyPicker, KdyTag } from '../../../components'
import { KdyField } from '../../../components/KdyField'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import {
  confirmOutcome,
  reminderLoadFromResult,
  reminderLoadFailure,
  reminderLoadSuccess,
  reminderPanelStart,
  type ReminderPanelState,
} from './detailState'
import { buildActivityDetailActions } from './detailViewModel'
import './index.scss'

/**
 * 活动详情。
 *
 * 动作严格按状态机出现：
 *   · candidate：只有「确认加入日程 / 忽略」，**没有**提醒按钮；
 *   · confirmed：可以补设报名 / 开始提醒，也能删已有提醒。
 *
 * 报名截止只有原文（`registrationDeadlineRaw`）时，提醒按钮禁用并说明
 * 「没有确定时刻」—— 不按 23:59 替用户算一个假截止。
 *
 * 所有外链只复制，不用 `web-view`（业务域名未备案会白屏）。
 */

const REMINDER_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: '待发送',
  sending: '发送中',
  sent: '已发送',
  failed: '发送失败',
  cancelled: '已取消',
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className='kdy-activity-detail__row'>
      <Text className='kdy-activity-detail__label'>{label}</Text>
      <Text className='kdy-activity-detail__value'>{value}</Text>
    </View>
  )
}

export default function ActivityDetailPage() {
  const router = useRouter()
  const id = router.params.id ?? ''
  const activities = getContainer().useCases.activities
  const state = useStore(activities.detail)

  const [reminderState, setReminderState] = useState<ReminderPanelState>(() =>
    reminderPanelStart(),
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [calendarBusy, setCalendarBusy] = useState(false)
  const [customDate, setCustomDate] = useState(() => shanghaiDateInput(new Date()))
  const [customTime, setCustomTime] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)

  useEffect(() => {
    if (id === '') return
    void activities.detail.load(id)
    void loadReminders()
  }, [id])

  async function loadReminders(): Promise<void> {
    if (id === '') return
    setReminderState(reminderPanelStart())
    const result = await activities.remindersFor(id)
    setReminderState(reminderLoadFromResult(result))
  }

  async function handleConfirm(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await activities.confirm(id)
      if (!result.ok) {
        setError(result.error.message)
        return
      }

      activities.detail.seed(result.value.item)
      const outcome = confirmOutcome(result.value)

      if (result.value.reminderWarning !== null) {
        setReminderState(reminderLoadFailure(result.value.reminderWarning))
      } else if (outcome.confirmed) {
        setReminderState(reminderLoadSuccess(result.value.reminders))
      } else {
        setReminderState(reminderLoadSuccess([]))
      }

      if (outcome.tone === 'success') {
        setNotice(outcome.message)
      } else {
        setError(outcome.message)
      }
      void activities.list.load()
    } finally {
      setBusy(false)
    }
  }

  async function handleDismiss(): Promise<void> {
    if (busy) return
    const confirmed = await Taro.showModal({
      title: '忽略这条活动？',
      content: '忽略后不会再出现在待确认里，也不会加入日程或建提醒。',
      confirmText: '忽略',
      confirmColor: '#d94f4f',
    })
    if (!confirmed.confirm) return

    setBusy(true)
    setError(null)
    try {
      const result = await activities.dismiss(id)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      activities.detail.seed(result.value)
      setNotice('已忽略这条活动。')
      void activities.list.load()
    } finally {
      setBusy(false)
    }
  }

  async function handleArchive(): Promise<void> {
    if (busy) return
    const confirmed = await Taro.showModal({
      title: '归档这条活动？',
      content: '归档后不再出现在列表里，也不会再提醒；需要时可以恢复。',
      confirmText: '归档',
    })
    if (!confirmed.confirm) return

    setBusy(true)
    setError(null)
    try {
      const result = await activities.archive(id)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      activities.detail.seed(result.value)
      setNotice('已归档。可在列表的「已归档」里找回。')
      void activities.list.load()
    } finally {
      setBusy(false)
    }
  }

  async function handleRestore(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await activities.restore(id)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      activities.detail.seed(result.value)
      setNotice('已恢复为候选活动，确认后才加入日程。')
      void activities.list.load()
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateDefaultReminder(
    kind: 'registration' | 'start',
  ): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await activities.createReminder(id, { kind })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setNotice(
        `${REMINDER_KIND_LABELS[kind]}已安排：${formatActivityInstant(result.value.remindAt, new Date())}`,
      )
      await loadReminders()
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateCustomReminder(): Promise<void> {
    if (busy) return
    if (customDate.trim() === '' || customTime.trim() === '') {
      setCustomError('请选择提醒日期与时间')
      return
    }
    const remindAt = parseShanghaiDateTime(customDate, customTime)
    if (remindAt === null) {
      setCustomError('日期或时间不合法，请重新选择')
      return
    }
    if (Date.parse(remindAt) <= Date.now()) {
      setCustomError('提醒时间必须晚于现在')
      return
    }

    setCustomError(null)
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await activities.createReminder(id, { kind: 'custom', remindAt })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setNotice(`自定义提醒已安排：${formatActivityInstant(result.value.remindAt, new Date())}`)
      setCustomTime('')
      await loadReminders()
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteReminder(reminderId: string): Promise<void> {
    if (deletingId !== null) return
    const confirmed = await Taro.showModal({
      title: '删除这条提醒？',
      content: '删除后不会再收到这条站内信提醒。',
      confirmText: '删除',
      confirmColor: '#d94f4f',
    })
    if (!confirmed.confirm) return

    setDeletingId(reminderId)
    setError(null)
    try {
      const result = await activities.deleteReminder(reminderId)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setNotice('提醒已删除。')
      await loadReminders()
    } finally {
      setDeletingId(null)
    }
  }

  async function handleAddToPhoneCalendar(item: ActivityItem): Promise<void> {
    if (calendarBusy) return
    setCalendarBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await addActivityToPhoneCalendar(item)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setNotice(result.value.message)
    } finally {
      setCalendarBusy(false)
    }
  }

  async function handleCopy(url: string): Promise<void> {
    const result = await copyText(url)
    if (!result.ok) toast(result.error.message, 'error')
  }

  if (id === '') {
    return (
      <View className='kdy-page kdy-activity-detail'>
        <KdyEmpty
          mode='error'
          title='缺少活动 id'
          description='这个页面链接不完整，请从活动列表重新打开。'
          actionText='返回活动列表'
          onAction={() => {
            void navigateTo(activityListPath())
          }}
        />
      </View>
    )
  }

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <View className='kdy-page kdy-activity-detail'>
        <KdyListSkeleton rows={3} />
      </View>
    )
  }

  if (state.status === 'error' || state.data === null) {
    return (
      <View className='kdy-page kdy-activity-detail'>
        <KdyEmpty
          mode='error'
          title='打不开这条活动'
          description={state.error ?? '它可能已被删除'}
          actionText='返回'
          onAction={() => void Taro.navigateBack()}
        />
      </View>
    )
  }

  const item = state.data
  const reminders = reminderState.items
  const now = new Date()
  const actions = buildActivityDetailActions(item, reminders, now, {
    remindersKnown: reminderState.status === 'ready',
  })
  const deadline = item.registrationDeadlineAt === null && item.registrationDeadlineRaw === null
    ? null
    : item.registrationDeadlineAt === null
      ? `报名截止 ${item.registrationDeadlineRaw}（原文未给出具体时刻）`
      : `报名截止 ${formatActivityInstant(item.registrationDeadlineAt, now)}`

  return (
    <View className='kdy-page kdy-activity-detail'>
      <KdyHeading title={item.title} subtitle={`${item.sourceLabel ?? ACTIVITY_SOURCE_LABELS[item.source]} · ${ACTIVITY_KIND_LABELS[item.kind]}`} />

      <KdyCard elevated>
        <View className='kdy-activity-detail__head'>
          <KdyTag tone={item.status === 'candidate' ? 'brand' : item.status === 'confirmed' ? 'success' : 'neutral'}>
            {ACTIVITY_STATUS_LABELS[item.status]}
          </KdyTag>
          <KdyTag tone={item.confidence >= 0.8 ? 'success' : item.confidence >= 0.5 ? 'warning' : 'neutral'}>
            可信度 {Math.round(item.confidence * 100)}%
          </KdyTag>
          {item.stale ? <KdyTag tone='warning'>上次同步结果</KdyTag> : null}
        </View>

        <Row
          label='时间'
          value={
            item.startsAt === null
              ? '时间待定（原文未给出具体时刻）'
              : item.endsAt === null
                ? formatActivityInstant(item.startsAt, now)
                : `${formatActivityInstant(item.startsAt, now)} 至 ${formatActivityInstant(item.endsAt, now)}`
          }
        />
        {item.location !== null ? <Row label='地点' value={item.location} /> : null}
        {item.organizer !== null ? <Row label='主办' value={item.organizer} /> : null}
        {deadline !== null ? <Row label='报名' value={deadline} /> : null}

        {item.registrationUrl !== null ? (
          <View className='kdy-activity-detail__link'>
            <Text className='kdy-activity-detail__url'>{item.registrationUrl}</Text>
            <KdyButton size='sm' variant='secondary' onClick={() => void handleCopy(item.registrationUrl as string)}>
              复制报名链接
            </KdyButton>
          </View>
        ) : null}

        {item.sourceUrl !== null ? (
          <View className='kdy-activity-detail__link'>
            <Text className='kdy-activity-detail__url'>{item.sourceUrl}</Text>
            <KdyButton size='sm' variant='ghost' onClick={() => void handleCopy(item.sourceUrl as string)}>
              复制来源链接
            </KdyButton>
          </View>
        ) : null}
      </KdyCard>

      {item.evidenceText !== '' ? (
        <KdyCard title='证据片段' elevated={false}>
          <Text className='kdy-activity-detail__evidence'>{item.evidenceText}</Text>
          <Text className='kdy-activity-detail__note'>
            只保留这段 ≤200 字的原文；邮件正文、附件与公众号全文不会存进小程序。
          </Text>
        </KdyCard>
      ) : null}

      {item.status === 'candidate' ? (
        <KdyCard elevated={false}>
          <Text className='kdy-activity-detail__banner'>
            这是候选活动。确认后才加入日程，也才会建提醒。
          </Text>
          <View className='kdy-activity-detail__actions'>
            <KdyButton block loading={busy} onClick={() => void handleConfirm()}>
              确认加入日程
            </KdyButton>
            <KdyButton block variant='secondary' disabled={busy} onClick={() => void handleDismiss()}>
              忽略
            </KdyButton>
            <KdyButton block variant='secondary' disabled={busy} onClick={() => void handleArchive()}>
              归档
            </KdyButton>
          </View>
        </KdyCard>
      ) : null}

      {item.status === 'archived' ? (
        <KdyCard elevated={false}>
          <Text className='kdy-activity-detail__banner'>
            这条活动已归档：不在列表里，也不会再提醒。恢复后会回到「待确认」。
          </Text>
          <View className='kdy-activity-detail__actions'>
            <KdyButton block loading={busy} onClick={() => void handleRestore()}>
              恢复为候选活动
            </KdyButton>
          </View>
        </KdyCard>
      ) : null}

      {item.status === 'confirmed' ? (
        <>
          <KdyCard
            title='提醒'
            elevated={false}
            extra={<Text className='kdy-activity-detail__muted'>仅站内信</Text>}
          >
            {actions.reminderHint !== null ? (
              <Text className='kdy-activity-detail__note'>{actions.reminderHint}</Text>
            ) : null}

            <Text className='kdy-activity-detail__note'>
              确认时服务端已按「报名截止前 24 小时、开始前 1 小时」自动安排站内信提醒；
              目标时间未知或已过时不会建。
            </Text>

            {reminderState.status === 'loading' ? (
              <Text className='kdy-activity-detail__note'>提醒读取中…</Text>
            ) : null}

            {reminderState.status === 'error' ? (
              <KdyEmpty
                mode='error'
                title='提醒读取失败'
                description={reminderState.error ?? '请稍后重试'}
                actionText='重试'
                onAction={() => void loadReminders()}
              />
            ) : null}

            {reminderState.status === 'ready' ? (
              reminders.length > 0 ? (
                <View className='kdy-activity-detail__reminders' aria-role='list'>
                  {reminders.map((reminder) => (
                    <View
                      key={reminder.id}
                      className='kdy-activity-detail__reminder'
                      aria-role='listitem'
                    >
                      <View className='kdy-activity-detail__reminder-copy'>
                        <Text className='kdy-activity-detail__reminder-title'>
                          {REMINDER_KIND_LABELS[reminder.kind]} ·{' '}
                          {formatActivityInstant(reminder.remindAt, now)}
                        </Text>
                        <Text className='kdy-activity-detail__muted'>
                          {REMINDER_CHANNEL_LABELS[reminder.channel]} ·{' '}
                          {REMINDER_STATUS_LABELS[reminder.status] ?? reminder.status}
                        </Text>
                      </View>
                      <KdyButton
                        size='sm'
                        variant='ghost'
                        loading={deletingId === reminder.id}
                        disabled={deletingId !== null}
                        onClick={() => void handleDeleteReminder(reminder.id)}
                      >
                        删除
                      </KdyButton>
                    </View>
                  ))}
                </View>
              ) : (
                <Text className='kdy-activity-detail__note'>还没有提醒。</Text>
              )
            ) : null}

            <Text className='kdy-activity-detail__section-label'>补设默认提醒</Text>
            {actions.canSetRegistrationReminder ? (
              <KdyButton
                block
                variant='secondary'
                loading={busy}
                onClick={() => void handleCreateDefaultReminder('registration')}
              >
                补设报名提醒
              </KdyButton>
            ) : actions.registrationHint !== null ? (
              <Text className='kdy-activity-detail__note'>{actions.registrationHint}</Text>
            ) : null}
            {actions.canSetStartReminder ? (
              <KdyButton
                block
                variant='secondary'
                loading={busy}
                onClick={() => void handleCreateDefaultReminder('start')}
              >
                补设开始提醒
              </KdyButton>
            ) : actions.startHint !== null ? (
              <Text className='kdy-activity-detail__note'>{actions.startHint}</Text>
            ) : null}

            <Text className='kdy-activity-detail__section-label'>自定义提醒</Text>
            <KdyField label='日期' required error={customError}>
              <KdyPicker
                mode='date'
                min={shanghaiDateInput(now)}
                value={customDate}
                onChange={(value) => {
                  setCustomDate(value)
                  setCustomError(null)
                }}
              />
            </KdyField>
            <KdyField label='时间' required>
              <KdyPicker
                mode='time'
                value={customTime}
                onChange={(value) => {
                  setCustomTime(value)
                  setCustomError(null)
                }}
              />
            </KdyField>
            <KdyButton
              block
              variant='secondary'
              loading={busy}
              disabled={customTime === ''}
              onClick={() => void handleCreateCustomReminder()}
            >
              添加站内信提醒
            </KdyButton>

            <View className='kdy-activity-detail__actions'>
              <KdyButton
                block
                variant='ghost'
                onClick={() => void navigateTo(activityRemindersPath())}
              >
                查看全部提醒
              </KdyButton>
            </View>
          </KdyCard>

          <KdyCard
            title='手机日历'
            elevated={false}
            extra={<KdyTag tone='neutral'>系统日历</KdyTag>}
          >
            <Text className='kdy-activity-detail__note'>
              写入手机系统日历，由你自己决定；不会发送微信订阅消息，也不会产生微信推送。
            </Text>
            {item.startsAt === null ? (
              <Text className='kdy-activity-detail__note'>
                原文没有确定的开始时间，无法加入日历。
              </Text>
            ) : (
              <KdyButton
                block
                variant='secondary'
                loading={calendarBusy}
                disabled={busy}
                onClick={() => void handleAddToPhoneCalendar(item)}
              >
                加入手机日历
              </KdyButton>
            )}
          </KdyCard>
        </>
      ) : null}

      {notice !== null ? (
        <View className='kdy-activity-detail__ok' aria-label={notice}>
          {notice}
        </View>
      ) : null}
      {error !== null ? (
        <View className='kdy-activity-detail__error' aria-label={error}>
          {error}
        </View>
      ) : null}

      <Text className='kdy-disclaimer'>
        活动时间与报名要求以主办方通知为准。微信订阅消息尚未接通，提醒只出现在站内。
      </Text>
    </View>
  )
}
