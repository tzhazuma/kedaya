import type { Result } from '@kedaya/shared'

import type { Page } from '@kedaya/contracts'

import type {
  CreateFleaItemInput,
  FleaItem,
  FleaItemFilters,
  UpdateFleaItemInput,
} from '../models/fleaMarket'
import type { RepositoryError } from './errors'

/**
 * 跳蚤市场仓储端口 —— http / mock 两套实现（契约 §7 硬规则 3、4）。
 *
 * 端点形状（与后端 controller 一一对应）：
 * ```
 * GET    /flea-market/items            列表（游标分页 + 筛选）
 * POST   /flea-market/items            发布（需登录）
 * GET    /flea-market/items/:id        详情
 * PATCH  /flea-market/items/:id        修改（仅发布者）
 * DELETE /flea-market/items/:id        删除（仅发布者）
 * POST   /flea-market/items/:id/reserve   买家预定
 * POST   /flea-market/items/:id/release   卖家解除预定
 * POST   /flea-market/items/:id/sold      卖家标记售出
 * ```
 */

export interface ListFleaItemsQuery {
  cursor: string | null
  limit?: number
  filters: FleaItemFilters
}

export interface FleaItemRepository {
  list(query: ListFleaItemsQuery): Promise<Result<Page<FleaItem>, RepositoryError>>
  detail(id: string): Promise<Result<FleaItem, RepositoryError>>
  create(input: CreateFleaItemInput): Promise<Result<FleaItem, RepositoryError>>
  update(id: string, input: UpdateFleaItemInput): Promise<Result<FleaItem, RepositoryError>>
  remove(id: string): Promise<Result<{ id: string }, RepositoryError>>
  reserve(id: string): Promise<Result<FleaItem, RepositoryError>>
  release(id: string): Promise<Result<FleaItem, RepositoryError>>
  markSold(id: string): Promise<Result<FleaItem, RepositoryError>>
}
