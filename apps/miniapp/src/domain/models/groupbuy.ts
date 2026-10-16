/**
 * 拼单（`groupbuy`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 契约要点：
 * - 金额一律 **整数分**（`priceFen`），只在展示层用 `@kedaya/shared` 的 `fenToYuan` 转元。
 * - 时间一律 ISO-8601 UTC 字符串；所有判定都接受注入的 `now`，保证可测。
 * - 状态既可能是后端给的显式值，也可能需要由「人数 + 截止时间」推导，
 *   因此统一走 `deriveStatus()`，UI 不允许自行判断。
 */

import { formatDeadline } from '@kedaya/shared'

export type GroupBuyStatus = 'open' | 'full' | 'closed' | 'cancelled'

export type GroupBuyCategory = 'food' | 'drink' | 'supplies' | 'ticket' | 'other'

export type GroupBuyCategoryFilter = GroupBuyCategory | 'all'

export interface GroupBuyParticipant {
  id: string
  displayName: string
  /** 匿名参团（契约 §9：拼单支持匿名身份，与实名身份解耦存储） */
  anonymous: boolean
  quantity: number
  joinedAt: string
}

export interface GroupBuy {
  id: string
  title: string
  description: string
  category: GroupBuyCategory
  initiatorId: string
  initiatorName: string
  /** 单价，整数分 */
  priceFen: number
  /** 成团目标份数 */
  targetCount: number
  participants: GroupBuyParticipant[]
  /** 截止时间，ISO-8601 UTC */
  deadline: string
  pickupPlace: string
  status: GroupBuyStatus
  createdAt: string
  updatedAt: string
}

/** 列表/卡片展示用的派生摘要 —— UI 只读这个，避免在组件里重复计算 */
export interface GroupBuySummary {
  id: string
  title: string
  category: GroupBuyCategory
  categoryLabel: string
  initiatorName: string
  priceFen: number
  targetCount: number
  joinedCount: number
  joinedQuantity: number
  remainingSlots: number
  progressPercent: number
  totalAmountFen: number
  deadline: string
  deadlineLabel: string
  pickupPlace: string
  status: GroupBuyStatus
  statusLabel: string
  joinable: boolean
}

export const GROUP_BUY_CATEGORIES: readonly GroupBuyCategory[] = [
  'food',
  'drink',
  'supplies',
  'ticket',
  'other',
]

export const GROUP_BUY_CATEGORY_LABELS: Readonly<Record<GroupBuyCategory, string>> = {
  food: '拼饭',
  drink: '拼奶茶',
  supplies: '拼日用',
  ticket: '拼票',
  other: '其它',
}

export const GROUP_BUY_STATUS_LABELS: Readonly<Record<GroupBuyStatus, string>> = {
  open: '可参团',
  full: '已成团',
  closed: '已截止',
  cancelled: '已取消',
}

/** 参团资格判定结果 —— 判别联合，UI 可直接 switch */
export type JoinEligibility =
  | { allowed: true }
  | {
      allowed: false
      reason: 'not-open' | 'full' | 'expired' | 'already-joined' | 'invalid-quantity'
      message: string
    }

export function categoryLabel(category: GroupBuyCategory): string {
  return GROUP_BUY_CATEGORY_LABELS[category]
}

export function statusLabel(status: GroupBuyStatus): string {
  return GROUP_BUY_STATUS_LABELS[status]
}

export function joinedCount(groupBuy: GroupBuy): number {
  return groupBuy.participants.length
}

export function joinedQuantity(groupBuy: GroupBuy): number {
  return groupBuy.participants.reduce((sum, participant) => sum + participant.quantity, 0)
}

export function remainingSlots(groupBuy: GroupBuy): number {
  return Math.max(0, groupBuy.targetCount - joinedQuantity(groupBuy))
}

/** 进度百分比（0-100，整数） */
export function progressPercent(groupBuy: GroupBuy): number {
  if (groupBuy.targetCount <= 0) return 0
  return Math.min(100, Math.round((joinedQuantity(groupBuy) / groupBuy.targetCount) * 100))
}

/** 当前已凑金额（整数分） */
export function totalAmountFen(groupBuy: GroupBuy): number {
  return groupBuy.priceFen * joinedQuantity(groupBuy)
}

export function isExpired(groupBuy: GroupBuy, now: Date): boolean {
  const deadline = new Date(groupBuy.deadline).getTime()
  if (Number.isNaN(deadline)) return false
  return deadline <= now.getTime()
}

/**
 * 由「已凑份数 + 截止时间」推导运行时状态。
 * 显式的 `cancelled` 优先级最高，不会被推导覆盖。
 */
export function deriveStatus(groupBuy: GroupBuy, now: Date): GroupBuyStatus {
  if (groupBuy.status === 'cancelled') return 'cancelled'
  if (joinedQuantity(groupBuy) >= groupBuy.targetCount) return 'full'
  if (isExpired(groupBuy, now)) return 'closed'
  return 'open'
}

/**
 * 参团资格判定 —— 纯函数，UI 与用例层共用同一份规则，避免规则漂移。
 */
export function canJoin(
  groupBuy: GroupBuy,
  userId: string | null,
  now: Date,
  quantity = 1,
): JoinEligibility {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { allowed: false, reason: 'invalid-quantity', message: '参团份数必须是正整数' }
  }

  const status = deriveStatus(groupBuy, now)
  if (status === 'cancelled') {
    return { allowed: false, reason: 'not-open', message: '该拼单已被发起人取消' }
  }
  if (status === 'full') {
    return { allowed: false, reason: 'full', message: '已经成团，来晚了一步' }
  }
  if (status === 'closed') {
    return { allowed: false, reason: 'expired', message: '已过截止时间' }
  }
  if (userId !== null && groupBuy.participants.some((p) => p.id === userId)) {
    return { allowed: false, reason: 'already-joined', message: '你已经参团了' }
  }

  const remaining = remainingSlots(groupBuy)
  if (quantity > remaining) {
    return { allowed: false, reason: 'full', message: `只剩 ${remaining} 份了` }
  }

  return { allowed: true }
}

export function summarize(groupBuy: GroupBuy, now: Date): GroupBuySummary {
  const status = deriveStatus(groupBuy, now)
  const quantity = joinedQuantity(groupBuy)
  return {
    id: groupBuy.id,
    title: groupBuy.title,
    category: groupBuy.category,
    categoryLabel: categoryLabel(groupBuy.category),
    initiatorName: groupBuy.initiatorName,
    priceFen: groupBuy.priceFen,
    targetCount: groupBuy.targetCount,
    joinedCount: joinedCount(groupBuy),
    joinedQuantity: quantity,
    remainingSlots: remainingSlots(groupBuy),
    progressPercent: progressPercent(groupBuy),
    totalAmountFen: totalAmountFen(groupBuy),
    deadline: groupBuy.deadline,
    deadlineLabel: formatDeadline(groupBuy.deadline, now),
    pickupPlace: groupBuy.pickupPlace,
    status,
    statusLabel: statusLabel(status),
    joinable: status === 'open',
  }
}
