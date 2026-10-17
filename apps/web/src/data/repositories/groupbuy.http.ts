/**
 * 拼单 HTTP 仓储 —— 端口 `GroupBuyRepository` 的真实实现（契约 §6.1 冻结路由）。
 *
 * 路由形状（契约）：
 *   GET   /api/v1/groupbuy/items        列表（游标分页）
 *   GET   /api/v1/groupbuy/items/:id    详情
 *   POST  /api/v1/groupbuy/items/:id/join  领域动作
 */
import { modulePath } from '@kedaya/contracts';
import type { ApiError, Page } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import type { GroupBuyDetail, GroupBuyItem } from '@/domain/models/groupbuy';
import type { GroupBuyListQuery, GroupBuyRepository } from '@/domain/ports/groupbuy';

import { ApiClientError, type ApiClient } from '../api/client';
import { safeParseGroupBuyDetail, safeParseGroupBuyPage } from '../schemas/groupbuy';

const ITEMS_PATH = `/${modulePath('groupbuy', 'items')}`;

/** ApiClientError → 契约 ApiError（端口只认契约错误载荷） */
export function toApiError(cause: ApiClientError): ApiError {
  return cause.details === undefined
    ? { code: cause.code, message: cause.message }
    : { code: cause.code, message: cause.message, details: cause.details };
}

export function createGroupBuyHttpRepository(client: ApiClient): GroupBuyRepository {
  return {
    async list(query: GroupBuyListQuery): Promise<Result<Page<GroupBuyItem>, ApiError>> {
      const result = await client.get<unknown>(ITEMS_PATH, {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.keyword === undefined ? {} : { keyword: query.keyword }),
      });
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseGroupBuyPage(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的拼单列表不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async detail(id: string): Promise<Result<GroupBuyDetail, ApiError>> {
      const result = await client.get<unknown>(`${ITEMS_PATH}/${encodeURIComponent(id)}`);
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseGroupBuyDetail(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的拼单详情不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async join(id: string, quantity: number): Promise<Result<GroupBuyDetail, ApiError>> {
      const result = await client.post<unknown>(
        `${ITEMS_PATH}/${encodeURIComponent(id)}/join`,
        { quantity },
        { idempotencyKey: `groupbuy-join-${id}-${quantity}` },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseGroupBuyDetail(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的参团结果不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },
  };
}
