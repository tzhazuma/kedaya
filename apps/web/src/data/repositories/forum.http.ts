/**
 * 论坛 HTTP 仓储 —— 端口 `ForumRepository` 的真实实现（契约 §6.1 冻结路由）。
 *
 * 路由（模块名一律来自 `@kedaya/contracts` 的模块注册表，不硬编码字符串）：
 *   GET   /api/v1/forum/boards
 *   GET   /api/v1/forum/items
 *   POST  /api/v1/forum/items
 *   GET   /api/v1/forum/items/:id
 *   POST  /api/v1/forum/items/:id/replies   子集合创建（非自创 action）
 *   POST  /api/v1/forum/items/:id/report    已冻结 action（契约 §11.2）
 */
import { modulePath } from '@kedaya/contracts';
import type { ApiError, Page } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import type { ForumBoard, ForumPost, ForumReply, ForumReport } from '@/domain/models/forum';
import type {
  CreateForumPostInput,
  CreateForumReplyInput,
  ForumPostDetail,
  ForumPostListQuery,
  ForumReplyListQuery,
  ForumRepository,
  ReportForumTargetInput,
} from '@/domain/ports/forum';

import { createTraceId, type ApiClient } from '../api/client';
import {
  safeParseForumBoards,
  safeParseForumPost,
  safeParseForumPostDetail,
  safeParseForumPostPage,
  safeParseForumReply,
  safeParseForumReplyPage,
  safeParseForumReport,
} from '../schemas/forum';

const BOARDS_PATH = `/${modulePath('forum', 'boards')}`;
const ITEMS_PATH = `/${modulePath('forum', 'items')}`;

/** ApiClientError → 契约 ApiError（端口只认契约错误载荷） */
function toApiError(cause: { code: ApiError['code']; message: string; details?: unknown }): ApiError {
  return cause.details === undefined
    ? { code: cause.code, message: cause.message }
    : { code: cause.code, message: cause.message, details: cause.details };
}

export function createForumHttpRepository(client: ApiClient): ForumRepository {
  return {
    async listBoards(): Promise<Result<ForumBoard[], ApiError>> {
      const result = await client.get<unknown>(BOARDS_PATH);
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseForumBoards(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的版块列表不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async listPosts(query: ForumPostListQuery): Promise<Result<Page<ForumPost>, ApiError>> {
      const result = await client.get<unknown>(ITEMS_PATH, {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.boardId === undefined ? {} : { boardId: query.boardId }),
        ...(query.keyword === undefined ? {} : { keyword: query.keyword }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.includeGoverned === undefined ? {} : { includeGoverned: query.includeGoverned }),
      });
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseForumPostPage(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的主题列表不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async postDetail(id: string): Promise<Result<ForumPostDetail, ApiError>> {
      const result = await client.get<unknown>(`${ITEMS_PATH}/${encodeURIComponent(id)}`);
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseForumPostDetail(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的主题详情不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async listReplies(query: ForumReplyListQuery): Promise<Result<Page<ForumReply>, ApiError>> {
      const result = await client.get<unknown>(
        `${ITEMS_PATH}/${encodeURIComponent(query.postId)}/replies`,
        {
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
        },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseForumReplyPage(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的回复列表不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async createPost(input: CreateForumPostInput): Promise<Result<ForumPost, ApiError>> {
      const result = await client.post<unknown>(
        ITEMS_PATH,
        {
          boardId: input.boardId,
          title: input.title,
          body: input.body,
          tags: input.tags,
          anonymous: input.anonymous,
        },
        // 契约 §11.3：POST 必须带 Idempotency-Key
        { idempotencyKey: input.idempotencyKey ?? createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseForumPost(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的发帖结果不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async createReply(input: CreateForumReplyInput): Promise<Result<ForumReply, ApiError>> {
      const result = await client.post<unknown>(
        `${ITEMS_PATH}/${encodeURIComponent(input.postId)}/replies`,
        {
          body: input.body,
          anonymous: input.anonymous,
          parentReplyId: input.parentReplyId ?? null,
        },
        { idempotencyKey: input.idempotencyKey ?? createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseForumReply(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的回复结果不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async report(input: ReportForumTargetInput): Promise<Result<ForumReport, ApiError>> {
      // 已冻结的领域动作名：`forum.report`（契约 §11.2），不得自创
      const result = await client.post<unknown>(
        `${ITEMS_PATH}/${encodeURIComponent(input.targetId)}/report`,
        {
          targetType: input.targetType,
          reason: input.reason,
          ...(input.note === undefined ? {} : { note: input.note }),
        },
        { idempotencyKey: input.idempotencyKey ?? createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseForumReport(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的举报结果不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },
  };
}
