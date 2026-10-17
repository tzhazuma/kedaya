import type { Result } from '@kedaya/shared'
import { err, ok } from '@kedaya/shared'

import type { Page } from '@kedaya/contracts'

import {
  FORUM_REPLIES_DEFAULT_PAGE_SIZE,
  boardProblem,
  bodyProblem,
  normalizeBoardStats,
  replyProblem,
  summarizePost,
  titleProblem,
} from '../../domain/models/forum'
import type {
  ForumBoardStat,
  ForumPost,
  ForumPostDetail,
  ForumPostFilters,
  ForumPostSummary,
  ForumReply,
} from '../../domain/models/forum'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ForumRepository } from '../../domain/ports/forumRepository'
import { createDetailUseCase } from '../common/detailUseCase'
import type { DetailUseCase } from '../common/detailUseCase'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'

/**
 * 论坛用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 列表与详情的**机制**来自 `application/common/*`（六个模块共用、单独有测试），
 * 本文件只负责模块特有的事：
 *   1. 把筛选条件翻译成仓储查询（版块 / 关键词 / 状态 / 排序 / 只看我的）；
 *   2. 把行数据映射成卡片直接可读的 `ForumPostSummary`（含回复数、最后回复、匿名标记）；
 *   3. 发帖 / 回复前做客户端校验；
 *   4. **同一动作后刷新详情**：回复成功后重新拉详情，保证 `replyCount` 与回复列表一致。
 *
 * 匿名只影响存储形态：客户端可以要求「匿名发帖」，但实名主体永远来自 JWT，
 * 页面拿不到也不该伪造 `authorId`。
 */

const PAGE_SIZE = 10

export interface ForumPostDraft {
  board: string
  title: string
  body: string
  anonymous: boolean
}

export interface ForumReplyDraft {
  body: string
  anonymous: boolean
}

/** 发帖的客户端校验（与服务端 Zod / normalize* 同一套规则，只做即时提示） */
export function validatePostDraft(draft: ForumPostDraft): string[] {
  const problems: string[] = []

  const board = boardProblem(draft.board)
  if (board !== null) problems.push(board)

  const title = titleProblem(draft.title)
  if (title !== null) problems.push(title)

  const body = bodyProblem(draft.body)
  if (body !== null) problems.push(body)

  return problems
}

/** 回复的客户端校验 */
export function validateReplyDraft(draft: ForumReplyDraft): string[] {
  const problem = replyProblem(draft.body)
  return problem === null ? [] : [problem]
}

export interface ForumDeps {
  repository: ForumRepository
  cache: CachePort
  clock: ClockPort
  /** 列表缓存 key 由装配层注入 */
  cacheKey: string
  /** 当前登录用户 id（未登录为 null）—— 用来判定「这是我发的」 */
  viewerId: () => string | null
}

export interface ForumUseCases {
  list: ListUseCase<ForumPostFilters, ForumPostSummary>
  detail: DetailUseCase<ForumPostDetail>
  /** 版块清单 + 帖子数（列表页版块切换用它；后端已按契约顺序补齐 0） */
  boards(): Promise<Result<ForumBoardStat[], RepositoryError>>
  /** 发帖：本地校验通过后才发请求，成功后清空列表缓存 */
  createPost(draft: ForumPostDraft): Promise<Result<ForumPost, RepositoryError>>
  /** 回复：成功后**重新拉取详情**，让回复数与回复列表立刻一致 */
  reply(id: string, draft: ForumReplyDraft): Promise<Result<ForumReply, RepositoryError>>
  /** 关闭主题：成功后详情替换为服务端最新状态（closed） */
  close(id: string): Promise<Result<ForumPostDetail, RepositoryError>>
  remove(id: string): Promise<Result<{ id: string }, RepositoryError>>
  /** 回复分页：把下一页回复并到当前详情里（游标为空时是空操作） */
  loadMoreReplies(id: string): Promise<Result<ForumPostDetail, RepositoryError>>
}

export function createForumUseCases(deps: ForumDeps): ForumUseCases {
  const { repository, cache, clock, cacheKey, viewerId } = deps

  const list: ListUseCase<ForumPostFilters, ForumPostSummary> = createListUseCase<
    ForumPostFilters,
    ForumPost,
    ForumPostSummary
  >({
    cache,
    clock,
    cacheKey,
    defaultQuery: { sort: 'latest' },
    isCachedPage: createCachedPageGuard<ForumPost>(),
    fetchPage: (filters, cursor) => repository.list({ cursor, limit: PAGE_SIZE, filters }),
    // 每次映射时取当前用户：登录后重新 load 即可拿到正确的「我的」标记
    mapItem: (post, now) => summarizePost(post, viewerId(), now),
  })

  const detail = createDetailUseCase<ForumPostDetail>((id) =>
    repository.detail(id, { replyCursor: null, replyLimit: FORUM_REPLIES_DEFAULT_PAGE_SIZE }),
  )

  return {
    list,
    detail,

    async boards() {
      const result = await repository.boards()
      if (!result.ok) return result
      // 两条实现路径（http / mock）都归一化一次，页面拿到的顺序永远与契约一致
      return ok(normalizeBoardStats(result.value))
    },

    async createPost(draft) {
      if (viewerId() === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录后再发帖' })
      }

      const problems = validatePostDraft(draft)
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查填写内容' })
      }

      const result = await repository.createPost({
        board: draft.board,
        title: draft.title.trim(),
        body: draft.body.trim(),
        anonymous: draft.anonymous,
      })
      if (result.ok) list.reset()
      return result
    },

    async reply(id, draft) {
      if (viewerId() === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录后再回复' })
      }

      const problems = validateReplyDraft(draft)
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查回复内容' })
      }

      const result = await repository.reply(id, {
        body: draft.body.trim(),
        anonymous: draft.anonymous,
      })
      // 回复成功即刷新详情：replyCount / lastReplyAt 由后端在同一事务里维护，
      // 客户端只能靠重新拉取来对齐（乐观 +1 会在并发回复时漂移）。
      if (result.ok) await detail.load(id)
      return result
    },

    async close(id) {
      const result = await detail.mutate(async () => {
        const closed = await repository.close(id)
        if (!closed.ok) return err(closed.error)
        return repository.detail(id, {
          replyCursor: null,
          replyLimit: FORUM_REPLIES_DEFAULT_PAGE_SIZE,
        })
      })
      if (result.ok) list.reset()
      return result
    },

    async remove(id) {
      const result = await repository.remove(id)
      if (result.ok) {
        list.reset()
        detail.reset()
      }
      return result
    },

    async loadMoreReplies(id) {
      const current = detail.getSnapshot().data
      if (current === null) {
        return err({ code: 'NOT_FOUND', message: '主题尚未加载，无法翻页' })
      }

      const cursor = current.replies.nextCursor
      if (cursor === null) return ok(current)

      const page = await repository.detail(id, { replyCursor: cursor })
      if (!page.ok) return page

      const merged: ForumPostDetail = {
        post: page.value.post,
        replies: mergePages(current.replies, page.value.replies),
      }
      detail.seed(merged)
      return ok(merged)
    },
  }
}

function mergePages(current: Page<ForumReply>, next: Page<ForumReply>): Page<ForumReply> {
  return {
    items: [...current.items, ...next.items],
    nextCursor: next.nextCursor,
    ...(next.total === undefined ? {} : { total: next.total }),
  }
}
