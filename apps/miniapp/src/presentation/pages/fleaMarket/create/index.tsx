import { Text, View } from '@tarojs/components'
import { useState } from 'react'
import { fenToYuan, yuanToFen } from '@kedaya/shared'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import {
  FLEA_CATEGORIES,
  FLEA_CATEGORY_LABELS,
  FLEA_CONDITIONS,
  FLEA_CONDITION_LABELS,
} from '../../../../domain/models/fleaMarket'
import { validateDraft } from '../../../../application/fleaMarket/fleaMarketUseCases'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyField, KdyImageUploader } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { imageSubmitProblem, useImageAttachments, useStore } from '../../../hooks'
import './index.scss'

/**
 * 发布闲置。
 *
 * 三条产品纪律（都来自契约）：
 *   · **价格用「分」传输**：输入框收元，提交前 `yuanToFen` 换算成整数分，
 *     避免浮点误差（契约 §6.1 硬规则）；
 *   · **不碰资金**：校园跳蚤市场是线下当面交易，平台只做撮合与状态同步，
 *     因此没有下单/支付，只有「预定 → 已售出」的状态推进；
 *   · **发布者只能是自己**：服务端从 JWT 取主体，客户端连 sellerId 字段都不发。
 */
export default function FleaMarketCreatePage() {
  const container = getContainer()
  const flea = container.useCases.fleaMarket
  const session = useStore(container.useCases.session)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priceText, setPriceText] = useState('')
  const [category, setCategory] = useState<string>('electronics')
  const [condition, setCondition] = useState<string>('good')
  const [campusSpot, setCampusSpot] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  /**
   * 图片：选完立即上传（见 `useImageAttachments` 的注释）。
   * 页面只需要在提交时把 `attachments.urls` 带上，以及用 `imageSubmitProblem`
   * 挡住「还有图没传成功就发布」这种会静默丢图的情况。
   */
  const attachments = useImageAttachments()
  const imageProblem = imageSubmitProblem(attachments)

  const priceFen = priceText.trim() === '' ? Number.NaN : yuanToFen(priceText.trim())
  const problems = validateDraft({
    title,
    description,
    priceFen,
    category,
    condition,
    campusSpot,
  })

  if (session.tokens === null) {
    return (
      <View className='kdy-page kdy-flea-create'>
        <KdyHeading title='发布闲置' subtitle='登录后才能发布，这样同学才知道东西是谁的。' />
        <KdyCard elevated={false}>
          <Text className='kdy-flea-create__hint'>当前未登录。</Text>
          <View className='kdy-flea-create__actions'>
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
    if (submitting) return
    setError(null)
    setSubmitting(true)

    const result = await flea.create({
      title,
      description: description.trim() === '' ? null : description,
      priceFen,
      category,
      condition,
      campusSpot: campusSpot.trim() === '' ? null : campusSpot,
      imageUrls: attachments.urls,
    })
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('发布成功', 'success')
    await navigateTo(PAGE_PATHS.fleaList)
  }

  return (
    <View className='kdy-page kdy-flea-create'>
      <KdyHeading
        title='发布闲置'
        subtitle='如实描述成色与瑕疵，成交率会高很多。'
      />

      <KdyCard title='商品信息' elevated={false}>
        <KdyField
          label='标题'
          value={title}
          onChange={setTitle}
          placeholder='例如：九成新机械键盘'
          maxLength={60}
        />
        <KdyField
          label='描述'
          value={description}
          onChange={setDescription}
          placeholder='使用情况、瑕疵、附件等（选填）'
          maxLength={2000}
        />
        <KdyField
          label='价格（元）'
          value={priceText}
          onChange={setPriceText}
          placeholder='例如 128 或 128.50'
          type='digit'
          maxLength={10}
          hint={
            Number.isFinite(priceFen) && priceFen >= 0
              ? `将按 ¥${fenToYuan(priceFen)} 发布`
              : '支持两位小数'
          }
        />
        <KdyField
          label='交易地点'
          value={campusSpot}
          onChange={setCampusSpot}
          placeholder='例如：二号宿舍楼下（选填）'
          maxLength={60}
        />
      </KdyCard>

      <KdyCard title='图片' elevated={false}>
        <KdyImageUploader
          items={attachments.items}
          availability={attachments.availability}
          full={attachments.full}
          maxCount={attachments.maxCount}
          onAdd={() => void attachments.add()}
          onRemove={attachments.remove}
          onRetry={(id) => void attachments.retry(id)}
          onRetryAvailability={() => void container.useCases.media.ensureAvailability(true)}
        />
      </KdyCard>

      <KdyCard title='分类' elevated={false}>
        <View className='kdy-flea-create__chips'>
          {FLEA_CATEGORIES.map((item) => (
            <KdyChip key={item} active={category === item} onClick={() => setCategory(item)}>
              {FLEA_CATEGORY_LABELS[item]}
            </KdyChip>
          ))}
        </View>
      </KdyCard>

      <KdyCard title='成色' elevated={false}>
        <View className='kdy-flea-create__chips'>
          {FLEA_CONDITIONS.map((item) => (
            <KdyChip key={item} active={condition === item} onClick={() => setCondition(item)}>
              {FLEA_CONDITION_LABELS[item]}
            </KdyChip>
          ))}
        </View>
      </KdyCard>

      {problems.length > 0 && (
        <Text className='kdy-flea-create__problems'>
          还需要完善：{problems.join('、')}
        </Text>
      )}
      {imageProblem !== null && <Text className='kdy-flea-create__problems'>{imageProblem}</Text>}
      {error !== null && <Text className='kdy-flea-create__error'>{error}</Text>}

      <View className='kdy-flea-create__actions'>
        <KdyButton
          block
          loading={submitting}
          disabled={problems.length > 0 || imageProblem !== null}
          onClick={() => void handleSubmit()}
        >
          发布
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        请勿发布违规物品；平台不留存交易资金，遇到纠纷请优先线下沟通或联系辅导员。
      </Text>
    </View>
  )
}
