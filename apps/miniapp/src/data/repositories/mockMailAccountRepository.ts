import { err, ok, type Result } from '@kedaya/shared'

import type {
  MailAccountFormInput,
  MailAccountSummary,
  MailEventItem,
  MailEventsSnapshot,
  MailSyncSummary,
} from '../../domain/models/mailActivity'
import type { RepositoryError } from '../../domain/ports/errors'
import type { MailAccountRepository } from '../../domain/ports/mailAccountRepository'

/**
 * Mock 校园邮箱 —— 离线演示「绑定 → 同步 → 提升为活动」整条链路。
 *
 * 与真后端**同形状**：绑定成功才返回账户；未绑定时同步返回
 * `CONFLICT`（服务端原话 `MAIL_ACCOUNT_NOT_LINKED`），页面据此提示
 * 「先绑定」而不是显示一个假的空列表。
 *
 * 演示事件只有活动字段与 ≤200 字证据片段，不含邮件正文 / 附件。
 */

export interface MockMailAccountRepository extends MailAccountRepository {
  readonly kind: 'mock'
  reset(): void
  /** 供 mock 活动仓储做「邮件提升」时查事件 */
  eventsForPromotion(): readonly MailEventItem[]
  isBound(): boolean
  setLatency(ms: number): void
}

export interface MockMailAccountRepositoryOptions {
  latencyMs?: number
  now?: () => Date
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function seedEvents(now: Date): MailEventItem[] {
  return [
    {
      id: 'mock-mail-ev-1',
      title: '通识大讲堂：人工智能与校园',
      startsAt: new Date(now.getTime() + DAY_MS + 7 * HOUR_MS).toISOString(),
      location: '会议中心 301',
      organizer: '通识教育中心',
      confidence: 0.88,
      matchedText: '讲座将于明晚 19:00 在会议中心 301 举行，请提前十分钟入场。',
      receivedAt: new Date(now.getTime() - 6 * HOUR_MS).toISOString(),
      stale: false,
    },
    {
      id: 'mock-mail-ev-2',
      title: '本科生科研计划说明会',
      startsAt: new Date(now.getTime() + 3 * DAY_MS + 2 * HOUR_MS).toISOString(),
      location: '信息学院 1A-200',
      organizer: '教务处',
      confidence: 0.74,
      matchedText: '本科生科研计划说明会，本周五 14:00，信息学院 1A-200。',
      receivedAt: new Date(now.getTime() - 20 * HOUR_MS).toISOString(),
      stale: false,
    },
    {
      id: 'mock-mail-ev-3',
      title: '交换项目宣讲',
      startsAt: new Date(now.getTime() + 8 * DAY_MS + 1 * HOUR_MS).toISOString(),
      location: null,
      organizer: '国际合作处',
      confidence: 0.61,
      matchedText: '交换项目宣讲下周举行，具体地点见后续通知。',
      receivedAt: new Date(now.getTime() - 30 * HOUR_MS).toISOString(),
      stale: true,
    },
  ]
}

export function createMockMailAccountRepository(
  options: MockMailAccountRepositoryOptions = {},
): MockMailAccountRepository {
  const now = options.now ?? (() => new Date())
  let latencyMs = options.latencyMs ?? 200
  let bound = false
  let account: MailAccountSummary | null = null
  let events = seedEvents(now())

  async function guard<T>(work: () => Result<T, RepositoryError>): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    return work()
  }

  function notLinked(): Result<never, RepositoryError> {
    return err({ code: 'CONFLICT', message: '尚未绑定校园邮箱，请先绑定后再同步' })
  }

  return {
    kind: 'mock',

    bind(input: MailAccountFormInput): Promise<Result<MailAccountSummary, RepositoryError>> {
      return guard(() => {
        if (input.password.trim() === '') {
          return err({ code: 'VALIDATION_FAILED', message: '请填写邮箱客户端专用密码' })
        }
        account = {
          email: input.email.trim(),
          imapHost: input.imapHost.trim(),
          imapPort: input.imapPort,
          status: 'active',
          lastSyncAt: null,
        }
        bound = true
        events = seedEvents(now())
        return ok(account)
      })
    },

    unlink(): Promise<Result<true, RepositoryError>> {
      return guard(() => {
        bound = false
        account = null
        events = seedEvents(now())
        return ok(true)
      })
    },

    sync(): Promise<Result<MailSyncSummary, RepositoryError>> {
      return guard(() => {
        if (!bound || account === null) return notLinked()
        const lastSyncAt = now().toISOString()
        account = { ...account, lastSyncAt, status: 'active' }
        return ok({
          scanned: events.length + 7,
          matched: events.length,
          stored: events.length,
          lastSyncAt,
          stale: false,
        })
      })
    },

    events(): Promise<Result<MailEventsSnapshot, RepositoryError>> {
      return guard(() => (bound ? ok({ items: [...events], stale: false }) : notLinked()))
    },

    eventsForPromotion(): readonly MailEventItem[] {
      return events
    },

    isBound(): boolean {
      return bound
    },

    reset(): void {
      bound = false
      account = null
      events = seedEvents(now())
    },

    setLatency(ms: number): void {
      latencyMs = Math.max(0, ms)
    },
  }
}
