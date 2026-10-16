import type { ApiErrorCode } from '@kedaya/contracts'

/**
 * 领域层统一错误码：后端 `ApiErrorCode` 的**超集**。
 *
 * 多出来的三个是纯前端/传输层失败，后端永远不会返回：
 * - `NETWORK`：连不上（DNS/断网/域名未配置）
 * - `TIMEOUT`：请求超时
 * - `UNKNOWN`：未归类的失败（含响应体不符合信封约定）
 */
export type RepositoryErrorCode = ApiErrorCode | 'NETWORK' | 'TIMEOUT' | 'UNKNOWN'

export interface RepositoryError {
  code: RepositoryErrorCode
  /** 面向用户的中文文案 */
  message: string
  /** 后端追踪 id（本地失败时为空） */
  traceId?: string
  details?: unknown
}

/** 是否值得让用户「重试」——用于错误态 UI 决定是否显示重试按钮 */
export function isRetryable(code: RepositoryErrorCode): boolean {
  return (
    code === 'NETWORK' ||
    code === 'TIMEOUT' ||
    code === 'UPSTREAM_UNAVAILABLE' ||
    code === 'RATE_LIMITED' ||
    code === 'INTERNAL'
  )
}

/** 是否需要用户先绑定校园系统（契约 §5 硬规则 3） */
export function needsCampusBinding(code: RepositoryErrorCode): boolean {
  return code === 'CAMPUS_BINDING_REQUIRED'
}

/** 是否需要用户先做二次同意（契约 §9 敏感模块） */
export function needsConsent(code: RepositoryErrorCode): boolean {
  return code === 'CONSENT_REQUIRED'
}
