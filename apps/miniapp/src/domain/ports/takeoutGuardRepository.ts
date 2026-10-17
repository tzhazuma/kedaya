import type { Result } from '@kedaya/shared'

import type { Page } from '@kedaya/contracts'

import type {
  CreateTakeoutGuardReportInput,
  TakeoutGuardReport,
  TakeoutGuardReportFilters,
} from '../models/takeoutGuard'
import type { RepositoryError } from './errors'

/**
 * 偷外卖仓储端口 —— http / mock 两套实现（契约 §7 硬规则 3、4）。
 *
 * 端点形状（与后端 `takeout-guard.controller.ts` 一一对应，
 * 控制器挂在 `modulePath('takeout-guard')` 下，资源段是 `items`）：
 * ```
 * GET    /takeout-guard/items            我的记录（游标分页 + status 筛选；**强制只看自己**，需登录）
 * POST   /takeout-guard/items            记录一次（需登录；归属与初始状态由服务端决定）
 * GET    /takeout-guard/items/:id        详情（仅记录人本人；非本人 404）
 * PATCH  /takeout-guard/items/:id        修正经过（仅记录人本人，不能改状态/归属）
 * DELETE /takeout-guard/items/:id        删除（仅记录人本人）
 * POST   /takeout-guard/items/:id/escalate  领域动作：升级处理（pending → escalated）
 * POST   /takeout-guard/items/:id/resolve   领域动作：标记已解决（pending/escalated → resolved）
 * ```
 *
 * 端口刻意**不含** `mine` 参数：列表永远是"我的记录"。
 * 也刻意不含"按订单号搜索"这类能力：任何跨记录的检索都能把一条记录与具体的人对应起来。
 *
 * `PATCH` / `DELETE` 后端已实现且只允许本人，但小程序当前不提供对应入口
 * （记录是给人看的凭证，暂不鼓励删改），因此端口里也不暴露。
 */

export interface ListTakeoutGuardReportsQuery {
  cursor: string | null
  limit?: number
  filters: TakeoutGuardReportFilters
}

export interface TakeoutGuardRepository {
  /** 我的记录（未登录会得到 UNAUTHENTICATED） */
  list(query: ListTakeoutGuardReportsQuery): Promise<Result<Page<TakeoutGuardReport>, RepositoryError>>
  detail(id: string): Promise<Result<TakeoutGuardReport, RepositoryError>>
  create(input: CreateTakeoutGuardReportInput): Promise<Result<TakeoutGuardReport, RepositoryError>>
  /** 升级处理（请平台或辅导员协助） */
  escalate(id: string): Promise<Result<TakeoutGuardReport, RepositoryError>>
  /** 标记已解决（对方归还 / 事情说清楚） */
  resolve(id: string): Promise<Result<TakeoutGuardReport, RepositoryError>>
}
