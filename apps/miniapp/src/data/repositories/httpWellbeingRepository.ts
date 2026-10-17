import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import {
  normalizeCrisisLine,
  type CreateWellbeingAppointmentInput,
  type WellbeingAppointment,
  type WellbeingCrisisLine,
} from '../../domain/models/wellbeing'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ListWellbeingAppointmentsQuery,
  WellbeingConsentRecord,
  WellbeingRepository,
} from '../../domain/ports/wellbeingRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端心理支持仓储。
 *
 * 只做「URL + 类型」映射：信封解包、Bearer、trace、401 自动刷新重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * 三处值得单独说明：
 *   · `crisis-line` 是**公开**端点，但客户端仍可能带着 token 去请求（不影响）；
 *     响应要过 `normalizeCrisisLine` —— 形状不合规时返回失败，由用例切到
 *     `CRISIS_FALLBACK`。危机出口宁可用本地兜底，也不能显示半截数据。
 *   · 查询参数全部是字符串（后端 Zod 按字符串校验），只发选中的 `status`；
 *     界面上不存在的「看别人的预约」没有对应参数。
 *   · `consents` 的 GET 返回该用户**全部**模块的同意记录，这里只判定 wellbeing
 *     那一条是否有效（`revokedAt === null`），其余模块的同意不关本模块的事。
 */
export function createHttpWellbeingRepository(client: ApiClient): WellbeingRepository {
  const base = modulePath('wellbeing')
  const items = `${base}/items`
  const consents = `${base}/consents`

  async function readConsentRecord(
    value: unknown,
  ): Promise<Result<WellbeingConsentRecord | null, RepositoryError>> {
    if (value === null) return ok(null)
    const record = toConsentRecord(value)
    if (record === null) {
      return err({ code: 'UNKNOWN', message: '服务端返回的同意记录不符合预期' })
    }
    return ok(record)
  }

  return {
    async crisisLine(): Promise<Result<WellbeingCrisisLine, RepositoryError>> {
      const result = await client.get<unknown>(`${base}/crisis-line`)
      if (!result.ok) return err(toRepositoryError(result.error))

      const line = normalizeCrisisLine(result.value)
      if (line === null) {
        // 不把半截数据交给页面：用例会据此切到 CRISIS_FALLBACK
        return err({ code: 'UPSTREAM_UNAVAILABLE', message: '危机热线数据不完整' })
      }
      return ok(line)
    },

    async list(
      query: ListWellbeingAppointmentsQuery,
    ): Promise<Result<Page<WellbeingAppointment>, RepositoryError>> {
      const result = await client.get<Page<WellbeingAppointment>>(items, {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        status: query.filters.status,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async detail(id: string): Promise<Result<WellbeingAppointment, RepositoryError>> {
      const result = await client.get<WellbeingAppointment>(`${items}/${encodeURIComponent(id)}`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async create(
      input: CreateWellbeingAppointmentInput,
    ): Promise<Result<WellbeingAppointment, RepositoryError>> {
      const result = await client.post<WellbeingAppointment, CreateWellbeingAppointmentInput>(
        items,
        input,
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async cancel(id: string): Promise<Result<WellbeingAppointment, RepositoryError>> {
      const result = await client.post<WellbeingAppointment, Record<string, never>>(
        `${items}/${encodeURIComponent(id)}/cancel`,
        {},
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async grantConsent(): Promise<Result<WellbeingConsentRecord, RepositoryError>> {
      const result = await client.post<unknown, Record<string, never>>(consents, {})
      if (!result.ok) return err(toRepositoryError(result.error))
      const record = toConsentRecord(result.value)
      if (record === null) {
        return err({ code: 'UNKNOWN', message: '服务端返回的同意记录不符合预期' })
      }
      return ok(record)
    },

    async revokeConsent(): Promise<Result<WellbeingConsentRecord | null, RepositoryError>> {
      const result = await client.del<unknown>(consents)
      if (!result.ok) return err(toRepositoryError(result.error))
      return readConsentRecord(result.value)
    },

    async activeConsent(): Promise<Result<boolean, RepositoryError>> {
      const result = await client.get<unknown>(consents)
      if (!result.ok) return err(toRepositoryError(result.error))

      const records = Array.isArray(result.value) ? result.value : []
      const mine = records
        .map(toConsentRecord)
        .filter((record): record is WellbeingConsentRecord => record !== null)
        .filter((record) => record.module === 'wellbeing')

      return ok(mine.some((record) => record.revokedAt === null))
    },
  }
}

/* ------------------------------------------------------------------ *
 * 响应解析（服务端可能把日期序列化成 ISO 字符串，也可能是 Date）
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isoOf(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') return value
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  return null
}

function toConsentRecord(value: unknown): WellbeingConsentRecord | null {
  if (!isRecord(value)) return null

  const id = typeof value.id === 'string' && value.id !== '' ? value.id : null
  const module = typeof value.module === 'string' && value.module !== '' ? value.module : null
  const grantedAt = isoOf(value.grantedAt)
  if (id === null || module === null || grantedAt === null) return null

  return {
    id,
    module,
    version: typeof value.version === 'string' ? value.version : '',
    grantedAt,
    revokedAt: isoOf(value.revokedAt),
  }
}
