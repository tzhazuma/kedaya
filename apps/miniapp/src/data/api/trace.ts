import type { TracePort } from '../../domain/ports/tracePort'

/**
 * 追踪 id 生成（契约 §6.1 请求头 `X-KedaYa-Trace`）。
 *
 * 纯函数、无框架依赖，便于测试时注入确定性的随机源。
 */
export function createTraceId(
  random: () => number = Math.random,
  now: () => number = Date.now,
): string {
  const segment = (): string =>
    Math.floor(random() * 0xffff)
      .toString(16)
      .padStart(4, '0')
  return `kdy-${now().toString(36)}-${segment()}${segment()}`
}

export function createTracePort(random?: () => number): TracePort {
  return { next: () => createTraceId(random) }
}
