/**
 * 拼单（groupbuy）领域模型 —— 纯逻辑，零框架、零 IO（契约 §7）。
 *
 * 契约 §6.1 冻结：金额一律**整数分**（`*Fen`），时间一律 **ISO-8601 UTC 字符串**。
 * 展示层才用 `@kedaya/shared` 的 `fenToYuan` / `formatRelativeTime` 转换。
 */
import { fenToYuan } from '@kedaya/shared';

export type GroupBuyStatus = 'recruiting' | 'locked' | 'completed' | 'cancelled';

export type GroupBuyCategory = 'food' | 'drink' | 'daily' | 'stationery' | 'digital' | 'other';

export interface GroupBuyInitiator {
  id: string;
  nickname: string;
}

export interface GroupBuyItem {
  id: string;
  title: string;
  merchant: string;
  category: GroupBuyCategory;
  status: GroupBuyStatus;
  /** 成团目标人数 */
  targetCount: number;
  /** 已参团人数 */
  joinedCount: number;
  /** 拼单价（整数分） */
  priceFen: number;
  /** 原价（整数分） */
  originalPriceFen: number;
  initiator: GroupBuyInitiator;
  /** 取货点，例：三食堂门口 */
  pickupSpot: string;
  /** 截止时间，ISO-8601 UTC */
  deadlineAt: string;
  createdAt: string;
  note?: string;
}

export interface GroupBuyParticipant {
  id: string;
  nickname: string;
  quantity: number;
  paidFen: number;
  joinedAt: string;
  /** 匿名参团（与实名身份解耦存储） */
  anonymous: boolean;
}

export interface GroupBuyDetail extends GroupBuyItem {
  participants: GroupBuyParticipant[];
  /** 发起人填写/系统生成的成团规则 */
  rules: string[];
}

export const GROUP_BUY_STATUS_LABELS: Record<GroupBuyStatus, string> = {
  recruiting: '拼单中',
  locked: '已成团',
  completed: '已完成',
  cancelled: '已取消',
};

export const GROUP_BUY_CATEGORY_LABELS: Record<GroupBuyCategory, string> = {
  food: '正餐',
  drink: '饮品',
  daily: '日用',
  stationery: '文具',
  digital: '数码',
  other: '其他',
};

/** 状态机：只有这些迁移是合法的 */
const STATUS_TRANSITIONS: Record<GroupBuyStatus, readonly GroupBuyStatus[]> = {
  recruiting: ['locked', 'cancelled'],
  locked: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransition(from: GroupBuyStatus, to: GroupBuyStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/** 非法迁移返回 null（调用方决定怎么提示） */
export function transitionStatus(
  item: GroupBuyItem,
  to: GroupBuyStatus,
): GroupBuyItem | null {
  if (!canTransition(item.status, to)) return null;
  return { ...item, status: to };
}

export function remainingSlots(item: Pick<GroupBuyItem, 'targetCount' | 'joinedCount'>): number {
  return Math.max(0, item.targetCount - item.joinedCount);
}

/** 进度百分比，0–100 整数；targetCount <= 0 视为 0 */
export function progressPercent(
  item: Pick<GroupBuyItem, 'targetCount' | 'joinedCount'>,
): number {
  if (item.targetCount <= 0) return 0;
  const raw = Math.round((item.joinedCount / item.targetCount) * 100);
  return Math.min(100, Math.max(0, raw));
}

/** 是否还能参团：状态为 recruiting、还有名额、且未过截止时间 */
export function isJoinable(
  item: Pick<GroupBuyItem, 'status' | 'targetCount' | 'joinedCount' | 'deadlineAt'>,
  now: Date,
): boolean {
  if (item.status !== 'recruiting') return false;
  if (remainingSlots(item) <= 0) return false;
  const deadline = new Date(item.deadlineAt).getTime();
  if (Number.isNaN(deadline)) return false;
  return deadline > now.getTime();
}

/** 参团后应变成什么状态（够人数就 locked） */
export function statusAfterJoin(
  item: Pick<GroupBuyItem, 'status' | 'targetCount' | 'joinedCount'>,
): GroupBuyStatus {
  if (item.status !== 'recruiting') return item.status;
  return item.joinedCount + 1 >= item.targetCount ? 'locked' : 'recruiting';
}

/** 省了多少钱（整数分），负数归零 */
export function discountFen(item: Pick<GroupBuyItem, 'priceFen' | 'originalPriceFen'>): number {
  return Math.max(0, item.originalPriceFen - item.priceFen);
}

/** 折扣百分比（0–100 整数），原价非法时返回 0 */
export function discountPercent(
  item: Pick<GroupBuyItem, 'priceFen' | 'originalPriceFen'>,
): number {
  if (item.originalPriceFen <= 0) return 0;
  const raw = Math.round((discountFen(item) / item.originalPriceFen) * 100);
  return Math.min(100, Math.max(0, raw));
}

/** 金额展示："¥12.34" */
export function formatFen(fen: number): string {
  return `¥${fenToYuan(fen)}`;
}

/** 总价（整数分） */
export function totalFen(priceFen: number, quantity: number): number {
  const qty = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
  return priceFen * qty;
}

/** 按截止时间升序（最近的在前），非法时间排最后 */
export function sortByDeadline<T extends { deadlineAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const ta = new Date(a.deadlineAt).getTime();
    const tb = new Date(b.deadlineAt).getTime();
    const va = Number.isNaN(ta) ? Number.POSITIVE_INFINITY : ta;
    const vb = Number.isNaN(tb) ? Number.POSITIVE_INFINITY : tb;
    return va - vb;
  });
}

export function countByStatus(
  items: readonly GroupBuyItem[],
): Record<GroupBuyStatus, number> {
  const acc: Record<GroupBuyStatus, number> = {
    recruiting: 0,
    locked: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const item of items) acc[item.status] += 1;
  return acc;
}

/**
 * 领域校验（纯函数，不依赖 zod —— domain 层零外部依赖）。
 * 返回问题清单，空数组表示合法。
 */
export function validateGroupBuyItem(item: GroupBuyItem): string[] {
  const problems: string[] = [];
  if (!item.id) problems.push('缺少 id');
  if (!item.title.trim()) problems.push('缺少标题');
  if (!Number.isSafeInteger(item.priceFen) || item.priceFen < 0) {
    problems.push('priceFen 必须是非负整数分');
  }
  if (!Number.isSafeInteger(item.originalPriceFen) || item.originalPriceFen < 0) {
    problems.push('originalPriceFen 必须是非负整数分');
  }
  if (!Number.isInteger(item.targetCount) || item.targetCount <= 0) {
    problems.push('targetCount 必须为正整数');
  }
  if (!Number.isInteger(item.joinedCount) || item.joinedCount < 0) {
    problems.push('joinedCount 必须为非负整数');
  }
  if (item.joinedCount > item.targetCount) problems.push('joinedCount 不能超过 targetCount');
  if (Number.isNaN(new Date(item.deadlineAt).getTime())) problems.push('deadlineAt 非法');
  if (Number.isNaN(new Date(item.createdAt).getTime())) problems.push('createdAt 非法');
  return problems;
}
