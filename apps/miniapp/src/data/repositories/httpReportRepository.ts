import { err, ok, type Result } from '@kedaya/shared'

import type { RepositoryError } from '../../domain/ports/errors'
import type { ReportReceipt } from '../../domain/models/report'
import type { ReportDraft, ReportRepository } from '../../domain/ports/reportRepository'
import type { ApiClient } from '../api'
import { toRepositoryError } from './toRepositoryError'

/**
 * 举报仓储（真实后端）。
 *
 * 与别处不同的两点：
 *   · `submit` **不重试**（重复提交会被服务端 409 挡掉，重试只是白跑一趟）；
 *   · 409「你已经举报过」是**正常结局**，不当作错误弹红 —— 调用方（用例层）会把它
 *     翻译成「你之前已经举报过了」，因为用户真正关心的是"我的举报收到了吗"。
 */
export function createHttpReportRepository(client: ApiClient): ReportRepository {
  return {
    async submit(draft: ReportDraft): Promise<Result<ReportReceipt, RepositoryError>> {
      const result = await client.post<ReportReceipt, ReportDraft>('/reports', draft)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async listMine(): Promise<Result<ReportReceipt[], RepositoryError>> {
      const result = await client.get<ReportReceipt[]>('/reports/mine')
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
