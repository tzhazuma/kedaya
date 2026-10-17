import { Text, View } from '@tarojs/components'
import Popup from '@taroify/core/popup'
import Textarea from '@taroify/core/textarea'
import '@taroify/core/popup/style'
import '@taroify/core/textarea/style'
import { Passed } from '@taroify/icons'
import { useEffect, useState } from 'react'

import { getContainer } from '../../../app/container'
import {
  REPORT_REASON_OPTIONS,
  type ReportReason,
  type ReportTargetType,
} from '../../../domain/models/report'
import { toast } from '../../../platform/navigation'
import { KdyButton } from '../KdyButton'
import { KdyChip } from '../KdyChip'
import './index.scss'

/**
 * KdyReportSheet —— 举报弹层（跳蚤 / 跑腿 / 搭子 / 失物 / 论坛 详情页共用）。
 *
 * ## 为什么是一个共用组件而不是各页各写一遍
 *
 * 举报是**合规能力**：它必须在每个能看内容的地方都存在、行为一致、
 * 而且不能因为某个页面"懒得接"就缺失（那正是提审被驳回的理由）。
 * 抽成一个组件后，"接举报"变成每页一行 `<KdyReportSheet targetType=... targetId=... />`，
 * 没有实现的借口。
 *
 * ## 三个刻意的交互决定
 *
 * 1. **原因超出一次可见量时允许滚动**，但原因本身是**必选**的：
 *    没有原因就没有可聚合的信号，复核的人只能逐条读自由文本。
 * 2. **提交后立刻换成"已收到"**，而不是关掉弹层 + 一个 toast。
 *    举报是被骚扰用户的**最后一次求助**，用 toast 打发掉是最让人寒心的做法；
 *    这里明确告诉他"我们收到了、会人工复核、对方不会知道是你举报的"。
 * 3. **提交按钮在未选原因时禁用且文案明确**（"请先选择原因"），
 *    而不是允许点击后弹一个红字错误。
 */
export interface KdyReportSheetProps {
  open: boolean
  onClose: () => void
  targetType: ReportTargetType
  targetId: string
  /** 提交成功后的回调（详情页据此把入口改成「已举报」） */
  onSubmitted?: () => void
  /** 被举报内容的标题（可选，展示在弹层里，降低"举报错了"的概率） */
  targetTitle?: string
}

type Phase = 'form' | 'submitting' | 'done'

export function KdyReportSheet({
  open,
  onClose,
  targetType,
  targetId,
  onSubmitted,
  targetTitle,
}: KdyReportSheetProps) {
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [detail, setDetail] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [alreadyReported, setAlreadyReported] = useState(false)

  /**
   * 每次打开都复位成"表单"，并**重新判断一次**是否已举报 ——
   * 不复位的话，用户关掉再打开会看到上次的"已收到"，以为按钮坏了。
   */
  useEffect(() => {
    if (!open) return
    setPhase('form')
    setAlreadyReported(false)
    setReason(null)
    setDetail('')

    let cancelled = false
    void getContainer()
      .useCases.report.hasReported(targetType, targetId)
      .then((reported) => {
        if (!cancelled) setAlreadyReported(reported)
      })
      .catch(() => {
        /* 判断失败就当没举报过：真正的去重由服务端把关 */
      })
    return () => {
      cancelled = true
    }
  }, [open, targetType, targetId])

  async function handleSubmit(): Promise<void> {
    if (reason === null || phase !== 'form') return
    setPhase('submitting')

    const trimmed = detail.trim()
    const result = await getContainer().useCases.report.submit({
      targetType,
      targetId,
      reason,
      ...(trimmed.length === 0 ? {} : { detail: trimmed }),
    })

    if (!result.ok) {
      setPhase('form')
      toast(result.error.message)
      return
    }

    setAlreadyReported(result.value.alreadyReported)
    setPhase('done')
    onSubmitted?.()
  }

  const canSubmit = reason !== null && phase === 'form'

  return (
    <Popup
      open={open}
      placement='bottom'
      rounded
      onClose={onClose}
      style={{ maxHeight: '82vh' }}
    >
      <View className='kdy-report'>
        <View className='kdy-report__header'>
          <Text className='kdy-report__title'>举报内容</Text>
          <Text className='kdy-report__close' onClick={onClose}>
            关闭
          </Text>
        </View>

        {phase === 'done' ? (
          <View className='kdy-report__done'>
            <View className='kdy-report__done-glyph'>
              <Passed />
            </View>
            <Text className='kdy-report__done-title'>
              {alreadyReported ? '你之前已经举报过了' : '已收到你的举报'}
            </Text>
            <Text className='kdy-report__done-desc'>
              我们会人工复核这条内容。举报是匿名的，对方不会知道是谁举报的。
            </Text>
            <KdyButton block onClick={onClose}>
              知道了
            </KdyButton>
          </View>
        ) : (
          <View className='kdy-report__body'>
            {targetTitle === undefined ? null : (
              <Text className='kdy-report__target'>内容：{targetTitle}</Text>
            )}

            <Text className='kdy-report__section'>选择原因（必选）</Text>
            <View className='kdy-report__reasons'>
              {REPORT_REASON_OPTIONS.map((option) => (
                <KdyChip
                  key={option.value}
                  active={reason === option.value}
                  onClick={() => {
                    setReason(option.value)
                  }}
                >
                  {option.label}
                </KdyChip>
              ))}
            </View>

            <Text className='kdy-report__section'>补充说明（可选）</Text>
            <View className='kdy-report__detail'>
              <Textarea
                value={detail}
                limit={300}
                placeholder='补充具体情况能帮我们更快处理'
                onChange={(event) => {
                  setDetail(event.detail.value)
                }}
              />
            </View>

            <KdyButton block disabled={!canSubmit} loading={phase === 'submitting'} onClick={handleSubmit}>
              {reason === null ? '请先选择原因' : '提交举报'}
            </KdyButton>
            <Text className='kdy-report__hint'>
              恶意举报会影响账号信用；举报不会自动下架内容，我们会人工复核。
            </Text>
          </View>
        )}
      </View>
    </Popup>
  )
}
