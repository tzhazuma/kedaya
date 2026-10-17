import { err, ok, type Result } from '@kedaya/shared'

import type { RepositoryError } from '../../domain/ports/errors'
import type { ReportReceipt } from '../../domain/models/report'
import type { ReportDraft, ReportRepository } from '../../domain/ports/reportRepository'

/**
 * 举报仓储（mock）。
 *
 * 演示模式下举报也要**真的能用、能被观察**：内存里去重 + 阈值升级，
 * 与真实后端行为一致，这样在没连后端时也能把「举报 → 已举报 → 触发加急」走完。
 * （如果这里静默吞掉，演示时会以为举报没做，上线才发现。）
 */
export interface MockReportRepositoryOptions {
  /** 每个对象被 N 个不同的人举报后升级（与后端 `REPORT_ESCALATION_THRESHOLD` 对齐） */
  escalationThreshold?: number
  now?: () => Date
}

export function createMockReportRepository(
  options: MockReportRepositoryOptions = {},
): ReportRepository & { __seedReports(targetType: string, targetId: string, count: number): void } {
  const threshold = options.escalationThreshold ?? 3
  const now = options.now ?? (() => new Date())

  /** key = `${targetType}::${targetId}` */
  const reporters = new Map<string, Set<string>>()
  const mine: ReportReceipt[] = []
  let sequence = 0

  function key(targetType: string, targetId: string): string {
    return `${targetType}::${targetId}`
  }

  return {
    submit(draft: ReportDraft): Promise<Result<ReportReceipt, RepositoryError>> {
      const k = key(draft.targetType, draft.targetId)
      const bucket = reporters.get(k) ?? new Set<string>()

      if (bucket.has('me')) {
        return Promise.resolve(
          err({ code: 'CONFLICT', message: '你已经举报过这条内容，我们正在处理' }),
        )
      }

      bucket.add('me')
      reporters.set(k, bucket)

      sequence += 1
      const receipt: ReportReceipt = {
        id: `mock-report-${String(sequence)}`,
        targetType: draft.targetType,
        targetId: draft.targetId,
        targetTitle: '(演示模式) 被举报的内容',
        reason: draft.reason,
        detail: draft.detail ?? null,
        escalated: bucket.size >= threshold,
        createdAt: now().toISOString(),
      }
      mine.unshift(receipt)
      return Promise.resolve(ok(receipt))
    },

    listMine(): Promise<Result<ReportReceipt[], RepositoryError>> {
      return Promise.resolve(ok([...mine]))
    },

    /** 仅演示/测试用：假装已经有 N 个人举报过，便于看「加急」状态 */
    __seedReports(targetType: string, targetId: string, count: number): void {
      const bucket = new Set<string>()
      for (let index = 0; index < count; index += 1) bucket.add(`demo-${String(index)}`)
      reporters.set(key(targetType, targetId), bucket)
    },
  }
}
