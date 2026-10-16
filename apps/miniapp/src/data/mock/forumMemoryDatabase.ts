import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import { FORUM_REPORT_HIDE_THRESHOLD, canReply } from '../../domain/models/forum'
import type { ForumBoard, ForumPost, ForumReport, ForumReply } from '../../domain/models/forum'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  CreateForumPostInput,
  CreateForumReplyInput,
  ForumPostPage,
  ForumReplyPage,
  ListForumPostsQuery,
  ListForumRepliesQuery,
  ReportForumContentInput,
} from '../../domain/ports/forumRepository'
import { MOCK_FORUM_BOARDS, MOCK_FORUM_POSTS, MOCK_FORUM_REPLIES } from './forumFixtures'

/**
 * 论坛内存数据库 —— mock repository 的存储内核。
 *
 * 游标分页语义与后端保持一致（契约 §6.1）：`cursor` 是**上一条记录的 id**，
 * 不是 offset。这样 UI 的分页逻辑在切到真后端时不需要改。
 *
 * 治理规则也在这里真实执行（而不是在 UI 里假装）：
 * - 列表**不含** `HIDDEN` / `DELETED` / `DRAFT`（普通用户看不到）；
 * - `LOCKED` 主题不能新增回复；
 * - 3 个不同用户举报 → 目标自动 `HIDDEN`（domain-model §2.4）。
 */

export interface ForumMemoryDatabase {
  listBoards(): ForumBoard[]
  listPosts(query?: ListForumPostsQuery): ForumPostPage
  findPost(id: string): ForumPost | null
  listReplies(postId: string, query?: ListForumRepliesQuery): ForumReplyPage
  createPost(input: CreateForumPostInput, now: Date): ForumPost
  createReply(
    input: CreateForumReplyInput,
    now: Date,
  ): Result<{ reply: ForumReply; post: ForumPost }, RepositoryError>
  report(input: ReportForumContentInput, now: Date): Result<ForumReport, RepositoryError>
  clear(): void
  reset(): void
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return DEFAULT_PAGE_SIZE
  return Math.min(Math.floor(limit), MAX_PAGE_SIZE)
}

/** 普通用户在列表里能看到的状态（HIDDEN / DELETED / DRAFT 都不出现） */
export function isListVisible(post: ForumPost): boolean {
  return post.status === 'PUBLISHED' || post.status === 'LOCKED'
}

function matchesKeyword(post: ForumPost, keyword: string | undefined): boolean {
  if (keyword === undefined || keyword.trim() === '') return true
  const needle = keyword.trim().toLowerCase()
  return (
    post.title.toLowerCase().includes(needle) ||
    post.body.toLowerCase().includes(needle) ||
    post.tags.some((tag) => tag.toLowerCase().includes(needle))
  )
}

/** 置顶优先，其次按创建时间倒序 —— 与后端的列表排序约定一致 */
function comparePosts(a: ForumPost, b: ForumPost): number {
  if (a.pinnedAt !== undefined && b.pinnedAt === undefined) return -1
  if (a.pinnedAt === undefined && b.pinnedAt !== undefined) return 1
  if (a.pinnedAt !== undefined && b.pinnedAt !== undefined) {
    return b.pinnedAt.localeCompare(a.pinnedAt)
  }
  return b.createdAt.localeCompare(a.createdAt)
}

export function createForumMemoryDatabase(
  seedBoards: readonly ForumBoard[] = MOCK_FORUM_BOARDS,
  seedPosts: readonly ForumPost[] = MOCK_FORUM_POSTS,
  seedReplies: readonly ForumReply[] = MOCK_FORUM_REPLIES,
): ForumMemoryDatabase {
  let boards: ForumBoard[] = seedBoards.map(clone)
  let posts: ForumPost[] = seedPosts.map(clone)
  let replies: ForumReply[] = seedReplies.map(clone)
  let reports: ForumReport[] = []
  let sequence = 0

  function nextId(prefix: string, now: Date): string {
    sequence += 1
    return `${prefix}-${now.getTime().toString(36)}-${sequence.toString(36)}`
  }

  return {
    listBoards(): ForumBoard[] {
      return boards.map(clone)
    },

    listPosts(query: ListForumPostsQuery = {}): ForumPostPage {
      const limit = clampLimit(query.limit)
      const boardId = query.boardId ?? null

      const filtered = posts
        .filter(isListVisible)
        .filter((post) => boardId === null || post.boardId === boardId)
        .filter((post) => matchesKeyword(post, query.keyword))
        .sort(comparePosts)

      const cursor = query.cursor ?? null
      const startIndex = cursor === null ? 0 : filtered.findIndex((post) => post.id === cursor) + 1
      const page = filtered.slice(startIndex, startIndex + limit)
      const hasMore = startIndex + limit < filtered.length
      const last = page.length > 0 ? page[page.length - 1] : undefined

      return {
        items: page.map(clone),
        nextCursor: hasMore && last !== undefined ? last.id : null,
        total: filtered.length,
      }
    },

    findPost(id: string): ForumPost | null {
      const found = posts.find((post) => post.id === id)
      return found === undefined ? null : clone(found)
    },

    listReplies(postId: string, query: ListForumRepliesQuery = {}): ForumReplyPage {
      const limit = clampLimit(query.limit)
      const filtered = replies
        .filter((reply) => reply.postId === postId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

      const cursor = query.cursor ?? null
      const startIndex = cursor === null ? 0 : filtered.findIndex((reply) => reply.id === cursor) + 1
      const page = filtered.slice(startIndex, startIndex + limit)
      const hasMore = startIndex + limit < filtered.length
      const last = page.length > 0 ? page[page.length - 1] : undefined

      return {
        items: page.map(clone),
        nextCursor: hasMore && last !== undefined ? last.id : null,
        total: filtered.length,
      }
    },

    createPost(input: CreateForumPostInput, now: Date): ForumPost {
      const board = boards.find((item) => item.id === input.boardId)
      const post: ForumPost = {
        id: nextId('fp', now),
        boardId: input.boardId,
        title: input.title,
        body: input.body,
        status: 'PUBLISHED',
        anonymous: input.anonymous,
        authorId: input.authorId,
        authorName: input.anonymous ? '匿名同学' : input.authorName,
        tags: [...input.tags],
        replyCount: 0,
        likeCount: 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }
      posts = [post, ...posts]
      if (board !== undefined) {
        boards = boards.map((item) =>
          item.id === board.id ? { ...item, postCount: item.postCount + 1 } : item,
        )
      }
      return clone(post)
    },

    createReply(
      input: CreateForumReplyInput,
      now: Date,
    ): Result<{ reply: ForumReply; post: ForumPost }, RepositoryError> {
      const current = posts.find((post) => post.id === input.postId)
      if (current === undefined) {
        return err({ code: 'NOT_FOUND', message: '主题不存在或已被删除' })
      }

      // 规则只在 domain 里写一次（LOCKED / HIDDEN / DELETED / DRAFT）
      const eligibility = canReply(current)
      if (!eligibility.allowed) {
        return err({
          code: 'CONFLICT',
          message: eligibility.message,
          details: { reason: eligibility.reason },
        })
      }

      const reply: ForumReply = {
        id: nextId('fr', now),
        postId: input.postId,
        ...(input.parentReplyId === undefined ? {} : { parentReplyId: input.parentReplyId }),
        body: input.body,
        status: 'PUBLISHED',
        anonymous: input.anonymous,
        authorId: input.authorId,
        authorName: input.anonymous ? '匿名同学' : input.authorName,
        createdAt: now.toISOString(),
      }
      replies = [...replies, reply]

      const updated: ForumPost = {
        ...current,
        replyCount: current.replyCount + 1,
        updatedAt: now.toISOString(),
      }
      posts = posts.map((post) => (post.id === current.id ? updated : post))

      return ok({ reply: clone(reply), post: clone(updated) })
    },

    report(input: ReportForumContentInput, now: Date): Result<ForumReport, RepositoryError> {
      const duplicated = reports.some(
        (report) =>
          report.targetType === input.targetType &&
          report.targetId === input.targetId &&
          report.reporterId === input.reporterId,
      )
      if (duplicated) {
        return err({ code: 'CONFLICT', message: '你已经举报过这条内容了' })
      }

      const report: ForumReport = {
        id: nextId('frep', now),
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        status: 'PENDING',
        reporterId: input.reporterId,
        anonymous: input.anonymous,
        createdAt: now.toISOString(),
      }
      reports = [...reports, report]

      // 治理规则：3 个**不同**用户举报 → 自动隐藏 + 进人工队列（domain-model §2.4）
      const distinctReporters = new Set(
        reports
          .filter(
            (item) => item.targetType === input.targetType && item.targetId === input.targetId,
          )
          .map((item) => item.reporterId),
      )
      if (distinctReporters.size >= FORUM_REPORT_HIDE_THRESHOLD) {
        if (input.targetType === 'POST') {
          posts = posts.map((post) =>
            post.id === input.targetId && post.status === 'PUBLISHED'
              ? { ...post, status: 'HIDDEN', updatedAt: now.toISOString() }
              : post,
          )
        } else {
          replies = replies.map((reply) =>
            reply.id === input.targetId && reply.status === 'PUBLISHED'
              ? { ...reply, status: 'HIDDEN' }
              : reply,
          )
        }
      }

      return ok(clone(report))
    },

    clear(): void {
      posts = []
      replies = []
      reports = []
      boards = boards.map((board) => ({ ...board, postCount: 0 }))
    },

    reset(): void {
      boards = seedBoards.map(clone)
      posts = seedPosts.map(clone)
      replies = seedReplies.map(clone)
      reports = []
    },
  }
}
