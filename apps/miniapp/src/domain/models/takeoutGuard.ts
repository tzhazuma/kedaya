import { formatRelativeTime } from '@kedaya/shared'

/**
 * 偷外卖（`takeout-guard`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 与后端 `services/api/src/modules/takeout-guard/domain/takeout-guard.domain.ts`
 * 及 `takeout-guard.service.ts` 逐条对齐：
 *   · 状态机白名单 `pending → escalated → resolved`，新建恒为 `pending`；
 *   · 归属只来自后端 JWT —— 客户端连 `reporterId` 都不发，请求体里也没有这个字段；
 *   · **列表永远是"我的记录"**（后端强制 `reporterId = 主体`），所以这里没有 `mine` 筛选；
 *   · 发生时间允许 5 分钟时钟偏差。
 *
 * 产品定位（不是"公开举报墙"，而是"我的外卖被拿错记录 + 协助沟通"）：
 * 平台不判定谁对谁错，只帮用户把经过记清楚、把诉求说清楚。因此
 * **列表里只出现订单号后四位**，完整订单号只在详情页（只有本人能打开）展示。
 */

/** 状态机：待处理（记录了，等/先自己沟通）→ 已升级（请平台/辅导员协助）→ 已解决 */
export const TAKEOUT_GUARD_STATUS = {
  pending: 'pending',
  escalated: 'escalated',
  resolved: 'resolved',
} as const
export type TakeoutGuardStatus = (typeof TAKEOUT_GUARD_STATUS)[keyof typeof TAKEOUT_GUARD_STATUS]

export const TAKEOUT_GUARD_STATUSES = [
  TAKEOUT_GUARD_STATUS.pending,
  TAKEOUT_GUARD_STATUS.escalated,
  TAKEOUT_GUARD_STATUS.resolved,
] as const

export const TAKEOUT_GUARD_STATUS_LABELS: Readonly<Record<TakeoutGuardStatus, string>> = {
  pending: '待处理',
  escalated: '已升级',
  resolved: '已解决',
}

/* 文本上限（与后端同值；客户端只做即时提示，服务端才是最终裁决） */
export const TAKEOUT_GUARD_ORDER_NO_MAX = 64
export const TAKEOUT_GUARD_PLACE_MAX = 60
export const TAKEOUT_GUARD_DETAIL_MAX = 1000

/** 发生时间允许的时钟偏差：5 分钟（与后端 `TAKEOUT_CLOCK_SKEW_MS` 同值） */
export const TAKEOUT_GUARD_CLOCK_SKEW_MS = 5 * 60 * 1000

/**
 * 每条记录最多几张证据图。
 *
 * 后端只有 `evidenceUrl` **一列字符串**，所以这里写死 1；
 * 多传的不会被保存 —— 与其让用户以为传了 5 张，不如一开始就只给一个位置。
 */
export const TAKEOUT_GUARD_EVIDENCE_MAX = 1

/** 页面固定说明（与后端领域规则同源，三个页面共用一句话，避免各写一份漂移） */
export const TAKEOUT_GUARD_NOTICE =
  '平台不判定谁对谁错，只帮你把经过记清楚、把诉求说清楚；请勿公开点名或在群里扩散他人信息。'

/** 领域模型：字段与后端 `TakeoutReportModel` 一一对应，时间以 ISO 字符串传输 */
export interface TakeoutGuardReport {
  id: string
  /** 记录人；服务端从 JWT 取主体，客户端不参与（也不会用它在页面里做判断） */
  reporterId: string | null
  /** 订单号（完整值只在详情页展示，列表只给后四位） */
  orderNo: string
  /** 取餐点，例如「生活区 5 号楼一层外卖架」 */
  place: string
  /** 发生时间（ISO-8601） */
  happenedAt: string
  /** 经过描述（后端必填） */
  detail: string | null
  /** 最多一张证据图；只可能是本平台上传的地址 */
  evidenceUrl: string | null
  status: string
  createdAt: string
  updatedAt: string
}

/** 创建输入：**没有** reporterId / status（服务端从 JWT 取归属，状态一律 pending） */
export interface CreateTakeoutGuardReportInput {
  orderNo: string
  place: string
  /** ISO-8601 */
  happenedAt: string
  detail: string
  /** 已上传成功的证据图地址（见 `useImageAttachments`） */
  evidenceUrl?: string | null
}

/** 修改输入（后端只允许改"经过"类字段，状态与归属不可改） */
export interface UpdateTakeoutGuardReportInput {
  orderNo?: string
  place?: string
  happenedAt?: string
  detail?: string
  evidenceUrl?: string | null
}

/**
 * 列表筛选条件。
 *
 * 只有 `status` 一个维度：后端**强制**只看当前登录用户自己的记录，
 * 关键词 / 地点 / 订单号之类的组合查询一旦开放，就能把记录与具体的人对应起来。
 */
export interface TakeoutGuardReportFilters extends Record<string, unknown> {
  status?: TakeoutGuardStatus
}

/** 卡片直接可读的派生视图 —— UI 不再自己算标签与"后四位" */
export interface TakeoutGuardReportSummary {
  id: string
  place: string
  /** 订单号后四位（列表只用它；完整订单号留在详情页） */
  orderNoTail: string
  status: TakeoutGuardStatus
  statusLabel: string
  /** 发生时间相对文案 */
  happenedLabel: string
  createdLabel: string
  detailPreview: string
  /** 有没有证据图（列表用它决定要不要显示缩略图角标） */
  hasEvidence: boolean
  escalated: boolean
  resolved: boolean
}

export function isTakeoutGuardStatus(value: unknown): value is TakeoutGuardStatus {
  return typeof value === 'string' && (TAKEOUT_GUARD_STATUSES as readonly string[]).includes(value)
}

export function statusLabel(status: string): string {
  return isTakeoutGuardStatus(status) ? TAKEOUT_GUARD_STATUS_LABELS[status] : '未知状态'
}

/**
 * 订单号后四位。
 *
 * 列表里绝不能摆完整订单号：订单号 + 取餐点 + 时间连起来就足以指向具体的人，
 * 而在食堂 / 宿舍走廊看手机的人不止一个。详情页（只有本人能打开）才展示完整值。
 */
export function orderNoTail(orderNo: string): string {
  const cleaned = orderNo.replace(/[\s-]/g, '')
  if (cleaned.length === 0) return '—'
  return cleaned.length <= 4 ? cleaned : cleaned.slice(-4)
}

/** 状态 → 时间线三态（详情页按它渲染，页面不自己拼状态判断） */
export type TakeoutGuardTimelineState = 'done' | 'current' | 'todo'

export interface TakeoutGuardTimelineStep {
  id: 'recorded' | 'escalated' | 'resolved'
  label: string
  description: string
  state: TakeoutGuardTimelineState
}

export function statusTimeline(status: string): TakeoutGuardTimelineStep[] {
  const normalized: TakeoutGuardStatus = isTakeoutGuardStatus(status)
    ? status
    : TAKEOUT_GUARD_STATUS.pending

  const order: readonly TakeoutGuardStatus[] = [
    TAKEOUT_GUARD_STATUS.pending,
    TAKEOUT_GUARD_STATUS.escalated,
    TAKEOUT_GUARD_STATUS.resolved,
  ]
  const currentIndex = order.indexOf(normalized)

  const steps: ReadonlyArray<{ id: TakeoutGuardTimelineStep['id']; label: string; description: string }> = [
    { id: 'recorded', label: '记录完成', description: '你写下了取餐点与经过，只有你自己能看到' },
    { id: 'escalated', label: '升级处理', description: '需要时请平台或辅导员协助沟通（可选）' },
    { id: 'resolved', label: '已解决', description: '对方归还，或事情已经说清楚' },
  ]

  return steps.map((step, index) => ({
    ...step,
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo',
  }))
}

export function summarize(report: TakeoutGuardReport, now: Date): TakeoutGuardReportSummary {
  const status: TakeoutGuardStatus = isTakeoutGuardStatus(report.status)
    ? report.status
    : TAKEOUT_GUARD_STATUS.pending
  return {
    id: report.id,
    place: report.place,
    orderNoTail: orderNoTail(report.orderNo),
    status,
    statusLabel: statusLabel(report.status),
    happenedLabel: formatRelativeTime(report.happenedAt, now),
    createdLabel: formatRelativeTime(report.createdAt, now),
    detailPreview: (report.detail ?? '').slice(0, 60),
    hasEvidence: report.evidenceUrl !== null && report.evidenceUrl !== '',
    escalated: status === TAKEOUT_GUARD_STATUS.escalated,
    resolved: status === TAKEOUT_GUARD_STATUS.resolved,
  }
}

/* ------------------------------------------------------------------ *
 * 校验（纯函数：用例、mock 仓储与页面共用同一份文案）
 * ------------------------------------------------------------------ */

export function orderNoProblem(orderNo: string): string | null {
  const text = orderNo.trim()
  if (text.length === 0) return '请填写外卖订单号'
  if ([...text].length > TAKEOUT_GUARD_ORDER_NO_MAX) {
    return `订单号最多 ${TAKEOUT_GUARD_ORDER_NO_MAX} 个字`
  }
  return null
}

export function placeProblem(place: string): string | null {
  const text = place.trim()
  if (text.length === 0) return '请填写取餐点'
  if ([...text].length > TAKEOUT_GUARD_PLACE_MAX) {
    return `取餐点最多 ${TAKEOUT_GUARD_PLACE_MAX} 个字`
  }
  return null
}

/** 经过描述必填：说不清楚发生了什么，后面就没法跟对方或辅导员对齐 */
export function detailProblem(detail: string): string | null {
  const text = detail.trim()
  if (text.length === 0) return '请写清楚经过'
  if ([...text].length > TAKEOUT_GUARD_DETAIL_MAX) {
    return `经过描述最多 ${TAKEOUT_GUARD_DETAIL_MAX} 个字`
  }
  return null
}

/**
 * 发生时间校验 —— 与后端 `normalizeHappenedAt` 同一套判定：
 * 非法日期 / 超出 5 分钟时钟偏差都被拒绝。
 */
export function happenedAtProblem(happenedAt: Date, now: Date): string | null {
  if (Number.isNaN(happenedAt.getTime())) return '发生时间格式不正确'
  if (happenedAt.getTime() > now.getTime() + TAKEOUT_GUARD_CLOCK_SKEW_MS) {
    return '发生时间不能晚于当前时间'
  }
  return null
}

/** `Date` → 表单可编辑的本地时间文本 `YYYY-MM-DD HH:mm` */
export function formatHappenedAtInput(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 表单文本 → `Date`（本地时区）。
 *
 * 与 `lostFound.ts` 里同名函数是**同一套规则**（模块各自持有一份，避免两个领域模型互相 import）。
 * 不用 `new Date(text)`：它把 `2026-10-16 20:30` 当实现相关的宽松格式，
 * 在部分小程序运行时（iOS JSCore）直接得到 Invalid Date。
 * 支持 `YYYY-MM-DD HH:mm`、`YYYY-MM-DD HH:mm:ss`、`YYYY-MM-DD`、`YYYY/MM/DD HH:mm`。
 */
export function parseHappenedAtInput(text: string): Date | null {
  const matched = /^\s*(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?\s*$/.exec(text)
  if (matched === null) return null

  const [, year, month, day, hour = '0', minute = '0', second = '0'] = matched
  if (year === undefined || month === undefined || day === undefined) return null

  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    0,
  )
  // `new Date(2026, 12, 40)` 会静默进位到下一月，因此回读一次做校验
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute)
  ) {
    return null
  }
  return date
}

/* ------------------------------------------------------------------ *
 * 动作闸门（服务端仍是最终裁决，这里只是提前把不该出现的按钮藏掉）
 * ------------------------------------------------------------------ */

export interface TakeoutGuardEligibility {
  allowed: boolean
  message: string
}

/**
 * 「升级处理」是否可点 —— 与后端 `TakeoutReportService.escalate` 同一套判定：
 * pending → escalated；已升级 / 已解决都是 CONFLICT。
 */
export function escalateEligibility(
  report: TakeoutGuardReport,
  viewerId: string | null,
): TakeoutGuardEligibility {
  if (viewerId === null) return { allowed: false, message: '登录后才能升级处理' }
  if (report.reporterId !== viewerId) return { allowed: false, message: '只能处理自己的记录' }
  if (report.status === TAKEOUT_GUARD_STATUS.escalated) {
    return { allowed: false, message: '这条记录已经升级处理，无需重复提交' }
  }
  if (report.status === TAKEOUT_GUARD_STATUS.resolved) {
    return { allowed: false, message: '已解决的记录不能再升级处理' }
  }
  return { allowed: true, message: '' }
}

/**
 * 「标记已解决」是否可点 —— 与后端 `resolve` 同一套判定：
 * pending / escalated → resolved；已解决是 CONFLICT。
 */
export function resolveEligibility(
  report: TakeoutGuardReport,
  viewerId: string | null,
): TakeoutGuardEligibility {
  if (viewerId === null) return { allowed: false, message: '登录后才能标记已解决' }
  if (report.reporterId !== viewerId) return { allowed: false, message: '只能处理自己的记录' }
  if (report.status === TAKEOUT_GUARD_STATUS.resolved) {
    return { allowed: false, message: '这条记录已经标记为已解决' }
  }
  return { allowed: true, message: '' }
}
