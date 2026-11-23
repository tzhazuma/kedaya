import type { Result } from '@kedaya/shared'

import type {
  MailAccountFormInput,
  MailAccountSummary,
  MailEventsSnapshot,
  MailSyncSummary,
} from '../models/mailActivity'
import type { RepositoryError } from './errors'

/**
 * 校园邮箱端口 —— **复用现成 `/mail` 模块**，不另造邮件协议。
 *
 * ```
 * POST   /mail/account   { email, imapHost, imapPort, password }
 * DELETE /mail/account
 * POST   /mail/sync
 * GET    /mail/events
 * ```
 *
 * 密码只在 `bind` 的入参里出现一次；端口没有任何「读密码 / 解密」方法，
 * 响应类型也不含密码字段。
 */
export interface MailAccountRepository {
  bind(
    input: MailAccountFormInput,
    idempotencyKey?: string,
  ): Promise<Result<MailAccountSummary, RepositoryError>>
  unlink(idempotencyKey?: string): Promise<Result<true, RepositoryError>>
  sync(idempotencyKey?: string): Promise<Result<MailSyncSummary, RepositoryError>>
  events(): Promise<Result<MailEventsSnapshot, RepositoryError>>
}
