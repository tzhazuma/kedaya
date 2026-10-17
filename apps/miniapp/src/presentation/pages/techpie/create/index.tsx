import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import {
  TECHPIE_CATEGORIES,
  TECHPIE_DISCLAIMER,
  TECHPIE_NAME_MAX,
  TECHPIE_URL_MAX,
  categoryHint,
  categoryLabel,
} from '../../../../domain/models/techpie'
import type { TechpieDraft } from '../../../../application/techpie/techpieUseCases'
import { validateDraft } from '../../../../application/techpie/techpieUseCases'
import { navigateBack, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyField } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import './index.scss'

/**
 * 补充一条校园技术服务。
 *
 * 三条纪律（都来自后端与产品的真实边界）：
 *   · **没有「说明」字段**：后端 `TechpieLink` 那张表不存在说明列，
 *     所以表单只收名称 / 分类 / 地址 —— 放一个提交后被服务端丢掉的输入框才是骗人。
 *     「这条是干什么的」由**分类**承担，选中后页面显示该分类的一句话说明。
 *   · **创建是匿名的**：`POST /techpie/items` 不要求登录、不记作者，
 *     因此这里不做登录拦截，只做客户端校验并生成后端要的 `key`。
 *   · **不在此端打开外链**：这里只收地址，打开方式由详情页的「复制服务地址」承担。
 */

export default function TechpieCreatePage() {
  const container = getContainer()
  const techpie = container.useCases.techpie

  // 分类默认落在白名单第一项而不是空串：避免一进页面就顶着一条"请选择分类"的未完成提示，
  // 也让校验只在真的填错时才开口。想换分类直接点 chip。
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>(TECHPIE_CATEGORIES[0])
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const draft: TechpieDraft = { name, category, url }
  const problems = validateDraft(draft)

  async function handleSubmit(): Promise<void> {
    if (submitting) return
    setError(null)
    setSubmitting(true)

    const result = await techpie.create(draft)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('已提交，感谢共建', 'success')
    // 返回列表：`useDidShow` 会重新拉取，新条目立刻可见（create 内部已让列表缓存失效）
    await navigateBack()
  }

  return (
    <View className='kdy-page kdy-techpie-create'>
      <KdyHeading
        title='补充服务'
        subtitle='把你常用的校园系统地址记下来，帮助同学少找一会儿。创建无需登录，目录由同学共建。'
        eyebrow='KEDAYA · 技术服务目录'
      />

      <KdyCard title='服务信息' elevated={false}>
        <KdyField
          label='服务名称'
          value={name}
          onChange={setName}
          placeholder='例如：校园网自助服务'
          maxLength={TECHPIE_NAME_MAX}
          hint='写同学一眼能认出来的名字'
        />
        <KdyField
          label='服务地址'
          value={url}
          onChange={setUrl}
          placeholder='https://...'
          maxLength={TECHPIE_URL_MAX}
          hint='以 http:// 或 https:// 开头的完整网址，之后在浏览器里打开'
        />
      </KdyCard>

      <KdyCard title='分类' elevated={false}>
        <View className='kdy-techpie-create__chips'>
          {TECHPIE_CATEGORIES.map((option) => (
            <KdyChip
              key={option}
              active={category === option}
              onClick={() => setCategory(option)}
            >
              {categoryLabel(option)}
            </KdyChip>
          ))}
        </View>
        {/* 表里没有说明列：这一句是**分类级**说明，告诉别人这一类是干什么的 */}
        <Text className='kdy-techpie-create__hint'>{categoryHint(category)}</Text>
      </KdyCard>

      <Text className='kdy-techpie-create__hint'>
        请补充你确认过的校园官方或常用服务地址，不要填广告、推广页或需要付费的内容。
        可达鸭不会探测链接是否可用，提交后会带着「待核对」状态展示，等同学打开后核对。
      </Text>

      {problems.length > 0 && (
        <Text className='kdy-techpie-create__problems'>还需要完善：{problems.join('、')}</Text>
      )}
      {error !== null && <Text className='kdy-techpie-create__error'>{error}</Text>}

      <View className='kdy-techpie-create__actions'>
        <KdyButton
          block
          loading={submitting}
          disabled={problems.length > 0}
          onClick={() => void handleSubmit()}
        >
          提交服务
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>{TECHPIE_DISCLAIMER}</Text>
    </View>
  )
}
