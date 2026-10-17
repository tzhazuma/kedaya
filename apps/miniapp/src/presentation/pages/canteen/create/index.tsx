import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import {
  CANTEEN_DISCLAIMER,
  CANTEEN_OPTIONS,
  parseYuanText,
  priceLabel,
} from '../../../../domain/models/canteen'
import type { CanteenDishDraft } from '../../../../application/canteen/canteenUseCases'
import { validateDraft } from '../../../../application/canteen/canteenUseCases'
import { navigateBack, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyField } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import './index.scss'

/**
 * 补充菜品营养信息。
 *
 * 两条纪律（都来自后端领域规则）：
 *   · **创建是匿名的**：后端 `POST /canteen/items` 不带归属字段、不要求登录，
 *     因此这里不做登录拦截 —— 强制登录与产品语义不符；
 *   · **文本先解析再提交**：热量 / 营养素收非负整数，价格收元、提交前 `yuanToFen`
 *     换算成整数分（契约 §6.1），客户端用与 mock 同一套边界即时提示，
 *     而不是先发一个注定 400 的请求来试探。
 */

export default function CanteenCreatePage() {
  const container = getContainer()
  const canteen = container.useCases.canteen

  const [canteenName, setCanteenName] = useState<string>(CANTEEN_OPTIONS[0])
  const [name, setName] = useState('')
  const [caloriesText, setCaloriesText] = useState('')
  const [proteinText, setProteinText] = useState('')
  const [fatText, setFatText] = useState('')
  const [carbText, setCarbText] = useState('')
  const [priceText, setPriceText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const draft: CanteenDishDraft = {
    canteen: canteenName,
    name,
    caloriesText,
    proteinText,
    fatText,
    carbText,
    priceText,
  }
  const problems = validateDraft(draft)

  const priceFen = parseYuanText(priceText)

  async function handleSubmit(): Promise<void> {
    if (submitting) return
    setError(null)
    setSubmitting(true)

    const result = await canteen.create(draft)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('已提交，感谢共建', 'success')
    // 详情页会因返回后 `useDidShow` 重新 hydrate/load 而拿到最新数据
    await navigateBack()
  }

  return (
    <View className='kdy-page kdy-canteen-create'>
      <KdyHeading
        title='补充菜品'
        subtitle='无需登录；热量由同学估算，仅供参考。'
      />

      <KdyCard title='食堂' elevated={false}>
        <View className='kdy-canteen-create__chips'>
          {CANTEEN_OPTIONS.map((option) => (
            <KdyChip
              key={option}
              active={canteenName === option}
              onClick={() => setCanteenName(option)}
            >
              {option}
            </KdyChip>
          ))}
        </View>
      </KdyCard>

      <KdyCard title='菜品' elevated={false}>
        <KdyField
          label='菜品名称'
          value={name}
          onChange={setName}
          placeholder='例如：红烧肉盖饭'
          maxLength={60}
        />
        <KdyField
          label='参考价格（元）'
          value={priceText}
          onChange={setPriceText}
          type='digit'
          placeholder='例如：18 或 18.00'
          maxLength={10}
          hint={
            priceFen === null
              ? '按元填写，最多两位小数'
              : `将按 ${priceLabel(priceFen)} 记录`
          }
        />
      </KdyCard>

      <KdyCard title='营养成分（每份）' elevated={false}>
        <KdyField
          label='热量'
          value={caloriesText}
          onChange={setCaloriesText}
          type='number'
          placeholder='千卡，例如：780'
          maxLength={6}
          hint='非负整数，按每份估算'
        />
        <KdyField
          label='蛋白质'
          value={proteinText}
          onChange={setProteinText}
          type='number'
          placeholder='克，例如：32'
          maxLength={5}
        />
        <KdyField
          label='脂肪'
          value={fatText}
          onChange={setFatText}
          type='number'
          placeholder='克，例如：28'
          maxLength={5}
        />
        <KdyField
          label='碳水化合物'
          value={carbText}
          onChange={setCarbText}
          type='number'
          placeholder='克，例如：96'
          maxLength={5}
        />
        <Text className='kdy-canteen-create__hint'>
          营养值为估算即可，不需要精确到小数点；不确定的项可先按常见值填写。
        </Text>
      </KdyCard>

      {problems.length > 0 && (
        <Text className='kdy-canteen-create__problems'>还需要完善：{problems.join('、')}</Text>
      )}
      {error !== null && <Text className='kdy-canteen-create__error'>{error}</Text>}

      <View className='kdy-canteen-create__actions'>
        <KdyButton
          block
          loading={submitting}
          disabled={problems.length > 0}
          onClick={() => void handleSubmit()}
        >
          提交菜品
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        {CANTEEN_DISCLAIMER}。请勿录入与食堂无关的内容；第三方非官方平台。
      </Text>
    </View>
  )
}
