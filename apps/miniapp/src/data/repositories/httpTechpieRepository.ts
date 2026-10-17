import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { CreateTechpieLinkInput, TechpieLink } from '../../domain/models/techpie'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ListTechpieLinksQuery, TechpieRepository } from '../../domain/ports/techpieRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端服务目录仓储。
 *
 * 只做「URL + 类型」映射：信封解包、Bearer、trace、401 自动刷新重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * 查询参数全部是**字符串**（后端用 Zod 按字符串校验）：未选分类时不发 `category`，
 * 关键词为空时不发 `q`，避免服务端把空串当成"搜空字符串"。
 */
export function createHttpTechpieRepository(client: ApiClient): TechpieRepository {
  const base = modulePath('techpie', 'items')

  return {
    async list(
      query: ListTechpieLinksQuery,
    ): Promise<Result<Page<TechpieLink>, RepositoryError>> {
      const { filters } = query
      const result = await client.get<Page<TechpieLink>>(base, {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        category: filters.category,
        q: filters.q,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async detail(id: string): Promise<Result<TechpieLink, RepositoryError>> {
      const result = await client.get<TechpieLink>(`${base}/${encodeURIComponent(id)}`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async create(input: CreateTechpieLinkInput): Promise<Result<TechpieLink, RepositoryError>> {
      const result = await client.post<TechpieLink, CreateTechpieLinkInput>(base, input)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    /**
     * 领域动作：`POST /items/:id/sync`（不带请求体）。
     *
     * ⚠️ 它不是"与对方系统同步"：后端只是把 status 写成 `synced`。幂等，不返回冲突。
     */
    async sync(id: string): Promise<Result<TechpieLink, RepositoryError>> {
      const result = await client.post<TechpieLink, Record<string, never>>(
        `${base}/${encodeURIComponent(id)}/sync`,
        {},
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
