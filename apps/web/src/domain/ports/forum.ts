/**
 * 论坛仓储端口（依赖倒置点 —— 契约 §7）。
 *
 * domain 定义接口，data 层实现（HTTP / mock）；presentation 永远不直接发请求。
 * 错误通道用 `@kedaya/shared` 的 `Result`，错误载荷用契约的 `ApiError`。
 *
 * 路由形状（契约 §6.1 的 CRUD 统一形状 + §11.2 已登记的 `forum.report` 动作）：
 *   GET   /api/v1/forum/boards                  版块列表
 *   GET   /api/v1/forum/items?cursor&limit      主题列表（游标分页）
 *   POST  /api/v1/forum/items                   发帖
 *   GET   /api/v1/forum/items/:id               主题详情（含回复首页）
 *   POST  /api/v1/forum/items/:id/replies       发表回复（子集合创建，非自创 action）
 *   POST  /api/v1/forum/items/:id/report        举报（**已冻结 action 名**）
 */
import type { ApiError, Page } from '@kedaya/contracts';
import type { Result } from '@kedaya/shared';

import type {
  ForumBoard,
  ForumPost,
  ForumPostStatus,
  ForumReply,
  ForumReport,
  ForumReportReason,
  ForumReportTargetType,
} from '../models/forum';

/** mock 适配器的可控故障模式，用于演示三态 UI（与拼单切片共用同一语义） */
export type { MockFailureMode } from './groupbuy';

export interface ForumPostListQuery {
  /**
   * 游标分页（契约 §6.1：不用 offset）。
   * ⚠️ 契约 §11.10-E：游标对客户端**完全不透明** —— 只能把服务端返回的
   * `nextCursor` 原样回传，**不得**解析、构造或假设其格式。
   */
  cursor?: string;
  limit?: number;
  /** 按版块筛选（不传 = 全部版块） */
  boardId?: string;
  /** 关键词（标题 / 正文 / 标签） */
  keyword?: string;
  /** 只看某个状态 */
  status?: ForumPostStatus;
  /**
   * 是否包含被治理的主题（HIDDEN / LOCKED）。
   * 默认 **true**：被隐藏的主题必须显式出现并标注状态，不得静默消失（域模型 §2.4 治理规则）。
   * DELETED / DRAFT 永远不出现。
   */
  includeGoverned?: boolean;
}

export interface ForumReplyListQuery {
  postId: string;
  cursor?: string;
  limit?: number;
}

export interface ForumPostDetail {
  post: ForumPost;
  replies: ForumReply[];
  repliesNextCursor: string | null;
}

export interface CreateForumPostInput {
  boardId: string;
  title: string;
  body: string;
  tags: string[];
  anonymous: boolean;
  /** 已登录用户的实名 id；匿名时仓储内部派生 `AnonymousIdentity.id` */
  authorId: string;
  authorNickname: string;
  /** 契约 §11.3：POST 必须带 Idempotency-Key */
  idempotencyKey?: string;
}

export interface CreateForumReplyInput {
  postId: string;
  body: string;
  anonymous: boolean;
  parentReplyId?: string | null;
  authorId: string;
  authorNickname: string;
  idempotencyKey?: string;
}

export interface ReportForumTargetInput {
  targetType: ForumReportTargetType;
  targetId: string;
  reason: ForumReportReason;
  note?: string;
  /** 举报人（可匿名 —— 匿名举报时由调用方传入匿名身份 id） */
  reporterId: string;
  anonymous: boolean;
  idempotencyKey?: string;
}

export interface ForumRepository {
  /**
   * 版块列表。返回**全部**版块（含需要登录的 `campus_only`），
   * 是否可访问由 application 层用 `isBoardAccessible(board, { authenticated })` 判定 ——
   * 「存在但需要登录」比「直接消失」对用户更诚实。
   */
  listBoards(): Promise<Result<ForumBoard[], ApiError>>;
  listPosts(query: ForumPostListQuery): Promise<Result<Page<ForumPost>, ApiError>>;
  postDetail(id: string): Promise<Result<ForumPostDetail, ApiError>>;
  listReplies(query: ForumReplyListQuery): Promise<Result<Page<ForumReply>, ApiError>>;
  createPost(input: CreateForumPostInput): Promise<Result<ForumPost, ApiError>>;
  createReply(input: CreateForumReplyInput): Promise<Result<ForumReply, ApiError>>;
  report(input: ReportForumTargetInput): Promise<Result<ForumReport, ApiError>>;
}
