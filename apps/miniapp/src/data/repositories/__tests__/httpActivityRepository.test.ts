import { describe, expect, it } from 'vitest'
import type { ApiError } from '@kedaya/contracts'
import { ok, type Result } from '@kedaya/shared'

import type { ApiClient, ApiRequestExtras, QueryMap } from '../../api/request'
import { createHttpActivityRepository } from '../httpActivityRepository'
import { createHttpMailAccountRepository } from '../httpMailAccountRepository'

/**
 * 活动 / 校园邮箱的 HTTP 仓储测试。
 *
 * 只断言三件**会静默错**的事：
 *   1. 路径与动作名逐字等于共同契约（`/activities/items/:id/confirm` 等）；
 *   2. 写操作带 `Idempotency-Key`（现有 ApiClient 把信封 / 401 重试都收在内部）；
 *   3. 响应经过归一化：未知字段（尤其邮件密码 / 密文）不会进入客户端状态。
 */

interface RecordedCall {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  query?: QueryMap
  body?: unknown
  extras?: ApiRequestExtras
}

interface FakeApiClient extends ApiClient {
  calls: RecordedCall[]
}

function createFakeApiClient(
  handler: (call: RecordedCall) => Result<unknown, ApiError> = () => ok({}),
): FakeApiClient {
  const calls: RecordedCall[] = []

  function record(call: RecordedCall): Result<unknown, ApiError> {
    calls.push(call)
    return handler(call)
  }

  return {
    calls,
    async request() {
      throw new Error('该测试只覆盖被显式实现的几个方法')
    },
    async get<T>(path: string, query?: QueryMap): Promise<Result<T, ApiError>> {
      return record({ method: 'GET', path, ...(query === undefined ? {} : { query }) }) as Result<
        T,
        ApiError
      >
    },
    async post<T, TBody = unknown>(
      path: string,
      body?: TBody,
      extras?: ApiRequestExtras,
    ): Promise<Result<T, ApiError>> {
      return record({
        method: 'POST',
        path,
        body,
        ...(extras === undefined ? {} : { extras }),
      }) as Result<T, ApiError>
    },
    async patch<T, TBody = unknown>(
      path: string,
      body?: TBody,
      extras?: ApiRequestExtras,
    ): Promise<Result<T, ApiError>> {
      return record({
        method: 'PATCH',
        path,
        body,
        ...(extras === undefined ? {} : { extras }),
      }) as Result<T, ApiError>
    },
    async put<T>(): Promise<Result<T, ApiError>> {
      throw new Error('该测试不使用 PUT')
    },
    async del<T>(path: string, extras?: ApiRequestExtras): Promise<Result<T, ApiError>> {
      return record({
        method: 'DELETE',
        path,
        ...(extras === undefined ? {} : { extras }),
      }) as Result<T, ApiError>
    },
  }
}

const WIRE_ACTIVITY = {
  id: 'act-1',
  source: 'campus-mail',
  kind: 'lecture',
  title: '分布式系统讲座',
  startsAt: '2026-11-24T06:00:00.000Z',
  endsAt: null,
  location: '1A-200',
  organizer: '信息学院',
  registrationDeadlineAt: null,
  registrationDeadlineRaw: '11月24日 17:00 前',
  registrationUrl: null,
  evidenceText: '11月24日 19:00 信息学院 1A-200',
  confidence: 0.78,
  status: 'candidate',
  sourceUrl: null,
  sourceLabel: '校园邮箱',
  publishedAt: '2026-11-20T00:00:00.000Z',
  stale: false,
  // 不该进入客户端状态的字段
  password: 'secret',
  passwordCipher: 'cipher',
}

describe('http · activities repository', () => {
  it('list → GET activities/items（游标与 limit 原样透传）', async () => {
    const client = createFakeApiClient(() =>
      ok({ items: [WIRE_ACTIVITY, { ...WIRE_ACTIVITY, id: 'bad', status: 'pending' }], nextCursor: 'c2' }),
    )
    const repository = createHttpActivityRepository(client)

    const result = await repository.list({ cursor: 'c1', limit: 20 })

    expect(client.calls[0]).toEqual({
      method: 'GET',
      path: 'activities/items',
      query: { cursor: 'c1', limit: 20 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items).toHaveLength(1)
    expect(result.value.items[0]?.registrationDeadlineRaw).toBe('11月24日 17:00 前')
    expect(result.value.items[0]).not.toHaveProperty('password')
  })

  it('list 透传 status / source / from / to 筛选参数', async () => {
    const client = createFakeApiClient(() => ok({ items: [], nextCursor: null }))
    const repository = createHttpActivityRepository(client)

    await repository.list({
      status: 'confirmed',
      source: 'manual',
      from: '2026-11-22T00:00:00.000Z',
      to: '2026-11-23T00:00:00.000Z',
      limit: 100,
    })

    expect(client.calls[0]).toEqual({
      method: 'GET',
      path: 'activities/items',
      query: {
        status: 'confirmed',
        source: 'manual',
        from: '2026-11-22T00:00:00.000Z',
        to: '2026-11-23T00:00:00.000Z',
        limit: 100,
      },
    })
  })

  it('detail / update → GET,PATCH activities/items/:id', async () => {
    const client = createFakeApiClient(() => ok(WIRE_ACTIVITY))
    const repository = createHttpActivityRepository(client)

    await repository.detail('act-1')
    await repository.update('act-1', { title: '改过的标题' })

    expect(client.calls[0]).toEqual({ method: 'GET', path: 'activities/items/act-1' })
    expect(client.calls[1]).toEqual({
      method: 'PATCH',
      path: 'activities/items/act-1',
      body: { title: '改过的标题' },
    })
  })

  it('手动新增 → POST activities/items，带 source=manual 与幂等键', async () => {
    const client = createFakeApiClient(() => ok(WIRE_ACTIVITY))
    const repository = createHttpActivityRepository(client)
    const draft = {
      title: '社团招新',
      kind: 'club' as const,
      startsAt: '2026-11-25T10:00:00+08:00',
      evidenceText: '11月25日 18:00 社团招新',
    }

    await repository.create(draft, 'idem-create')

    expect(client.calls[0]?.method).toBe('POST')
    expect(client.calls[0]?.path).toBe('activities/items')
    expect(client.calls[0]?.body).toEqual(draft)
    expect(client.calls[0]?.extras?.idempotencyKey).toBe('idem-create')
  })

  it('confirm / dismiss → POST activities/items/:id/{confirm,dismiss}', async () => {
    const client = createFakeApiClient(() => ok(WIRE_ACTIVITY))
    const repository = createHttpActivityRepository(client)

    await repository.confirm('act-1', 'idem-confirm')
    await repository.dismiss('act-1', 'idem-dismiss')

    expect(client.calls[0]).toEqual({
      method: 'POST',
      path: 'activities/items/act-1/confirm',
      body: undefined,
      extras: { idempotencyKey: 'idem-confirm' },
    })
    expect(client.calls[1]?.path).toBe('activities/items/act-1/dismiss')
    expect(client.calls[1]?.extras?.idempotencyKey).toBe('idem-dismiss')
  })

  it('公众号导入 → POST activities/imports/wechat（wire 字段是 url / text，响应是 {item}）', async () => {
    const client = createFakeApiClient(() => ok({ item: WIRE_ACTIVITY, created: true }))
    const repository = createHttpActivityRepository(client)

    const first = await repository.importWechat(
      { link: 'https://mp.weixin.qq.com/s/AbCd' },
      'idem-import',
    )
    await repository.importWechat({ text: '讲座预告正文' })

    expect(client.calls[0]).toEqual({
      method: 'POST',
      path: 'activities/imports/wechat',
      body: { url: 'https://mp.weixin.qq.com/s/AbCd' },
      extras: { idempotencyKey: 'idem-import' },
    })
    expect(client.calls[1]?.body).toEqual({ text: '讲座预告正文' })
    expect(first.ok && first.value.id).toBe('act-1')
  })

  it('邮件提升 → POST activities/imports/mail { eventIds }，返回服务端全部候选', async () => {
    const client = createFakeApiClient(() =>
      ok({
        items: [WIRE_ACTIVITY, { ...WIRE_ACTIVITY, id: 'act-2', title: '第二场讲座' }],
        created: 2,
        skipped: 0,
      }),
    )
    const repository = createHttpActivityRepository(client)

    const result = await repository.importMail('mail-ev-1', 'idem-mail')

    expect(client.calls[0]).toEqual({
      method: 'POST',
      path: 'activities/imports/mail',
      body: { eventIds: ['mail-ev-1'] },
      extras: { idempotencyKey: 'idem-mail' },
    })
    expect(result.ok && result.value.map((item) => item.id)).toEqual(['act-1', 'act-2'])
  })

  it('提醒 → GET activities/reminders、POST items/:id/reminders、DELETE reminders/:id', async () => {
    const client = createFakeApiClient((call) => {
      if (call.method === 'GET') {
        return ok({
          items: [
            {
              id: 'rem-1',
              activityId: 'act-1',
              activityTitle: '分布式系统讲座',
              kind: 'registration',
              remindAt: '2026-11-22T06:00:00.000Z',
              channel: 'inapp',
              status: 'pending',
            },
          ],
        })
      }
      return ok({
        id: 'rem-2',
        kind: 'custom',
        remindAt: '2026-11-23T00:00:00.000Z',
        channel: 'inapp',
        status: 'pending',
      })
    })
    const repository = createHttpActivityRepository(client)

    const list = await repository.listReminders()
    const forActivity = await repository.listRemindersFor('act-1')
    await repository.createReminder(
      'act-1',
      { kind: 'custom', remindAt: '2026-11-23T00:00:00.000Z', channel: 'inapp' },
      'idem-rem',
    )
    await repository.deleteReminder('rem-1', 'idem-del')

    expect(client.calls[0]).toEqual({
      method: 'GET',
      path: 'activities/reminders',
      query: { limit: 100 },
    })
    expect(client.calls[1]).toEqual({
      method: 'GET',
      path: 'activities/reminders',
      query: { limit: 100 },
    })
    expect(list.ok && list.value[0]?.activityTitle).toBe('分布式系统讲座')
    expect(forActivity.ok && forActivity.value[0]?.id).toBe('rem-1')
    expect(client.calls[2]).toEqual({
      method: 'POST',
      path: 'activities/items/act-1/reminders',
      body: { kind: 'custom', remindAt: '2026-11-23T00:00:00.000Z', channel: 'inapp' },
      extras: { idempotencyKey: 'idem-rem' },
    })
    expect(client.calls[3]).toEqual({
      method: 'DELETE',
      path: 'activities/reminders/rem-1',
      extras: { idempotencyKey: 'idem-del' },
    })
  })

  it('管理员派发 → POST activities/reminders/dispatch', async () => {
    const client = createFakeApiClient(() => ok({ claimed: 3, sent: 3, failed: 0, cancelled: 0 }))
    const repository = createHttpActivityRepository(client)

    const result = await repository.dispatchReminders()

    expect(client.calls[0]).toEqual({
      method: 'POST',
      path: 'activities/reminders/dispatch',
      body: {},
    })
    expect(result.ok && result.value.dispatched).toBe(3)
  })

  it('坏数据整条拒绝，而不是渲染一个半条活动', async () => {
    const client = createFakeApiClient(() => ok({ ...WIRE_ACTIVITY, source: 'weibo' }))
    const repository = createHttpActivityRepository(client)
    const result = await repository.detail('act-1')
    expect(result.ok).toBe(false)
  })
})

describe('http · mail account repository（复用 /mail）', () => {
  const ACCOUNT_WIRE = {
    email: 'alice@shanghaitech.edu.cn',
    imapHost: 'imap.shanghaitech.edu.cn',
    imapPort: 993,
    status: 'active',
    lastSyncAt: '2026-11-22T04:00:00.000Z',
    password: 'secret',
    passwordCipher: 'cipher',
  }

  it('bind → POST mail/account，密码只出现在请求体里', async () => {
    const client = createFakeApiClient(() => ok(ACCOUNT_WIRE))
    const repository = createHttpMailAccountRepository(client)

    const result = await repository.bind(
      {
        email: 'alice@shanghaitech.edu.cn',
        imapHost: 'imap.shanghaitech.edu.cn',
        imapPort: 993,
        password: 'client-specific-password',
      },
      'idem-bind',
    )

    expect(client.calls[0]).toEqual({
      method: 'POST',
      path: 'mail/account',
      body: {
        email: 'alice@shanghaitech.edu.cn',
        imapHost: 'imap.shanghaitech.edu.cn',
        imapPort: 993,
        password: 'client-specific-password',
      },
      extras: { idempotencyKey: 'idem-bind' },
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).not.toHaveProperty('password')
  })

  it('unlink / sync / events → 对应 /mail 端点', async () => {
    const client = createFakeApiClient((call) => {
      if (call.path === 'mail/sync') {
        return ok({
          scanned: 10,
          matched: 2,
          stored: 2,
          lastSyncAt: '2026-11-22T04:00:00.000Z',
          stale: false,
        })
      }
      if (call.path === 'mail/events') {
        return ok({
          items: [
            {
              id: 'mail-ev-1',
              title: '讲座',
              startsAt: '2026-11-24T11:00:00.000Z',
              location: '1A-200',
              organizer: 'SIST',
              confidence: 0.8,
              matchedText: '11月24日 19:00',
              receivedAt: '2026-11-20T00:00:00.000Z',
              stale: false,
            },
          ],
          stale: false,
        })
      }
      return ok(true)
    })
    const repository = createHttpMailAccountRepository(client)

    await repository.unlink('idem-unlink')
    await repository.sync('idem-sync')
    const events = await repository.events()

    expect(client.calls[0]).toEqual({
      method: 'DELETE',
      path: 'mail/account',
      extras: { idempotencyKey: 'idem-unlink' },
    })
    expect(client.calls[1]?.path).toBe('mail/sync')
    expect(client.calls[1]?.extras?.idempotencyKey).toBe('idem-sync')
    expect(client.calls[2]).toEqual({ method: 'GET', path: 'mail/events' })
    expect(events.ok && events.value.items[0]?.title).toBe('讲座')
  })
})
