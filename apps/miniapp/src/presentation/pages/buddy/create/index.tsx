import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import {
  hoursFromNowIso,
  resolveBuddyStart,
  validateBuddyDraft,
} from '../../../../application/buddy/buddyUseCases'
import {
  BUDDY_ACTIVITIES,
  BUDDY_ACTIVITY_LABELS,
  BUDDY_MAX_CAPACITY,
  BUDDY_MIN_CAPACITY,
  BUDDY_START_PRESETS,
} from '../../../../domain/models/buddy'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyField } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 发起搭子招募。
 *
 * 与服务端 `buddy.service.ts` 对齐的三条：
 *   · 活动类型必须落在白名单内（客户端用同一份 `BUDDY_ACTIVITIES` 渲染）；
 *   · 容量 2~50（至少「我 + 一个搭子」）；
 *   · 开始时间必须晚于当前 —— 所以用「相对当前时间」的快捷选项表达，
 *     不用原生 Picker（见 apps/miniapp/AGENTS.md）。
 *
 * 组长由服务端从 JWT 主体补全，并在同一步写进成员表，客户端不传 ownerId。
 */
export default function BuddyCreatePage() {
  const container = getContainer()
  const buddy = container.useCases.buddy
  const session = useStore(container.useCases.session)

  const [activity, setActivity] = useState<string>('study')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [campusSpot, setCampusSpot] = useState('')
  const [capacityText, setCapacityText] = useState('4')
  const [presetId, setPresetId] = useState<string>(BUDDY_START_PRESETS[2]?.id ?? '1d')
  const [useCustom, setUseCustom] = useState(false)
  const [customHours, setCustomHours] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const now = container.clock.now()
  const startsAtIso = useCustom
    ? hoursFromNowIso(now, customHours)
    : resolveBuddyStart(now, presetId).iso

  const problems = validateBuddyDraft(
    { activity, title, description, campusSpot, capacityText, startsAtIso },
    now,
  )

  if (session.tokens === null) {
    return (
      <View className='kdy-page kdy-buddy-create'>
        <KdyHeading title='发起搭子' subtitle='登录后才能发起，这样同学才知道组长是谁。' />
        <KdyCard elevated={false}>
          <Text className='kdy-buddy-create__hint'>当前未登录。</Text>
          <View className='kdy-buddy-create__actions'>
            <KdyButton
              block
              onClick={() => {
                void navigateTo(PAGE_PATHS.authLogin)
              }}
            >
              去登录
            </KdyButton>
          </View>
        </KdyCard>
      </View>
    )
  }

  async function handleSubmit(): Promise<void> {
    if (submitting || startsAtIso === null) return
    setError(null)
    setSubmitting(true)

    const result = await buddy.create({
      activity,
      title,
      description: description.trim() === '' ? null : description,
      campusSpot,
      startsAt: startsAtIso,
      capacity: Number(capacityText),
    })
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('已发起，等待同学加入', 'success')
    await navigateTo(PAGE_PATHS.buddyList)
  }

  return (
    <View className='kdy-page kdy-buddy-create'>
      <KdyHeading
        title='发起搭子'
        subtitle='写清时间与集合地点，搭子们才知道去哪里找你。'
        eyebrow='KEDAYA · 找搭子'
      />

      <KdyCard title='搭子信息' elevated={false}>
        <KdyField
          label='标题'
          value={title}
          onChange={setTitle}
          placeholder='例如：今晚上自习，一起卷到闭馆'
          maxLength={60}
        />
        <KdyField
          label='简介'
          value={description}
          onChange={setDescription}
          placeholder='活动内容、强度、注意事项等（选填）'
          maxLength={2000}
        />
        <KdyField
          label='集合地点'
          value={campusSpot}
          onChange={setCampusSpot}
          placeholder='例如：图书馆一楼闸机'
          maxLength={60}
        />
        <KdyField
          label='人数上限'
          value={capacityText}
          onChange={setCapacityText}
          placeholder={`${BUDDY_MIN_CAPACITY}~${BUDDY_MAX_CAPACITY}`}
          type='number'
          maxLength={2}
          hint={`包含你自己，需在 ${BUDDY_MIN_CAPACITY}~${BUDDY_MAX_CAPACITY} 之间`}
        />
      </KdyCard>

      <KdyCard title='活动类型' elevated={false}>
        <View className='kdy-buddy-create__chips'>
          {BUDDY_ACTIVITIES.map((item) => (
            <KdyChip key={item} active={activity === item} onClick={() => setActivity(item)}>
              {BUDDY_ACTIVITY_LABELS[item]}
            </KdyChip>
          ))}
        </View>
      </KdyCard>

      <KdyCard title='开始时间' elevated={false}>
        <View className='kdy-buddy-create__chips'>
          {BUDDY_START_PRESETS.map((preset) => (
            <KdyChip
              key={preset.id}
              active={!useCustom && presetId === preset.id}
              onClick={() => {
                setUseCustom(false)
                setPresetId(preset.id)
              }}
            >
              {preset.label}
            </KdyChip>
          ))}
          <KdyChip active={useCustom} onClick={() => setUseCustom(true)}>
            自定义
          </KdyChip>
        </View>

        {useCustom && (
          <KdyField
            label='多少小时后'
            value={customHours}
            onChange={setCustomHours}
            placeholder='例如 4.5'
            type='digit'
            maxLength={6}
            hint='支持小数，必须大于 0'
          />
        )}

        <Text className='kdy-buddy-create__hint'>
          当前选择：
          {startsAtIso === null ? '尚未选择有效时间' : startsAtIso.replace('T', ' ').slice(0, 16)}
          （UTC）
        </Text>
      </KdyCard>

      {problems.length > 0 && (
        <Text className='kdy-buddy-create__problems'>还需要完善：{problems.join('、')}</Text>
      )}
      {error !== null && <Text className='kdy-buddy-create__error'>{error}</Text>}

      <View className='kdy-buddy-create__actions'>
        <KdyButton
          block
          loading={submitting}
          disabled={problems.length > 0}
          onClick={() => void handleSubmit()}
        >
          发起搭子
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        请勿发布违规内容；线下见面请优先选择人多明亮的公共场所。
      </Text>
    </View>
  )
}
