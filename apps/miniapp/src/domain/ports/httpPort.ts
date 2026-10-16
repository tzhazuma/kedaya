/**
 * HTTP 传输端口。
 *
 * 为什么单独抽出来：`data/api/request.ts`（信封解包 + 401 刷新重试）是**纯逻辑**，
 * 只依赖这个接口；`Taro.request` 的具体调用被隔离在 `data/api/taroHttpAdapter.ts`。
 * 于是 request 的核心行为可以在 Vitest（node 环境）里用假 transport 完整测试，
 * 不需要小程序模拟器。
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export interface HttpRequest {
  url: string
  method: HttpMethod
  headers: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

export interface HttpResponse {
  statusCode: number
  /** 原始响应体，未解包 */
  data: unknown
  headers: Record<string, string>
}

export interface HttpPort {
  send(request: HttpRequest): Promise<HttpResponse>
}

export type TransportFailureKind = 'network' | 'timeout' | 'abort'

/**
 * 传输层失败。与「业务失败」（HTTP 通了、信封里 `ok: false`）严格区分：
 * 前者可重试，后者是明确的业务结论。
 */
export class HttpTransportError extends Error {
  readonly kind: TransportFailureKind
  readonly detail: unknown

  constructor(kind: TransportFailureKind, message: string, detail?: unknown) {
    super(message)
    this.name = 'HttpTransportError'
    this.kind = kind
    this.detail = detail
  }
}
