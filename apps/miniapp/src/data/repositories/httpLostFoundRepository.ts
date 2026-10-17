import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type {
  CreateLostFoundItemInput,
  LostFoundItem,
  UpdateLostFoundItemInput,
} from '../../domain/models/lostFound'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ListLostFoundItemsQuery,
  LostFoundRepository,
} from '../../domain/ports/lostFoundRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端失物招领仓储。
 *
 * 只做「URL + 类型」映射：信封解包、Bearer、trace、401 自动刷新重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * 查询参数全部是**字符串**：后端用 Zod 按字符串校验（`?mine=1`、`?q=雨伞`），
 * 传布尔会在校验层被拒；`mine` 因此用 `'1'` 表示，未选时不发该参数。
 */
export function createHttpLostFoundRepository(client: ApiClient): LostFoundRepository {
  const base = modulePath('lost-found', 'items')

  return {
    async list(query: ListLostFoundItemsQuery): Promise<Result<Page<LostFoundItem>, RepositoryError>> {
      const { filters } = query
      const result = await client.get<Page<LostFoundItem>>(base, {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        q: filters.keyword,
        kind: filters.kind,
        status: filters.status,
        place: filters.place,
        sort: filters.sort,
        mine: filters.mine === true ? '1' : undefined,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async detail(id: string): Promise<Result<LostFoundItem, RepositoryError>> {
      const result = await client.get<LostFoundItem>(`${base}/${encodeURIComponent(id)}`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async create(input: CreateLostFoundItemInput): Promise<Result<LostFoundItem, RepositoryError>> {
      const result = await client.post<LostFoundItem, CreateLostFoundItemInput>(base, input)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async update(
      id: string,
      input: UpdateLostFoundItemInput,
    ): Promise<Result<LostFoundItem, RepositoryError>> {
      const result = await client.patch<LostFoundItem, UpdateLostFoundItemInput>(
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

    resolve: (id) => postAction(client, base, id, 'resolve'),
    reopen: (id) => postAction(client, base, id, 'reopen'),
  }
}

async function postAction(
  client: ApiClient,
  base: string,
  id: string,
  action: 'resolve' | 'reopen',
): Promise<Result<LostFoundItem, RepositoryError>> {
  const result = await client.post<LostFoundItem, Record<string, never>>(
    `${base}/${encodeURIComponent(id)}/${action}`,
    {},
  )
  if (!result.ok) return err(toRepositoryError(result.error))
  return ok(result.value)
}
