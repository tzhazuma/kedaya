import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import { FAQ_CATEGORY_ALL, applyHelpfulVote, isArticlePublished, matchesFaqKeyword } from '../../domain/models/faq'
import type { FaqArticle, FaqTicket } from '../../domain/models/faq'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  FaqArticlePage,
  FaqHelpfulVote,
  ListFaqArticlesQuery,
  SubmitFaqTicketInput,
  VoteFaqHelpfulInput,
} from '../../domain/ports/faqRepository'
import { MOCK_FAQ_ARTICLES, MOCK_FAQ_TICKETS } from './faqFixtures'

/**
 * FAQ 内存数据库 —— mock repository 的存储内核。
 *
 * 「有用」投票的幂等在这里**真实执行**：`userId + articleId` 的集合去重，
 * 重复投票返回 `applied: false` 且计数不变（domain-model §2.8 / 任务硬性要求）。
 * 与用例层的本地幂等共用 domain 的 `applyHelpfulVote`，语义不会漂移。
 */

export interface FaqMemoryDatabase {
  listArticles(query?: ListFaqArticlesQuery): FaqArticlePage
  findArticle(id: string): FaqArticle | null
  voteHelpful(input: VoteFaqHelpfulInput): Result<FaqHelpfulVote, RepositoryError>
  listTickets(userId: string | null): FaqTicket[]
  submitTicket(input: SubmitFaqTicketInput, now: Date): FaqTicket
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

export function createFaqMemoryDatabase(
  seedArticles: readonly FaqArticle[] = MOCK_FAQ_ARTICLES,
  seedTickets: readonly FaqTicket[] = MOCK_FAQ_TICKETS,
): FaqMemoryDatabase {
  let articles: FaqArticle[] = seedArticles.map(clone)
  let tickets: FaqTicket[] = seedTickets.map(clone)
  /** userId → 已投票的文章 id 集合（幂等依据） */
  const votes = new Map<string, Set<string>>()
  let sequence = 0

  function votedBy(userId: string): string[] {
    return [...(votes.get(userId) ?? new Set<string>())]
  }

  return {
    listArticles(query: ListFaqArticlesQuery = {}): FaqArticlePage {
      const limit = clampLimit(query.limit)
      const category = query.category ?? null

      const filtered = articles
        .filter(isArticlePublished)
        .filter(
          (article) =>
            category === null || category === FAQ_CATEGORY_ALL || article.category === category,
        )
        .filter((article) => matchesFaqKeyword(article, query.keyword))

      const cursor = query.cursor ?? null
      const startIndex = cursor === null ? 0 : filtered.findIndex((item) => item.id === cursor) + 1
      const page = filtered.slice(startIndex, startIndex + limit)
      const hasMore = startIndex + limit < filtered.length
      const last = page.length > 0 ? page[page.length - 1] : undefined

      return {
        items: page.map(clone),
        nextCursor: hasMore && last !== undefined ? last.id : null,
        total: filtered.length,
      }
    },

    findArticle(id: string): FaqArticle | null {
      const found = articles.find((article) => article.id === id)
      return found === undefined ? null : clone(found)
    },

    voteHelpful(input: VoteFaqHelpfulInput): Result<FaqHelpfulVote, RepositoryError> {
      const current = articles.find((article) => article.id === input.articleId)
      if (current === undefined) {
        return err({ code: 'NOT_FOUND', message: '该问题不存在或已下架' })
      }

      const already = votedBy(input.userId)
      const outcome = applyHelpfulVote(current, already, input.articleId)

      if (outcome.applied) {
        articles = articles.map((article) =>
          article.id === input.articleId ? outcome.article : article,
        )
        const bucket = votes.get(input.userId) ?? new Set<string>()
        bucket.add(input.articleId)
        votes.set(input.userId, bucket)
      }

      return ok({
        articleId: input.articleId,
        helpfulCount: outcome.article.helpfulCount,
        applied: outcome.applied,
      })
    },

    listTickets(userId: string | null): FaqTicket[] {
      return tickets
        .filter((ticket) => ticket.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(clone)
    },

    submitTicket(input: SubmitFaqTicketInput, now: Date): FaqTicket {
      sequence += 1
      const ticket: FaqTicket = {
        id: `ft-${now.getTime().toString(36)}-${sequence.toString(36)}`,
        userId: input.userId,
        contact: input.contact,
        question: input.question,
        status: 'OPEN',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }
      tickets = [ticket, ...tickets]
      return clone(ticket)
    },

    clear(): void {
      articles = []
      tickets = []
    },

    reset(): void {
      articles = seedArticles.map(clone)
      tickets = seedTickets.map(clone)
      votes.clear()
    },
  }
}
