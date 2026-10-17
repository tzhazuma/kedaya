import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type {
  CreateFleaItemInput,
  FleaItem,
  UpdateFleaItemInput,
} from '../../domain/models/fleaMarket'
import type { RepositoryError } from '../../domain/ports/errors'
import type { FleaItemRepository, ListFleaItemsQuery } from '../../domain/ports/fleaMarketRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端跳蚤仓储。
 *
 * 只做「URL + 类型」映射：信封解包、Bearer、trace、401 自动刷新重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * `mine` 用 `'1'` 而不是 `true`：后端用 Zod 按字符串校验查询参数
 * （`?mine=1`），传布尔会在校验层被拒。
 */
export function createHttpFleaMarketRepository(client: ApiClient): FleaItemRepository {
  const base = modulePath('flea-market', 'items')

  return {
    async list(query: ListFleaItemsQuery): Promise<Result<Page<FleaItem>, RepositoryError>> {
      const { filters } = query
      const result = await client.get<Page<FleaItem>>(base, {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        q: filters.keyword,
        category: filters.category,
        condition: filters.condition,
        status: filters.status,
        sort: filters.sort,
        mine: filters.mine === true ? '1' : undefined,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async detail(id: string): Promise<Result<FleaItem, RepositoryError>> {
      const result = await client.get<FleaItem>(`${base}/${encodeURIComponent(id)}`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async create(input: CreateFleaItemInput): Promise<Result<FleaItem, RepositoryError>> {
      const result = await client.post<FleaItem, CreateFleaItemInput>(base, input)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async update(id: string, input: UpdateFleaItemInput): Promise<Result<FleaItem, RepositoryError>> {
      const result = await client.patch<FleaItem, UpdateFleaItemInput>(
        `${base}/${encodeURIComponent(id)}`,
        input,
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async remove(id: string): Promise<Result<{ id: string }, RepositoryError>> {
      const result = await client.del<{ id: string; deleted: true }>(
        `${base}/${encodeURIComponent(id)}`,
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({ id: result.value.id })
    },

    reserve: (id) => postAction(client, base, id, 'reserve'),
    release: (id) => postAction(client, base, id, 'release'),
    markSold: (id) => postAction(client, base, id, 'sold'),
  }
}

async function postAction(
  client: ApiClient,
  base: string,
  id: string,
  action: 'reserve' | 'release' | 'sold',
): Promise<Result<FleaItem, RepositoryError>> {
  const result = await client.post<FleaItem, Record<string, never>>(
    `${base}/${encodeURIComponent(id)}/${action}`,
    {},
  )
  if (!result.ok) return err(toRepositoryError(result.error))
  return ok(result.value)
}
