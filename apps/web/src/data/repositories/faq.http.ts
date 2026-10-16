/**
 * 常见问题 HTTP 仓储 —— 端口 `FaqRepository` 的真实实现（契约 §6.1 冻结路由）。
 *
 * 路由（模块名来自 `@kedaya/contracts` 的模块注册表）：
 *   GET   /api/v1/faq/items?cursor&limit&category&keyword
 *   POST  /api/v1/faq/items/:slug/votes      子集合创建（faq 无冻结 action，见端口注释）
 *   GET   /api/v1/faq/tickets
 *   POST  /api/v1/faq/tickets
 */
import { modulePath } from '@kedaya/contracts';
import type { ApiError, Page } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import type { FaqArticle, FaqTicket } from '@/domain/models/faq';
import type {
  FaqArticleListQuery,
  FaqRepository,
  FaqTicketListQuery,
  SubmitFaqTicketInput,
  VoteFaqHelpfulInput,
} from '@/domain/ports/faq';

import { createTraceId, type ApiClient } from '../api/client';
import {
  safeParseFaqArticle,
  safeParseFaqArticlePage,
  safeParseFaqTicket,
  safeParseFaqTicketPage,
} from '../schemas/faq';

const ARTICLES_PATH = `/${modulePath('faq', 'items')}`;
const TICKETS_PATH = `/${modulePath('faq', 'tickets')}`;

function toApiError(cause: { code: ApiError['code']; message: string; details?: unknown }): ApiError {
  return cause.details === undefined
    ? { code: cause.code, message: cause.message }
    : { code: cause.code, message: cause.message, details: cause.details };
}

export function createFaqHttpRepository(client: ApiClient): FaqRepository {
  return {
    async listArticles(query: FaqArticleListQuery): Promise<Result<Page<FaqArticle>, ApiError>> {
      const result = await client.get<unknown>(ARTICLES_PATH, {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.category === undefined ? {} : { category: query.category }),
        ...(query.keyword === undefined ? {} : { keyword: query.keyword }),
        ...(query.status === undefined ? {} : { status: query.status }),
      });
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseFaqArticlePage(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的条目列表不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async voteHelpful(input: VoteFaqHelpfulInput): Promise<Result<FaqArticle, ApiError>> {
      const result = await client.post<unknown>(
        `${ARTICLES_PATH}/${encodeURIComponent(input.slug)}/votes`,
        { vote: input.vote },
        { idempotencyKey: `faq-vote-${input.slug}-${input.vote ?? 'none'}-${input.userId ?? 'anon'}` },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseFaqArticle(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的投票结果不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async listTickets(query: FaqTicketListQuery): Promise<Result<Page<FaqTicket>, ApiError>> {
      const result = await client.get<unknown>(TICKETS_PATH, {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.status === undefined ? {} : { status: query.status }),
      });
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseFaqTicketPage(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的工单列表不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async submitTicket(input: SubmitFaqTicketInput): Promise<Result<FaqTicket, ApiError>> {
      const result = await client.post<unknown>(
        TICKETS_PATH,
        { contact: input.contact, question: input.question },
        { idempotencyKey: input.idempotencyKey ?? createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseFaqTicket(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的工单结果不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },
  };
}
