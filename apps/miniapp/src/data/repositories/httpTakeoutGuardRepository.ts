import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type {
  CreateTakeoutGuardReportInput,
  TakeoutGuardReport,
} from '../../domain/models/takeoutGuard'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ListTakeoutGuardReportsQuery,
  TakeoutGuardRepository,
} from '../../domain/ports/takeoutGuardRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端偷外卖仓储。
 *
 * 只做「URL + 类型」映射：信封解包、Bearer、trace、401 自动刷新重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * 查询参数全部是**字符串**（后端用 Zod 按字符串校验）：`status` 只在选了具体状态时发送，
 * 不发 `mine` —— 后端的列表本来就是"只看自己"，没有这个开关。
 */
export function createHttpTakeoutGuardRepository(client: ApiClient): TakeoutGuardRepository {
  const base = modulePath('takeout-guard', 'items')

  return {
    async list(
      query: ListTakeoutGuardReportsQuery,
    ): Promise<Result<Page<TakeoutGuardReport>, RepositoryError>> {
      const result = await client.get<Page<TakeoutGuardReport>>(base, {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        status: query.filters.status,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async detail(id: string): Promise<Result<TakeoutGuardReport, RepositoryError>> {
      const result = await client.get<TakeoutGuardReport>(`${base}/${encodeURIComponent(id)}`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async create(
      input: CreateTakeoutGuardReportInput,
    ): Promise<Result<TakeoutGuardReport, RepositoryError>> {
      const result = await client.post<TakeoutGuardReport, CreateTakeoutGuardReportInput>(base, input)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    escalate: (id) => postAction(client, base, id, 'escalate'),
    resolve: (id) => postAction(client, base, id, 'resolve'),
  }
}

async function postAction(
  client: ApiClient,
  base: string,
  id: string,
  action: 'escalate' | 'resolve',
): Promise<Result<TakeoutGuardReport, RepositoryError>> {
  const result = await client.post<TakeoutGuardReport, Record<string, never>>(
    `${base}/${encodeURIComponent(id)}/${action}`,
    {},
  )
  if (!result.ok) return err(toRepositoryError(result.error))
  return ok(result.value)
}
