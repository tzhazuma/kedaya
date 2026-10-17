import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type {
  CreateErrandTaskInput,
  ErrandTask,
  UpdateErrandTaskInput,
} from '../../domain/models/errand'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ErrandTaskRepository, ListErrandTasksQuery } from '../../domain/ports/errandRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端跑腿仓储。
 *
 * 只做「URL + 类型」映射：信封解包、Bearer、trace、401 自动刷新重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * 查询参数一律是**字符串**：后端用 Zod 按字符串校验
 * （`?mine=1` / `?role=runner`），传布尔会在校验层被拒。
 */
export function createHttpErrandRepository(client: ApiClient): ErrandTaskRepository {
  const base = modulePath('errand', 'items')

  return {
    async list(query: ListErrandTasksQuery): Promise<Result<Page<ErrandTask>, RepositoryError>> {
      const { filters } = query
      const result = await client.get<Page<ErrandTask>>(base, {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        q: filters.keyword,
        status: filters.status,
        fromPlace: filters.fromPlace,
        toPlace: filters.toPlace,
        sort: filters.sort,
        // 「我发布的」走 mine=1（服务端翻成 requesterId）；「我接的」走 role=runner
        mine: filters.scope === 'requester' ? '1' : undefined,
        role: filters.scope === 'runner' ? 'runner' : undefined,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async detail(id: string): Promise<Result<ErrandTask, RepositoryError>> {
      const result = await client.get<ErrandTask>(`${base}/${encodeURIComponent(id)}`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async create(input: CreateErrandTaskInput): Promise<Result<ErrandTask, RepositoryError>> {
      const result = await client.post<ErrandTask, CreateErrandTaskInput>(base, input)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async update(
      id: string,
      input: UpdateErrandTaskInput,
    ): Promise<Result<ErrandTask, RepositoryError>> {
      const result = await client.patch<ErrandTask, UpdateErrandTaskInput>(
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

    accept: (id) => postAction(client, base, id, 'accept'),
    deliver: (id) => postAction(client, base, id, 'deliver'),
    complete: (id) => postAction(client, base, id, 'complete'),
    cancel: (id) => postAction(client, base, id, 'cancel'),
  }
}

async function postAction(
  client: ApiClient,
  base: string,
  id: string,
  action: 'accept' | 'deliver' | 'complete' | 'cancel',
): Promise<Result<ErrandTask, RepositoryError>> {
  const result = await client.post<ErrandTask, Record<string, never>>(
    `${base}/${encodeURIComponent(id)}/${action}`,
    {},
  )
  if (!result.ok) return err(toRepositoryError(result.error))
  return ok(result.value)
}
