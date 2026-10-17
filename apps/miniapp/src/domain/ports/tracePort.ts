/**
 * 追踪端口 —— 契约 §6.1：请求头 `X-KedaYa-Trace`，响应体 `traceId`。
 *
 * 每次请求生成一个 trace id，便于三端与后端日志对齐。
 */
export interface TracePort {
  next(): string
}
