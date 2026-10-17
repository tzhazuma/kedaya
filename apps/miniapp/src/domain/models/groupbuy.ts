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
  /** 截止时间是否已过（`deriveStatus` 会给 `closed`，这里是给**卡片**用的显式标记） */
  deadlinePassed: boolean
  /** 是否临近截止（未过期且 ≤ {@link GROUP_BUY_URGENT_WINDOW_MS}）—— 拼单最怕错过截止 */
  deadlineUrgent: boolean
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

/**
 * 拼单「临近截止」的窗口：12 小时。
 *
 * 与跑腿的 2 小时不同 —— 拼单按**天**计（预设是一天/三天/一周），
 * 「今天就截止了」才是该催的分界。窗口值各模块自己定，不共用常量：
 * 共用一个数字只会让改一个模块时误伤另一个。
 */
export const GROUP_BUY_URGENT_WINDOW_MS = 12 * 60 * 60 * 1000

/** 截止时间的两种派生判断（非法时间一律当作"未过期、不紧急"，不抛错） */
function deadlineState(groupBuy: GroupBuy, now: Date): { passed: boolean; urgent: boolean } {
  const at = new Date(groupBuy.deadline).getTime()
  if (Number.isNaN(at)) return { passed: false, urgent: false }
  const left = at - now.getTime()
  return { passed: left <= 0, urgent: left > 0 && left <= GROUP_BUY_URGENT_WINDOW_MS }
}

export function summarize(groupBuy: GroupBuy, now: Date): GroupBuySummary {
  const status = deriveStatus(groupBuy, now)
  const quantity = joinedQuantity(groupBuy)
  const deadline = deadlineState(groupBuy, now)
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
    deadlinePassed: deadline.passed,
    deadlineUrgent: deadline.urgent,
    pickupPlace: groupBuy.pickupPlace,
    status,
    statusLabel: statusLabel(status),
    joinable: status === 'open',
  }
}

/* ------------------------------------------------------------------ *
 * 发起拼单：截止时间怎么选
 * ------------------------------------------------------------------ */

/**
 * 「相对当前时间」的截止时间预设。
 *
 * 不用日期选择器是刻意的（`apps/miniapp/AGENTS.md`：小程序禁用原生 Picker）：
 * 相对预设还能天然保证"不会选中过去的时间"——拼单截止时间在将来是服务端硬规则。
 *
 * 为什么在本模块内再定义一份 `OffsetPreset` 而不是复用跑腿/找搭子的：
 * 三个模块的预设**语义不同**（跑腿按分钟、拼单按天），共用一个类型只会让
 * 某天改一个模块时误伤另外两个。仓库里跑腿与找搭子也是各持一份。
 */
export interface OffsetPreset {
  id: string
  label: string
  offsetMinutes: number
}

export const GROUP_BUY_DEADLINE_PRESETS: readonly OffsetPreset[] = [
  { id: '6h', label: '6 小时后', offsetMinutes: 360 },
  { id: '12h', label: '12 小时后', offsetMinutes: 720 },
  { id: '1d', label: '明天此刻', offsetMinutes: 1_440 },
  { id: '3d', label: '3 天后', offsetMinutes: 4_320 },
  { id: '7d', label: '一周后', offsetMinutes: 10_080 },
]

/** `now + minutes` 的 ISO 字符串 */
export function offsetIso(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString()
}

export function findOffsetPreset(
  presets: readonly OffsetPreset[],
  presetId: string,
): OffsetPreset | null {
  return presets.find((preset) => preset.id === presetId) ?? null
}

