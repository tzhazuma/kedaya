import { err, ok, type Result } from '@kedaya/shared'

import type { ActivityItem } from '../../domain/models/activity'
import {
  mailAccountFormProblem,
  type MailAccountFormInput,
  type MailAccountSummary,
  type MailEventsSnapshot,
  type MailSyncSummary,
} from '../../domain/models/mailActivity'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ActivityRepository } from '../../domain/ports/activityRepository'
import type { MailAccountRepository } from '../../domain/ports/mailAccountRepository'
import { createIdempotencyKey } from '../idempotency'

/**
 * 校园邮箱绑定 / 同步入口 —— **复用现成 `/mail` 模块**。
 *
 * 页面只调用这里，不直接发请求；密码只在 `bind()` 的入参里出现一次，
 * 由 `ApiClient` 送进 `POST /mail/account`。服务端先真连一次 IMAP 验证，
 * 再用 AES-256-GCM 加密落库；失败时**不会**落任何凭证。
 *
 * 我们刻意没有「假成功」路径：绑定 / 同步失败一律返回错误，
 * 由页面显示后端文案并保留表单（密码已清空，需要重新输入）。
 */

export interface MailSyncOutcome extends MailEventsSnapshot {
  sync: MailSyncSummary
}

export interface MailActivityUseCases {
  bind(input: MailAccountFormInput): Promise<Result<MailAccountSummary, RepositoryError>>
  sync(): Promise<Result<MailSyncOutcome, RepositoryError>>
  events(): Promise<Result<MailEventsSnapshot, RepositoryError>>
  unlink(): Promise<Result<true, RepositoryError>>
  /** 把一条归一后的邮件事件提升为候选活动；一封邮件可能归一出多条 */
  promote(eventId: string): Promise<Result<ActivityItem[], RepositoryError>>
}

export interface MailActivityUseCaseDeps {
  readonly repository: MailAccountRepository
  readonly activities: ActivityRepository
  /** 幂等键需要稳定的时钟；测试可注入固定时刻 */
  readonly clock?: ClockPort
}

const systemClock: ClockPort = { now: () => new Date() }

export function createMailActivityUseCases(
  deps: MailActivityUseCaseDeps,
): MailActivityUseCases {
  const { repository, activities } = deps
  const clock = deps.clock ?? systemClock

  return {
    async bind(input) {
      const problem = mailAccountFormProblem(input)
      if (problem !== null) {
        return err({ code: 'VALIDATION_FAILED', message: problem })
      }
      return repository.bind({
        email: input.email.trim(),
        imapHost: input.imapHost.trim(),
        imapPort: input.imapPort,
        password: input.password,
      })
    },

    async sync() {
      const synced = await repository.sync()
      if (!synced.ok) return synced

      const events = await repository.events()
      if (!events.ok) return events

      return ok({ ...events.value, sync: synced.value })
    },

    events: () => repository.events(),
    unlink: () => repository.unlink(),

    async promote(eventId) {
      const trimmed = eventId.trim()
      if (trimmed === '') {
        return err({ code: 'VALIDATION_FAILED', message: '缺少邮件事件 id' })
      }
      // 写动作必须带幂等键：用户连点 / 网络重试不能提升出两条候选。
      return activities.importMail(
        trimmed,
        createIdempotencyKey(`activities:import:mail:${trimmed}`, clock.now()),
      )
    },
  }
}
