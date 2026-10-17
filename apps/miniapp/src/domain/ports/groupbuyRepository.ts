import type { Result } from '@kedaya/shared'

import type { GroupBuy, GroupBuyCategory, GroupBuyCategoryFilter } from '../models/groupbuy'
import type { RepositoryError } from './errors'

/** 列表排序：`latest` 最新发布 / `deadline` 即将截止 */
export type GroupBuySort = 'latest' | 'deadline'

/** 「我的拼单」里的角色：`owner` 我发起的 / `member` 我参与的 */
export type GroupBuyRole = 'owner' | 'member'

/** 游标分页查询（契约 §6.1：不用 offset 分页） */
export interface ListGroupBuysQuery {
  cursor?: string | null
  limit?: number
  category?: GroupBuyCategoryFilter
  keyword?: string
  /** 只看「我的拼单」。服务端从 JWT 取主体，因此未登录时服务端会返回 UNAUTHENTICATED */
  mine?: boolean
  /** `mine` 生效时的角色筛选；缺省表示两者都要 */
  role?: GroupBuyRole
  sort?: GroupBuySort
}

export interface GroupBuyPage {
  items: GroupBuy[]
  nextCursor: string | null
  total?: number
}

/**
 * 发起拼单的输入。
 *
 * `initiatorId` / `initiatorName` 只为 mock 仓储准备（本地要记账发起人是谁）。
 * http 仓储**不会**把它们发给服务端 —— 发起人一律由服务端从 JWT 取，
 * 客户端连 `initiatorId` 都不发（契约 §7：归属只认 token）。
 */
export interface CreateGroupBuyInput {
  title: string
  description?: string | null
  category: GroupBuyCategory
  targetCount: number
  /** 单价，整数分 */
  priceFen: number
  /** 截止时间，ISO-8601 UTC —— 由 `datetime-local` 输入换算而来 */
  deadline: string
  pickupPlace?: string | null
  /** 仅供 mock：发起人 id（用例层从会话填入） */
  initiatorId?: string
  /** 仅供 mock：发起人展示名 */
  initiatorName?: string
}

export interface JoinGroupBuyInput {
  userId: string
  displayName: string
  quantity: number
  anonymous?: boolean
  /** 契约 §6.1：写操作支持 Idempotency-Key */
  idempotencyKey?: string
}

/**
 * 拼单仓储端口 —— 由 `data/repositories/*` 实现（http / mock 两套）。
 *
 * 契约 §7 硬规则 3：所有网络访问必须经过 `data/api/`，
 * `presentation` 禁止直接发请求，只能通过用例层调用本端口。
 */
export interface GroupBuyRepository {
  list(query?: ListGroupBuysQuery): Promise<Result<GroupBuyPage, RepositoryError>>
  detail(id: string): Promise<Result<GroupBuy, RepositoryError>>
  create(input: CreateGroupBuyInput): Promise<Result<GroupBuy, RepositoryError>>
  join(id: string, input: JoinGroupBuyInput): Promise<Result<GroupBuy, RepositoryError>>
}
