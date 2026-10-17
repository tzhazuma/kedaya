import type { Page } from '@kedaya/contracts'
import type { Result } from '@kedaya/shared'

import type {
  BuddyGroup,
  BuddyGroupDetail,
  BuddyGroupFilters,
  CreateBuddyGroupInput,
} from '../models/buddy'
import type { RepositoryError } from './errors'

/**
 * 找搭子仓储端口 —— http / mock 两套实现（契约 §7 硬规则 3、4）。
 *
 * 端点形状（与后端 `buddy.controller.ts` 一一对应）：
 * ```
 * GET    /buddy/groups              列表（游标分页 + 筛选；mine / joined 需登录）
 * POST   /buddy/groups              发起招募（需登录，自动成为组长）
 * GET    /buddy/groups/:id          详情（含成员列表）
 * POST   /buddy/groups/:id/join     加入（满员自动推进为 full）
 * POST   /buddy/groups/:id/leave    退出（组长需改用 cancel）
 * POST   /buddy/groups/:id/close    组长停止招募
 * POST   /buddy/groups/:id/cancel   组长取消（终态）
 * ```
 */

export interface ListBuddyGroupsQuery {
  cursor: string | null
  limit?: number
  filters: BuddyGroupFilters
}

export interface BuddyRepository {
  list(query: ListBuddyGroupsQuery): Promise<Result<Page<BuddyGroup>, RepositoryError>>
  detail(id: string): Promise<Result<BuddyGroupDetail, RepositoryError>>
  create(input: CreateBuddyGroupInput): Promise<Result<BuddyGroup, RepositoryError>>
  join(id: string): Promise<Result<BuddyGroup, RepositoryError>>
  leave(id: string): Promise<Result<BuddyGroup, RepositoryError>>
  close(id: string): Promise<Result<BuddyGroup, RepositoryError>>
  cancel(id: string): Promise<Result<BuddyGroup, RepositoryError>>
}
