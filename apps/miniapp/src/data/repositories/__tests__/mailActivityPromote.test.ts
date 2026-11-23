import { describe, expect, it } from 'vitest'
import type { ApiError } from '@kedaya/contracts'
import { ok, type Result } from '@kedaya/shared'

import type { ApiClient, ApiRequestExtras, QueryMap } from '../../api/request'
import type { MailAccountRepository } from '../../../domain/ports/mailAccountRepository'
import { createMailActivityUseCases } from '../../../application/activities/mailActivityUseCases'
import { createHttpActivityRepository } from '../httpActivityRepository'

/**
 * `promote` 的**真实 HTTP 契约**。
 *
 * 页面只调用 `mail.promote(eventId)`；幂等键必须由用例生成并一路传到
 * `POST /activities/imports/mail` 的 `Idempotency-Key` 头。只断言用例
 * 「调用了仓储」不够 —— 那正好漏掉了键没有透传的情况。
 */

const NOW = new Date('2026-11-22T04:00:00.000Z')

const WIRE_ACTIVITY = {
  id: 'act-mail-1',
  source: 'campus-mail',
  kind: 'lecture',
  title: '分布式系统讲座',
  startsAt: '2026-11-24T06:00:00.000Z',
  endsAt: null,
  location: '1A-200',
  organizer: '信息学院',
  registrationDeadlineAt: null,
  registrationDeadlineRaw: null,
  registrationUrl: null,
  evidenceText: '11月24日 14:00 信息学院 1A-200',
  confidence: 0.8,
  status: 'candidate',
  sourceUrl: null,
  sourceLabel: '校园邮箱',
  publishedAt: '2026-11-20T00:00:00.000Z',
  stale: false,
}

interface RecordedCall {
  method: 'POST'
  path: string
  body?: unknown
  extras?: ApiRequestExtras
}

function createFakeApiClient(
  handler: () => Result<unknown, ApiError> = () => ok({ items: [WIRE_ACTIVITY], created: 1, skipped: 0 }),
): ApiClient & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  return {
    calls,
    async request() {
      throw new Error('该测试只覆盖 POST')
    },
    async get<T>(_path: string, _query?: QueryMap): Promise<Result<T, ApiError>> {
      throw new Error('该测试只覆盖 POST')
    },
    async post<T, TBody = unknown>(
      path: string,
      body?: TBody,
      extras?: ApiRequestExtras,
    ): Promise<Result<T, ApiError>> {
      calls.push({
        method: 'POST',
        path,
        ...(body === undefined ? {} : { body }),
        ...(extras === undefined ? {} : { extras }),
      })
      return handler() as Result<T, ApiError>
    },
    async patch<T>(): Promise<Result<T, ApiError>> {
      throw new Error('该测试只覆盖 POST')
    },
    async put<T>(): Promise<Result<T, ApiError>> {
      throw new Error('该测试只覆盖 POST')
    },
    async del<T>(): Promise<Result<T, ApiError>> {
      throw new Error('该测试只覆盖 POST')
    },
  }
}

function createMailRepository(): MailAccountRepository {
  return {
    async bind(input) {
      return ok({
        email: input.email,
        imapHost: input.imapHost,
        imapPort: input.imapPort,
        status: 'active',
        lastSyncAt: null,
      })
    },
    async unlink() {
      return ok(true)
    },
    async sync() {
      return ok({ scanned: 0, matched: 0, stored: 0, lastSyncAt: null, stale: false })
    },
    async events() {
      return ok({ items: [], stale: false })
    },
  }
}

describe('邮件提升 · 真实 HTTP 契约', () => {
  it('promote 生成 Idempotency-Key 并透传到 POST /activities/imports/mail', async () => {
    const client = createFakeApiClient()
    const activities = createHttpActivityRepository(client)
    const mail = createMailActivityUseCases({
      repository: createMailRepository(),
      activities,
      clock: { now: () => NOW },
    })

    const result = await mail.promote('mail-ev-1')

    expect(result.ok).toBe(true)
    expect(client.calls).toHaveLength(1)
    const call = client.calls[0]
    expect(call?.method).toBe('POST')
    expect(call?.path).toBe('activities/imports/mail')
    expect(call?.body).toEqual({ eventIds: ['mail-ev-1'] })
    expect(call?.extras?.idempotencyKey).toBeTruthy()
    expect(call?.extras?.idempotencyKey).toContain('activities:import:mail:mail-ev-1')
  })

  it('空 id 不发请求', async () => {
    const client = createFakeApiClient()
    const activities = createHttpActivityRepository(client)
    const mail = createMailActivityUseCases({
      repository: createMailRepository(),
      activities,
      clock: { now: () => NOW },
    })

    const result = await mail.promote('   ')

    expect(result.ok).toBe(false)
    expect(client.calls).toEqual([])
  })
})
