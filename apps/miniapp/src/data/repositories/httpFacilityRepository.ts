import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { CreateFacilityBookingInput, FacilityBooking } from '../../domain/models/facility'
import type { RepositoryError } from '../../domain/ports/errors'
import type { FacilityRepository } from '../../domain/ports/facilityRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 场馆预约 · 真后端仓储。
 *
 * 只做「URL + 类型」映射：信封解包、Bearer、trace、401 自动刷新重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * 语义要点：
 * - **创建/取消走 POST**，`ApiClient` 会自动注入 `Idempotency-Key`（契约 §11.3），
 *   所以网络重试不会造成重复预约或重复取消；
 * - **时段冲突返回 409**：文案由服务端给（`该时段已被预约`），前端不重写；
 * - **取消是领域动作**（`POST /items/:id/cancel`），不是 PATCH status ——
 *   服务端要在这里做归属检查与 `booked` 状态校验。
 */
export function createHttpFacilityRepository(client: ApiClient): FacilityRepository {
  const base = modulePath('facility') + '/items'

  return {
    async list({ cursor, limit }): Promise<Result<Page<FacilityBooking>, RepositoryError>> {
      const result = await client.get<Page<FacilityBooking>>(base, {
        cursor: cursor ?? undefined,
        limit: limit > 0 ? limit : DEFAULT_PAGE_SIZE,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async detail(id): Promise<Result<FacilityBooking, RepositoryError>> {
      const result = await client.get<FacilityBooking>(`${base}/${encodeURIComponent(id)}`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async create(input): Promise<Result<FacilityBooking, RepositoryError>> {
      const result = await client.post<FacilityBooking, Record<string, unknown>>(base, {
        kind: input.kind,
        facilityName: input.facilityName ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        feeFen: input.feeFen,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async cancel(id): Promise<Result<FacilityBooking, RepositoryError>> {
      const result = await client.post<FacilityBooking, Record<string, never>>(
        `${base}/${encodeURIComponent(id)}/cancel`,
        {},
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
