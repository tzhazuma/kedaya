import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { GroupBuy } from '../../domain/models/groupbuy'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  GroupBuyPage,
  GroupBuyRepository,
  JoinGroupBuyInput,
  ListGroupBuysQuery,
} from '../../domain/ports/groupbuyRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端拼单仓储 —— 契约 §6.1 的 CRUD 形状：
 *
 * ```
 * GET    /api/v1/groupbuy/items            列表（游标分页）
 * GET    /api/v1/groupbuy/items/:id        详情
 * POST   /api/v1/groupbuy/items/:id/join   领域动作
 * ```
 *
 * 注意：这里**只**做「URL + 类型」的映射，信封解包、Bearer、trace、401 重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 */
export function createHttpGroupBuyRepository(client: ApiClient): GroupBuyRepository {
  return {
    async list(query: ListGroupBuysQuery = {}): Promise<Result<GroupBuyPage, RepositoryError>> {
      const category = query.category

      const result = await client.get<Page<GroupBuy>>(modulePath('groupbuy', 'items'), {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        category: category === undefined || category === 'all' ? undefined : category,
        keyword: query.keyword,
      })

      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({
        items: result.value.items,
        nextCursor: result.value.nextCursor,
        total: result.value.total,
      })
    },

    async detail(id: string): Promise<Result<GroupBuy, RepositoryError>> {
      const result = await client.get<GroupBuy>(
        modulePath('groupbuy', 'items', encodeURIComponent(id)),
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async join(id: string, input: JoinGroupBuyInput): Promise<Result<GroupBuy, RepositoryError>> {
      const result = await client.post<GroupBuy, JoinGroupBuyInput>(
        modulePath('groupbuy', 'items', encodeURIComponent(id), 'join'),
        input,
        input.idempotencyKey === undefined ? undefined : { idempotencyKey: input.idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
