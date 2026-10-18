import { Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import { validateDraft } from '../../../../application/takeoutGuard/takeoutGuardUseCases'
import {
  TAKEOUT_GUARD_DETAIL_MAX,
  TAKEOUT_GUARD_EVIDENCE_MAX,
  TAKEOUT_GUARD_NOTICE,
  TAKEOUT_GUARD_ORDER_NO_MAX,
  TAKEOUT_GUARD_PLACE_MAX,
  formatHappenedAtInput,
} from '../../../../domain/models/takeoutGuard'
import { navigateBack, navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyField, KdyImageUploader } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { imageSubmitProblem, useImageAttachments, useStore } from '../../../hooks'
import './index.scss'

/**
 * 记录一次「外卖被拿错」。
 *
 * 三条纪律（都来自后端领域规则）：
 *   · **记录人只能是自己**：服务端从 JWT 取 `reporterId`，客户端连这个字段都不发，
 *     请求体里也没有它；
 *   · **状态一律 `pending`**：只能通过「升级处理 / 标记已解决」两个领域动作推进，
 *     不能通过请求体直接写 `status`；
 *   · **发生时间不能在未来**（允许 5 分钟时钟偏差），因此表单收文本、提交前解析，
 *     先用同一套规则提示，不用「先发一个注定 400 的请求」来试探。
 *
 * 证据图**最多一张**：后端 `evidenceUrl` 就是一列字符串。与其让用户以为传了 5 张，
 * 不如一开始就只给一个位置（多选到的也会被收敛回第一张）。
 */

export default function TakeoutGuardCreatePage() {
  const container = getContainer()
  const takeoutGuard = container.useCases.takeoutGuard
  const session = useStore(container.useCases.session)

  const [orderNo, setOrderNo] = useState('')
  const [place, setPlace] = useState('')
  const [happenedAtText, setHappenedAtText] = useState(() =>
    formatHappenedAtInput(container.clock.now()),
  )
  const [detail, setDetail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  /**
   * 图片：选完立即上传，失败可点图重试。
   *
   * 共享的 `useImageAttachments` 用的是**全局**张数上限（多图模块共用），
   * 而本模块后端只有一列 `evidenceUrl`，所以这里：
   *   1. 展示层把上限压到 1（`maxCount` / `full`）；
   *   2. 万一一次多选了几张，用 effect 收敛回第一张（`remove` 会顺手清掉多余的服务端对象）。
   * 绝不静默丢图 —— 提交前由 `imageSubmitProblem` 挡下"有图没传成功"。
   */
  const attachments = useImageAttachments()
  const imageProblem = imageSubmitProblem(attachments)

  useEffect(() => {
    if (attachments.items.length <= TAKEOUT_GUARD_EVIDENCE_MAX) return
    for (const item of attachments.items.slice(TAKEOUT_GUARD_EVIDENCE_MAX)) {
      attachments.remove(item.id)
    }
  }, [attachments])

  const draft = {
    orderNo,
    place,
    happenedAtText,
    detail,
    // 只取第一张：与后端单列 evidenceUrl 对齐
    evidenceUrl: attachments.urls[0] ?? null,
  }
  const problems = validateDraft(draft, container.clock.now())

  /** 快捷时间：用容器时钟（mock 模式下与 mock 仓储同一时钟，不会互相矛盾） */
  function applyPreset(minutesAgo: number): void {
    const target = new Date(container.clock.now().getTime() - minutesAgo * 60_000)
    setHappenedAtText(formatHappenedAtInput(target))
  }

  if (session.tokens === null) {
    return (
      <View className='kdy-page kdy-tg-create'>
        <KdyHeading title='记录一次' subtitle='登录后才能登记，记录只存在你自己的账号里。' />
        <KdyCard elevated={false}>
          <Text className='kdy-tg-create__hint'>当前未登录。</Text>
          <View className='kdy-tg-create__actions'>
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

    const result = await takeoutGuard.create(draft)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('已记录', 'success')
    // 回到列表：用户立刻能看到刚记下的这条
    void navigateBack()
  }

  return (
    <View className='kdy-page kdy-tg-create'>
      <KdyHeading
        title='记录一次'
        subtitle='写清取餐点、时间与经过。'
      />

      <Text className='kdy-tg-create__notice'>{TAKEOUT_GUARD_NOTICE}</Text>

      <KdyCard title='订单与取餐点' elevated={false}>
        <KdyField
          label='外卖订单号'
          value={orderNo}
          onChange={setOrderNo}
          placeholder='例如：KD2026101501（列表只显示后四位）'
          maxLength={TAKEOUT_GUARD_ORDER_NO_MAX}
        />
        <KdyField
          label='取餐点'
          value={place}
          onChange={setPlace}
          placeholder='例如：生活区 5 号楼一层外卖架'
          maxLength={TAKEOUT_GUARD_PLACE_MAX}
        />
      </KdyCard>

      <KdyCard title='发生时间' elevated={false}>
        <KdyField
          label='时间'
          value={happenedAtText}
          onChange={setHappenedAtText}
          placeholder='YYYY-MM-DD HH:mm'
          maxLength={20}
          hint='按本地时间填写，支持 2026-10-16 20:30 或 2026/10/16 20:30'
        />
        <View className='kdy-tg-create__chips'>
          <KdyChip onClick={() => applyPreset(0)}>刚刚</KdyChip>
          <KdyChip onClick={() => applyPreset(60)}>1 小时前</KdyChip>
          <KdyChip onClick={() => applyPreset(24 * 60)}>昨天此时</KdyChip>
        </View>
      </KdyCard>

      <KdyCard title='经过描述' elevated={false}>
        <KdyField
          label='经过'
          value={detail}
          onChange={setDetail}
          placeholder='例如：取餐时袋子被拆开，主食和饮料都不见了，旁边只剩包装'
          maxLength={TAKEOUT_GUARD_DETAIL_MAX}
          hint='必填。写得越清楚，后续和对方或辅导员沟通越省事。'
        />
      </KdyCard>

      <KdyCard title='证据图（选填）' elevated={false}>
        <KdyImageUploader
          items={attachments.items}
          availability={attachments.availability}
          full={attachments.items.length >= TAKEOUT_GUARD_EVIDENCE_MAX}
          maxCount={TAKEOUT_GUARD_EVIDENCE_MAX}
          onAdd={() => void attachments.add()}
          onRemove={attachments.remove}
          onRetry={(id) => void attachments.retry(id)}
          onRetryAvailability={() => void container.useCases.media.ensureAvailability(true)}
        />
        <Text className='kdy-tg-create__hint'>当前每条记录最多 1 张证据图。</Text>
      </KdyCard>

      {problems.length > 0 && (
        <Text className='kdy-tg-create__problems'>还需要完善：{problems.join('、')}</Text>
      )}
      {imageProblem !== null && <Text className='kdy-tg-create__problems'>{imageProblem}</Text>}
      {error !== null && <Text className='kdy-tg-create__error'>{error}</Text>}

      <View className='kdy-tg-create__actions'>
        <KdyButton
          block
          loading={submitting}
          disabled={problems.length > 0 || imageProblem !== null}
          onClick={() => void handleSubmit()}
        >
          保存记录
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        请勿在这里公开点名或填写他人隐私信息。平台不判定谁对谁错，只帮你把经过记清楚、把诉求说清楚。
      </Text>
    </View>
  )
}
