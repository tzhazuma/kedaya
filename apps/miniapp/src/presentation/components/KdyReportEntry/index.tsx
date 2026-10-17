import { Text, View } from '@tarojs/components'
import { WarningOutlined } from '@taroify/icons'

import type { ReportTargetType } from '../../../domain/models/report'
import { useReportEntry } from '../../hooks'
import { KdyReportSheet } from '../KdyReportSheet'
import './index.scss'

/**
 * KdyReportEntry —— 详情页底部的「举报这条内容」入口（内含举报弹层）。
 *
 * ## 为什么是「一个入口组件」而不是每页自己拼
 *
 * 举报是**合规能力**：它必须在每个能看到他人内容的地方都存在。
 * 抽成一行 JSX 之后，「这页忘了接举报」就不再是一个容易犯的错 ——
 * 而缺少举报入口正是 UGC 小程序提审被驳回的常见理由。
 *
 * ## `selfOwned`：自己的内容不显示举报入口
 *
 * 服务端会拒绝「举报自己」（没有治理意义），但让用户点到一个**必然失败**的按钮
 * 是典型的死路设计。所以由页面告诉这里「我是不是作者」（页面本来就在算这个判断），
 * 是作者就整块不渲染，而不是渲染之后弹红字。
 *
 * 已举报过时入口**保留可见**，只是文案变成「你已举报…处理中」——
 * 让用户知道自己的举报还在，而不是让他再来点一次、再被拒一次。
 */
export interface KdyReportEntryProps {
  targetType: ReportTargetType
  targetId: string
  /** 被举报内容的标题（展示在弹层里，降低「举报错了」的概率） */
  targetTitle?: string
  /** 当前用户就是这条内容的作者时为 true → 整块不渲染 */
  selfOwned?: boolean
  className?: string
}

export function KdyReportEntry({
  targetType,
  targetId,
  targetTitle,
  selfOwned = false,
  className,
}: KdyReportEntryProps) {
  const entry = useReportEntry(targetType, targetId)

  if (selfOwned) return null

  return (
    <View className={`kdy-report-entry ${className ?? ''}`}>
      <View className='kdy-report-entry__link' onClick={entry.openSheet}>
        <WarningOutlined className='kdy-report-entry__glyph' />
        <Text className={entry.reported ? 'kdy-report-entry__text--done' : 'kdy-report-entry__text'}>
          {entry.reported ? '你已举报这条内容，我们正在处理' : '举报这条内容'}
        </Text>
      </View>

      <KdyReportSheet
        open={entry.open}
        onClose={entry.closeSheet}
        targetType={targetType}
        targetId={targetId}
        {...(targetTitle === undefined ? {} : { targetTitle })}
        onSubmitted={entry.markSubmitted}
      />
    </View>
  )
}
