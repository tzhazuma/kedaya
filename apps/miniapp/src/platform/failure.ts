import type { Result } from '@kedaya/shared'

/**
 * 平台能力的统一失败类型。
 *
 * 每个平台适配器都必须明确区分三种失败：
 * - `UNSUPPORTED`：当前端**没有**这个能力（例如 H5 没有微信订阅消息）→ UI 应展示降级方案
 * - `REJECTED`：用户主动拒绝（例如拒绝订阅、取消扫码）→ UI 应静默或轻提示
 * - `FAILED`：调用本身出错 → UI 可提示重试
 */
export interface PlatformFailure {
  code: 'UNSUPPORTED' | 'REJECTED' | 'FAILED'
  message: string
}

export type PlatformResult<T> = Result<T, PlatformFailure>
