import { err, type Result } from '@kedaya/shared'

import { FORUM_REPORT_REASONS, reportReasonLabel } from '../../domain/models/forum'
import type { ForumReport, ForumReportReason, ForumReportTargetType } from '../../domain/models/forum'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ForumRepository } from '../../domain/ports/forumRepository'
import type { SessionStorePort } from '../../domain/ports/sessionPort'
import { createIdempotencyKey } from '../idempotency'

/**
 * 「举报」用例 —— 契约 §11.2 已登记的领域动作 `forum.report`。
 *
 * 两点刻意的设计：
 * 1. **必须登录**：`ForumReport.reporterId` 是真实身份，治理规则依赖
 *    「3 个**不同**用户举报」的阈值（domain-model §2.4）。允许完全匿名举报
 *    会让阈值判定失去意义。
 * 2. 但**展示可以匿名**：`anonymous: true` 只影响举报人是否在治理界面露出昵称，
 *    不影响 `reporterId` 的落库。这两件事必须解耦（契约 §9）。
 *
 * 幂等：同一个人对同一目标重复举报，mock 仓储返回 `CONFLICT`，
 * 页面据此提示「你已举报过」，而不是静默成功。
 */

export interface ReportForumContentDeps {
  repository: ForumRepository
  session: SessionStorePort
  clock: ClockPort
}

export interface ReportForumContentDraft {
  targetType: ForumReportTargetType
  targetId: string
  reason: ForumReportReason
  /** 举报以匿名身份展示（治理层仍可见 reporterId） */
  anonymous?: boolean
  idempotencyKey?: string
}

export interface ReportForumContentUseCase {
  /** 供页面确认弹窗展示「你选择的理由」 */
  reasonLabel(reason: ForumReportReason): string
  submit(draft: ReportForumContentDraft): Promise<Result<ForumReport, RepositoryError>>
}

export function createReportForumContentUseCase(
  deps: ReportForumContentDeps,
): ReportForumContentUseCase {
  const { repository, session, clock } = deps

  return {
    reasonLabel: (reason: ForumReportReason) => reportReasonLabel(reason),

    async submit(draft: ReportForumContentDraft): Promise<Result<ForumReport, RepositoryError>> {
      const profile = session.getSnapshot().profile
      if (profile === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录后再举报' })
      }

      if (draft.targetId.trim() === '') {
        return err({ code: 'VALIDATION_FAILED', message: '举报对象不存在' })
      }
      if (!FORUM_REPORT_REASONS.includes(draft.reason)) {
        return err({ code: 'VALIDATION_FAILED', message: '请选择举报理由' })
      }

      const now = clock.now()
      return repository.report({
        targetType: draft.targetType,
        targetId: draft.targetId,
        reason: draft.reason,
        reporterId: profile.id,
        anonymous: draft.anonymous === true,
        idempotencyKey:
          draft.idempotencyKey ??
          createIdempotencyKey(`forum:report:${profile.id}:${draft.targetId}`, now),
      })
    },
  }
}
