import type { Result } from '@kedaya/shared'

import type { RepositoryError } from '../../domain/ports/errors'
import type { ReportReceipt, ReportTargetType } from '../../domain/models/report'
import type { ReportDraft, ReportRepository } from '../../domain/ports/reportRepository'

/**
 * 举报用例。
 *
 * ## 为什么需要一个「我举报过什么」的缓存
 *
 * 详情页在挂载时要判断「这条内容我举报过没有」（举报过就把入口改成「已举报」，
 * 而不是让用户再点一次、再被 409 拒绝一次）。如果每次进详情页都发一次请求，
 * 列表里连续看十条就是十次请求 —— 而这份数据在整个会话里几乎不变。
 * 所以：**首次拉取后缓存，提交成功后本地追加**，失败则不缓存（下次重试）。
 *
 * ## 409 不是错误
 *
 * 服务端对重复举报返回 409。用户视角这不是"出错了"，而是"我确实举报过"。
 * 所以这里把它翻译成一次**成功语义的回执**（`alreadyReported: true`）——
 * 否则用户会看到一个红色报错，然后开始犹豫自己第一次到底有没有提交成功。
 */

export interface SubmitReportOutcome {
  receipt: ReportReceipt
  /** true = 这次是"你之前已经举报过"，而不是新提交了一条 */
  alreadyReported: boolean
}

export interface ReportUseCases {
  /** 我是否已举报过某条内容（走缓存；拉取失败时返回 false 且不缓存） */
  hasReported(targetType: ReportTargetType, targetId: string): Promise<boolean>
  submit(draft: ReportDraft): Promise<Result<SubmitReportOutcome, RepositoryError>>
  /** 仅测试/演示用：清空缓存 */
  reset(): void
}

export interface ReportUseCasesDeps {
  repository: ReportRepository
}

export function createReportUseCases({ repository }: ReportUseCasesDeps): ReportUseCases {
  /** null = 还没拉过；拉取失败保持 null，下次再试 */
  let mineCache: ReportReceipt[] | null = null

  function contains(list: ReportReceipt[], targetType: string, targetId: string): boolean {
    return list.some((item) => item.targetType === targetType && item.targetId === targetId)
  }

  return {
    async hasReported(targetType: ReportTargetType, targetId: string): Promise<boolean> {
      if (mineCache === null) {
        const result = await repository.listMine()
        if (!result.ok) return false
        mineCache = result.value
      }
      return contains(mineCache, targetType, targetId)
    },

    async submit(draft: ReportDraft): Promise<Result<SubmitReportOutcome, RepositoryError>> {
      const result = await repository.submit(draft)
      if (result.ok) {
        // 本地追加：同一会话里再进这个详情页就是「已举报」，不用再等一次网络
        mineCache = [result.value, ...(mineCache ?? [])]
        return { ok: true, value: { receipt: result.value, alreadyReported: false } }
      }

      if (result.error.code === 'CONFLICT') {
        /**
         * 服务端说"你举报过了"，但我们本地没有这条记录（例如换了设备、
         * 或上次提交成功后本地缓存被清了）。这时补一次拉取，把本地补齐 ——
         * 否则用户会陷入"点了说已经举报过，但页面又显示没举报"的循环。
         */
        const refresh = await repository.listMine()
        if (refresh.ok) mineCache = refresh.value

        const existing = (mineCache ?? []).find(
          (item) => item.targetType === draft.targetType && item.targetId === draft.targetId,
        )
        if (existing !== undefined) {
          return { ok: true, value: { receipt: existing, alreadyReported: true } }
        }
      }

      return result
    },

    reset(): void {
      mineCache = null
    },
  }
}
