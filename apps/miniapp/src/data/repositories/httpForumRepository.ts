import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { ForumBoard, ForumPost, ForumReport, ForumReply } from '../../domain/models/forum'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  CreateForumPostInput,
  CreateForumReplyInput,
  ForumPostPage,
  ForumReplyPage,
  ForumRepository,
  ListForumPostsQuery,
  ListForumRepliesQuery,
  ReportForumContentInput,
} from '../../domain/ports/forumRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端论坛仓储 —— 契约 §6.1 的 CRUD 形状 + §11.2 的领域动作登记表：
 *
 * ```
 * GET    /api/v1/forum/boards                版块（子资源）
 * GET    /api/v1/forum/items                 主题列表（游标分页）
 * GET    /api/v1/forum/items/:id             主题详情
 * GET    /api/v1/forum/items/:id/replies     回复列表（子资源，游标分页）
 * POST   /api/v1/forum/items                 发帖
 * POST   /api/v1/forum/items/:id/replies     回复
 * POST   /api/v1/forum/items/:id/report      举报（**§11.2 已登记**的领域动作）
 * ```
 *
 * 信封解包、Bearer、trace、401 重试全部由 `ApiClient` 负责（契约 §7 硬规则 3）；
 * 这里只做「URL + 类型」映射。所有 `POST` 都带 `Idempotency-Key`（契约 §11.3 必需）。
 */
export function createHttpForumRepository(client: ApiClient): ForumRepository {
  return {
    async listBoards(): Promise<Result<ForumBoard[], RepositoryError>> {
      const result = await client.get<ForumBoard[]>(modulePath('forum', 'boards'))
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async listPosts(query: ListForumPostsQuery = {}): Promise<Result<ForumPostPage, RepositoryError>> {
      const result = await client.get<Page<ForumPost>>(modulePath('forum', 'items'), {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        boardId: query.boardId ?? undefined,
        keyword: query.keyword,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({
        items: result.value.items,
        nextCursor: result.value.nextCursor,
        total: result.value.total,
      })
    },

    async postDetail(id: string): Promise<Result<ForumPost, RepositoryError>> {
      const result = await client.get<ForumPost>(modulePath('forum', 'items', encodeURIComponent(id)))
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async listReplies(
      postId: string,
      query: ListForumRepliesQuery = {},
    ): Promise<Result<ForumReplyPage, RepositoryError>> {
      const result = await client.get<Page<ForumReply>>(
        modulePath('forum', 'items', encodeURIComponent(postId), 'replies'),
        {
          cursor: query.cursor ?? undefined,
          limit: query.limit ?? DEFAULT_PAGE_SIZE,
        },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({
        items: result.value.items,
        nextCursor: result.value.nextCursor,
        total: result.value.total,
      })
    },

    async createPost(input: CreateForumPostInput): Promise<Result<ForumPost, RepositoryError>> {
      const body = {
        boardId: input.boardId,
        title: input.title,
        body: input.body,
        tags: input.tags,
        anonymous: input.anonymous,
      }
      const result = await client.post<ForumPost, typeof body>(
        modulePath('forum', 'items'),
        body,
        input.idempotencyKey === undefined ? undefined : { idempotencyKey: input.idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async createReply(input: CreateForumReplyInput): Promise<Result<ForumReply, RepositoryError>> {
      const body = {
        body: input.body,
        parentReplyId: input.parentReplyId,
        anonymous: input.anonymous,
      }
      const result = await client.post<ForumReply, typeof body>(
        modulePath('forum', 'items', encodeURIComponent(input.postId), 'replies'),
        body,
        input.idempotencyKey === undefined ? undefined : { idempotencyKey: input.idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async report(input: ReportForumContentInput): Promise<Result<ForumReport, RepositoryError>> {
      const body = {
        targetType: input.targetType,
        reason: input.reason,
        anonymous: input.anonymous,
      }
      const result = await client.post<ForumReport, typeof body>(
        modulePath('forum', 'items', encodeURIComponent(input.targetId), 'report'),
        body,
        input.idempotencyKey === undefined ? undefined : { idempotencyKey: input.idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
