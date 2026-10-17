/**
 * 校园卡（`campus-card`）领域模型。
 *
 * 这个模块最容易做成"流水打印页"，而用户真正的三个问题在 `CardInsight` 里：
 * 还能撑几天、这笔钱是不是我刷的、丢了怎么办。
 *
 * 高可用约定：`stale === true` 表示当前展示的是**缓存**数据，
 * 页面必须显著提示并给出上次成功时间 —— 绝不允许把"查不到"渲染成 0 元。
 */

/** 与后端常量一致的低余额阈值（分）：约两顿正餐 */
export const LOW_BALANCE_THRESHOLD_FEN = 2000

export interface CardTransactionView {
  id: string
  amountFen: number
  direction: string
  merchant: string
  happenedAt: string
  balanceAfterFen: number
  /** `"−15.00"` / `"+200.00"`（符号由服务端算好） */
  amountLabel: string
}

export interface CardAnomaly {
  merchant: string
  amountFen: number
  happenedAt: string
  /** 相对日常消费中位数的倍数，用来解释"为什么判定异常" */
  ratioToMedian: number
}

export interface CardInsight {
  todayOutFen: number
  todayOutCount: number
  weekOutFen: number
  weekOutCount: number
  avgDailyOutFen: number
  /** 余额还能撑几天（无消费记录为 null） */
  estimatedDaysLeft: number | null
  medianOutFen: number
  anomalies: CardAnomaly[]
  topMerchants: { merchant: string; totalFen: number; count: number }[]
}

export interface CardOverview {
  platform: 'CARD'
  balanceFen: number
  thresholdFen: number
  lowBalance: boolean
  /** 上游数据时间（ISO） */
  dataAsOf: string
  /** 本地上次成功同步时间；从未同步为 null */
  syncedAt: string | null
  /** true = 上游不可用，展示的是缓存 */
  stale: boolean
  staleReason: string | null
  simulated: boolean
  transactions: CardTransactionView[]
  insight: CardInsight
}

export interface CardLostReport {
  accepted: boolean
  note: string
  steps: string[]
  channels: { name: string; detail: string }[]
  audited: boolean
}

/** 分 → `¥12.34` */
export function formatYuan(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}`
}

/** 余额文案 + 低余额提醒（页面里的主数字） */
export function balanceLabel(overview: CardOverview): string {
  return formatYuan(overview.balanceFen)
}

/** "还能撑几天"的一句话解释（把推算口径也讲清楚，避免用户误解） */
export function daysLeftLabel(overview: CardOverview): string | null {
  const days = overview.insight.estimatedDaysLeft
  if (days === null) return null
  return `按最近 7 天日均消费（${formatYuan(overview.insight.avgDailyOutFen)}）估算，还能撑约 ${days} 天`
}
