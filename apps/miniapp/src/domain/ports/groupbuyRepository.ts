import type { Result } from '@kedaya/shared'

import type { GroupBuy, GroupBuyCategoryFilter } from '../models/groupbuy'
import type { RepositoryError } from './errors'

/** 游标分页查询（契约 §6.1：不用 offset 分页） */
export interface ListGroupBuysQuery {
  cursor?: string | null
  limit?: number
  category?: GroupBuyCategoryFilter
  keyword?: string
}

export interface GroupBuyPage {
  items: GroupBuy[]
  nextCursor: string | null
  total?: number
}

export interface JoinGroupBuyInput {
  userId: string
  displayName: string
  quantity: number
  anonymous?: boolean
  note?: string
  selections?: Array<{ item: string; quantity: number }>
  /** 契约 §6.1：写操作支持 Idempotency-Key */
  idempotencyKey?: string
}

export interface CreateGroupBuyInput {
  idempotencyKey?: string
  title: string
  description: string
  category: string
  itemSpec: string
  itemOptions?: string[]
  targetCount: number
  priceFen: number
  pickupPlace: string
  kind: 'ordinary' | 'membership'
  merchantName?: string
  membershipDeclaration: boolean
  initiatorId: string
  initiatorName: string
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
  join(id: string, input: JoinGroupBuyInput): Promise<Result<GroupBuy, RepositoryError>>
  create(input: CreateGroupBuyInput): Promise<Result<GroupBuy, RepositoryError>>
  withdraw(id: string, userId: string): Promise<Result<GroupBuy, RepositoryError>>
  cancel(id: string, userId: string): Promise<Result<GroupBuy, RepositoryError>>
  publishPickupNotice(id: string, userId: string, notice: string): Promise<Result<GroupBuy, RepositoryError>>
  markReceived(id: string, userId: string, memberId: string, received: boolean): Promise<Result<GroupBuy, RepositoryError>>
}
