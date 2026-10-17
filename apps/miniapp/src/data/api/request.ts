import {
  API_BASE_PATH,
  AUTH_HEADER,
  IDEMPOTENCY_HEADER,
  TRACE_HEADER,
  toResult,
} from '@kedaya/contracts'
import type { ApiEnvelope, ApiError, ApiErrorCode } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { AuthTokens } from '../../domain/models/session'
import { HttpTransportError } from '../../domain/ports/httpPort'
import type { HttpMethod, HttpPort, HttpResponse } from '../../domain/ports/httpPort'
import type { AuthRefresherPort, TokenStorePort } from '../../domain/ports/sessionPort'
import type { TracePort } from '../../domain/ports/tracePort'

/**
 * 统一请求层（契约 §6.1）。
 *
 * 职责（全部在这里收敛，禁止其它层自行解包）：
 * 1. 注入 baseURL `/api/v1`、`Authorization: Bearer`、`X-KedaYa-Trace`、`Idempotency-Key`
 * 2. 把后端 `ApiEnvelope<T>` 解包成 `@kedaya/shared` 的 `Result<T, ApiError>`
 * 3. 401 → 刷新 token → **只重试一次**（并发刷新去重）
 * 4. 传输层失败（断网/超时）与业务失败严格区分
 *
 * 本文件不 import 任何 Taro API —— 传输由 `HttpPort` 注入，
 * 于是核心行为可以在 Vitest（node）里被完整测试。
 */

export type QueryValue = string | number | boolean | undefined | null
export type QueryMap = Record<string, QueryValue>

export interface ApiRequestSpec<TBody = unknown> {
  /** 不含 `/api/v1` 前缀，例如 `/groupbuy/items` */
  path: string
  method?: HttpMethod
  body?: TBody
  query?: QueryMap
  /** 写操作幂等键（契约 §6.1） */
  idempotencyKey?: string
  /** 跳过 Authorization（登录 / 刷新 / 公开接口） */
  anonymous?: boolean
  timeoutMs?: number
}

export type ApiRequestExtras = Omit<ApiRequestSpec<unknown>, 'path' | 'method' | 'body'>

export interface ApiClientOptions {
  /** 例如 `https://api.kedaya.example`（不含 /api/v1） */
  baseUrl: string
  http: HttpPort
  tokens: TokenStorePort
  refresh: AuthRefresherPort
  trace: TracePort
  defaultTimeoutMs?: number
  /** 刷新也失败时的回调（跳登录页 / 清理本地态） */
  onUnauthenticated?: () => void
  /**
   * 服务端**自身**出问题时的回调（5xx / 信封不合规）。
   *
   * 刻意不报"网络不可用 / 超时"：那是用户环境问题（地铁里没信号），
   * 上报只会淹没真正的服务端故障。这里要的是「我们的后端坏了」这一类线索。
   *
   * 同样刻意**不传 `details`**：它可能整包含有响应原文（里面有用户数据），
   * 上报只需要知道「哪个接口、什么错、哪次 trace」。
   */
  onServerError?: (info: ServerErrorInfo) => void
}

export interface ServerErrorInfo {
  path: string
  method: string
  status: number
  code: ApiErrorCode
  message: string
  traceId: string
}

export interface ApiClient {
  request<T, TBody = unknown>(spec: ApiRequestSpec<TBody>): Promise<Result<T, ApiError>>
  get<T>(path: string, query?: QueryMap): Promise<Result<T, ApiError>>
  post<T, TBody = unknown>(
    path: string,
    body?: TBody,
    extras?: ApiRequestExtras,
  ): Promise<Result<T, ApiError>>
  patch<T, TBody = unknown>(
    path: string,
    body?: TBody,
    extras?: ApiRequestExtras,
  ): Promise<Result<T, ApiError>>
  put<T, TBody = unknown>(
    path: string,
    body?: TBody,
    extras?: ApiRequestExtras,
  ): Promise<Result<T, ApiError>>
  del<T>(path: string, extras?: ApiRequestExtras): Promise<Result<T, ApiError>>
}

/* ------------------------------------------------------------------ *
 * 纯函数工具（单独导出，便于单测）
 * ------------------------------------------------------------------ */

/** 拼出最终 URL：`<baseUrl>/api/v1<path>?<query>` */
export function buildUrl(baseUrl: string, path: string, query?: QueryMap): string {
  const base = baseUrl.replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = `${base}${API_BASE_PATH}${normalizedPath}`

  const pairs: string[] = []
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    }
  }

  return pairs.length > 0 ? `${url}?${pairs.join('&')}` : url
}

const STATUS_TO_CODE: Readonly<Record<number, ApiErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  502: 'UPSTREAM_UNAVAILABLE',
  503: 'UPSTREAM_UNAVAILABLE',
  504: 'UPSTREAM_UNAVAILABLE',
}

/** HTTP 状态码 → 契约错误码（仅在响应体不是合法信封时兜底使用） */
export function statusToErrorCode(statusCode: number): ApiErrorCode {
  const mapped = STATUS_TO_CODE[statusCode]
  if (mapped !== undefined) return mapped
  if (statusCode >= 500) return 'INTERNAL'
  if (statusCode >= 400) return 'VALIDATION_FAILED'
  return 'INTERNAL'
}

/**
 * 把原始响应体收敛成 `ApiEnvelope<T>`。
 * 不符合信封约定的响应一律变成 `INTERNAL` 失败 —— 绝不放行未校验的数据。
 */
export function parseEnvelope<T>(raw: unknown, fallbackTraceId: string): ApiEnvelope<T> {
  if (typeof raw === 'object' && raw !== null) {
    const candidate = raw as { ok?: unknown; data?: unknown; error?: unknown; traceId?: unknown }
    const traceId =
      typeof candidate.traceId === 'string' && candidate.traceId.length > 0
        ? candidate.traceId
        : fallbackTraceId

    if (candidate.ok === true) {
      return { ok: true, data: candidate.data as T, traceId }
    }

    if (candidate.ok === false) {
      const rawError = candidate.error as
        | { code?: unknown; message?: unknown; details?: unknown }
        | undefined
      const code =
        typeof rawError?.code === 'string' ? (rawError.code as ApiErrorCode) : ('INTERNAL' as const)
      const message =
        typeof rawError?.message === 'string' && rawError.message.length > 0
          ? rawError.message
          : '请求失败'
      const error: ApiError =
        rawError?.details === undefined
          ? { code, message }
          : { code, message, details: rawError.details }
      return { ok: false, error, traceId }
    }
  }

  return {
    ok: false,
    error: {
      code: 'INTERNAL',
      message: '响应格式不符合 ApiEnvelope 约定',
      details: raw,
    },
    traceId: fallbackTraceId,
  }
}

/** 传输层异常 → 契约错误（可重试语义） */
export function transportErrorToApiError(error: unknown): ApiError {
  if (error instanceof HttpTransportError) {
    const message =
      error.kind === 'timeout'
        ? '请求超时，请检查网络后重试'
        : error.kind === 'abort'
          ? '请求已取消'
          : '网络不可用，请稍后重试'
    return { code: 'UPSTREAM_UNAVAILABLE', message, details: { kind: error.kind } }
  }
  return {
    code: 'UPSTREAM_UNAVAILABLE',
    message: '网络异常，请稍后重试',
    details: { raw: String(error) },
  }
}

/* ------------------------------------------------------------------ *
 * 客户端
 * ------------------------------------------------------------------ */

export function createApiClient(options: ApiClientOptions): ApiClient {
  const {
    baseUrl,
    http,
    tokens,
    refresh,
    trace,
    defaultTimeoutMs = 15_000,
    onUnauthenticated,
    onServerError,
  } = options

  /** 并发去重：同一时刻只允许一个刷新请求在飞 */
  let inflightRefresh: Promise<Result<AuthTokens, ApiError>> | null = null

  async function dispatch<T, TBody>(
    spec: ApiRequestSpec<TBody>,
    accessToken: string | null,
  ): Promise<{ result: Result<T, ApiError>; unauthorized: boolean }> {
    const traceId = trace.next()
    const headers: Record<string, string> = {
      [TRACE_HEADER]: traceId,
      Accept: 'application/json',
    }
    if (spec.body !== undefined) headers['Content-Type'] = 'application/json'
    if (spec.idempotencyKey !== undefined) headers[IDEMPOTENCY_HEADER] = spec.idempotencyKey
    if (spec.anonymous !== true && accessToken !== null) {
      headers[AUTH_HEADER] = `Bearer ${accessToken}`
    }

    let response: HttpResponse
    try {
      response = await http.send({
        url: buildUrl(baseUrl, spec.path, spec.query),
        method: spec.method ?? 'GET',
        headers,
        body: spec.body,
        timeoutMs: spec.timeoutMs ?? defaultTimeoutMs,
      })
    } catch (error) {
      return { result: err(transportErrorToApiError(error)), unauthorized: false }
    }

    if (response.statusCode === 401) {
      return {
        result: err({ code: 'UNAUTHENTICATED', message: '登录状态已过期，请重新登录' }),
        unauthorized: true,
      }
    }

    const unwrapped = toResult(parseEnvelope<T>(response.data, traceId))
    if (unwrapped.ok) {
      return { result: ok(unwrapped.value), unauthorized: false }
    }

    // 后端给了失败信封；但如果信封里没有更具体的信息（INTERNAL），用 HTTP 状态码兜底
    const code: ApiErrorCode =
      unwrapped.error.code === 'INTERNAL'
        ? statusToErrorCode(response.statusCode)
        : unwrapped.error.code

    const apiError: ApiError = { ...unwrapped.error, code }

    /**
     * 「我们的后端坏了」这一类才上报：`INTERNAL`（5xx / 信封不合规）。
     * 业务性失败（校验不过、无权限、冲突）是**预期内**的，
     * 报上去只会把真正的故障淹没在噪声里。
     *
     * 上报放在这里（而不是 `request()`）是为了避免 401→刷新→重试路径重复上报。
     */
    if (code === 'INTERNAL') {
      onServerError?.({
        path: spec.path,
        method: spec.method ?? 'GET',
        status: response.statusCode,
        code,
        message: apiError.message,
        traceId: unwrapped.traceId,
      })
    }

    return {
      result: err(apiError),
      unauthorized: code === 'UNAUTHENTICATED',
    }
  }

  function refreshTokens(): Promise<Result<AuthTokens, ApiError>> {
    if (inflightRefresh !== null) return inflightRefresh

    const refreshToken = tokens.getRefreshToken()
    if (refreshToken === null) {
      return Promise.resolve(
        err<ApiError>({ code: 'UNAUTHENTICATED', message: '缺少 refresh token，请重新登录' }),
      )
    }

    const promise = refresh
      .refresh(refreshToken)
      .then((result) => {
        if (result.ok) tokens.setTokens(result.value)
        return result
      })
      .finally(() => {
        inflightRefresh = null
      })

    inflightRefresh = promise
    return promise
  }

  async function request<T, TBody = unknown>(
    spec: ApiRequestSpec<TBody>,
  ): Promise<Result<T, ApiError>> {
    const first = await dispatch<T, TBody>(spec, spec.anonymous === true ? null : tokens.getAccessToken())
    if (!first.unauthorized || spec.anonymous === true) return first.result

    // 401：刷新一次 token 后重试（只重试一次，避免死循环）
    const refreshed = await refreshTokens()
    if (!refreshed.ok) {
      tokens.clear()
      onUnauthenticated?.()
      return err(refreshed.error)
    }

    const retried = await dispatch<T, TBody>(spec, refreshed.value.accessToken)
    if (retried.unauthorized) {
      tokens.clear()
      onUnauthenticated?.()
      return err({ code: 'UNAUTHENTICATED', message: '登录状态已过期，请重新登录' })
    }
    return retried.result
  }

  return {
    request,
    get: <T>(path: string, query?: QueryMap) => request<T>({ path, method: 'GET', query }),
    post: <T, TBody = unknown>(path: string, body?: TBody, extras?: ApiRequestExtras) =>
      request<T, TBody>({ path, method: 'POST', body, ...extras }),
    patch: <T, TBody = unknown>(path: string, body?: TBody, extras?: ApiRequestExtras) =>
      request<T, TBody>({ path, method: 'PATCH', body, ...extras }),
    put: <T, TBody = unknown>(path: string, body?: TBody, extras?: ApiRequestExtras) =>
      request<T, TBody>({ path, method: 'PUT', body, ...extras }),
    del: <T>(path: string, extras?: ApiRequestExtras) =>
      request<T>({ path, method: 'DELETE', ...extras }),
  }
}
