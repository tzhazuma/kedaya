import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type {
  CreateForumPostInput,
  CreateForumReplyInput,
  ForumBoardStat,
  ForumPost,
  ForumPostDetail,
  ForumReply,
} from '../../domain/models/forum'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ForumDetailQuery,
  ForumRepository,
  ListForumPostsQuery,
} from '../../domain/ports/forumRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端论坛仓储。
 *
 * 只做「URL + 类型」映射：信封解包、Bearer、trace、401 自动刷新重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * 前缀用 `modulePath('forum', '')`（= `forum/`），资源段 `posts` / `boards` 直接拼接 ——
 * 与后端 `@Controller(modulePath('forum'))` + `@Get('posts')` 的形状一一对应。
 *
 * 查询参数全部是**字符串**：后端用 Zod 按字符串校验（`?mine=1`），
 * 传布尔会在校验层被拒；`status` 不传时后端默认只返回 `published`，因此不要主动补默认值。
 */
export function createHttpForumRepository(client: ApiClient): ForumRepository {
  const base = modulePath('forum', '')

  return {
    async boards(): Promise<Result<ForumBoardStat[], RepositoryError>> {
      const result = await client.get<ForumBoardStat[]>(`${base}boards`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async list(query: ListForumPostsQuery): Promise<Result<Page<ForumPost>, RepositoryError>> {
      const { filters } = query
      const result = await client.get<Page<ForumPost>>(`${base}posts`, {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        board: filters.board,
        status: filters.status,
        q: filters.keyword,
        sort: filters.sort,
        mine: filters.mine === true ? '1' : undefined,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async detail(
      id: string,
      query?: ForumDetailQuery,
    ): Promise<Result<ForumPostDetail, RepositoryError>> {
      const result = await client.get<ForumPostDetail>(`${base}posts/${encodeURIComponent(id)}`, {
        replyCursor: query?.replyCursor ?? undefined,
        replyLimit: query?.replyLimit,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async createPost(input: CreateForumPostInput): Promise<Result<ForumPost, RepositoryError>> {
      const result = await client.post<ForumPost, CreateForumPostInput>(`${base}posts`, input)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async reply(
      id: string,
      input: CreateForumReplyInput,
    ): Promise<Result<ForumReply, RepositoryError>> {
      const result = await client.post<ForumReply, CreateForumReplyInput>(
        `${base}posts/${encodeURIComponent(id)}/replies`,
        input,
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async close(id: string): Promise<Result<ForumPost, RepositoryError>> {
      const result = await client.post<ForumPost, Record<string, never>>(
        `${base}posts/${encodeURIComponent(id)}/close`,
        {},
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async remove(id: string): Promise<Result<{ id: string }, RepositoryError>> {
      const result = await client.del<{ id: string; deleted: true }>(
        `${base}posts/${encodeURIComponent(id)}`,
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({ id: result.value.id })
    },
  }
}
