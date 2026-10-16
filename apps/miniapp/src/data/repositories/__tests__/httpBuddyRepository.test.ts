import { describe, expect, it } from 'vitest'
import type { ApiError } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import { createHttpBuddyRepository } from '../httpBuddyRepository'
import type { ApiClient, ApiRequestExtras, QueryMap } from '../../api/request'
import {
  TEST_PROFILE,
  buddyApplication,
  buddyPost,
  buddyProfile,
  buddyTag,
} from '../../../application/__tests__/testDoubles'

/**
 * 真后端搭子仓储的**路径 / 动作名 / 幂等键**测试。
 *
 * 断言三件事：
 * 1. 路径落在契约 §6.1 的 `/buddy/*` 前缀下，且**五个动作名**逐字等于
 *    契约 §11.2 已登记的 `join` / `leave` / `close` / `decide` / `feedback`
 *    （三端**不得自创** action 名）；
 * 2. 所有 `POST` 都带 `Idempotency-Key`（契约 §11.3 必需）；
 * 3. **游标原样透传**（契约 §11.10-E：客户端不解析、不构造游标）。
 */

interface RecordedCall {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
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

  function unsupported(): never {
    throw new Error('该测试只覆盖被显式实现的几个方法')
  }

  return {
    calls,
    async request() {
      return unsupported()
    },
    async get<T>(path: string, query?: QueryMap): Promise<Result<T, ApiError>> {
      const call: RecordedCall = { method: 'GET', path, ...(query === undefined ? {} : { query }) }
      calls.push(call)
      return handler(call) as Result<T, ApiError>
    },
    async post<T, TBody = unknown>(
      path: string,
      body?: TBody,
      extras?: ApiRequestExtras,
    ): Promise<Result<T, ApiError>> {
      const call: RecordedCall = {
        method: 'POST',
        path,
        ...(body === undefined ? {} : { body }),
        ...(extras === undefined ? {} : { extras }),
      }
      calls.push(call)
      return handler(call) as Result<T, ApiError>
    },
    async put<T, TBody = unknown>(
      path: string,
      body?: TBody,
      extras?: ApiRequestExtras,
    ): Promise<Result<T, ApiError>> {
      const call: RecordedCall = {
        method: 'PUT',
        path,
        ...(body === undefined ? {} : { body }),
        ...(extras === undefined ? {} : { extras }),
      }
      calls.push(call)
      return handler(call) as Result<T, ApiError>
    },
    async del<T>(path: string, extras?: ApiRequestExtras): Promise<Result<T, ApiError>> {
      const call: RecordedCall = {
        method: 'DELETE',
        path,
        ...(extras === undefined ? {} : { extras }),
      }
      calls.push(call)
      return handler(call) as Result<T, ApiError>
    },
    async patch() {
      return unsupported()
    },
  }
}

const page = <T>(items: T[], nextCursor: string | null = null): { items: T[]; nextCursor: string | null; total: number } => ({
  items,
  nextCursor,
  total: items.length,
})

describe('httpBuddyRepository · 路径映射（契约 §6.1）', () => {
  it('listItems 走 /buddy/items 并透传 section / tags / 游标 / limit', async () => {
    const client = createFakeApiClient(() => ok(page([buddyPost('bp-1')])))
    const repo = createHttpBuddyRepository(client)

    const result = await repo.listItems({
      section: 'sport',
      tags: ['badminton', 'running'],
      cursor: 'opaque-cursor',
      limit: 5,
    })

    expect(client.calls[0]).toMatchObject({ method: 'GET', path: 'buddy/items' })
    expect(client.calls[0]?.query).toMatchObject({
      section: 'sport',
      tags: 'badminton,running',
      cursor: 'opaque-cursor',
      limit: 5,
    })
    expect(result.ok).toBe(true)
  })

  it('section=all 时不发送 section 参数（不过滤）', async () => {
    const client = createFakeApiClient(() => ok(page([])))
    const repo = createHttpBuddyRepository(client)
    await repo.listItems({ section: 'all' })
    expect(client.calls[0]?.query?.section).toBeUndefined()
  })

  it('游标**原样透传**，不做任何解析或构造（契约 §11.10-E）', async () => {
    const client = createFakeApiClient(() => ok(page([], 'next-opaque')))
    const repo = createHttpBuddyRepository(client)
    const weird = 'eyJzdGFydHNBdCI6IjIwMjYtMTAtMjQiLCJpZCI6ImJwLTEifQ'
    const result = await repo.listItems({ cursor: weird })
    expect(client.calls[0]?.query?.cursor).toBe(weird)
    if (result.ok) expect(result.value.nextCursor).toBe('next-opaque')
  })

  it('listTags 走 /buddy/tags（§11.11 的附属集合形状，无需登记动作名）', async () => {
    const client = createFakeApiClient(() => ok([buddyTag('badminton', { label: '羽毛球' })]))
    const repo = createHttpBuddyRepository(client)
    const result = await repo.listTags()
    expect(client.calls[0]).toMatchObject({ method: 'GET', path: 'buddy/tags' })
    if (result.ok) expect(result.value[0]?.label).toBe('羽毛球')
  })

  it('itemDetail 走 /buddy/items/:id 并对 id 做 URL 编码', async () => {
    const client = createFakeApiClient(() => ok(buddyPost('bp-1')))
    const repo = createHttpBuddyRepository(client)
    await repo.itemDetail('bp/1 空格')
    expect(client.calls[0]?.path).toBe('buddy/items/bp%2F1%20%E7%A9%BA%E6%A0%BC')
  })

  it('recommendations 必须带 section（规格 §5.7）', async () => {
    const client = createFakeApiClient(() =>
      ok({ matchMode: 'hash', items: [{ post: buddyPost('bp-1'), score: 0.723, reason: '同一个院系' }], nextCursor: null }),
    )
    const repo = createHttpBuddyRepository(client)
    const result = await repo.recommendations('academic', 10)

    expect(client.calls[0]).toMatchObject({ method: 'GET', path: 'buddy/recommendations' })
    expect(client.calls[0]?.query).toMatchObject({ section: 'academic', limit: 10 })
    if (result.ok) {
      expect(result.value.matchMode).toBe('hash')
      expect(result.value.items[0]?.score).toBe(0.723)
      expect(result.value.items[0]?.reason).toBe('同一个院系')
    }
  })

  it('listApplications 走 /buddy/items/:id/applications（§11.11 子集合）', async () => {
    const client = createFakeApiClient(() => ok(page([buddyApplication('ba-1')])))
    const repo = createHttpBuddyRepository(client)
    const result = await repo.listApplications('bp-1')
    expect(client.calls[0]).toMatchObject({
      method: 'GET',
      path: 'buddy/items/bp-1/applications',
    })
    if (result.ok) expect(result.value.items).toHaveLength(1)
  })
})

describe('httpBuddyRepository · 动作名与幂等键（契约 §11.2 / §11.3）', () => {
  it('join 用**已登记**的动作名 `join`，并带 Idempotency-Key', async () => {
    const client = createFakeApiClient(() => ok(buddyApplication('ba-1')))
    const repo = createHttpBuddyRepository(client)
    await repo.join('bp-1', { message: '一起', idempotencyKey: 'k-1' })

    expect(client.calls[0]).toMatchObject({ method: 'POST', path: 'buddy/items/bp-1/join' })
    expect(client.calls[0]?.extras?.idempotencyKey).toBe('k-1')
    expect(client.calls[0]?.body).toEqual({ message: '一起' })
  })

  it('leave / close / decide / feedback 四个动作名逐字等于契约 §11.2', async () => {
    const client = createFakeApiClient(() => ok({}))
    const repo = createHttpBuddyRepository(client)

    await repo.leave('bp-1', 'k-leave')
    await repo.close('bp-1', 'k-close')
    await repo.decide('bp-1', { applicationId: 'ba-1', decision: 'ACCEPTED', idempotencyKey: 'k-decide' })
    await repo.feedback('bp-1', { section: 'sport', action: 'like' })

    expect(client.calls.map((call) => call.path)).toEqual([
      'buddy/items/bp-1/leave',
      'buddy/items/bp-1/close',
      'buddy/items/bp-1/decide',
      'buddy/items/bp-1/feedback',
    ])
    expect(client.calls[0]?.extras?.idempotencyKey).toBe('k-leave')
    expect(client.calls[1]?.extras?.idempotencyKey).toBe('k-close')
    expect(client.calls[2]?.extras?.idempotencyKey).toBe('k-decide')
    expect(client.calls[2]?.body).toEqual({ applicationId: 'ba-1', decision: 'ACCEPTED' })
    expect(client.calls[3]?.body).toEqual({ section: 'sport', action: 'like' })
  })

  it('**没有**自创 `accept` / `reject` / `cancel` 之类的动作名', async () => {
    const client = createFakeApiClient(() => ok({}))
    const repo = createHttpBuddyRepository(client)
    await repo.decide('bp-1', { applicationId: 'ba-1', decision: 'REJECTED', idempotencyKey: 'k' })
    const path = client.calls[0]?.path ?? ''
    for (const invented of ['accept', 'reject', 'cancel', 'apply', 'enroll']) {
      expect(path).not.toContain(invented)
    }
  })

  it('createItem 走 POST /buddy/items 并带幂等键（契约 §11.3 必需）', async () => {
    const client = createFakeApiClient(() => ok(buddyPost('bp-new')))
    const repo = createHttpBuddyRepository(client)
    await repo.createItem(
      {
        activity: 'sport',
        title: '羽毛球',
        location: '体育馆',
        startsAt: '2026-10-24T06:00:00.000Z',
        durationMin: 120,
        capacity: 4,
        genderPreference: 'any',
        tags: ['badminton'],
      },
      'k-create',
    )
    expect(client.calls[0]).toMatchObject({ method: 'POST', path: 'buddy/items' })
    expect(client.calls[0]?.extras?.idempotencyKey).toBe('k-create')
  })
})

describe('httpBuddyRepository · 匹配资料', () => {
  it('GET /buddy/profile', async () => {
    const client = createFakeApiClient(() => ok(buddyProfile()))
    const repo = createHttpBuddyRepository(client)
    const result = await repo.getProfile()
    expect(client.calls[0]).toMatchObject({ method: 'GET', path: 'buddy/profile' })
    if (result.ok) expect(result.value?.userId).toBe(TEST_PROFILE.id)
  })

  it('GET /buddy/profile 返回 404 时等价于 null（「还没填过」不是错误）', async () => {
    const client = createFakeApiClient(() =>
      err({ code: 'NOT_FOUND', message: '没有匹配资料' }),
    )
    const repo = createHttpBuddyRepository(client)
    const result = await repo.getProfile()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBeNull()
  })

  it('PUT /buddy/profile（PUT 的幂等键可选）', async () => {
    const client = createFakeApiClient(() => ok(buddyProfile()))
    const repo = createHttpBuddyRepository(client)
    await repo.putProfile(buddyProfile({ department: '生命科学与技术学院' }))
    expect(client.calls[0]).toMatchObject({ method: 'PUT', path: 'buddy/profile' })
    expect(client.calls[0]?.extras?.idempotencyKey).toBeUndefined()
  })

  it('DELETE /buddy/profile（撤回，规格 §6.3）', async () => {
    const client = createFakeApiClient(() => ok(true))
    const repo = createHttpBuddyRepository(client)
    const result = await repo.deleteProfile()
    expect(client.calls[0]).toMatchObject({ method: 'DELETE', path: 'buddy/profile' })
    expect(result.ok).toBe(true)
  })
})

describe('httpBuddyRepository · 错误映射', () => {
  it('ApiError → RepositoryError 并带上 traceId', async () => {
    const client = createFakeApiClient(() =>
      err({ code: 'CONFLICT', message: '人数已满', details: { reason: 'POST_FULL' } }),
    )
    const repo = createHttpBuddyRepository(client)
    const result = await repo.join('bp-1', { idempotencyKey: 'k' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT')
      expect(result.error.message).toBe('人数已满')
      expect(result.error.details).toMatchObject({ reason: 'POST_FULL' })
    }
  })
})
