import type { Result } from '@kedaya/shared'

import type { ReportReceipt, ReportReason, ReportTargetType } from '../models/report'
import type { RepositoryError } from './errors'

/** 提交举报的入参 */
export interface ReportDraft {
  targetType: ReportTargetType
  targetId: string
  reason: ReportReason
  /** 可选补充说明（服务端按 300 码点截断） */
  detail?: string
}

export interface ReportRepository {
  submit(draft: ReportDraft): Promise<Result<ReportReceipt, RepositoryError>>
  /** 我举报过的内容（用于在详情页显示「已举报」，以及避免重复提交） */
  listMine(): Promise<Result<ReportReceipt[], RepositoryError>>
}
