import { modulePath } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type {
  AiPortraitProfilePayload,
  AiPortraitServerConsent,
  AiPortraitSourcesPayload,
} from '../../domain/models/aiPortrait'
import type { AiPortraitRepository } from '../../domain/ports/aiPortraitRepository'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端 AI 画像仓储。
 *
 * 只做「URL + 类型」映射：信封解包、Bearer、trace、401 自动刷新重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * 三条刻意的取舍：
 *   · `GET /me` 允许返回 `null`（还没有画像）—— 后端没有生成逻辑时这是常态，
 *     调用方必须把它当"空态"而不是"失败"，所以这里**不**把 null 转成错误；
 *   · 不发送任何归属字段（没有 userId / 画像 id 参数可发）；
 *   · `POST /items`（写画像）**不实现** —— 客户端只读，见端口注释。
 */
export function createHttpAiPortraitRepository(client: ApiClient): AiPortraitRepository {
  const base = modulePath('ai-portrait')

  return {
    async me(): Promise<Result<AiPortraitProfilePayload | null, RepositoryError>> {
      const result = await client.get<AiPortraitProfilePayload | null>(`${base}/me`)
      if (!result.ok) return err(toRepositoryError(result.error))
      // `data: null` 是合法回答（尚无画像），不是错误
      return ok(result.value ?? null)
    },

    async sources(): Promise<Result<AiPortraitSourcesPayload, RepositoryError>> {
      const result = await client.get<AiPortraitSourcesPayload>(`${base}/sources`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async consents(): Promise<Result<AiPortraitServerConsent[], RepositoryError>> {
      const result = await client.get<AiPortraitServerConsent[]>(`${base}/consents`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async grantConsent(): Promise<Result<AiPortraitServerConsent, RepositoryError>> {
      // 空 body：同意与否完全由"当前登录主体 + 模块"决定，客户端没有可传的字段
      const result = await client.post<AiPortraitServerConsent, Record<string, never>>(
        `${base}/consents`,
        {},
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async revokeConsent(): Promise<Result<AiPortraitServerConsent | null, RepositoryError>> {
      const result = await client.del<AiPortraitServerConsent | null>(`${base}/consents`)
      if (!result.ok) return err(toRepositoryError(result.error))
      // 幂等：没有可撤回的记录时后端返回 null，这不是失败
      return ok(result.value ?? null)
    },

    async setEnabled(enabled: boolean): Promise<Result<AiPortraitProfilePayload, RepositoryError>> {
      const result = await client.patch<AiPortraitProfilePayload, { enabled: boolean }>(
        `${base}/me`,
        { enabled },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
