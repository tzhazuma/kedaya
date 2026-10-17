import type { Page } from '@kedaya/contracts'
import type { Result } from '@kedaya/shared'

import type {
  CreateErrandTaskInput,
  ErrandTask,
  ErrandTaskFilters,
  UpdateErrandTaskInput,
} from '../models/errand'
import type { RepositoryError } from './errors'

/**
 * 跑腿仓储端口 —— http / mock 两套实现（契约 §7 硬规则 3、4）。
 *
 * 端点形状（与后端 `errand.controller.ts` 一一对应）：
 * ```
 * GET    /errand/items               列表（游标分页 + 筛选；mine / role 需登录）
 * POST   /errand/items               发布（需登录）
 * GET    /errand/items/:id           详情
 * PATCH  /errand/items/:id           修改（仅发布者）
 * DELETE /errand/items/:id           删除（仅发布者）
 * POST   /errand/items/:id/accept    接单（不能接自己的单）
 * POST   /errand/items/:id/deliver   接单者确认送达
 * POST   /errand/items/:id/complete  发布者确认完成
 * POST   /errand/items/:id/cancel    发布者取消任务
 * ```
 */

export interface ListErrandTasksQuery {
  cursor: string | null
  limit?: number
  filters: ErrandTaskFilters
}

export interface ErrandTaskRepository {
  list(query: ListErrandTasksQuery): Promise<Result<Page<ErrandTask>, RepositoryError>>
  detail(id: string): Promise<Result<ErrandTask, RepositoryError>>
  create(input: CreateErrandTaskInput): Promise<Result<ErrandTask, RepositoryError>>
  update(id: string, input: UpdateErrandTaskInput): Promise<Result<ErrandTask, RepositoryError>>
  remove(id: string): Promise<Result<{ id: string }, RepositoryError>>
  accept(id: string): Promise<Result<ErrandTask, RepositoryError>>
  deliver(id: string): Promise<Result<ErrandTask, RepositoryError>>
  complete(id: string): Promise<Result<ErrandTask, RepositoryError>>
  cancel(id: string): Promise<Result<ErrandTask, RepositoryError>>
}
