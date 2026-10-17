import { modulePath } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type {
  DormHarmonyCase,
  DormHarmonyCaseDetail,
  DormHarmonyMessageResult,
  SubmitDormHarmonyCaseInput,
  SubmitDormHarmonyCaseResult,
} from '../../domain/models/dormHarmony'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  DormHarmonyRepository,
  TrackDormHarmonyCaseQuery,
} from '../../domain/ports/dormHarmonyRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端宿舍矛盾仓储。
 *
 * 只做「URL + 类型」映射：信封解包、Bearer、trace、401 刷新重试全部由 `ApiClient`
 * 负责（契约 §7 硬规则 3）。
 *
 * 三条与后端 controller 严格对齐的约定：
 *   · 读操作走 `GET cases/:id?trackCode=…` —— 追踪码进 **query**，不进路径
 *     （路径会进各级日志与 Referer，query 同样会，但后端就是这么定义的，
 *      客户端不得自行发明形态）；
 *   · `detail` / `expectation` 显式发 `null` 而不是省略：后端 zod 是 `.nullish()`，
 *     显式 null 表达「我真的没有填」，省略则语义模糊；
 *   · `mediatorReply` 不带任何身份字段 —— 调解员 id 由服务端从 JWT 取。
 */
export function createHttpDormHarmonyRepository(client: ApiClient): DormHarmonyRepository {
  const base = modulePath('dorm-harmony', 'cases')

  function caseUrl(caseId: string, ...segments: string[]): string {
    return [base, encodeURIComponent(caseId), ...segments].join('/')
  }

  return {
    async submit(
      input: SubmitDormHarmonyCaseInput,
    ): Promise<Result<SubmitDormHarmonyCaseResult, RepositoryError>> {
      const result = await client.post<
        SubmitDormHarmonyCaseResult,
        {
          building: string
          topic: string
          detail: string | null
          expectation: string | null
        }
      >(base, {
        building: input.building,
        topic: input.topic,
        detail: input.detail ?? null,
        expectation: input.expectation ?? null,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async track(
      query: TrackDormHarmonyCaseQuery,
    ): Promise<Result<DormHarmonyCaseDetail, RepositoryError>> {
      const result = await client.get<DormHarmonyCaseDetail>(caseUrl(query.caseId), {
        trackCode: query.trackCode,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async postMessage(
      query: TrackDormHarmonyCaseQuery & { body: string },
    ): Promise<Result<DormHarmonyMessageResult, RepositoryError>> {
      const result = await client.post<DormHarmonyMessageResult, { trackCode: string; body: string }>(
        caseUrl(query.caseId, 'messages'),
        { trackCode: query.trackCode, body: query.body },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async close(query: TrackDormHarmonyCaseQuery): Promise<Result<DormHarmonyCase, RepositoryError>> {
      const result = await client.post<DormHarmonyCase, { trackCode: string }>(
        caseUrl(query.caseId, 'close'),
        { trackCode: query.trackCode },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async mediatorReply(
      caseId: string,
      body: string,
    ): Promise<Result<DormHarmonyMessageResult, RepositoryError>> {
      const result = await client.post<DormHarmonyMessageResult, { body: string }>(
        caseUrl(caseId, 'mediator-reply'),
        { body },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
