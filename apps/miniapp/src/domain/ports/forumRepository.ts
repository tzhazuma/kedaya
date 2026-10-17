import type { Result } from '@kedaya/shared'

import type { Page } from '@kedaya/contracts'

import type {
  CreateForumPostInput,
  CreateForumReplyInput,
  ForumBoardStat,
  ForumPost,
  ForumPostDetail,
  ForumPostFilters,
  ForumReply,
} from '../models/forum'
import type { RepositoryError } from './errors'

/**
 * 论坛仓储端口 —— http / mock 两套实现（契约 §7 硬规则 3、4）。
 *
 * 端点形状（与后端 `forum.controller.ts` 一一对应，
 * 控制器挂在 `modulePath('forum')` 下，资源段是 `posts` / `boards`）：
 * ```
 * GET    /forum/boards                  版块清单 + 每个版块的帖子数（版块切换用它）
 * GET    /forum/posts                   列表（游标分页 + 版块/状态/关键词筛选 + 排序）
 * POST   /forum/posts                   发帖（需登录，可选匿名）
 * GET    /forum/posts/:id               详情 + 一页回复（replyCursor / replyLimit）
 * POST   /forum/posts/:id/replies       回复（需登录，可选匿名；同一事务维护 replyCount）
 * POST   /forum/posts/:id/close         关闭主题（仅实名作者；匿名帖不可关闭）
 * DELETE /forum/posts/:id               删除主题（仅实名作者；匿名帖不可删除）
 * ```
 */

export interface ListForumPostsQuery {
  cursor: string | null
  limit?: number
  filters: ForumPostFilters
}

export interface ForumDetailQuery {
  replyCursor: string | null
  replyLimit?: number
}

export interface ForumRepository {
  /** 版块清单 + 帖子数（后端按契约顺序补齐 0） */
  boards(): Promise<Result<ForumBoardStat[], RepositoryError>>
  list(query: ListForumPostsQuery): Promise<Result<Page<ForumPost>, RepositoryError>>
  detail(
    id: string,
    query?: ForumDetailQuery,
  ): Promise<Result<ForumPostDetail, RepositoryError>>
  createPost(input: CreateForumPostInput): Promise<Result<ForumPost, RepositoryError>>
  reply(
    id: string,
    input: CreateForumReplyInput,
  ): Promise<Result<ForumReply, RepositoryError>>
  close(id: string): Promise<Result<ForumPost, RepositoryError>>
  remove(id: string): Promise<Result<{ id: string }, RepositoryError>>
}
