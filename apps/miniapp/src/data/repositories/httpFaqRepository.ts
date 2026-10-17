import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { CreateFaqEntryInput, FaqEntry } from '../../domain/models/faq'
import type { RepositoryError } from '../../domain/ports/errors'
import type { FaqRepository, ListFaqEntriesQuery } from '../../domain/ports/faqRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端常见问题仓储。
 *
 * 只做「URL + 类型」映射：信封解包、Bearer、trace、401 自动刷新重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * 查询参数名与后端 `listQuerySchema` 严格一致：`category`（精确）、
 * `q`（question / answer 模糊）—— 客户端这边叫 `filters.keyword`，
 * 翻译发生在本文件这**一处**，页面与用例都不需要知道后端的参数叫 `q`。
 */
export function createHttpFaqRepository(client: ApiClient): FaqRepository {
  const base = modulePath('faq', 'items')

  return {
    async list(query: ListFaqEntriesQuery): Promise<Result<Page<FaqEntry>, RepositoryError>> {
      const result = await client.get<Page<FaqEntry>>(base, {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        category: query.filters.category,
        q: query.filters.keyword,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async detail(id: string): Promise<Result<FaqEntry, RepositoryError>> {
      const result = await client.get<FaqEntry>(`${base}/${encodeURIComponent(id)}`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async create(input: CreateFaqEntryInput): Promise<Result<FaqEntry, RepositoryError>> {
      // 不发 `helpfulCount`：计数只能由服务端自增（后端 schema 会把它剥掉）
      const result = await client.post<FaqEntry, CreateFaqEntryInput>(base, input)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async markHelpful(id: string): Promise<Result<FaqEntry, RepositoryError>> {
      const result = await client.post<FaqEntry, Record<string, never>>(
        `${base}/${encodeURIComponent(id)}/helpful`,
        {},
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
