import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import {
  CAMPUS_CARD_PAYMENT_CODE_PATH,
  normalizeCampusCardPaymentCode,
  normalizeCampusCardTransactions,
  type CampusCardPaymentCode,
  type CampusCardTransaction,
} from '../../domain/models/campusCard'
import {
  normalizeCampusBindingSummary,
  normalizeCampusBindingSummaries,
  normalizeCampusCapabilities,
  type CampusBindingSummary,
  type CampusCapability,
} from '../../domain/models/techpie'
import type { RepositoryError } from '../../domain/ports/errors'
import type { LogPort } from '../../domain/ports/logPort'
import type {
  CampusBindingPage,
  CampusCardTransactionPage,
  CreateCampusBindingInput,
  ListBindingsQuery,
  TechpieRepository,
} from '../../domain/ports/techpieRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端 TechPie / 校园能力仓储。
 *
 * ```
 * GET    /api/v1/techpie/links             列出绑定（**不含凭证**）
 * POST   /api/v1/techpie/links             发起绑定（必需 Idempotency-Key）
 * GET    /api/v1/techpie/links/:id         绑定详情
 * DELETE /api/v1/techpie/links/:id         解绑
 * POST   /api/v1/techpie/links/:id/renew   手动续期（契约 §11.2 冻结 action：`renew`）
 * GET    /api/v1/techpie/capabilities      能力清单
 * GET    /api/v1/campus-card/items         校园卡流水（游标分页）
 * POST   /api/v1/campus-card/payment-code  付款码（⚠️ 尚未登记进冻结契约）
 * ```
 *
 * 这里**只**做「URL + 形状归一化」：信封解包、Bearer、trace、401 重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * ## 两个刻意的设计
 *
 * 1. **响应一律经过 `normalize*`**：契约 §8.3 要求响应中严禁出现 8 个凭证键。
 *    若后端违反，我们**拒绝该条目**并记一次 `techpie.contract.violation` ——
 *    而不是"看不见就继续用"（后者等于允许凭证进入客户端状态）。
 * 2. **没有 webview-session 方法**：契约 §11.10-F 已裁决小程序 `web-view`
 *    无法注入 cookie，**I3 在本端没有出口**。本端走 W4（用户自己登录）。
 *    这不是遗漏，是平台能力边界。
 */

export interface TechpieRepositoryOptions {
  log?: LogPort
}

function reportViolation(
  log: LogPort | undefined,
  where: string,
  droppedCount: number,
  reason: string,
): void {
  log?.warn('techpie.contract.violation', { where, droppedCount, reason })
}

export function createHttpTechpieRepository(
  client: ApiClient,
  options: TechpieRepositoryOptions = {},
): TechpieRepository {
  const { log } = options

  return {
    async listBindings(query: ListBindingsQuery = {}): Promise<Result<CampusBindingPage, RepositoryError>> {
      const result = await client.get<Page<unknown>>(modulePath('techpie', 'links'), {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
      })
      if (!result.ok) return err(toRepositoryError(result.error))

      const raw = Array.isArray(result.value.items) ? result.value.items : []
      const items = normalizeCampusBindingSummaries(raw)
      if (items.length < raw.length) {
        reportViolation(log, 'techpie.links', raw.length - items.length, 'FORBIDDEN_KEYS_OR_SHAPE')
      }
      return ok({ items, nextCursor: result.value.nextCursor, total: result.value.total })
    },

    async bindingDetail(id: string): Promise<Result<CampusBindingSummary, RepositoryError>> {
      const result = await client.get<unknown>(modulePath('techpie', 'links', encodeURIComponent(id)))
      if (!result.ok) return err(toRepositoryError(result.error))

      const normalized = normalizeCampusBindingSummary(result.value)
      if (normalized === null) {
        reportViolation(log, 'techpie.link', 1, 'FORBIDDEN_KEYS_OR_SHAPE')
        return err({ code: 'INTERNAL', message: '绑定数据形状不合法，已拒绝使用' })
      }
      return ok(normalized)
    },

    async createBinding(
      input: CreateCampusBindingInput,
      idempotencyKey?: string,
    ): Promise<Result<CampusBindingSummary, RepositoryError>> {
      // ⚠️ `openid` 字段承载的是 `wx.login` 的一次性 code，**不是** openid：
      // 小程序客户端在密码学上无法自己得到 openid（需要 AppSecret）。
      // 字段命名与语义不符是已登记的契约缺口（见交付说明的未决问题）。
      const body = {
        provider: input.provider,
        ...(input.credential === undefined ? {} : { openid: input.credential.wechatLoginCode }),
      }
      const result = await client.post<unknown, typeof body>(
        modulePath('techpie', 'links'),
        body,
        idempotencyKey === undefined ? {} : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))

      const normalized = normalizeCampusBindingSummary(result.value)
      if (normalized === null) {
        reportViolation(log, 'techpie.links.create', 1, 'FORBIDDEN_KEYS_OR_SHAPE')
        return err({ code: 'INTERNAL', message: '绑定结果形状不合法，已拒绝使用' })
      }
      return ok(normalized)
    },

    async unbind(id: string, idempotencyKey?: string): Promise<Result<true, RepositoryError>> {
      const result = await client.del<unknown>(
        modulePath('techpie', 'links', encodeURIComponent(id)),
        idempotencyKey === undefined ? {} : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(true)
    },

    async renew(
      id: string,
      idempotencyKey?: string,
    ): Promise<Result<CampusBindingSummary, RepositoryError>> {
      const result = await client.post<unknown, undefined>(
        modulePath('techpie', 'links', encodeURIComponent(id), 'renew'),
        undefined,
        idempotencyKey === undefined ? {} : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))

      const normalized = normalizeCampusBindingSummary(result.value)
      if (normalized === null) {
        reportViolation(log, 'techpie.links.renew', 1, 'FORBIDDEN_KEYS_OR_SHAPE')
        return err({ code: 'INTERNAL', message: '续期结果形状不合法，已拒绝使用' })
      }
      return ok(normalized)
    },

    async capabilities(): Promise<Result<CampusCapability[], RepositoryError>> {
      const result = await client.get<{ capabilities?: unknown }>(
        modulePath('techpie', 'capabilities'),
      )
      if (!result.ok) return err(toRepositoryError(result.error))

      const raw = Array.isArray(result.value.capabilities) ? result.value.capabilities : []
      const items = normalizeCampusCapabilities(raw)
      if (items.length < raw.length) {
        reportViolation(log, 'techpie.capabilities', raw.length - items.length, 'FORBIDDEN_KEYS_OR_SHAPE')
      }
      return ok(items)
    },

    async cardTransactions(
      query: ListBindingsQuery = {},
    ): Promise<Result<CampusCardTransactionPage, RepositoryError>> {
      const result = await client.get<Page<unknown>>(modulePath('campus-card', 'items'), {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
      })
      if (!result.ok) return err(toRepositoryError(result.error))

      const raw = Array.isArray(result.value.items) ? result.value.items : []
      const items: CampusCardTransaction[] = normalizeCampusCardTransactions(raw)
      if (items.length < raw.length) {
        reportViolation(log, 'campus-card.items', raw.length - items.length, 'FORBIDDEN_KEYS_OR_SHAPE')
      }
      return ok({ items, nextCursor: result.value.nextCursor, total: result.value.total })
    },

    async paymentCode(idempotencyKey?: string): Promise<Result<CampusCardPaymentCode, RepositoryError>> {
      const result = await client.post<unknown, undefined>(
        CAMPUS_CARD_PAYMENT_CODE_PATH,
        undefined,
        idempotencyKey === undefined ? {} : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))

      const normalized = normalizeCampusCardPaymentCode(result.value)
      if (normalized === null) {
        reportViolation(log, 'campus-card.payment-code', 1, 'FORBIDDEN_KEYS_OR_SHAPE')
        return err({ code: 'INTERNAL', message: '付款码形状不合法，已拒绝使用' })
      }
      return ok(normalized)
    },
  }
}
