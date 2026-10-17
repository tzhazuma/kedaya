/**
 * 时钟端口 —— 领域逻辑不接受 `new Date()` 直接调用，
 * 一律注入时钟，保证「已截止 / 已成团」这类判定可复现、可测试。
 */
export interface ClockPort {
  now(): Date
}
