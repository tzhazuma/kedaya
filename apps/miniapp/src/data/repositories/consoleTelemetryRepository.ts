import { ok, type Result } from '@kedaya/shared'

import type { RepositoryError } from '../../domain/ports/errors'
import type { ClientEventPayload, TelemetryRepository } from '../../domain/ports/telemetryRepository'

/**
 * 调试用遥测仓储（mock 模式）。
 *
 * 为什么不直接什么都不做：mock 模式是**开发与演示的默认形态**。
 * 如果这里静默丢弃，开发者就永远看不到"这条崩溃会被报上去、内容是这些" ——
 * 等真上线才发现上报的载荷是空的。
 *
 * 所以它把**归一化之后**的载荷打到控制台（`console.warn`，因为这是异常线索，
 * 不该混在普通 log 里）。除了控制台，它不发任何网络请求。
 */
export function createConsoleTelemetryRepository(): TelemetryRepository {
  return {
    send(payload: ClientEventPayload): Promise<Result<{ accepted: boolean }, RepositoryError>> {
      // 刻意用 console.warn：这是 mock 模式下唯一的可见出口（真机/工具里都能看到）
      console.warn('[kdy-telemetry]', payload.kind, payload.message, payload)
      return Promise.resolve(ok({ accepted: true }))
    },
  }
}
