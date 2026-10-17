/**
 * 举报的领域模型（纯数据 + 白名单，零框架依赖）。
 *
 * ⚠️ `ReportTargetType` / `ReportReason` 的取值必须与服务端
 * `services/api/src/modules/reports/domain/reports.domain.ts` 一致。
 * 服务端用 `z.enum` 校验，漂移的后果是**提交时报 400**（不是静默失败），
 * 所以这条约束是硬的；中文标签属于纯展示，各端各有一份没问题。
 */

export type ReportTargetType =
  | 'flea-item'
  | 'errand-task'
  | 'buddy-group'
  | 'lost-found-item'
  | 'forum-post'
  | 'forum-reply'
  // 同学共建型内容（食堂菜品 / 常见问题 / 动物观察点 / 服务目录）
  | 'canteen-dish'
  | 'faq-entry'
  | 'wildlife-spot'
  | 'techpie-link'

export type ReportReason =
  | 'illegal'
  | 'porn'
  | 'harassment'
  | 'fraud'
  | 'privacy'
  | 'spam'
  | 'other'

/**
 * 举报原因选项（顺序即展示顺序）。
 *
 * 顺序是**刻意**的：最需要优先处理的放前面，「其它」放最后 ——
 * 大多数用户会顺手点第一个，把「诈骗 / 虚假交易」放第一个比把「其它」放第一个有用得多。
 */
export const REPORT_REASON_OPTIONS: ReadonlyArray<{ value: ReportReason; label: string }> = [
  { value: 'fraud', label: '诈骗 / 虚假交易' },
  { value: 'illegal', label: '违法违规' },
  { value: 'porn', label: '色情低俗' },
  { value: 'harassment', label: '侮辱谩骂' },
  { value: 'privacy', label: '泄露隐私' },
  { value: 'spam', label: '垃圾广告' },
  { value: 'other', label: '其它' },
]

export function reportReasonLabel(reason: ReportReason): string {
  return REPORT_REASON_OPTIONS.find((option) => option.value === reason)?.label ?? '其它'
}

/** 举报成功后的回执（服务端形状） */
export interface ReportReceipt {
  id: string
  targetType: ReportTargetType
  targetId: string
  targetTitle: string
  reason: ReportReason
  detail: string | null
  /** 达到阈值已被升级（客户端据此显示「已加急」） */
  escalated: boolean
  createdAt: string
}
