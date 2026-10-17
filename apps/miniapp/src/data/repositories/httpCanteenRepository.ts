import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type {
  CanteenCalorieSummary,
  CanteenDish,
  CreateCanteenDishInput,
} from '../../domain/models/canteen'
import type { CanteenRepository, ListCanteenDishesQuery } from '../../domain/ports/canteenRepository'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端食堂营养仓储。
 *
 * 只做「URL + 类型」映射：信封解包、Bearer、trace、401 自动刷新重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * 查询参数全部是**字符串**（后端用 Zod 按字符串校验）：未选食堂时不发 `canteen`，
 * 关键词为空时不发 `q`，避免服务端把空串当成"搜空字符串"。
 */
export function createHttpCanteenRepository(client: ApiClient): CanteenRepository {
  const base = modulePath('canteen', 'items')

  return {
    async list(
      query: ListCanteenDishesQuery,
    ): Promise<Result<Page<CanteenDish>, RepositoryError>> {
      const { filters } = query
      const result = await client.get<Page<CanteenDish>>(base, {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        canteen: filters.canteen,
        q: filters.q,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async detail(id: string): Promise<Result<CanteenDish, RepositoryError>> {
      const result = await client.get<CanteenDish>(`${base}/${encodeURIComponent(id)}`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async create(input: CreateCanteenDishInput): Promise<Result<CanteenDish, RepositoryError>> {
      const result = await client.post<CanteenDish, CreateCanteenDishInput>(base, input)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async calories(canteen: string): Promise<Result<CanteenCalorieSummary, RepositoryError>> {
      const result = await client.get<CanteenCalorieSummary>(modulePath('canteen', 'calories'), {
        canteen,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
