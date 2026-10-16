import type { Result } from '@kedaya/shared'

import type { FaqArticle, FaqTicket } from '../models/faq'
import type { RepositoryError } from './errors'

/** 游标分页查询（契约 §6.1） */
export interface ListFaqArticlesQuery {
  /** `FAQ_CATEGORY_ALL` 或 `null` 表示不筛选 */
  category?: string | null
  keyword?: string
  cursor?: string | null
  limit?: number
}

export interface FaqArticlePage {
  items: FaqArticle[]
  nextCursor: string | null
  total?: number
}

export interface VoteFaqHelpfulInput {
  articleId: string
  /** 投票人；`faq` 是低敏感模块，未登录时由用例层填匿名标识 */
  userId: string
  /** 契约 §11.3：POST 必须带 `Idempotency-Key` */
  idempotencyKey?: string
}

export interface FaqHelpfulVote {
  articleId: string
  helpfulCount: number
  /** false = 该用户此前已投过（重复点击只算一次） */
  applied: boolean
}

export interface SubmitFaqTicketInput {
  /** 未登录也可提交（domain-model §2.8），此时为 `null` */
  userId: string | null
  /** 邮箱或微信，**不存明文手机号** */
  contact: string
  question: string
  idempotencyKey?: string
}

/**
 * 常见问题仓储端口 —— 由 `data/repositories/*` 实现（http / mock 两套）。
 *
 * 路径映射（契约 §6.1；`faq` 未登记领域动作，见下）：
 * - `listArticles`  → `GET  /faq/items`
 * - `voteHelpful`   → `POST /faq/items/:id/votes`  body `{ value: 'helpful' }`
 * - `listMyTickets` → `GET  /faq/tickets`
 * - `submitTicket`  → `POST /faq/tickets`
 *
 * ⚠️ **契约缺口（需 Lead 裁决，已在交付说明中上报）**：
 * 契约 §11.2 冻结了领域动作名，而 `faq` 的 `VoteHelpful` **没有**对应登记项。
 * 为避免自创 `<action>` 名（§11.2 明令禁止），这里刻意把投票建模为
 * **子资源集合的创建**（`POST /faq/items/:id/votes`）而不是动作
 * （`POST /faq/items/:id/helpful`）。子资源不受「动作名冻结」约束，
 * 且天然可承载 `Idempotency-Key`。若 Lead 决定登记为 `faq.vote` 动作，
 * 只需改 `httpFaqRepository.ts` 里的一行路径。
 */
export interface FaqRepository {
  listArticles(query?: ListFaqArticlesQuery): Promise<Result<FaqArticlePage, RepositoryError>>
  voteHelpful(input: VoteFaqHelpfulInput): Promise<Result<FaqHelpfulVote, RepositoryError>>
  listMyTickets(userId: string | null): Promise<Result<FaqTicket[], RepositoryError>>
  submitTicket(input: SubmitFaqTicketInput): Promise<Result<FaqTicket, RepositoryError>>
}
