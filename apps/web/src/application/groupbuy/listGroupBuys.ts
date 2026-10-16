/**
 * 用例：加载拼单列表（契约 §7：application 层编排，不含 IO）。
 *
 * 依赖方向 `presentation → application → domain ← data`：
 * 本文件只依赖 domain 的模型与端口，仓储实例由调用方注入。
 * 输出是**视图模型**（已本地化的文案 / 已转元的金额），UI 不再做任何计算。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, formatDeadline, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  discountFen,
  discountPercent,
  formatFen,
  GROUP_BUY_CATEGORY_LABELS,
  GROUP_BUY_STATUS_LABELS,
  isJoinable,
  progressPercent,
  remainingSlots,
  type GroupBuyItem,
} from '@/domain/models/groupbuy';
import type { GroupBuyListQuery, GroupBuyRepository } from '@/domain/ports/groupbuy';

export interface GroupBuyListItemVM {
  id: string;
  title: string;
  merchant: string;
  categoryLabel: string;
  status: GroupBuyItem['status'];
  statusLabel: string;
  priceLabel: string;
  originalPriceLabel: string;
  discountLabel: string;
  progress: number;
  remainingSlots: number;
  joinedLabel: string;
  deadlineLabel: string;
  deadlineAt: string;
  createdLabel: string;
  pickupSpot: string;
  initiatorName: string;
  joinable: boolean;
  note?: string;
}

export interface GroupBuyListVM {
  items: GroupBuyListItemVM[];
  nextCursor: string | null;
  total: number;
  isEmpty: boolean;
  joinableCount: number;
}

/** 列表项 → 视图模型（纯函数，可单测） */
export function toGroupBuyItemVM(item: GroupBuyItem, now: Date): GroupBuyListItemVM {
  const discount = discountFen(item);
  const percent = discountPercent(item);
  return {
    id: item.id,
    title: item.title,
    merchant: item.merchant,
    categoryLabel: GROUP_BUY_CATEGORY_LABELS[item.category],
    status: item.status,
    statusLabel: GROUP_BUY_STATUS_LABELS[item.status],
    priceLabel: formatFen(item.priceFen),
    originalPriceLabel: formatFen(item.originalPriceFen),
    discountLabel: discount > 0 ? `省 ${formatFen(discount)}（${percent}%）` : '无折扣',
    progress: progressPercent(item),
    remainingSlots: remainingSlots(item),
    joinedLabel: `${item.joinedCount}/${item.targetCount} 人`,
    deadlineLabel: formatDeadline(item.deadlineAt, now) || '截止时间未知',
    deadlineAt: item.deadlineAt,
    createdLabel: formatRelativeTime(item.createdAt, now) || '时间未知',
    pickupSpot: item.pickupSpot,
    initiatorName: item.initiator.nickname,
    joinable: isJoinable(item, now),
    ...(item.note === undefined ? {} : { note: item.note }),
  };
}

export function toGroupBuyListVM(
  items: readonly GroupBuyItem[],
  nextCursor: string | null,
  total: number,
  now: Date,
): GroupBuyListVM {
  const vms = items.map((item) => toGroupBuyItemVM(item, now));
  return {
    items: vms,
    nextCursor,
    total,
    isEmpty: vms.length === 0,
    joinableCount: vms.filter((vm) => vm.joinable).length,
  };
}

export async function loadGroupBuyList(
  repository: GroupBuyRepository,
  query: GroupBuyListQuery = {},
  now: Date = new Date(),
): Promise<Result<GroupBuyListVM, ApiError>> {
  const result = await repository.list(query);
  if (!result.ok) return err(result.error);

  const { items, nextCursor, total } = result.value;
  return ok(toGroupBuyListVM(items, nextCursor, total ?? items.length, now));
}
