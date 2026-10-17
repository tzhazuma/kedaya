import { describe, expect, it } from 'vitest'

import type { AuthTokens } from '../../../domain/models/session'
import type { HttpPort, HttpRequest, HttpResponse } from '../../../domain/ports/httpPort'
import { HttpTransportError } from '../../../domain/ports/httpPort'
import type { AuthRefresherPort, TokenStorePort } from '../../../domain/ports/sessionPort'
import { buildUrl, createApiClient, parseEnvelope, statusToErrorCode } from '../request'

/**
 * 请求层测试 —— 契约 §6.1 的核心行为。
 *
 * 因为 `request.ts` 只依赖 `HttpPort` 端口（不 import Taro），
 * 这里可以用一个假 transport 完整验证：
 * 信封解包 / trace 头 / Bearer 注入 / 幂等键 / 401 刷新重试 / 并发刷新去重 / 静默失败语义。
 */

/* ---------------- 测试替身 ---------------- */

interface FakeHttp {
  port: HttpPort
  calls: HttpRequest[]
}

function createFakeHttp(
  handler: (request: HttpRequest, index: number) => HttpResponse | Promise<HttpResponse>,
): FakeHttp {
  const calls: HttpRequest[] = []
  return {
    calls,
    port: {
      async send(request: HttpRequest): Promise<HttpResponse> {
        calls.push(request)
        return handler(request, calls.length - 1)
      },
    },
  }
}

function json(statusCode: number, data: unknown): HttpResponse {
  return { statusCode, data, headers: { 'content-type': 'application/json' } }
}

interface FakeTokens extends TokenStorePort {
  current(): AuthTokens | null
  clearCount: number
}

function createFakeTokens(initial: AuthTokens | null): FakeTokens {
  let tokens = initial
  const store: FakeTokens = {
    clearCount: 0,
    current: () => tokens,
    getAccessToken: () => tokens?.accessToken ?? null,
    getRefreshToken: () => tokens?.refreshToken ?? null,
    setTokens(next: AuthTokens) {
      tokens = next
    },
    clear() {
      tokens = null
      store.clearCount += 1
    },
  }
  return store
}

const TOKENS: AuthTokens = {
  accessToken: 'access-old',
  refreshToken: 'refresh-1',
  expiresAt: '2026-10-16T14:00:00.000Z',
}

const REFRESHED: AuthTokens = {
  accessToken: 'access-new',
  refreshToken: 'refresh-2',
  expiresAt: '2026-10-16T16:00:00.000Z',
}

function createClient(options: {
  http: HttpPort
  tokens: TokenStorePort
  refresh?: AuthRefresherPort
  onUnauthenticated?: () => void
}) {
  let traceSeq = 0
  return createApiClient({
    baseUrl: 'https://api.kedaya.example',
    http: options.http,
    tokens: options.tokens,
    refresh: options.refresh ?? {
      refresh: async () => ({ ok: true, value: REFRESHED }),
    },
    trace: { next: () => `trace-${++traceSeq}` },
    ...(options.onUnauthenticated === undefined
      ? {}
      : { onUnauthenticated: options.onUnauthenticated }),
  })
}

/* ---------------- 纯函数 ---------------- */

describe('buildUrl', () => {
  it('注入 /api/v1 前缀并规范化斜杠', () => {
    expect(buildUrl('https://api.kedaya.example/', 'groupbuy/items')).toBe(
      'https://api.kedaya.example/api/v1/groupbuy/items',
    )
    expect(buildUrl('https://api.kedaya.example', '/groupbuy/items')).toBe(
      'https://api.kedaya.example/api/v1/groupbuy/items',
    )
  })

  it('序列化 query，跳过 undefined / null 并做 URL 编码', () => {
    const url = buildUrl('https://api.kedaya.example', '/groupbuy/items', {
      cursor: null,
      limit: 20,
      category: undefined,
      keyword: '拼 单&x',
    })
    expect(url).toBe(
      'https://api.kedaya.example/api/v1/groupbuy/items?limit=20&keyword=%E6%8B%BC%20%E5%8D%95%26x',
    )
  })
})

describe('statusToErrorCode', () => {
  it('映射契约错误码', () => {
    expect(statusToErrorCode(401)).toBe('UNAUTHENTICATED')
    expect(statusToErrorCode(403)).toBe('FORBIDDEN')
    expect(statusToErrorCode(404)).toBe('NOT_FOUND')
    expect(statusToErrorCode(409)).toBe('CONFLICT')
    expect(statusToErrorCode(429)).toBe('RATE_LIMITED')
    expect(statusToErrorCode(503)).toBe('UPSTREAM_UNAVAILABLE')
    expect(statusToErrorCode(500)).toBe('INTERNAL')
  })
})

describe('parseEnvelope', () => {
  it('成功信封 → 取 data 与后端 traceId', () => {
    const envelope = parseEnvelope<{ id: string }>(
      { ok: true, data: { id: 'gb-1' }, traceId: 'server-trace' },
      'local-trace',
    )
    expect(envelope).toEqual({ ok: true, data: { id: 'gb-1' }, traceId: 'server-trace' })
  })

  it('失败信封 → 保留 code / message / details', () => {
    const envelope = parseEnvelope<never>(
      {
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: '标题太短', details: { field: 'title' } },
        traceId: 'server-trace',
      },
      'local-trace',
    )
    expect(envelope.ok).toBe(false)
    if (!envelope.ok) {
      expect(envelope.error.code).toBe('VALIDATION_FAILED')
      expect(envelope.error.message).toBe('标题太短')
      expect(envelope.error.details).toEqual({ field: 'title' })
    }
  })

  it('不是信封的响应体 → INTERNAL，并回退到本地 traceId', () => {
    const envelope = parseEnvelope<never>({ hello: 'world' }, 'local-trace')
    expect(envelope.ok).toBe(false)
    if (!envelope.ok) {
      expect(envelope.error.code).toBe('INTERNAL')
      expect(envelope.traceId).toBe('local-trace')
    }
  })

  it('信封缺少 traceId 时回退本地 traceId', () => {
    const envelope = parseEnvelope<number>({ ok: true, data: 1 }, 'local-trace')
    expect(envelope.traceId).toBe('local-trace')
  })
})

/* ---------------- 客户端行为 ---------------- */

describe('createApiClient 请求头注入（契约 §6.1）', () => {
  it('注入 X-KedaYa-Trace、Authorization 与 Accept', async () => {
    const http = createFakeHttp(() => json(200, { ok: true, data: { id: 'gb-1' }, traceId: 't' }))
    const tokens = createFakeTokens(TOKENS)
    const client = createClient({ http: http.port, tokens })

    await client.get<{ id: string }>('/groupbuy/items/gb-1')

    const call = http.calls[0]
    expect(call?.url).toBe('https://api.kedaya.example/api/v1/groupbuy/items/gb-1')
    expect(call?.headers['X-KedaYa-Trace']).toBe('trace-1')
    expect(call?.headers.Authorization).toBe('Bearer access-old')
    expect(call?.headers.Accept).toBe('application/json')
    expect(call?.method).toBe('GET')
  })

  it('写操作注入 Idempotency-Key 与 Content-Type', async () => {
    const http = createFakeHttp(() => json(200, { ok: true, data: {}, traceId: 't' }))
    const client = createClient({ http: http.port, tokens: createFakeTokens(TOKENS) })

    await client.post('/groupbuy/items/gb-1/join', { quantity: 1 }, { idempotencyKey: 'idem-1' })

    const call = http.calls[0]
    expect(call?.headers['Idempotency-Key']).toBe('idem-1')
    expect(call?.headers['Content-Type']).toBe('application/json')
    expect(call?.method).toBe('POST')
    expect(call?.body).toEqual({ quantity: 1 })
  })

  it('anonymous 请求不带 Authorization', async () => {
    const http = createFakeHttp(() => json(200, { ok: true, data: {}, traceId: 't' }))
    const client = createClient({ http: http.port, tokens: createFakeTokens(TOKENS) })

    await client.post('/auth/refresh', { refreshToken: 'r' }, { anonymous: true })

    expect(http.calls[0]?.headers.Authorization).toBeUndefined()
  })
})

describe('createApiClient 结果语义', () => {
  it('成功信封 → Result.ok', async () => {
    const http = createFakeHttp(() =>
      json(200, { ok: true, data: { items: [], nextCursor: null }, traceId: 't' }),
    )
    const client = createClient({ http: http.port, tokens: createFakeTokens(TOKENS) })

    const result = await client.get<{ items: unknown[]; nextCursor: string | null }>(
      '/groupbuy/items',
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.nextCursor).toBeNull()
  })

  it('失败信封 → Result.err，保留后端文案', async () => {
    const http = createFakeHttp(() =>
      json(404, { ok: false, error: { code: 'NOT_FOUND', message: '拼单不存在' }, traceId: 't' }),
    )
    const client = createClient({ http: http.port, tokens: createFakeTokens(TOKENS) })

    const result = await client.get('/groupbuy/items/nope')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND')
      expect(result.error.message).toBe('拼单不存在')
    }
  })

  it('非信封响应体 → INTERNAL（绝不放行未校验数据）', async () => {
    const http = createFakeHttp(() => json(200, { unexpected: true }))
    const client = createClient({ http: http.port, tokens: createFakeTokens(TOKENS) })

    const result = await client.get('/groupbuy/items')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INTERNAL')
  })

  it('传输层异常 → UPSTREAM_UNAVAILABLE，并带上失败种类', async () => {
    const http = createFakeHttp(() => {
      throw new HttpTransportError('timeout', 'request timeout')
    })
    const client = createClient({ http: http.port, tokens: createFakeTokens(TOKENS) })

    const result = await client.get('/groupbuy/items')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('UPSTREAM_UNAVAILABLE')
      expect(result.error.message).toContain('超时')
      expect(result.error.details).toEqual({ kind: 'timeout' })
    }
  })
})

describe('createApiClient 401 刷新重试', () => {
  it('401 → 刷新一次 → 用新 token 重试成功', async () => {
    let refreshCalls = 0
    const http = createFakeHttp((request, index) => {
      if (index === 0) return json(401, { ok: false, error: { code: 'UNAUTHENTICATED' } })
      return json(200, { ok: true, data: { id: 'gb-1' }, traceId: 't' })
    })
    const tokens = createFakeTokens(TOKENS)
    const client = createClient({
      http: http.port,
      tokens,
      refresh: {
        async refresh() {
          refreshCalls += 1
          return { ok: true, value: REFRESHED }
        },
      },
    })

    const result = await client.get<{ id: string }>('/groupbuy/items/gb-1')

    expect(result.ok).toBe(true)
    expect(refreshCalls).toBe(1)
    expect(http.calls).toHaveLength(2)
    expect(http.calls[0]?.headers.Authorization).toBe('Bearer access-old')
    expect(http.calls[1]?.headers.Authorization).toBe('Bearer access-new')
    // 刷新后的 token 必须落盘
    expect(tokens.current()).toEqual(REFRESHED)
  })

  it('刷新失败 → 清 token、回调 onUnauthenticated、返回 UNAUTHENTICATED', async () => {
    const http = createFakeHttp(() => json(401, { ok: false, error: { code: 'UNAUTHENTICATED' } }))
    const tokens = createFakeTokens(TOKENS)
    let unauthenticated = 0
    const client = createClient({
      http: http.port,
      tokens,
      refresh: {
        refresh: async () => ({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'refresh 过期' } }),
      },
      onUnauthenticated: () => {
        unauthenticated += 1
      },
    })

    const result = await client.get('/groupbuy/items')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(tokens.current()).toBeNull()
    expect(tokens.clearCount).toBe(1)
    expect(unauthenticated).toBe(1)
    // 刷新失败不应再发第二次业务请求
    expect(http.calls).toHaveLength(1)
  })

  it('重试后仍然 401 → 只重试一次，不死循环', async () => {
    let refreshCalls = 0
    const http = createFakeHttp(() => json(401, { ok: false, error: { code: 'UNAUTHENTICATED' } }))
    const tokens = createFakeTokens(TOKENS)
    const client = createClient({
      http: http.port,
      tokens,
      refresh: {
        async refresh() {
          refreshCalls += 1
          return { ok: true, value: REFRESHED }
        },
      },
    })

    const result = await client.get('/groupbuy/items')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(refreshCalls).toBe(1)
    expect(http.calls).toHaveLength(2)
    expect(tokens.current()).toBeNull()
  })

  it('并发 401 只触发一次刷新（in-flight 去重）', async () => {
    let refreshCalls = 0
    let unauthorizedSeen = 0
    const http = createFakeHttp(() => {
      unauthorizedSeen += 1
      if (unauthorizedSeen <= 2) {
        return json(401, { ok: false, error: { code: 'UNAUTHENTICATED' } })
      }
      return json(200, { ok: true, data: { ok: true }, traceId: 't' })
    })
    const tokens = createFakeTokens(TOKENS)
    const client = createClient({
      http: http.port,
      tokens,
      refresh: {
        async refresh() {
          refreshCalls += 1
          return { ok: true, value: REFRESHED }
        },
      },
    })

    const [first, second] = await Promise.all([
      client.get('/groupbuy/items/gb-1'),
      client.get('/groupbuy/items/gb-2'),
    ])

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(refreshCalls).toBe(1)
    expect(http.calls).toHaveLength(4)
  })

  it('没有 refresh token 时不发刷新请求，直接判定未登录', async () => {
    let refreshCalls = 0
    const http = createFakeHttp(() => json(401, { ok: false, error: { code: 'UNAUTHENTICATED' } }))
    const tokens = createFakeTokens(null)
    const client = createClient({
      http: http.port,
      tokens,
      refresh: {
        async refresh() {
          refreshCalls += 1
          return { ok: true, value: REFRESHED }
        },
      },
    })

    const result = await client.get('/groupbuy/items')

    expect(result.ok).toBe(false)
    expect(refreshCalls).toBe(0)
    expect(http.calls).toHaveLength(1)
  })
})
