import type { Result } from '@kedaya/shared'

import type { Page } from '@kedaya/contracts'

import type {
  CreateWellbeingAppointmentInput,
  WellbeingAppointment,
  WellbeingAppointmentFilters,
  WellbeingCrisisLine,
} from '../models/wellbeing'
import type { RepositoryError } from './errors'

/**
 * 心理支持仓储端口 —— http / mock 两套实现（契约 §7 硬规则 3、4）。
 *
 * 端点形状（与后端 `wellbeing.controller.ts` 一一对应，控制器挂在
 * `modulePath('wellbeing')` 下）：
 * ```
 * GET    /wellbeing/crisis-line           危机出口（公开：无登录、无同意）
 * GET    /wellbeing/items                 我的预约（游标分页 + status 白名单；强制只看自己）
 * POST   /wellbeing/items                 创建预约（归属与初始状态由服务端决定）
 * GET    /wellbeing/items/:id             详情（仅本人；非本人 404）
 * POST   /wellbeing/items/:id/cancel      领域动作：取消预约
 * GET    /wellbeing/consents              我的同意记录（用于与本地留痕对齐）
 * POST   /wellbeing/consents              同意（幂等）
 * DELETE /wellbeing/consents              撤回同意（幂等）
 * ```
 *
 * 端口刻意**不含** `mine` 参数：列表永远是"我的预约"。
 * `PATCH` / `DELETE /items/:id` 后端已实现且只允许本人，但小程序端不提供入口
 * （预约记录是给用户自己看的凭证，暂不鼓励删改），因此这里也不暴露。
 *
 * 这里**不接分享、不接举报**（`KdyShareEntry` / `KdyReportEntry`）：
 * 预约内容可能含隐私，转发出去或拿去"举报"都是错的用法。
 */

export interface ListWellbeingAppointmentsQuery {
  cursor: string | null
  limit?: number
  filters: WellbeingAppointmentFilters
}

/** 服务端合规记录（`ConsentRecord` 的客户端视图，时间已序列化为 ISO 字符串） */
export interface WellbeingConsentRecord {
  id: string
  module: string
  version: string
  grantedAt: string
  revokedAt: string | null
}

export interface WellbeingRepository {
  /**
   * 危机出口。**公开**：未登录、未同意都必须能拿到；
   * 实现层拿不到时应返回失败（由用例决定用 `CRISIS_FALLBACK` 兜底），
   * 但绝不允许"因为受登录/同意门槛拦住而拿不到"。
   */
  crisisLine(): Promise<Result<WellbeingCrisisLine, RepositoryError>>

  /** 我的预约（未登录 UNAUTHENTICATED；未同意 CONSENT_REQUIRED） */
  list(
    query: ListWellbeingAppointmentsQuery,
  ): Promise<Result<Page<WellbeingAppointment>, RepositoryError>>

  detail(id: string): Promise<Result<WellbeingAppointment, RepositoryError>>

  create(
    input: CreateWellbeingAppointmentInput,
  ): Promise<Result<WellbeingAppointment, RepositoryError>>

  /** 领域动作：取消预约（requested / confirmed → cancelled） */
  cancel(id: string): Promise<Result<WellbeingAppointment, RepositoryError>>

  /* ---- 二次同意（契约 §9）---- */

  grantConsent(): Promise<Result<WellbeingConsentRecord, RepositoryError>>
  revokeConsent(): Promise<Result<WellbeingConsentRecord | null, RepositoryError>>
  /**
   * 服务端是否已有**有效**的 wellbeing 同意。
   *
   * 与本地留痕（`StorageKeys.consent`）职责不同：本地那份用于"同意门"的即时判断，
   * 服务端这份是后端放行的依据。换设备 / 清了缓存之后本地会空，但服务端可能还在 ——
   * 靠这个调用一次把两者对齐，避免用户被迫重新同意一遍（也避免"本地以为同意了、
   * 服务端其实没有"的 403 死循环）。
   */
  activeConsent(): Promise<Result<boolean, RepositoryError>>
}
