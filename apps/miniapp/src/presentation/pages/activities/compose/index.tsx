import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { activityDetailPath } from '../../../../app/routes'
import {
  ACTIVITY_KINDS,
  ACTIVITY_KIND_LABELS,
  parseShanghaiDateTime,
  type ActivityKind,
} from '../../../../domain/models/activity'
import { navigateTo } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip } from '../../../components'
import { KdyField } from '../../../components/KdyField'
import { KdyHeading } from '../../../components/KdyHeading'
import './index.scss'

/**
 * 手动创建活动。
 *
 * 为什么需要这一页：抽取只能认出「时间 + 地点」写得规整的通知，
 * 段落式、回顾式、纯文字转述的活动抽不出来。没有手动入口，用户就只能放弃。
 *
 * 这里的语义与导入一致：**创建结果仍是候选**，确认后才进日程、才建提醒。
 */

function todayShanghai(): string {
  // 后端与前端都以 Asia/Shanghai 为准；这里只用于表单默认值。
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  return `${now.getUTCFullYear()}-${month}-${day}`
}

export default function ActivityComposePage() {
  const activities = getContainer().useCases.activities

  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<ActivityKind>('lecture')
  const [date, setDate] = useState(todayShanghai())
  const [time, setTime] = useState('14:00')
  const [location, setLocation] = useState('')
  const [organizer, setOrganizer] = useState('')
  const [deadlineDate, setDeadlineDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(): Promise<void> {
    if (busy) return
    setError(null)

    const startsAt = time.trim() === '' ? null : parseShanghaiDateTime(date, time)
    if (time.trim() !== '' && startsAt === null) {
      setError('开始时间不合法：日期用 YYYY-MM-DD，时间用 HH:MM')
      return
    }

    let registrationDeadlineAt: string | null = null
    if (deadlineDate.trim() !== '') {
      // 只有日期时按当天 23:59（上海时区）——这是**用户显式填的**，
      // 与「从原文推断」不同，因此可以补时刻。
      registrationDeadlineAt = parseShanghaiDateTime(deadlineDate.trim(), '23:59')
      if (registrationDeadlineAt === null) {
        setError('报名截止日期不合法，请用 YYYY-MM-DD')
        return
      }
    }

    setBusy(true)
    try {
      const result = await activities.createManual({
        title: title.trim(),
        kind,
        startsAt,
        location: location.trim() === '' ? null : location.trim(),
        organizer: organizer.trim() === '' ? null : organizer.trim(),
        registrationDeadlineAt,
        registrationDeadlineRaw: null,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      void activities.list.load()
      await navigateTo(activityDetailPath(result.value.id))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View className='kdy-page kdy-activity-compose'>
      <KdyHeading
        title='手动添加活动'
        subtitle='抽不出来的通知可以在这里手填。加进去仍是候选，确认后才进日程。'
      />

      <KdyCard elevated={false}>
        <KdyField
          label='活动名称'
          name='activityTitle'
          required
          value={title}
          onChange={setTitle}
          placeholder='例如：名师讲坛：大模型与程序分析'
          maxLength={60}
        />

        <Text className='kdy-activity-compose__label'>类型</Text>
        <View className='kdy-activity-compose__chips'>
          {ACTIVITY_KINDS.map((value) => (
            <KdyChip key={value} active={kind === value} onClick={() => setKind(value)}>
              {ACTIVITY_KIND_LABELS[value]}
            </KdyChip>
          ))}
        </View>

        <View className='kdy-activity-compose__row'>
          <KdyField
            label='开始日期'
            name='activityDate'
            value={date}
            onChange={setDate}
            placeholder='YYYY-MM-DD'
            maxLength={10}
          />
          <KdyField
            label='开始时间'
            name='activityTime'
            value={time}
            onChange={setTime}
            placeholder='HH:MM'
            maxLength={5}
            hint='留空表示时间待定'
          />
        </View>

        <KdyField
          label='地点'
          name='activityLocation'
          value={location}
          onChange={setLocation}
          placeholder='例如：信息学院 1 号楼报告厅'
          maxLength={80}
        />
        <KdyField
          label='主办方'
          name='activityOrganizer'
          value={organizer}
          onChange={setOrganizer}
          placeholder='可选'
          maxLength={60}
        />
        <KdyField
          label='报名截止'
          name='activityDeadline'
          value={deadlineDate}
          onChange={setDeadlineDate}
          placeholder='YYYY-MM-DD（可选，按当天 23:59 计）'
          maxLength={10}
        />

        <View className='kdy-activity-compose__actions'>
          <KdyButton block loading={busy} onClick={() => void handleSubmit()}>
            添加为候选活动
          </KdyButton>
        </View>

        {error !== null ? (
          <View className='kdy-activity-compose__error' aria-label={error}>
            {error}
          </View>
        ) : null}

        <Text className='kdy-activity-compose__hint'>
          确认后才加入日程、才会建提醒；候选不会出现在「今天 / 本周」里。
        </Text>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
