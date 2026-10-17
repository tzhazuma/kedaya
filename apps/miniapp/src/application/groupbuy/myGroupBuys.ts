import { summarize } from '../../domain/models/groupbuy'
import type { GroupBuy, GroupBuySummary } from '../../domain/models/groupbuy'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { GroupBuyRepository, GroupBuyRole } from '../../domain/ports/groupbuyRepository'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'

/**
 * 「我的拼单」用例 —— 「我的资产」页专用的**独立列表**。
 *
 * 为什么不复用拼单列表页的那个 use case：两者是**不同语境**的同一个仓储查询。
 * 共用一份 state 会互相污染（在"我的资产"里切到"我参与的"，
 * 回到拼单广场时会先闪一下"我参与的"列表）。因此各自持有状态与缓存 key。
 *
 * `mine=1` 需要登录：未登录时服务端会返回 UNAUTHENTICATED，
 * 页面据此显示"登录后查看"，而不是把它当成加载失败。
 */

const PAGE_SIZE = 10

export interface MyGroupBuysFilters extends Record<string, unknown> {
  role: GroupBuyRole
}

export interface MyGroupBuysDeps {
  repository: GroupBuyRepository
  cache: CachePort
  clock: ClockPort
  /** 缓存 key 由装配层注入 */
  cacheKey: string
}

export type MyGroupBuysUseCase = ListUseCase<MyGroupBuysFilters, GroupBuySummary>

export function createMyGroupBuysUseCase(
  deps: MyGroupBuysDeps,
): ListUseCase<MyGroupBuysFilters, GroupBuySummary> {
  const { repository, cache, clock, cacheKey } = deps

  return createListUseCase<MyGroupBuysFilters, GroupBuy, GroupBuySummary>({
    cache,
    clock,
    cacheKey,
    defaultQuery: { role: 'owner' },
    isCachedPage: createCachedPageGuard<GroupBuy>(),
    fetchPage: (query, cursor) =>
      repository.list({
        cursor,
        limit: PAGE_SIZE,
        mine: true,
        role: query.role,
      }),
    mapItem: (item, now) => summarize(item, now),
  })
}
