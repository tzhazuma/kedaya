import { Text, View } from '@tarojs/components'
import { useState } from 'react'
import { fenToYuan, yuanToFen } from '@kedaya/shared'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, groupBuyDetailPath } from '../../../../app/routes'
import {
  GROUP_BUY_CATEGORIES,
  GROUP_BUY_CATEGORY_LABELS,
  GROUP_BUY_DEADLINE_PRESETS,
} from '../../../../domain/models/groupbuy'
import {
  GROUP_BUY_DESCRIPTION_MAX,
  GROUP_BUY_MAX_TARGET,
  GROUP_BUY_MIN_TARGET,
  GROUP_BUY_PICKUP_MAX,
  GROUP_BUY_TITLE_MAX,
  hoursFromNowIso,
  resolveGroupBuyDeadline,
  validateGroupBuyDraft,
} from '../../../../application/groupbuy/createGroupBuy'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyField } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 发起拼单。
 *
 * 三条纪律：
 *   · **单价用「分」传输**：输入框收元，提交前 `yuanToFen` 换算成整数分
 *     （契约 §6.1 硬规则，后端 `unitPriceFen` 只接受整数）；
 *   · **截止时间用相对预设**：小程序禁用原生 Picker（见 apps/miniapp/AGENTS.md），
 *     相对预设还能天然保证"不会选中过去的时间"（服务端硬规则是必须晚于现在）；
 *   · **发起人只能是自己**：服务端从 JWT 取主体，客户端只把 id / 昵称交给 mock 仓储记账。
 */

export default function GroupBuyCreatePage() {
  const container = getContainer()
  const createGroupBuy = container.useCases.createGroupBuy
  const session = useStore(container.useCases.session)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<string>('')
  const [targetCountText, setTargetCountText] = useState('3')
  const [priceText, setPriceText] = useState('')
  const [pickupPlace, setPickupPlace] = useState('')
  const [presetId, setPresetId] = useState<string>(GROUP_BUY_DEADLINE_PRESETS[2]?.id ?? '1d')
  const [useCustom, setUseCustom] = useState(false)
  const [customHours, setCustomHours] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const now = container.clock.now()
  const deadlineIso = useCustom
    ? hoursFromNowIso(now, customHours)
    : resolveGroupBuyDeadline(now, presetId).iso
  const priceFen = priceText.trim() === '' ? Number.NaN : yuanToFen(priceText.trim())
  const targetCount = /^\d+$/.test(targetCountText.trim()) ? Number(targetCountText.trim()) : Number.NaN

  const problems = validateGroupBuyDraft(
    { title, description, category, targetCount, priceFen, deadlineIso, pickupPlace },
    now,
  )

  if (session.tokens === null) {
    return (
      <View className='kdy-page kdy-groupbuy-create'>
        <KdyHeading title='发起拼单' subtitle='登录后才能发起，同学才知道该找谁拼。' />
        <KdyCard elevated={false}>
          <Text className='kdy-groupbuy-create__hint'>当前未登录。</Text>
          <View className='kdy-groupbuy-create__actions'>
            <KdyButton block onClick={() => void navigateTo(PAGE_PATHS.authLogin)}>
              去登录
            </KdyButton>
          </View>
        </KdyCard>
      </View>
    )
  }

  async function handleSubmit(): Promise<void> {
    if (submitting) return
    setError(null)
    setSubmitting(true)

    const result = await createGroupBuy.create({
      title,
      description,
      category,
      targetCount,
      priceFen,
      deadlineIso,
      pickupPlace,
    })
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('已发起，等待同学参团', 'success')
    await navigateTo(groupBuyDetailPath(result.value.groupBuy.id))
  }

  return (
    <View className='kdy-page kdy-groupbuy-create'>
      <KdyHeading
        title='发起拼单'
        subtitle='写清份数、价格与取货点。'
      />

      <KdyCard title='拼单信息' elevated={false}>
        <KdyField
          label='标题'
          value={title}
          onChange={setTitle}
          placeholder='例如：瑞幸咖啡券拼单（4 人成团）'
          maxLength={GROUP_BUY_TITLE_MAX}
        />
        <KdyField
          label='说明'
          value={description}
          onChange={setDescription}
          placeholder='规格、取货时间、注意事项等（选填）'
          maxLength={GROUP_BUY_DESCRIPTION_MAX}
        />
        <KdyField
          label='单价（元）'
          value={priceText}
          onChange={setPriceText}
          placeholder='例如 18 或 18.50'
          type='digit'
          maxLength={10}
          hint={
            Number.isFinite(priceFen) && priceFen >= 0
              ? `将按 ¥${fenToYuan(priceFen)}/份 发布`
              : '支持两位小数'
          }
        />
        <KdyField
          label='成团份数'
          value={targetCountText}
          onChange={setTargetCountText}
          placeholder={`${GROUP_BUY_MIN_TARGET}–${GROUP_BUY_MAX_TARGET}`}
          type='number'
          maxLength={2}
          hint='发起人自己算 1 份'
        />
        <KdyField
          label='取货地点'
          value={pickupPlace}
          onChange={setPickupPlace}
          placeholder='例如：三号楼 1F 大厅（选填）'
          maxLength={GROUP_BUY_PICKUP_MAX}
        />
      </KdyCard>

      <KdyCard title='分类' elevated={false}>
        <View className='kdy-groupbuy-create__chips'>
          {GROUP_BUY_CATEGORIES.map((item) => (
            <KdyChip key={item} active={category === item} onClick={() => setCategory(item)}>
              {GROUP_BUY_CATEGORY_LABELS[item]}
            </KdyChip>
          ))}
        </View>
      </KdyCard>

      <KdyCard title='截止时间' elevated={false}>
        <View className='kdy-groupbuy-create__chips'>
          {GROUP_BUY_DEADLINE_PRESETS.map((preset) => (
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
            placeholder='例如 36'
            type='digit'
            maxLength={6}
            hint='支持小数，必须大于 0'
          />
        )}

        <Text className='kdy-groupbuy-create__hint'>
          当前选择：
          {deadlineIso === null ? '尚未选择有效时间' : deadlineIso.replace('T', ' ').slice(0, 16)}（UTC）
        </Text>
      </KdyCard>

      {problems.length > 0 && (
        <Text className='kdy-groupbuy-create__problems'>还需要完善：{problems.join('、')}</Text>
      )}
      {error !== null && <Text className='kdy-groupbuy-create__error'>{error}</Text>}

      <View className='kdy-groupbuy-create__actions'>
        <KdyButton
          block
          loading={submitting}
          disabled={problems.length > 0}
          onClick={() => void handleSubmit()}
        >
          发布拼单
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        拼单是同学间的自愿拼团，平台不参与资金往来；取货请优先选择人多明亮的公共场所。
      </Text>
    </View>
  )
}
