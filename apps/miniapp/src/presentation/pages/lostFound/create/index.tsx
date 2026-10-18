import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, lostFoundDetailPath } from '../../../../app/routes'
import {
  LOST_FOUND_KINDS,
  LOST_FOUND_KIND_HINTS,
  formatHappenedAtInput,
  kindLabel,
} from '../../../../domain/models/lostFound'
import { validateDraft } from '../../../../application/lostFound/lostFoundUseCases'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyField, KdyImageUploader } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { imageSubmitProblem, useImageAttachments, useStore } from '../../../hooks'
import './index.scss'

/**
 * 登记失物 / 招领信息。
 *
 * 三条纪律（都来自后端领域规则）：
 *   · **发布者只能是自己**：服务端从 JWT 取 `reporterId`，客户端连这个字段都不发；
 *   · **事发时间不能在未来**（允许 5 分钟时钟偏差），因此表单收文本、提交前解析，
 *     客户端先用同一套规则提示，不用「先发一个注定 400 的请求」来试探；
 *   · **状态只能走领域动作**：新建一律 `open`，不能通过请求体直接写 `status`。
 */

export default function LostFoundCreatePage() {
  const container = getContainer()
  const lostFound = container.useCases.lostFound
  const session = useStore(container.useCases.session)

  const [kind, setKind] = useState<string>(LOST_FOUND_KINDS[0])
  const [title, setTitle] = useState('')
  const [place, setPlace] = useState('')
  const [happenedAtText, setHappenedAtText] = useState(() =>
    formatHappenedAtInput(container.clock.now()),
  )
  const [description, setDescription] = useState('')
  const [contactHint, setContactHint] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  /**
   * 图片：选完立即上传。`draft` 带上 `attachments.urls`，
   * 「还有图没传成功」由 `imageSubmitProblem` 挡在提交之前（绝不静默丢图）。
   */
  const attachments = useImageAttachments()
  const imageProblem = imageSubmitProblem(attachments)

  const draft = {
    kind,
    title,
    description,
    place,
    happenedAtText,
    contactHint,
    imageUrls: attachments.urls,
  }
  const problems = validateDraft(draft, container.clock.now())

  /** 快捷时间：用容器时钟（mock 模式下与 mock 仓储同一时钟，不会互相矛盾） */
  function applyPreset(minutesAgo: number): void {
    const target = new Date(container.clock.now().getTime() - minutesAgo * 60_000)
    setHappenedAtText(formatHappenedAtInput(target))
  }

  if (session.tokens === null) {
    return (
      <View className='kdy-page kdy-lost-create'>
        <KdyHeading title='登记信息' subtitle='登录后才能登记，这样捡到东西的同学才知道该联系谁。' />
        <KdyCard elevated={false}>
          <Text className='kdy-lost-create__hint'>当前未登录。</Text>
          <View className='kdy-lost-create__actions'>
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

    const result = await lostFound.create(draft)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('登记成功', 'success')
    await navigateTo(lostFoundDetailPath(result.value.id))
  }

  return (
    <View className='kdy-page kdy-lost-create'>
      <KdyHeading
        title='登记信息'
        subtitle='写清物品特征与地点，越具体越容易被认出来。'
      />

      <KdyCard title='信息类型' elevated={false}>
        <View className='kdy-lost-create__chips'>
          {LOST_FOUND_KINDS.map((item) => (
            <KdyChip key={item} active={kind === item} onClick={() => setKind(item)}>
              {LOST_FOUND_KIND_HINTS[item]}
            </KdyChip>
          ))}
        </View>
        <Text className='kdy-lost-create__hint'>当前选择：{kindLabel(kind)}</Text>
      </KdyCard>

      <KdyCard title='物品与地点' elevated={false}>
        <KdyField
          label='物品名称'
          value={title}
          onChange={setTitle}
          placeholder='例如：黑色雨伞（伞柄贴了小黄鸭贴纸）'
          maxLength={60}
        />
        <KdyField
          label='地点'
          value={place}
          onChange={setPlace}
          placeholder='例如：图书馆四楼自习区'
          maxLength={60}
        />
      </KdyCard>

      <KdyCard title='事发时间' elevated={false}>
        <KdyField
          label='时间'
          value={happenedAtText}
          onChange={setHappenedAtText}
          placeholder='YYYY-MM-DD HH:mm'
          maxLength={20}
          hint='按本地时间填写，支持 2026-10-16 20:30 或 2026/10/16 20:30'
        />
        <View className='kdy-lost-create__chips'>
          <KdyChip onClick={() => applyPreset(0)}>刚刚</KdyChip>
          <KdyChip onClick={() => applyPreset(60)}>1 小时前</KdyChip>
          <KdyChip onClick={() => applyPreset(24 * 60)}>昨天此时</KdyChip>
        </View>
      </KdyCard>

      <KdyCard title='补充说明' elevated={false}>
        <KdyField
          label='详细描述'
          value={description}
          onChange={setDescription}
          placeholder='物品特征、附件、当前保管情况（选填）'
          maxLength={2000}
        />
        <KdyField
          label='联系方式提示'
          value={contactHint}
          onChange={setContactHint}
          placeholder='例如：站内私信 / 请到宿管处认领（选填）'
          maxLength={60}
        />
      </KdyCard>

      <KdyCard title='现场照片' elevated={false}>
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

      {problems.length > 0 && (
        <Text className='kdy-lost-create__problems'>还需要完善：{problems.join('、')}</Text>
      )}
      {imageProblem !== null && <Text className='kdy-lost-create__problems'>{imageProblem}</Text>}
      {error !== null && <Text className='kdy-lost-create__error'>{error}</Text>}

      <View className='kdy-lost-create__actions'>
        <KdyButton
          block
          loading={submitting}
          disabled={problems.length > 0 || imageProblem !== null}
          onClick={() => void handleSubmit()}
        >
          提交登记
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        请勿填写他人隐私信息；证件、钱包等贵重物品建议同时交到保卫处或失物招领柜。平台只做信息撮合。
      </Text>
    </View>
  )
}
