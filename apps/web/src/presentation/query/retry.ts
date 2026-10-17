/**
 * 查询重试策略（presentation 层，纯函数，可单测）。
 *
 * 为什么需要**按错误码**决定是否重试：
 *
 * 1. **确定性失败重试没有意义**：`CAMPUS_BINDING_REQUIRED`（409）、
 *    `FORBIDDEN`（403）、`NOT_FOUND`（404）、`VALIDATION_FAILED`（422）、
 *    `RATE_LIMITED`（429）、`UNAUTHENTICATED`（401）、`CONFLICT`（409）
 *    都是"再问一次答案也一样"的失败。重试只会把**引导**推迟一秒以上。
 *
 * 2. **后台标签页里重试计时器会被节流**：React Query 的重试用 `setTimeout`
 *    实现，而 Chrome 对不可见标签页的定时器有强节流（可低至 1 次/分钟）。
 *    于是"失败一次 → 等重试"会让 `isPending` 长时间为真，
 *    用户看到的就是**永久骨架屏** —— 这正是契约 §11.17 附带项
 *    （`networkMode: 'always'`）修掉的同一类缺陷的第二个来源：
 *    前者管的是"要不要发请求"，这里管的是"失败后要不要等"。
 *
 * 因此：确定性失败**不重试**；瞬时故障（`UPSTREAM_UNAVAILABLE` / `INTERNAL`）
 * 仍按全局默认重试一次。
 */
import type { ApiErrorCode } from '@kedaya/contracts';

import { asApiError } from './unwrap';

/** 再试一次也不会变的错误（4xx 语义 + 两个门禁码） */
export const NON_RETRYABLE_CODES: readonly ApiErrorCode[] = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'CONFLICT',
  'CAMPUS_BINDING_REQUIRED',
  'CONSENT_REQUIRED',
];

/** 只允许重试一次的瞬时故障 */
export const TRANSIENT_CODES: readonly ApiErrorCode[] = ['UPSTREAM_UNAVAILABLE', 'INTERNAL'];

export function isRetryableCode(code: ApiErrorCode): boolean {
  return TRANSIENT_CODES.includes(code);
}

/**
 * TanStack Query 的 `retry` 选项实现。
 *
 * @param failureCount 已经失败的次数（TanStack Query 语义：从 0 开始计）
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const apiError = asApiError(error);
  if (!isRetryableCode(apiError.code)) return false;
  return failureCount < 1;
}
