import type { Result } from '@kedaya/shared'

import type {
  ForumBoard,
  ForumPost,
  ForumReport,
  ForumReportReason,
  ForumReportTargetType,
  ForumReply,
} from '../models/forum'
import type { RepositoryError } from './errors'

/** 游标分页查询（契约 §6.1：不用 offset 分页） */
export interface ListForumPostsQuery {
  boardId?: string | null
  cursor?: string | null
  limit?: number
  keyword?: string
}

export interface ForumPostPage {
  items: ForumPost[]
  nextCursor: string | null
  total?: number
}

export interface ListForumRepliesQuery {
  cursor?: string | null
  limit?: number
}

export interface ForumReplyPage {
  items: ForumReply[]
  nextCursor: string | null
  total?: number
}

export interface CreateForumPostInput {
  boardId: string
  title: string
  body: string
  tags: string[]
  anonymous: boolean
  /** 匿名时为 `AnonymousIdentity.id`（由后端签发；端上先透传会话身份） */
  authorId: string
  authorName: string
  /** 契约 §11.3：POST 必须带 `Idempotency-Key` */
  idempotencyKey?: string
}

export interface CreateForumReplyInput {
  postId: string
  body: string
  parentReplyId?: string
  anonymous: boolean
  authorId: string
  authorName: string
  idempotencyKey?: string
}

export interface ReportForumContentInput {
  targetType: ForumReportTargetType
  targetId: string
  reason: ForumReportReason
  /** 举报人真实身份（用于「3 个不同用户举报」阈值），与是否匿名展示解耦 */
  reporterId: string
  anonymous: boolean
  idempotencyKey?: string
}

/**
 * 论坛仓储端口 —— 由 `data/repositories/*` 实现（http / mock 两套）。
 *
 * 契约 §7 硬规则 3：所有网络访问必须经过 `data/api/`，
 * `presentation` 禁止直接发请求，只能通过用例层调用本端口。
 *
 * 路径映射（契约 §6.1 + §11.2）：
 * - `listBoards`  → `GET  /forum/boards`（子资源，非领域动作）
 * - `listPosts`   → `GET  /forum/items`
 * - `postDetail`  → `GET  /forum/items/:id`
 * - `listReplies` → `GET  /forum/items/:id/replies`（子资源）
 * - `createPost`  → `POST /forum/items`
 * - `createReply` → `POST /forum/items/:id/replies`（子资源）
 * - `report`      → `POST /forum/items/:id/report`（**已登记**的领域动作，见 §11.2）
 */
export interface ForumRepository {
  listBoards(): Promise<Result<ForumBoard[], RepositoryError>>
  listPosts(query?: ListForumPostsQuery): Promise<Result<ForumPostPage, RepositoryError>>
  postDetail(id: string): Promise<Result<ForumPost, RepositoryError>>
  listReplies(
    postId: string,
    query?: ListForumRepliesQuery,
  ): Promise<Result<ForumReplyPage, RepositoryError>>
  createPost(input: CreateForumPostInput): Promise<Result<ForumPost, RepositoryError>>
  createReply(input: CreateForumReplyInput): Promise<Result<ForumReply, RepositoryError>>
  report(input: ReportForumContentInput): Promise<Result<ForumReport, RepositoryError>>
}
