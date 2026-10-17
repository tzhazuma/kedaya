import { TELEMETRY_ENDPOINT } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { RepositoryError } from '../../domain/ports/errors'
import type { ClientEventPayload, TelemetryRepository } from '../../domain/ports/telemetryRepository'
import type { ApiClient } from '../api'
import { toRepositoryError } from './toRepositoryError'

/**
 * 遥测仓储（真实后端）。
 *
 * 三个刻意的选择：
 *   1. **匿名发送**（`anonymous: true`）—— 崩溃常发生在登录之前（冷启动、token 过期）。
 *      要求登录等于在最需要日志的时候静默丢包。服务端按来源限流兜住滥用。
 *   2. **不重试**：上报失败就放弃。重试会在断网时堆积请求，把"错误处理"变成新的负担。
 *   3. **不抛错**：`send` 永远返回 `Result`。调用方本来就是 fire-and-forget，
 *      但类型上保证它绝不会因为网络异常而中断页面逻辑。
 */
export function createHttpTelemetryRepository(client: ApiClient): TelemetryRepository {
  return {
    async send(
      payload: ClientEventPayload,
    ): Promise<Result<{ accepted: boolean }, RepositoryError>> {
      const result = await client.post<{ accepted: boolean }, ClientEventPayload>(
        TELEMETRY_ENDPOINT,
        payload,
        { anonymous: true },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      // 服务端返回 `{ accepted: false }` 表示被限流丢弃 —— 这不是错误，只是没记
      return ok({ accepted: result.value?.accepted !== false })
    },
  }
}
