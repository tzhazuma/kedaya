import { Text, View } from '@tarojs/components'
import { useRouter } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import {
  FORUM_REPORT_REASONS,
  FORUM_REPORT_REASON_LABELS,
} from '../../../../domain/models/forum'
import type { ForumReportReason, ForumReportTargetType } from '../../../../domain/models/forum'
import { navigateBack, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdySwitch } from '../../../components'
import './index.scss'

/**
 * 举报页 —— 契约 §11.2 已登记动作 `forum.report` 的入口。
 *
 * 从主题详情页进入（`forumReportPath({ targetType, targetId })`）。
 * 页面上明确说明「匿名举报只影响展示，治理层仍可见身份」，
 * 这与 domain-model §2.4 的「3 个**不同**用户举报才触发隐藏」是一致的：
 * 完全匿名的举报会让阈值判定失去意义。
 */

function readTargetType(params: Record<string, string | undefined>): ForumReportTargetType | null {
  const value = params.targetType
  return value === 'POST' || value === 'REPLY' ? value : null
}

export default function ForumReportPage() {
  const router = useRouter()
  const params = router.params as Record<string, string | undefined>

  const targetType = readTargetType(params)
  const targetId = params.targetId ?? ''

  const container = getContainer()
  const reportUseCase = container.useCases.reportForumContent

  const [reason, setReason] = useState<ForumReportReason | null>(null)
  const [anonymous, setAnonymous] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(): Promise<void> {
    if (targetType === null || targetId === '') {
      toast('举报对象不存在')
      return
    }
    if (reason === null) {
      toast('请选择举报理由')
      return
    }

    setSubmitting(true)
    try {
      const result = await reportUseCase.submit({ targetType, targetId, reason, anonymous })
      if (!result.ok) {
        toast(result.error.message)
        return
      }
      toast('举报已提交，我们会尽快处理', 'success')
      await navigateBack()
    } finally {
      setSubmitting(false)
    }
  }

  if (targetType === null || targetId === '') {
    return (
      <View className='kdy-page kdy-forum-report'>
        <KdyEmpty mode='error' description='举报参数缺失，请从主题页重新进入' actionText='返回' onAction={() => void navigateBack()} />
      </View>
    )
  }

  return (
    <View className='kdy-page kdy-forum-report'>
      <KdyCard title='举报理由' elevated={false}>
        <Text className='kdy-forum-report__target'>
          举报对象：{targetType === 'POST' ? '主题' : '回复'} · {targetId}
        </Text>

        <View className='kdy-forum-report__reasons'>
          {FORUM_REPORT_REASONS.map((item) => (
            <View key={item} className='kdy-forum-report__reason'>
              <KdyChip active={reason === item} onClick={() => setReason(item)}>
                {FORUM_REPORT_REASON_LABELS[item]}
              </KdyChip>
            </View>
          ))}
        </View>

        {reason !== null && (
          <Text className='kdy-forum-report__selected'>
            已选择：{reportUseCase.reasonLabel(reason)}
          </Text>
        )}
      </KdyCard>

      <KdyCard title='举报方式' elevated={false}>
        <KdySwitch
          checked={anonymous}
          label='匿名举报'
          description='被举报人看不到你的昵称；治理人员仍可看到，用于判定「多个不同用户举报」'
          onChange={setAnonymous}
        />
        <Text className='kdy-forum-report__privacy'>
          举报记录只用于社区治理。恶意举报同样会被记录。
        </Text>
      </KdyCard>

      <View className='kdy-forum-report__actions'>
        <KdyButton
          block
          size='lg'
          loading={submitting}
          disabled={reason === null}
          onClick={() => {
            void handleSubmit()
          }}
        >
          提交举报
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={() => void navigateBack()}>
          取消
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，举报由志愿者版主处理。
      </Text>
    </View>
  )
}
