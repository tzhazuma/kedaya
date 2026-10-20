import { describe, expect, it } from 'vitest'
import type { ApiError } from '@kedaya/contracts'
import { ok, type Result } from '@kedaya/shared'

import { createHttpTechpieRepository } from '../httpTechpieRepository'
import type { ApiClient, ApiRequestExtras, QueryMap } from '../../api/request'
import { createLogPort, createMemorySink } from '../../../platform/log'

/**
 * 真后端 TechPie 仓储的**路径 / 动作名 / 幂等键 / 形状归一化**测试。
 *
 * 断言四件事：
 * 1. 路径落在契约 §6.1 的 `/techpie/*` 与 `/campus-card/*` 前缀下；
 * 2. 续期用的是契约 §11.2 **已冻结**的 action 名 `renew`（三端不得自创）；
 * 3. 所有 `POST` 都带 `Idempotency-Key`（契约 §11.3 必需）；
 * 4. ⚠️ **不存在** `webview-session` / `cookieHeaderFor` 这类出口
 *    （契约 §11.10-F：小程序端 I3 没有出口）。
 */

interface RecordedCall {
  method: 'GET' | 'POST' | 'DELETE'
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
      const call: RecordedCall = { method: 'POST', path, body, ...(extras === undefined ? {} : { extras }) }
      calls.push(call)
      return handler(call) as Result<T, ApiError>
    },
    async patch<T>(): Promise<Result<T, ApiError>> {
      return unsupported()
    },
    async put<T>(): Promise<Result<T, ApiError>> {
      return unsupported()
    },
    async del<T>(path: string, extras?: ApiRequestExtras): Promise<Result<T, ApiError>> {
      const call: RecordedCall = { method: 'DELETE', path, ...(extras === undefined ? {} : { extras }) }
      calls.push(call)
      return handler(call) as Result<T, ApiError>
    },
  }
}

const BINDING_WIRE = {
  id: 'tpl-1',
  provider: 'ecard',
  status: 'ACTIVE',
  displayName: null,
  boundAt: '2026-10-17T01:30:00.000Z',
  expiresAt: null,
  lastSyncAt: '2026-10-17T01:30:00.000Z',
  phase: 'phase0',
}

const CREDENTIAL = { channel: 'wechat-openid' as const, wechatLoginCode: 'wx-code-1' }

describe('http · techpie repository（路径与契约 §11.2 的动作名）', () => {
  it('listBindings → GET techpie/links（游标原样透传）', async () => {
    const client = createFakeApiClient(() => ok({ items: [BINDING_WIRE], nextCursor: 'c2', total: 1 }))
    const repository = createHttpTechpieRepository(client)

    const result = await repository.listBindings({ cursor: 'c1', limit: 5 })

    expect(client.calls[0]?.method).toBe('GET')
    expect(client.calls[0]?.path).toBe('techpie/links')
    expect(client.calls[0]?.query).toEqual({ cursor: 'c1', limit: 5 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items[0]?.provider).toBe('ecard')
  })

  it('bindingDetail → GET /techpie/links/:id', async () => {
    const client = createFakeApiClient(() => ok(BINDING_WIRE))
    const repository = createHttpTechpieRepository(client)
    await repository.bindingDetail('tpl-1')
    expect(client.calls[0]?.path).toBe('techpie/links/tpl-1')
  })

  it('createBinding → POST /techpie/links，带 Idempotency-Key（契约 §11.3）', async () => {
    const client = createFakeApiClient(() => ok(BINDING_WIRE))
    const repository = createHttpTechpieRepository(client)

    await repository.createBinding({ provider: 'ecard', credential: CREDENTIAL }, 'idem-1')

    expect(client.calls[0]?.method).toBe('POST')
    expect(client.calls[0]?.path).toBe('techpie/links')
    expect(client.calls[0]?.extras?.idempotencyKey).toBe('idem-1')
    // ⚠️ 送出去的是 wx.login 的一次性 code（承载在 OpenAPI 的 `openid` 字段上），
    // 不是密码、也不是真正的 openid —— 这是已登记的契约缺口
    expect(client.calls[0]?.body).toEqual({ provider: 'ecard', openid: 'wx-code-1' })
  })

  it('unbind → DELETE /techpie/links/:id', async () => {
    const client = createFakeApiClient(() => ok({}))
    const repository = createHttpTechpieRepository(client)
    await repository.unbind('tpl-1', 'idem-2')
    expect(client.calls[0]?.method).toBe('DELETE')
    expect(client.calls[0]?.path).toBe('techpie/links/tpl-1')
    expect(client.calls[0]?.extras?.idempotencyKey).toBe('idem-2')
  })

  it('⚠️ renew → POST /techpie/links/:id/renew（action 名逐字等于契约 §11.2）', async () => {
    const client = createFakeApiClient(() => ok(BINDING_WIRE))
    const repository = createHttpTechpieRepository(client)

    await repository.renew('tpl-1', 'idem-3')

    expect(client.calls[0]?.method).toBe('POST')
    expect(client.calls[0]?.path).toBe('techpie/links/tpl-1/renew')
    expect(client.calls[0]?.extras?.idempotencyKey).toBe('idem-3')
  })

  it('capabilities → GET /techpie/capabilities', async () => {
    const client = createFakeApiClient(() =>
      ok({ capabilities: [{ key: 'campus_card', nameZh: '校园卡', available: false, requiredProvider: 'ecard', phase: 'phase0', blockedReason: null }], unboundCount: 1 }),
    )
    const repository = createHttpTechpieRepository(client)

    const result = await repository.capabilities()

    expect(client.calls[0]?.path).toBe('techpie/capabilities')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value[0]?.requiredProvider).toBe('ecard')
  })

  it('cardTransactions → GET /campus-card/items（冻结契约的流水端点）', async () => {
    const client = createFakeApiClient(() =>
      ok({
        items: [
          { id: 'txn-1', amountFen: -1250, balanceFen: 58_750, merchant: '一食堂', occurredAt: '2026-10-17T03:12:00.000Z' },
        ],
        nextCursor: null,
      }),
    )
    const repository = createHttpTechpieRepository(client)

    const result = await repository.cardTransactions()

    expect(client.calls[0]?.path).toBe('campus-card/items')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items[0]?.balanceFen).toBe(58_750)
  })

  it('paymentCode → **GET** /campus-card/payment-code（2026-10-20 修正）', async () => {
    const client = createFakeApiClient(() =>
      ok({ code: 'C1', issuedAt: '2026-10-17T03:00:00.000Z', expiresAt: '2026-10-17T03:01:00.000Z' }),
    )
    const repository = createHttpTechpieRepository(client)

    const result = await repository.paymentCode('idem-4')

    // ⚠️ 这里是 **GET**，不是 POST。
    //
    // 服务端只注册了 `@Get('payment-code')`。此前客户端用 POST 会得到 **405**，
    // 而 405 在 UI 上被渲染成「未知错误」—— 用户根本看不到那句本该出现的
    // 「真实通道未打通（503）」。方法不匹配比 503 更糟：它把有用的信息盖掉了。
    //
    // 为什么是 GET 而不是「服务端补一个 POST」：付款码是**取一个短时效凭证**，
    // 不是创建持久资源。响应带 `Cache-Control: no-store`，每次取都得到新码，
    // 重复取无副作用 —— 没有理由要 POST，也没有理由要 idempotency-key。
    expect(client.calls[0]?.method).toBe('GET')
    expect(client.calls[0]?.path).toBe('/campus-card/payment-code')
    // 形参保留（不改用例层签名），但**不再发送**：服务端不认这个头，
    // 发了只会让抓包的人以为它在起作用。
    expect(client.calls[0]?.extras?.idempotencyKey).toBeUndefined()
    expect(result.ok).toBe(true)
  })
})

describe('http · techpie repository（⚠️ 契约 §11.10-F：小程序端没有 cookie 出口）', () => {
  it('仓储对象上**不存在** webview-session / cookieHeaderFor / cookie 相关方法', () => {
    const repository = createHttpTechpieRepository(createFakeApiClient())

    const names = Object.keys(repository)
    expect(names).not.toContain('webviewSession')
    expect(names).not.toContain('cookieHeaderFor')
    expect(names).not.toContain('cookies')
    expect(names).not.toContain('ticket')
    expect(names.sort()).toEqual(
      [
        'bindingDetail',
        'capabilities',
        'cardTransactions',
        'createBinding',
        'listBindings',
        'paymentCode',
        'renew',
        'unbind',
      ].sort(),
    )
  })

  it('全部方法调用里**没有**任何指向 /webview-session 的路径', async () => {
    const client = createFakeApiClient(() => ok({ items: [], nextCursor: null }))
    const repository = createHttpTechpieRepository(client)

    await repository.listBindings()
    await repository.capabilities()
    await repository.cardTransactions()

    for (const call of client.calls) {
      expect(call.path).not.toContain('webview-session')
      expect(call.path).not.toContain('cookie')
    }
  })
})

describe('http · techpie repository（形状归一化：响应夹带凭证即拒绝）', () => {
  it('⚠️ 响应条目含 castgc → 该条目被丢弃 + 记契约违规', async () => {
    const sink = createMemorySink()
    const log = createLogPort({ sink })
    const client = createFakeApiClient(() =>
      ok({ items: [{ ...BINDING_WIRE, castgc: 'TGT-LEAKED' }], nextCursor: null }),
    )
    const repository = createHttpTechpieRepository(client, { log })

    const result = await repository.listBindings()

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items).toEqual([])
    const violation = sink.records.find((record) => record.event === 'techpie.contract.violation')
    expect(violation?.fields.where).toBe('techpie.links')
    expect(JSON.stringify(sink.records)).not.toContain('TGT-LEAKED')
  })

  it('绑定详情的响应含 cookie → 返回 INTERNAL，而不是把凭证交给上层', async () => {
    const client = createFakeApiClient(() => ok({ ...BINDING_WIRE, cookie: 'JSESSIONID=1' }))
    const repository = createHttpTechpieRepository(client)

    const result = await repository.bindingDetail('tpl-1')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INTERNAL')
  })

  it('能力清单里含凭证键的条目被丢弃，其余保留', async () => {
    const client = createFakeApiClient(() =>
      ok({
        capabilities: [
          { key: 'ok', nameZh: '好', available: true, requiredProvider: null, phase: 'phase0', blockedReason: null },
          { key: 'bad', nameZh: '坏', available: true, tenant: 't1' },
        ],
      }),
    )
    const repository = createHttpTechpieRepository(client)

    const result = await repository.capabilities()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.map((item) => item.key)).toEqual(['ok'])
  })

  it('上游失败原样透传（含 409 CAMPUS_BINDING_REQUIRED 的语义）', async () => {
    const client = createFakeApiClient(() => ({
      ok: false,
      error: { code: 'CAMPUS_BINDING_REQUIRED', message: '请先绑定校园卡' },
    }))
    const repository = createHttpTechpieRepository(client)

    const result = await repository.cardTransactions()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CAMPUS_BINDING_REQUIRED')
  })
})
