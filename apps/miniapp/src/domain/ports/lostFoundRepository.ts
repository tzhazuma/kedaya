import type { Result } from '@kedaya/shared'

import type { Page } from '@kedaya/contracts'

import type {
  CreateLostFoundItemInput,
  LostFoundItem,
  LostFoundItemFilters,
  UpdateLostFoundItemInput,
} from '../models/lostFound'
import type { RepositoryError } from './errors'

/**
 * 失物招领仓储端口 —— http / mock 两套实现（契约 §7 硬规则 3、4）。
 *
 * 端点形状（与后端 `lost-found.controller.ts` 一一对应，
 * 控制器挂在 `modulePath('lost-found')` 下，资源段是 `items`）：
 * ```
 * GET    /lost-found/items            列表（游标分页 + 类型/状态/关键词/地点筛选）
 * POST   /lost-found/items            发布（需登录）
 * GET    /lost-found/items/:id        详情（公开可读）
 * PATCH  /lost-found/items/:id        修改（仅发布者）
 * DELETE /lost-found/items/:id        删除（仅发布者）
 * POST   /lost-found/items/:id/resolve  领域动作：标记已找回 / 已归还（仅发布者，open → resolved）
 * POST   /lost-found/items/:id/reopen   领域动作：重新开放（仅发布者，resolved → open，清空 resolvedAt）
 * ```
 */

export interface ListLostFoundItemsQuery {
  cursor: string | null
  limit?: number
  filters: LostFoundItemFilters
}

export interface LostFoundRepository {
  list(query: ListLostFoundItemsQuery): Promise<Result<Page<LostFoundItem>, RepositoryError>>
  detail(id: string): Promise<Result<LostFoundItem, RepositoryError>>
  create(input: CreateLostFoundItemInput): Promise<Result<LostFoundItem, RepositoryError>>
  update(id: string, input: UpdateLostFoundItemInput): Promise<Result<LostFoundItem, RepositoryError>>
  remove(id: string): Promise<Result<{ id: string }, RepositoryError>>
  /** 发布者标记「已找回 / 已归还」（幂等冲突返回 CONFLICT） */
  resolve(id: string): Promise<Result<LostFoundItem, RepositoryError>>
  /** 发布者重新开放（非 resolved 时返回 CONFLICT） */
  reopen(id: string): Promise<Result<LostFoundItem, RepositoryError>>
}
