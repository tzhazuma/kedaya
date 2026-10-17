import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type {
  BuddyGroup,
  BuddyGroupDetail,
  CreateBuddyGroupInput,
} from '../../domain/models/buddy'
import type { RepositoryError } from '../../domain/ports/errors'
import type { BuddyRepository, ListBuddyGroupsQuery } from '../../domain/ports/buddyRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端找搭子仓储。
 *
 * 与跳蚤/跑腿同一套形状；`mine=1` / `joined=1` / `upcoming=1` 都用字符串 `'1'`
 * ——后端 `buddy.controller.ts` 用 Zod 按字面量校验。
 *
 * 注意到 `join` / `leave` / `close` / `cancel` 返回的是**小组**（不含成员列表）：
 * 成员列表变化由用例层在动作成功后重新拉一次详情来体现。
 */
export function createHttpBuddyRepository(client: ApiClient): BuddyRepository {
  const base = modulePath('buddy', 'groups')

  return {
    async list(query: ListBuddyGroupsQuery): Promise<Result<Page<BuddyGroup>, RepositoryError>> {
      const { filters } = query
      const result = await client.get<Page<BuddyGroup>>(base, {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        q: filters.keyword,
        activity: filters.activity,
        status: filters.status,
        sort: filters.sort,
        mine: filters.scope === 'mine' ? '1' : undefined,
        joined: filters.scope === 'joined' ? '1' : undefined,
        upcoming: filters.onlyUpcoming === true ? '1' : undefined,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async detail(id: string): Promise<Result<BuddyGroupDetail, RepositoryError>> {
      const result = await client.get<BuddyGroupDetail>(`${base}/${encodeURIComponent(id)}`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async create(input: CreateBuddyGroupInput): Promise<Result<BuddyGroup, RepositoryError>> {
      const result = await client.post<BuddyGroup, CreateBuddyGroupInput>(base, input)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    join: (id) => postAction(client, base, id, 'join'),
    leave: (id) => postAction(client, base, id, 'leave'),
    close: (id) => postAction(client, base, id, 'close'),
    cancel: (id) => postAction(client, base, id, 'cancel'),
  }
}

async function postAction(
  client: ApiClient,
  base: string,
  id: string,
  action: 'join' | 'leave' | 'close' | 'cancel',
): Promise<Result<BuddyGroup, RepositoryError>> {
  const result = await client.post<BuddyGroup, Record<string, never>>(
    `${base}/${encodeURIComponent(id)}/${action}`,
    {},
  )
  if (!result.ok) return err(toRepositoryError(result.error))
  return ok(result.value)
}
