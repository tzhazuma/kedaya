import { ok, type Result } from '@kedaya/shared'

import type { FaqArticle, FaqTicket } from '../../domain/models/faq'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  FaqArticlePage,
  FaqHelpfulVote,
  FaqRepository,
  ListFaqArticlesQuery,
  SubmitFaqTicketInput,
  VoteFaqHelpfulInput,
} from '../../domain/ports/faqRepository'
import { createFaqMemoryDatabase, type FaqMemoryDatabase } from '../mock/faqMemoryDatabase'
import { mockNow } from '../mock/fixtures'

/**
 * Mock FAQ 仓储 —— 与 `mockGroupBuyRepository` / `mockForumRepository` 同形状：
 * 实现端口 + 暴露演示控制面（三态可真实触发）。
 */

export interface MockFaqRepository extends FaqRepository {
  readonly kind: 'mock'
  reset(): void
  failNextRequests(times: number): void
  setLatency(ms: number): void
  clearAll(): void
}

export interface MockFaqRepositoryOptions {
  latencyMs?: number
  now?: () => Date
  database?: FaqMemoryDatabase
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createMockFaqRepository(options: MockFaqRepositoryOptions = {}): MockFaqRepository {
  const db: FaqMemoryDatabase = options.database ?? createFaqMemoryDatabase()
  const now = options.now ?? mockNow
  let latencyMs = options.latencyMs ?? 220
  let remainingFailures = 0

  async function guard<T>(
    work: () => Result<T, RepositoryError>,
  ): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return { ok: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' } }
    }
    return work()
  }

  return {
    kind: 'mock',

    listArticles(query: ListFaqArticlesQuery = {}): Promise<Result<FaqArticlePage, RepositoryError>> {
      return guard(() => ok(db.listArticles(query)))
    },

    voteHelpful(input: VoteFaqHelpfulInput): Promise<Result<FaqHelpfulVote, RepositoryError>> {
      return guard(() => db.voteHelpful(input))
    },

    listMyTickets(userId: string | null): Promise<Result<FaqTicket[], RepositoryError>> {
      return guard(() => ok(db.listTickets(userId)))
    },

    submitTicket(input: SubmitFaqTicketInput): Promise<Result<FaqTicket, RepositoryError>> {
      return guard(() => ok(db.submitTicket(input, now())))
    },

    reset(): void {
      db.reset()
      remainingFailures = 0
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    setLatency(ms: number): void {
      latencyMs = Math.max(0, ms)
    },

    clearAll(): void {
      db.clear()
    },
  }
}

/** 便于测试/演示：判断文章是否可见（避免测试里重复实现同一规则） */
export function isVisibleFaqArticle(article: FaqArticle): boolean {
  return article.status === 'PUBLISHED'
}
