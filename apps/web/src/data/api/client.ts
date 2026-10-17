/**
 * HTTP 客户端 —— **所有网络访问的唯一出口**（契约 §7 硬规则 3）。
 *
 * 冻结约定（契约 §6.1）：
 * - Base path `/api/v1`
 * - 认证 `Authorization: Bearer <accessToken>`
 * - 追踪请求头 `X-KedaYa-Trace`，响应体 `traceId`
 * - 写操作支持 `Idempotency-Key`
 * - 列表游标分页（`cursor` / `limit`）
 *
 * 职责边界：本文件只做「HTTP → ApiEnvelope → Result」的收敛，不含任何业务规则。
 * 返回 `Result<T, ApiClientError>`（`@kedaya/shared`），**不抛异常**给 UI。
 */
import {
  API_BASE_PATH,
  AUTH_HEADER,
  IDEMPOTENCY_HEADER,
  TRACE_HEADER,
  toResult,
  type ApiEnvelope,
  type ApiError,
  type ApiErrorCode,
} from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

/**
 * ⚠️ 契约 §6.1 文档里定义了 `ApiRequest<TBody>`，但 `@kedaya/contracts` 包
 * **并未导出**该类型（`src/envelope.ts` 只导出信封 / 错误码 / 分页）。
 * 为不改动 Lead 独占的 `packages/`，这里按契约文档原样在 Web 侧复刻一份
 * （形状逐字一致）；若 contracts 后续补上导出，删掉本段改用包导出即可。
 */
export interface ApiRequest<TBody = unknown> {
  /** 不含 /api/v1 前缀 */
  path: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: TBody;
  query?: Record<string, string | number | boolean | undefined>;
}

/** 客户端侧错误：保留契约错误码 + traceId + HTTP 状态，便于 UI 分支与上报 */
export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly traceId: string;
  readonly status: number;
  readonly details: unknown;

  constructor(init: {
    code: ApiErrorCode;
    message: string;
    traceId: string;
    status: number;
    details?: unknown;
  }) {
    super(init.message);
    this.name = 'ApiClientError';
    this.code = init.code;
    this.traceId = init.traceId;
    this.status = init.status;
    this.details = init.details;
  }

  /** 需要用户先去绑定校园系统（契约 §5 硬规则 3） */
  get needsCampusBinding(): boolean {
    return this.code === 'CAMPUS_BINDING_REQUIRED';
  }

  /** 需要用户先做二次同意（契约 §9） */
  get needsConsent(): boolean {
    return this.code === 'CONSENT_REQUIRED';
  }

  /** 可直接展示给用户的中文文案 */
  get userMessage(): string {
    return this.message;
  }
}

export type ApiResult<T> = Result<T, ApiClientError>;

export interface ApiClientConfig {
  /** 默认 `/api/v1`；SSR 时可注入绝对地址 `https://api.example.com/api/v1` */
  baseUrl?: string;
  /** 便于测试注入；默认 `globalThis.fetch` */
  fetchImpl?: typeof globalThis.fetch;
  /** 契约 §5：第一级身份层 JWT 的读取器（第二级校园 session 绝不走这里） */
  getAccessToken?: () => string | null | undefined;
  /** trace id 生成器；默认 `crypto.randomUUID()` */
  createTraceId?: () => string;
  /** 附加静态请求头 */
  defaultHeaders?: Readonly<Record<string, string>>;
  /** 单请求超时（毫秒），默认 15000；<= 0 表示不超时 */
  timeoutMs?: number;
}

export interface RequestOptions {
  /** 写操作的幂等键（契约 §6.1） */
  idempotencyKey?: string;
  /** 外部取消信号 */
  signal?: AbortSignal;
  /** 覆盖 trace id */
  traceId?: string;
  /** 单次请求附加头 */
  headers?: Readonly<Record<string, string>>;
}

export interface ApiClient {
  readonly baseUrl: string;
  request<T>(req: ApiRequest, options?: RequestOptions): Promise<ApiResult<T>>;
  get<T>(
    path: string,
    query?: ApiRequest['query'],
    options?: RequestOptions,
  ): Promise<ApiResult<T>>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<T>>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<T>>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<T>>;
  del<T>(path: string, options?: RequestOptions): Promise<ApiResult<T>>;
}

/** 默认 trace id：优先 UUID，退化到时间戳 + 随机串（小程序等无 crypto 环境） */
export function createTraceId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `kdy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 把 query 对象序列化成查询串；undefined 跳过，游标分页友好 */
export function buildQueryString(query?: ApiRequest['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.append(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** HTTP 状态码 → 冻结错误码（响应体不是合法信封时的兜底） */
export function statusToErrorCode(status: number): ApiErrorCode {
  switch (status) {
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_FAILED';
    case 429:
      return 'RATE_LIMITED';
    default:
      if (status >= 500) return 'UPSTREAM_UNAVAILABLE';
      return 'INTERNAL';
  }
}

const STATUS_MESSAGES: Partial<Record<number, string>> = {
  401: '登录已过期，请重新登录',
  403: '没有权限访问该资源',
  404: '资源不存在',
  409: '操作冲突，请刷新后重试',
  422: '提交的数据不合法',
  429: '请求过于频繁，请稍后再试',
};

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { ok?: unknown };
  return typeof candidate.ok === 'boolean';
}

/** 网络层异常 → UPSTREAM_UNAVAILABLE（契约：启动时序允许静默降级） */
function networkFailure(traceId: string, cause: unknown): ApiClientError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new ApiClientError({
    code: 'UPSTREAM_UNAVAILABLE',
    message: '网络不可用，请检查网络后重试',
    traceId,
    status: 0,
    details: { cause: detail },
  });
}

export function createApiClient(config: ApiClientConfig = {}): ApiClient {
  const baseUrl = config.baseUrl ?? API_BASE_PATH;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const nextTraceId = config.createTraceId ?? createTraceId;

  async function request<T>(
    req: ApiRequest,
    options: RequestOptions = {},
  ): Promise<ApiResult<T>> {
    const fetchImpl = config.fetchImpl ?? globalThis.fetch;
    const traceId = options.traceId ?? nextTraceId();

    if (typeof fetchImpl !== 'function') {
      return err(
        new ApiClientError({
          code: 'UPSTREAM_UNAVAILABLE',
          message: '当前运行环境没有 fetch 实现',
          traceId,
          status: 0,
        }),
      );
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      [TRACE_HEADER]: traceId,
      ...(config.defaultHeaders ?? {}),
      ...(options.headers ?? {}),
    };

    const token = config.getAccessToken?.();
    if (token) headers[AUTH_HEADER] = `Bearer ${token}`;

    const method = req.method;
    const isWrite = method !== 'GET';
    if (isWrite && options.idempotencyKey) {
      headers[IDEMPOTENCY_HEADER] = options.idempotencyKey;
    }
    if (isWrite && req.body !== undefined) headers['Content-Type'] = 'application/json';

    const url = `${joinUrl(baseUrl, req.path)}${buildQueryString(req.query)}`;

    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!options.signal && timeoutMs > 0 && typeof AbortController === 'function') {
      controller = new AbortController();
      timer = setTimeout(() => controller?.abort(), timeoutMs);
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        ...(isWrite && req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (cause) {
      return err(networkFailure(traceId, cause));
    } finally {
      if (timer) clearTimeout(timer);
    }

    const responseTraceId = response.headers?.get?.(TRACE_HEADER) ?? traceId;

    let payload: unknown;
    try {
      const text = await response.text();
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      return err(
        new ApiClientError({
          code: 'INTERNAL',
          message: '服务端返回的不是合法 JSON',
          traceId: responseTraceId,
          status: response.status,
        }),
      );
    }

    if (isEnvelope(payload)) {
      const envelope = payload as ApiEnvelope<T>;
      const settled = toResult(envelope);
      if (settled.ok) return ok(settled.value);
      return err(
        new ApiClientError({
          code: settled.error.code,
          message: settled.error.message,
          traceId: settled.traceId || responseTraceId,
          status: response.status,
          details: settled.error.details,
        }),
      );
    }

    // 非信封响应（网关/代理错误页）：按 HTTP 状态兜底
    const code = statusToErrorCode(response.status);
    const error: ApiError = {
      code,
      message: STATUS_MESSAGES[response.status] ?? `请求失败（HTTP ${response.status}）`,
    };
    return err(
      new ApiClientError({
        code: error.code,
        message: error.message,
        traceId: responseTraceId,
        status: response.status,
        details: payload,
      }),
    );
  }

  return {
    baseUrl,
    request,
    get: (path, query, options) => request({ path, method: 'GET', ...(query ? { query } : {}) }, options),
    post: (path, body, options) =>
      request({ path, method: 'POST', ...(body === undefined ? {} : { body }) }, options),
    patch: (path, body, options) =>
      request({ path, method: 'PATCH', ...(body === undefined ? {} : { body }) }, options),
    put: (path, body, options) =>
      request({ path, method: 'PUT', ...(body === undefined ? {} : { body }) }, options),
    del: (path, options) => request({ path, method: 'DELETE' }, options),
  };
}

/**
 * 应用级单例工厂。
 *
 * 注意：**不要**在模块顶层直接 `createApiClient()` 再导出实例，
 * 否则 SSR 请求之间会共享 token 读取器；统一用 `getApiClient()` 懒加载。
 */
let cached: ApiClient | undefined;

export function getApiClient(): ApiClient {
  cached ??= createApiClient({
    baseUrl: process.env.NEXT_PUBLIC_KEDAYA_API_BASE ?? API_BASE_PATH,
    getAccessToken: () => process.env.NEXT_PUBLIC_KEDAYA_DEMO_TOKEN,
  });
  return cached;
}
