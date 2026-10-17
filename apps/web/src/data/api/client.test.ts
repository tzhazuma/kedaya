import { describe, expect, it } from 'vitest';

import { API_BASE_PATH, TRACE_HEADER } from '@kedaya/contracts';

import {
  ApiClientError,
  buildQueryString,
  createApiClient,
  createTraceId,
  statusToErrorCode,
} from './client';

interface Recorded {
  url: string;
  init: RequestInit | undefined;
}

function recordingFetch(
  handler: () => Response | Promise<Response>,
  recorded: Recorded[],
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    recorded.push({ url: String(input), init });
    return await handler();
  }) as typeof globalThis.fetch;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('buildQueryString（契约 §6.1 游标分页）', () => {
  it('跳过 undefined，保留 0 / false', () => {
    expect(buildQueryString({ cursor: 'c_4', limit: 4, keyword: undefined })).toBe(
      '?cursor=c_4&limit=4',
    );
    expect(buildQueryString({ limit: 0, flag: false })).toBe('?limit=0&flag=false');
  });

  it('无参数时返回空串', () => {
    expect(buildQueryString(undefined)).toBe('');
    expect(buildQueryString({})).toBe('');
  });
});

describe('statusToErrorCode（HTTP → 冻结错误码）', () => {
  it('映射关键状态码', () => {
    expect(statusToErrorCode(401)).toBe('UNAUTHENTICATED');
    expect(statusToErrorCode(403)).toBe('FORBIDDEN');
    expect(statusToErrorCode(404)).toBe('NOT_FOUND');
    expect(statusToErrorCode(409)).toBe('CONFLICT');
    expect(statusToErrorCode(422)).toBe('VALIDATION_FAILED');
    expect(statusToErrorCode(429)).toBe('RATE_LIMITED');
    expect(statusToErrorCode(500)).toBe('UPSTREAM_UNAVAILABLE');
    expect(statusToErrorCode(418)).toBe('INTERNAL');
  });
});

describe('createTraceId', () => {
  it('生成非空唯一 trace id', () => {
    const a = createTraceId();
    const b = createTraceId();
    expect(a.length).toBeGreaterThan(8);
    expect(a).not.toBe(b);
  });
});

describe('ApiClient —— 信封解包', () => {
  it('成功信封 → Result.ok，并保留 value', async () => {
    const recorded: Recorded[] = [];
    const client = createApiClient({
      fetchImpl: recordingFetch(
        () => jsonResponse({ ok: true, data: { id: 'gb-1' }, traceId: 'trc-abc' }),
        recorded,
      ),
    });

    const result = await client.get<{ id: string }>('/groupbuy/items/gb-1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe('gb-1');
    expect(recorded[0]?.url).toBe(`${API_BASE_PATH}/groupbuy/items/gb-1`);
  });

  it('失败信封 → Result.err，错误码与文案来自契约', async () => {
    const recorded: Recorded[] = [];
    const client = createApiClient({
      fetchImpl: recordingFetch(
        () =>
          jsonResponse(
            {
              ok: false,
              error: { code: 'CONSENT_REQUIRED', message: '请先完成二次同意' },
              traceId: 'trc-consent',
            },
            403,
          ),
        recorded,
      ),
    });

    const result = await client.get('/wellbeing/items');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ApiClientError);
      expect(result.error.code).toBe('CONSENT_REQUIRED');
      expect(result.error.message).toBe('请先完成二次同意');
      expect(result.error.traceId).toBe('trc-consent');
      expect(result.error.status).toBe(403);
      expect(result.error.needsConsent).toBe(true);
      expect(result.error.needsCampusBinding).toBe(false);
    }
  });

  it('非信封响应（网关错误页）→ 按 HTTP 状态兜底', async () => {
    const recorded: Recorded[] = [];
    const client = createApiClient({
      fetchImpl: recordingFetch(() => jsonResponse({ message: 'Bad Gateway' }, 502), recorded),
    });

    const result = await client.get('/groupbuy/items');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(result.error.status).toBe(502);
    }
  });

  it('非 JSON 响应 → INTERNAL', async () => {
    const recorded: Recorded[] = [];
    const client = createApiClient({
      fetchImpl: recordingFetch(
        () => new Response('<html>oops</html>', { status: 200 }),
        recorded,
      ),
    });

    const result = await client.get('/groupbuy/items');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INTERNAL');
  });

  it('fetch 抛异常 → UPSTREAM_UNAVAILABLE（不把异常抛给 UI）', async () => {
    const recorded: Recorded[] = [];
    const client = createApiClient({
      fetchImpl: recordingFetch(() => {
        throw new Error('ECONNREFUSED');
      }, recorded),
    });

    const result = await client.get('/groupbuy/items');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(result.error.status).toBe(0);
      expect(result.error.message).toContain('网络');
    }
  });
});

describe('ApiClient —— 请求头与查询串（契约 §6.1 冻结）', () => {
  it('注入 Bearer、X-KedaYa-Trace、Content-Type、Idempotency-Key', async () => {
    const recorded: Recorded[] = [];
    const client = createApiClient({
      fetchImpl: recordingFetch(() => jsonResponse({ ok: true, data: null, traceId: 't' }), recorded),
      getAccessToken: () => 'demo-token',
      createTraceId: () => 'trc-fixed',
    });

    await client.post(
      '/groupbuy/items/gb-1/join',
      { quantity: 2 },
      { idempotencyKey: 'idem-1' },
    );

    const init = recorded[0]?.init;
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe('POST');
    expect(headers.get('Authorization')).toBe('Bearer demo-token');
    expect(headers.get(TRACE_HEADER)).toBe('trc-fixed');
    expect(headers.get('Idempotency-Key')).toBe('idem-1');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ quantity: 2 }));
  });

  it('GET 不带 Content-Type / Idempotency-Key，但保留 trace 头', async () => {
    const recorded: Recorded[] = [];
    const client = createApiClient({
      fetchImpl: recordingFetch(() => jsonResponse({ ok: true, data: [], traceId: 't' }), recorded),
      createTraceId: () => 'trc-get',
    });

    await client.get('/groupbuy/items', { cursor: 'c_4', limit: 4 });

    const init = recorded[0]?.init;
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe('GET');
    expect(headers.get('Content-Type')).toBeNull();
    expect(headers.get('Idempotency-Key')).toBeNull();
    expect(headers.get(TRACE_HEADER)).toBe('trc-get');
    expect(recorded[0]?.url).toBe(`${API_BASE_PATH}/groupbuy/items?cursor=c_4&limit=4`);
  });

  it('响应头里的 trace id 作为信封缺失时的兜底', async () => {
    const recorded: Recorded[] = [];
    const client = createApiClient({
      fetchImpl: recordingFetch(
        () => jsonResponse({ message: 'nope' }, 500, { [TRACE_HEADER]: 'trc-from-header' }),
        recorded,
      ),
      createTraceId: () => 'trc-request',
    });

    const result = await client.get('/groupbuy/items');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.traceId).toBe('trc-from-header');
  });

  it('baseUrl 可覆盖（SSR 场景注入绝对地址）', async () => {
    const recorded: Recorded[] = [];
    const client = createApiClient({
      baseUrl: 'https://api.example.com/api/v1',
      fetchImpl: recordingFetch(() => jsonResponse({ ok: true, data: 1, traceId: 't' }), recorded),
    });

    await client.get('/groupbuy/items');
    expect(recorded[0]?.url).toBe('https://api.example.com/api/v1/groupbuy/items');
    expect(client.baseUrl).toBe('https://api.example.com/api/v1');
  });
});
