/**
 * 常见问题（`faq`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 对应 `docs/architecture/02-domain-model.md` §2.8。契约要点：
 * - 敏感级 `low`：`SearchFaq` **无需登录**；`FaqTicket.userId` 允许为 `null`。
 * - 工单 `contact` 是「邮箱或微信」，**不存明文手机号** —— 因此校验里显式拒绝手机号，
 *   这是 domain-model 写死的隐私约束，不是可选的产品偏好。
 * - 「有用」投票必须**幂等**：重复点击只算一次。幂等判定放在这里（纯函数），
 *   用例层与仓储层共用同一份语义，避免「本地算了、服务端又算一次」。
 */

import { formatRelativeTime, isChinaMobile, isLengthWithin } from '@kedaya/shared'

export type FaqArticleStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

export type FaqTicketStatus = 'OPEN' | 'ANSWERED' | 'CLOSED'

export interface FaqArticle {
  id: string
  /** 唯一 */
  slug: string
  question: string
  /** Markdown 子集 */
  answer: string
  category: string
  status: FaqArticleStatus
  helpfulCount: number
  unhelpfulCount: number
  updatedAt: string
}

export interface FaqTicket {
  id: string
  /** 未登录也可提交，此时为 `null`（domain-model §2.8） */
  userId: string | null
  /** 邮箱或微信，**不存明文手机号** */
  contact: string
  question: string
  status: FaqTicketStatus
  /** 管理员回复（`ANSWERED` 之后才有） */
  answer?: string
  createdAt: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

export const FAQ_QUESTION_MAX_LENGTH = 120
export const FAQ_ANSWER_MAX_LENGTH = 10_000
export const FAQ_TICKET_QUESTION_MAX_LENGTH = 2_000
export const FAQ_CONTACT_MAX_LENGTH = 120
export const FAQ_EXCERPT_MAX_LENGTH = 48

/** 分类筛选里的「全部」哨兵值（UI 与用例层共用，避免各处写魔法字符串） */
export const FAQ_CATEGORY_ALL = 'all'

export const FAQ_ARTICLE_STATUS_LABELS: Readonly<Record<FaqArticleStatus, string>> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  ARCHIVED: '已归档',
}

export const FAQ_TICKET_STATUS_LABELS: Readonly<Record<FaqTicketStatus, string>> = {
  OPEN: '待处理',
  ANSWERED: '已回复',
  CLOSED: '已关闭',
}

/* ------------------------------------------------------------------ *
 * 纯函数
 * ------------------------------------------------------------------ */

export function articleStatusLabel(status: FaqArticleStatus): string {
  return FAQ_ARTICLE_STATUS_LABELS[status]
}

export function ticketStatusLabel(status: FaqTicketStatus): string {
  return FAQ_TICKET_STATUS_LABELS[status]
}

/** 只有 `PUBLISHED` 的文章对用户可见（DRAFT 未上线、ARCHIVED 已下架） */
export function isArticlePublished(article: FaqArticle): boolean {
  return article.status === 'PUBLISHED'
}

export function visibleArticles(articles: readonly FaqArticle[]): FaqArticle[] {
  return articles.filter(isArticlePublished)
}

/** 关键词匹配：问题 + 答案 + 分类，大小写不敏感；空关键词恒真 */
export function matchesFaqKeyword(article: FaqArticle, keyword: string | undefined): boolean {
  if (keyword === undefined) return true
  const needle = keyword.trim().toLowerCase()
  if (needle === '') return true
  return (
    article.question.toLowerCase().includes(needle) ||
    article.answer.toLowerCase().includes(needle) ||
    article.category.toLowerCase().includes(needle)
  )
}

export interface FaqArticleFilter {
  category?: string | null
  keyword?: string
}

/** 搜索 + 分类筛选（`SearchFaq` 用例的核心，无需登录） */
export function filterArticles(
  articles: readonly FaqArticle[],
  filter: FaqArticleFilter = {},
): FaqArticle[] {
  const category = filter.category
  return visibleArticles(articles)
    .filter((article) => category === undefined || category === null || category === FAQ_CATEGORY_ALL || article.category === category)
    .filter((article) => matchesFaqKeyword(article, filter.keyword))
}

/**
 * 分类清单 —— 按**首次出现顺序**去重。
 *
 * 刻意不排序：分类的展示顺序是内容运营的决策（fixtures / 后端给的顺序），
 * 用 `localeCompare` 排序反而会把中文分类排成不可预期的顺序。
 */
export function faqCategories(articles: readonly FaqArticle[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const article of visibleArticles(articles)) {
    if (seen.has(article.category)) continue
    seen.add(article.category)
    result.push(article.category)
  }
  return result
}

export interface FaqCategoryGroup {
  category: string
  articles: FaqArticle[]
}

/** 按分类分组（手风琴列表按分类分段时用） */
export function groupArticlesByCategory(articles: readonly FaqArticle[]): FaqCategoryGroup[] {
  const groups = new Map<string, FaqArticle[]>()
  for (const article of visibleArticles(articles)) {
    const bucket = groups.get(article.category)
    if (bucket === undefined) {
      groups.set(article.category, [article])
      continue
    }
    bucket.push(article)
  }
  return [...groups.entries()].map(([category, items]) => ({ category, articles: items }))
}

/** 答案摘要（压平换行 + 截断） */
export function answerExcerpt(answer: string, maxLength = FAQ_EXCERPT_MAX_LENGTH): string {
  const flat = answer.replace(/\s+/g, ' ').trim()
  if (flat.length <= maxLength) return flat
  return `${flat.slice(0, maxLength)}…`
}

export interface FaqArticleSummary {
  id: string
  slug: string
  question: string
  category: string
  excerpt: string
  helpfulCount: number
  unhelpfulCount: number
  voted: boolean
}

export function summarizeArticle(article: FaqArticle, votedHelpful = false): FaqArticleSummary {
  return {
    id: article.id,
    slug: article.slug,
    question: article.question,
    category: article.category,
    excerpt: answerExcerpt(article.answer),
    helpfulCount: article.helpfulCount,
    unhelpfulCount: article.unhelpfulCount,
    voted: votedHelpful,
  }
}

export interface FaqTicketSummary {
  id: string
  question: string
  contact: string
  status: FaqTicketStatus
  statusLabel: string
  answer: string | null
  anonymous: boolean
  createdAtLabel: string
  createdAt: string
}

export function summarizeTicket(ticket: FaqTicket, now: Date = new Date()): FaqTicketSummary {
  return {
    id: ticket.id,
    question: ticket.question,
    contact: ticket.contact,
    status: ticket.status,
    statusLabel: ticketStatusLabel(ticket.status),
    answer: ticket.answer ?? null,
    anonymous: ticket.userId === null,
    createdAtLabel: formatRelativeTime(ticket.createdAt, now),
    createdAt: ticket.createdAt,
  }
}

/* ------------------------------------------------------------------ *
 * 「有用」投票的幂等语义
 * ------------------------------------------------------------------ */

/** 是否已经投过「有用」——投票记录的**唯一**判定入口 */
export function hasVotedHelpful(votedArticleIds: readonly string[], articleId: string): boolean {
  return votedArticleIds.includes(articleId)
}

export interface HelpfulVoteOutcome {
  article: FaqArticle
  /** false = 重复点击，未产生任何计数变化（幂等的核心断言点） */
  applied: boolean
}

/**
 * 应用一次「有用」投票 —— **纯函数**，重复调用不会重复计数。
 *
 * 用例层用它做本地幂等（避免无意义的请求），mock 仓储用它做服务端幂等，
 * 两边共用同一份语义；真后端另有 `Idempotency-Key` 兜底（契约 §11.3）。
 */
export function applyHelpfulVote(
  article: FaqArticle,
  votedArticleIds: readonly string[],
  articleId: string,
): HelpfulVoteOutcome {
  if (article.id !== articleId || hasVotedHelpful(votedArticleIds, articleId)) {
    return { article, applied: false }
  }
  return {
    article: { ...article, helpfulCount: article.helpfulCount + 1 },
    applied: true,
  }
}

/* ------------------------------------------------------------------ *
 * 工单草稿校验
 * ------------------------------------------------------------------ */

export interface FaqDraftFieldError {
  field: string
  message: string
}

export interface TicketDraft {
  contact: string
  question: string
}

export interface NormalizedTicketDraft {
  contact: string
  question: string
}

export type TicketValidation =
  | { valid: true; value: NormalizedTicketDraft }
  | { valid: false; errors: FaqDraftFieldError[] }

/**
 * 校验工单草稿。
 *
 * **硬约束**：`contact` 拒绝中国大陆手机号 —— domain-model §2.8 明确「不存明文手机号」。
 * 这里只是第一道闸；真正的持久化约束在后端（前端永远不是安全边界）。
 */
export function validateTicketDraft(draft: TicketDraft): TicketValidation {
  const errors: FaqDraftFieldError[] = []
  const contact = draft.contact.trim()
  const question = draft.question.trim()

  if (contact === '') {
    errors.push({ field: 'contact', message: '请填写邮箱或微信号，便于我们回复你' })
  } else if (isChinaMobile(contact)) {
    errors.push({ field: 'contact', message: '为保护隐私，请不要填写手机号，改用邮箱或微信号' })
  } else if ([...contact].length > FAQ_CONTACT_MAX_LENGTH) {
    errors.push({ field: 'contact', message: `联系方式不能超过 ${FAQ_CONTACT_MAX_LENGTH} 字` })
  }

  if (question === '') {
    errors.push({ field: 'question', message: '请描述你的问题' })
  } else if ([...question].length > FAQ_TICKET_QUESTION_MAX_LENGTH) {
    errors.push({
      field: 'question',
      message: `问题描述不能超过 ${FAQ_TICKET_QUESTION_MAX_LENGTH} 字`,
    })
  }

  if (errors.length > 0) return { valid: false, errors }
  return { valid: true, value: { contact, question } }
}

/** 工单是否处于「等待提问者确认」状态（ANSWERED 可追问 → 回到 OPEN） */
export function canFollowUp(ticket: FaqTicket): boolean {
  return ticket.status === 'ANSWERED'
}

/** 问题长度是否在 `FaqArticle` 约束内（内容运营侧用；此处也便于复用校验） */
export function isValidArticleQuestion(question: string): boolean {
  return isLengthWithin(question, 1, FAQ_QUESTION_MAX_LENGTH)
}
