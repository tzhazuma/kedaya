import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import {
  FACILITY_KINDS,
  FACILITY_NAME_SUGGESTIONS,
  timeRangeProblem,
} from '../../../../domain/models/facility'
import { navigateBack, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyField } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import './index.scss'

/** `datetime-local` 在本端不可用，改成两个字段 + 拼装（小程序表单能力有限） */
function composeIso(date: string, time: string): string | null {
  if (date.length === 0 || time.length === 0) return null
  const candidate = new Date(`${date}T${time}:00`)
  if (Number.isNaN(candidate.getTime())) return null
  return candidate.toISOString()
}

function todayText(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * 场馆预约 · 发起页。
 *
 * 表单**只用 `KdyField`，筛选/单选只用 `KdyChip`**（AGENTS.md 硬约束）。
 *
 * ⚠️ 这里**不判时段冲突**：客户端只有分页列表，看不到完整占用。
 * 提交后服务端返回 409（`该时段已被预约`）时，把服务端文案原样展示 ——
 * 不在前端编一句"可能冲突"，那会让用户以为是自己填错了。
 */
export default function FacilityCreatePage() {
  const { facility } = getContainer().useCases

  const [kind, setKind] = useState<string>('')
  const [facilityName, setFacilityName] = useState('')
  const [date, setDate] = useState(todayText())
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('19:00')
  const [feeYuan, setFeeYuan] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(): Promise<void> {
    if (submitting) return
    setError(null)

    const startsAt = composeIso(date, startTime)
    const endsAt = composeIso(date, endTime)
    if (startsAt === null || endsAt === null) {
      setError('请填写正确的日期与时间')
      return
    }

    const rangeProblem = timeRangeProblem(startsAt, endsAt)
    if (rangeProblem !== null) {
      setError(rangeProblem)
      return
    }

    const feeValue = Number(feeYuan)
    if (!Number.isFinite(feeValue) || feeValue < 0) {
      setError('费用请填非负数字（元）')
      return
    }
    const feeFen = Math.round(feeValue * 100)

    setSubmitting(true)
    const result = await facility.create({
      kind: kind.trim(),
      facilityName: facilityName.trim().length > 0 ? facilityName.trim() : null,
      startsAt,
      endsAt,
      feeFen,
    })
    setSubmitting(false)

    if (!result.ok) {
      // 409 的文案由服务端给，原样展示
      setError(result.error.message)
      return
    }

    toast('预约成功', 'success')
    await navigateBack()
  }

  return (
    <View className='kdy-page kdy-facility'>
      <KdyHeading title='发起预约' subtitle='选好场馆与时段，提交后会占用该时段。' />

      <KdyCard elevated={false}>
        <Text className='kdy-facility-form__label'>场馆种类</Text>
        <View className='kdy-facility-form__chips'>
          {FACILITY_KINDS.map((item) => (
            <KdyChip key={item} active={kind === item} onClick={() => setKind(item)}>
              {item}
            </KdyChip>
          ))}
        </View>

        <View className='kdy-facility-form__field'>
          <KdyField
            label='场馆名称（可选）'
            value={facilityName}
            onChange={setFacilityName}
            placeholder={FACILITY_NAME_SUGGESTIONS[0] ?? '如：上海科技大学体育馆'}
            maxLength={80}
          />
        </View>

        <View className='kdy-facility-form__field'>
          <KdyField label='日期' value={date} onChange={setDate} placeholder='YYYY-MM-DD' maxLength={10} />
        </View>

        <View className='kdy-facility-form__row'>
          <KdyField label='开始' value={startTime} onChange={setStartTime} placeholder='HH:mm' maxLength={5} />
          <KdyField label='结束' value={endTime} onChange={setEndTime} placeholder='HH:mm' maxLength={5} />
        </View>

        <View className='kdy-facility-form__field'>
          <KdyField
            label='费用（元，填 0 表示免费）'
            value={feeYuan}
            onChange={setFeeYuan}
            placeholder='0'
            maxLength={8}
          />
        </View>

        {error !== null && <Text className='kdy-facility-form__error'>{error}</Text>}

        <View className='kdy-facility-form__actions'>
          <KdyButton block loading={submitting} onClick={() => void handleSubmit()}>
            提交预约
          </KdyButton>
        </View>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        单次预约最长 4 小时，最多提前 30 天。时段是否冲突由场馆系统判定。
      </Text>
    </View>
  )
}
