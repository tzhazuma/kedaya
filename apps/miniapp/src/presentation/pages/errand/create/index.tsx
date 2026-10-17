import { Text, View } from '@tarojs/components'
import { useState } from 'react'
import { fenToYuan, yuanToFen } from '@kedaya/shared'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import {
  hoursFromNowIso,
  resolveErrandDeadline,
  validateErrandDraft,
} from '../../../../application/errand/errandUseCases'
import { ERRAND_DEADLINE_PRESETS, ERRAND_MAX_REWARD_FEN } from '../../../../domain/models/errand'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyField } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 发布跑腿任务。
 *
 * 三条纪律：
 *   · **悬赏用「分」传输**：输入框收元，提交前 `yuanToFen` 换算成整数分
 *     （契约 §6.1 硬规则，后端 `rewardFen` 只接受整数）；
 *   · **截止时间必须晚于当前**：所以用「相对当前时间」的快捷选项表达，
 *     落地时才换算成绝对 ISO，天然不会选中过去的时间；
 *     （小程序禁用原生 Picker，见 apps/miniapp/AGENTS.md，因此不用日期选择器）
 *   · **发布者只能是自己**：服务端从 JWT 取主体，客户端连 requesterId 都不发。
 */
export default function ErrandCreatePage() {
  const container = getContainer()
  const errand = container.useCases.errand
  const session = useStore(container.useCases.session)

  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [rewardText, setRewardText] = useState('')
  const [fromPlace, setFromPlace] = useState('')
  const [toPlace, setToPlace] = useState('')
  const [presetId, setPresetId] = useState<string>(ERRAND_DEADLINE_PRESETS[1]?.id ?? '1h')
  const [useCustom, setUseCustom] = useState(false)
  const [customHours, setCustomHours] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const now = container.clock.now()
  const deadlineIso = useCustom
    ? hoursFromNowIso(now, customHours)
    : resolveErrandDeadline(now, presetId).iso
  const rewardFen = rewardText.trim() === '' ? Number.NaN : yuanToFen(rewardText.trim())

  const problems = validateErrandDraft(
    {
      title,
      detail,
      rewardFen,
      fromPlace,
      toPlace,
      deadlineIso,
    },
    now,
  )

  if (session.tokens === null) {
    return (
      <View className='kdy-page kdy-errand-create'>
        <KdyHeading title='发布跑腿' subtitle='登录后才能发布，这样同学才知道该找谁。' />
        <KdyCard elevated={false}>
          <Text className='kdy-errand-create__hint'>当前未登录。</Text>
          <View className='kdy-errand-create__actions'>
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
    if (submitting || deadlineIso === null) return
    setError(null)
    setSubmitting(true)

    const result = await errand.create({
      title,
      detail: detail.trim() === '' ? null : detail,
      rewardFen,
      fromPlace,
      toPlace,
      deadline: deadlineIso,
    })
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('已发布，等待接单', 'success')
    await navigateTo(PAGE_PATHS.errandList)
  }

  return (
    <View className='kdy-page kdy-errand-create'>
      <KdyHeading
        title='发布跑腿'
        subtitle='写清地点与时间，接单的同学才不容易跑空。'
        eyebrow='KEDAYA · 跑腿'
      />

      <KdyCard title='任务信息' elevated={false}>
        <KdyField
          label='标题'
          value={title}
          onChange={setTitle}
          placeholder='例如：帮忙取一下菜鸟驿站的快递'
          maxLength={60}
        />
        <KdyField
          label='明细'
          value={detail}
          onChange={setDetail}
          placeholder='取件码、楼层、注意事项等（选填）'
          maxLength={2000}
        />
        <KdyField
          label='悬赏（元）'
          value={rewardText}
          onChange={setRewardText}
          placeholder='例如 5 或 5.50，可填 0'
          type='digit'
          maxLength={10}
          hint={
            Number.isFinite(rewardFen) && rewardFen >= 0
              ? `将按 ¥${fenToYuan(rewardFen)} 发布（上限 ¥${fenToYuan(ERRAND_MAX_REWARD_FEN)}）`
              : `支持两位小数，上限 ¥${fenToYuan(ERRAND_MAX_REWARD_FEN)}`
          }
        />
        <KdyField
          label='出发地'
          value={fromPlace}
          onChange={setFromPlace}
          placeholder='例如：菜鸟驿站'
          maxLength={60}
        />
        <KdyField
          label='目的地'
          value={toPlace}
          onChange={setToPlace}
          placeholder='例如：3 号楼楼下'
          maxLength={60}
        />
      </KdyCard>

      <KdyCard title='截止时间' elevated={false}>
        <View className='kdy-errand-create__chips'>
          {ERRAND_DEADLINE_PRESETS.map((preset) => (
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

        <Text className='kdy-errand-create__hint'>
          当前选择：{deadlineIso === null ? '尚未选择有效时间' : deadlineIso.replace('T', ' ').slice(0, 16)}（UTC）
        </Text>
      </KdyCard>

      {problems.length > 0 && (
        <Text className='kdy-errand-create__problems'>还需要完善：{problems.join('、')}</Text>
      )}
      {error !== null && <Text className='kdy-errand-create__error'>{error}</Text>}

      <View className='kdy-errand-create__actions'>
        <KdyButton
          block
          loading={submitting}
          disabled={problems.length > 0}
          onClick={() => void handleSubmit()}
        >
          发布
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        请勿发布违规内容；悬赏是同学间的自愿互助，平台不参与资金往来，遇到纠纷请优先线下沟通。
      </Text>
    </View>
  )
}
