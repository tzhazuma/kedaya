import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { CreateWildlifeSpotInput, WildlifeSpot } from '../../domain/models/wildlife'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ListWildlifeSpotsQuery,
  WildlifeRepository,
} from '../../domain/ports/wildlifeRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端观察点仓储。
 *
 * 只做「URL + 类型」映射：信封解包、Bearer、trace、401 自动刷新重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * 查询参数全部是**字符串**：后端用 Zod 按字符串校验（`?species=天鹅`）。
 * 未选中的筛选值传 `undefined` —— `buildUrl` 会直接跳过它，
 * 而不是发出 `species=undefined` 这种会被校验层拒掉的参数。
 */
export function createHttpWildlifeRepository(client: ApiClient): WildlifeRepository {
  const base = modulePath('wildlife', 'items')

  return {
    async list(
      query: ListWildlifeSpotsQuery,
    ): Promise<Result<Page<WildlifeSpot>, RepositoryError>> {
      const { filters } = query
      const result = await client.get<Page<WildlifeSpot>>(base, {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        species: filters.species,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async detail(id: string): Promise<Result<WildlifeSpot, RepositoryError>> {
      const result = await client.get<WildlifeSpot>(`${base}/${encodeURIComponent(id)}`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async create(input: CreateWildlifeSpotInput): Promise<Result<WildlifeSpot, RepositoryError>> {
      const result = await client.post<WildlifeSpot, CreateWildlifeSpotInput>(base, input)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    /** 领域动作（POST，语义是改状态）：不带请求体，幂等 */
    async confirm(id: string): Promise<Result<WildlifeSpot, RepositoryError>> {
      const result = await client.post<WildlifeSpot, Record<string, never>>(
        `${base}/${encodeURIComponent(id)}/confirm`,
        {},
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
