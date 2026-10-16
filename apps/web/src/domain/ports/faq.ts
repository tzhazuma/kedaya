/**
 * 常见问题仓储端口（依赖倒置点 —— 契约 §7）。
 *
 * 路由形状（契约 §6.1 CRUD 统一形状；**不含任何自创 action 名**）：
 *   GET   /api/v1/faq/items?cursor&limit&category&keyword   条目列表（游标分页）
 *   POST  /api/v1/faq/items/:slug/votes                     「有用 / 无用」投票（子集合创建）
 *   GET   /api/v1/faq/tickets                              我的工单
 *   POST  /api/v1/faq/tickets                              提交工单（无需登录）
 *
 * 说明：契约 §11.2 的冻结 action 表里 **没有** faq 条目，因此「有用」不能写成
 * `POST /items/:id/helpful` 这类自创 action；这里用**子集合创建**（votes 资源）表达，
 * 语义是「记录我的一票」，不是领域动作。见 README「与冻结契约的偏差」。
 */
import type { ApiError, Page } from '@kedaya/contracts';
import type { Result } from '@kedaya/shared';

import type { FaqArticle, FaqArticleStatus, FaqTicket, FaqVote } from '../models/faq';

/** mock 适配器的可控故障模式，用于演示三态 UI（与拼单切片共用同一语义） */
export type { MockFailureMode } from './groupbuy';

export interface FaqArticleListQuery {
  /**
   * 游标分页（契约 §6.1：不用 offset）。
   * ⚠️ 契约 §11.10-E：游标对客户端**完全不透明** —— 原样回传 `nextCursor`，
   * 不得解析 / 构造 / 假设格式。
   */
  cursor?: string;
  limit?: number;
  /** 分类 id；`all` 或 undefined 表示全部分类 */
  category?: string;
  /** 关键词（问题 / 答案 / 分类名） */
  keyword?: string;
  /** 默认只返回 PUBLISHED */
  status?: FaqArticleStatus;
}

export interface FaqTicketListQuery {
  cursor?: string;
  limit?: number;
  /** 只看某个状态 */
  status?: FaqTicket['status'];
}

export interface VoteFaqHelpfulInput {
  slug: string;
  /** null = 撤回我的一票 */
  vote: FaqVote | null;
  /** 投票人；未登录时传 null（契约允许匿名浏览知识库） */
  userId: string | null;
}

export interface SubmitFaqTicketInput {
  /** 邮箱或微信号；**不得是明文手机号** */
  contact: string;
  question: string;
  /** 未登录提交时为 null */
  userId: string | null;
  idempotencyKey?: string;
}

export interface FaqRepository {
  listArticles(query: FaqArticleListQuery): Promise<Result<Page<FaqArticle>, ApiError>>;
  /** 投票后返回**最新**条目（含更新后的计数） */
  voteHelpful(input: VoteFaqHelpfulInput): Promise<Result<FaqArticle, ApiError>>;
  listTickets(query: FaqTicketListQuery): Promise<Result<Page<FaqTicket>, ApiError>>;
  submitTicket(input: SubmitFaqTicketInput): Promise<Result<FaqTicket, ApiError>>;
}
