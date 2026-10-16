/**
 * 拼单仓储端口（依赖倒置点 —— 契约 §7）。
 *
 * domain 定义接口，data 层实现（HTTP / mock）。presentation 永远不直接发请求。
 * 错误通道用 `@kedaya/shared` 的 `Result`，错误载荷用契约的 `ApiError`
 * （这样 `CONSENT_REQUIRED` / `CAMPUS_BINDING_REQUIRED` 等冻结错误码可以一路透传到 UI）。
 */
import type { ApiError, Page } from '@kedaya/contracts';
import type { Result } from '@kedaya/shared';

import type { GroupBuyDetail, GroupBuyItem, GroupBuyStatus } from '../models/groupbuy';

export interface GroupBuyListQuery {
  /** 游标分页（契约 §6.1：不用 offset） */
  cursor?: string;
  limit?: number;
  status?: GroupBuyStatus;
  /** 关键词（标题 / 商家 / 取货点） */
  keyword?: string;
}

export interface GroupBuyRepository {
  list(query: GroupBuyListQuery): Promise<Result<Page<GroupBuyItem>, ApiError>>;
  detail(id: string): Promise<Result<GroupBuyDetail, ApiError>>;
  /** 参团（领域动作：POST /api/v1/groupbuy/items/:id/join） */
  join(id: string, quantity: number): Promise<Result<GroupBuyDetail, ApiError>>;
}

/** mock 适配器的可控故障模式，用于演示三态 UI */
export type MockFailureMode = 'none' | 'error';
