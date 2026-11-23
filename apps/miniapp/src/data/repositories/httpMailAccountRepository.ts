import { modulePath } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import {
  normalizeMailAccount,
  normalizeMailEvents,
  normalizeMailSyncResult,
  type MailAccountFormInput,
  type MailAccountSummary,
  type MailEventsSnapshot,
  type MailSyncSummary,
} from '../../domain/models/mailActivity'
import type { RepositoryError } from '../../domain/ports/errors'
import type { MailAccountRepository } from '../../domain/ports/mailAccountRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 校园邮箱 HTTP 仓储 —— **复用现成 `/mail` 模块**。
 *
 * ```
 * POST   /mail/account { email, imapHost, imapPort, password }
 * DELETE /mail/account
 * POST   /mail/sync
 * GET    /mail/events
 * ```
 *
 * 密码只出现在 `POST /mail/account` 的请求体里；任何响应都会经过
 * `normalizeMailAccount` / `normalizeMailEvents` 逐字段挑选，
 * 密码、密文、密钥版本不会进入客户端状态。
 */
export function createHttpMailAccountRepository(client: ApiClient): MailAccountRepository {
  return {
    async bind(
      input: MailAccountFormInput,
      idempotencyKey?: string,
    ): Promise<Result<MailAccountSummary, RepositoryError>> {
      const result = await client.post<unknown, MailAccountFormInput>(
        modulePath('mail', 'account'),
        input,
        idempotencyKey === undefined ? {} : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))

      const normalized = normalizeMailAccount(result.value)
      if (normalized === null) {
        return err({ code: 'INTERNAL', message: '邮箱绑定结果形状不合法，已拒绝使用' })
      }
      return ok(normalized)
    },

    async unlink(idempotencyKey?: string): Promise<Result<true, RepositoryError>> {
      const result = await client.del<unknown>(
        modulePath('mail', 'account'),
        idempotencyKey === undefined ? {} : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(true)
    },

    async sync(idempotencyKey?: string): Promise<Result<MailSyncSummary, RepositoryError>> {
      const result = await client.post<unknown, undefined>(
        modulePath('mail', 'sync'),
        undefined,
        idempotencyKey === undefined ? {} : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(normalizeMailSyncResult(result.value))
    },

    async events(): Promise<Result<MailEventsSnapshot, RepositoryError>> {
      const result = await client.get<unknown>(modulePath('mail', 'events'))
      if (!result.ok) return err(toRepositoryError(result.error))

      const value =
        typeof result.value === 'object' && result.value !== null
          ? (result.value as Record<string, unknown>)
          : {}
      const raw = Array.isArray(value.items) ? value.items : []
      const items = normalizeMailEvents(raw)
      return ok({ items, stale: value.stale === true })
    },
  }
}
