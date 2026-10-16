import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import { FAQ_CATEGORY_ALL } from '../../domain/models/faq'
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
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端 FAQ 仓储 —— 契约 §6.1 的 CRUD 形状：
 *
 * ```
 * GET  /api/v1/faq/items                 问答列表（游标分页，无需登录）
 * POST /api/v1/faq/items/:id/votes       「有用」投票（**子资源**，见下）
 * GET  /api/v1/faq/tickets               我的工单（子资源）
 * POST /api/v1/faq/tickets               提交工单
 * ```
 *
 * ⚠️ **契约缺口（已上报 Lead）**：契约 §11.2 冻结了领域动作名，但 `faq` 的
 * `VoteHelpful` 没有登记项。为了**不自创** `<action>` 名（§11.2 明令禁止），
 * 这里把投票建模为**子资源集合的创建**（`POST /faq/items/:id/votes`，
 * body `{ value: 'helpful' }`）而不是动作（`POST /faq/items/:id/helpful`）。
 * 子资源不受「动作名冻结」约束，且天然可承载 `Idempotency-Key`。
 * 若 Lead 决定登记为 `faq.vote` 动作，只需改本文件里的这一行路径。
 *
 * 所有 `POST` 都带 `Idempotency-Key`（契约 §11.3 必需）。
 */
export function createHttpFaqRepository(client: ApiClient): FaqRepository {
  return {
    async listArticles(query: ListFaqArticlesQuery = {}): Promise<Result<FaqArticlePage, RepositoryError>> {
      const category = query.category ?? null
      const result = await client.get<Page<FaqArticle>>(modulePath('faq', 'items'), {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        category: category === null || category === FAQ_CATEGORY_ALL ? undefined : category,
        keyword: query.keyword,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({
        items: result.value.items,
        nextCursor: result.value.nextCursor,
        total: result.value.total,
      })
    },

    async voteHelpful(input: VoteFaqHelpfulInput): Promise<Result<FaqHelpfulVote, RepositoryError>> {
      const body = { value: 'helpful' as const }
      const result = await client.post<FaqHelpfulVote, typeof body>(
        modulePath('faq', 'items', encodeURIComponent(input.articleId), 'votes'),
        body,
        input.idempotencyKey === undefined ? undefined : { idempotencyKey: input.idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async listMyTickets(userId: string | null): Promise<Result<FaqTicket[], RepositoryError>> {
      const result = await client.get<Page<FaqTicket>>(modulePath('faq', 'tickets'), {
        limit: DEFAULT_PAGE_SIZE,
        mine: userId === null ? undefined : true,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value.items)
    },

    async submitTicket(input: SubmitFaqTicketInput): Promise<Result<FaqTicket, RepositoryError>> {
      const body = { contact: input.contact, question: input.question }
      const result = await client.post<FaqTicket, typeof body>(
        modulePath('faq', 'tickets'),
        body,
        input.idempotencyKey === undefined ? undefined : { idempotencyKey: input.idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
