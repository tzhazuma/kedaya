/**
 * 活动域（`activities`）—— 纯类型 + 纯函数。
 *
 * 这一域**独立于课程 DDL**：活动有自己的来源（校园邮箱 / 公众号 / 手动）、
 * 自己的状态机（候选 → 已确认 / 已忽略 / 已归档）与自己的提醒。
 * 不把活动写进 `deadlines`，否则「课程作业」和「社团讲座」会共用一份
 * 紧迫度与提醒规则，最后两边都不对。
 *
 * ## 三条硬约束
 *
 * 1. **时间一律存 UTC ISO，展示显式 `Asia/Shanghai`**：
 *    不用 `new Date('2026-11-24')` 这种只有日期的输入（会按 UTC 解析，
 *    在上海变成前一天 08:00）。只有日期没有时刻的原文留在
 *    `registrationDeadlineRaw`，**绝不补 23:59**。
 * 2. **只存 ≤200 字证据片段**：正文 / 附件 / 公众号全文不进入这一层。
 * 3. **candidate 只是候选**：没有用户确认就不建日程、不建提醒。
 *
 * 本文件不 import Taro / 数据层（ESLint 强制），因此可以在 node 测试里
 * 直接断言时区、分组与提醒规则。
 */

/* ------------------------------------------------------------------ *
 * 枚举与文案
 * ------------------------------------------------------------------ */

import {
  ACTIVITY_DEFAULT_REMINDER_LEADS,
  ACTIVITY_EVIDENCE_MAX_CHARS,
  ACTIVITY_KIND_LABELS,
  ACTIVITY_KINDS,
  ACTIVITY_REMINDER_CHANNELS,
  ACTIVITY_REMINDER_KINDS,
  ACTIVITY_REMINDER_STATUSES,
  ACTIVITY_SOURCES,
  ACTIVITY_SOURCE_LABELS,
  ACTIVITY_STATUSES,
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_TIMEZONE,
  type ActivityItem as ContractActivityItem,
  type ActivityKind,
  type ActivityReminderChannel,
  type ActivityReminderItem as ContractActivityReminderItem,
  type ActivityReminderKind,
  type ActivityReminderStatus,
  type ActivitySource,
  type ActivityStatus,
} from '@kedaya/contracts'

export {
  ACTIVITY_KIND_LABELS,
  ACTIVITY_KINDS,
  ACTIVITY_REMINDER_CHANNELS,
  ACTIVITY_REMINDER_KINDS,
  ACTIVITY_REMINDER_STATUSES,
  ACTIVITY_SOURCES,
  ACTIVITY_SOURCE_LABELS,
  ACTIVITY_STATUSES,
  ACTIVITY_STATUS_LABELS,
}
export type {
  ActivityKind,
  ActivityReminderChannel,
  ActivityReminderKind,
  ActivityReminderStatus,
  ActivitySource,
  ActivityStatus,
}

export const ACTIVITY_TABS = ['pending', 'today', 'week', 'all'] as const
export type ActivityTab = (typeof ACTIVITY_TABS)[number]

export const ACTIVITY_TAB_LABELS: Readonly<Record<ActivityTab, string>> = {
  pending: '待确认',
  today: '今天',
  week: '本周',
  all: '全部',
}

export const ACTIVITY_SOURCE_FILTERS = ['all', ...ACTIVITY_SOURCES] as const
export type ActivitySourceFilter = (typeof ACTIVITY_SOURCE_FILTERS)[number]

export const ACTIVITY_SOURCE_FILTER_LABELS: Readonly<Record<ActivitySourceFilter, string>> = {
  all: '全部来源',
  'campus-mail': '校园邮箱',
  'wechat-mp': '微信公众号',
  manual: '手动添加',
}

export const REMINDER_KINDS = ACTIVITY_REMINDER_KINDS
export const REMINDER_CHANNELS = ACTIVITY_REMINDER_CHANNELS

export const REMINDER_KIND_LABELS: Readonly<Record<ActivityReminderKind, string>> = {
  registration: '报名截止提醒',
  start: '开始前提醒',
  custom: '自定义提醒',
}

/**
 * 渠道文案。微信订阅消息**尚未接通**（没有真实模板 ID），
 * 因此这里如实写「未接通」，UI 不会把它呈现成可用选项。
 */
export const REMINDER_CHANNEL_LABELS: Readonly<Record<ActivityReminderChannel, string>> = {
  inapp: '站内信',
  'wechat-subscribe': '微信订阅消息（未接通）',
}

export const ACTIVITY_TIME_ZONE = ACTIVITY_TIMEZONE
export const EVIDENCE_MAX_LENGTH = ACTIVITY_EVIDENCE_MAX_CHARS
export const ACTIVITY_TITLE_MAX = 160

const HOUR_MS = ACTIVITY_DEFAULT_REMINDER_LEADS.startMs
const DAY_MS = ACTIVITY_DEFAULT_REMINDER_LEADS.registrationMs
const FIVE_MINUTES_MS = ACTIVITY_DEFAULT_REMINDER_LEADS.fallbackDelayMs

/* ------------------------------------------------------------------ *
 * 类型（共同契约的 wire DTO）
 * ------------------------------------------------------------------ */

export type ActivityItem = ContractActivityItem
export type ActivityReminderItem = ContractActivityReminderItem

/** 提醒列表额外带回所属活动（共同契约里是可选字段，列表端点会带） */
export interface ActivityReminderWithActivity extends ActivityReminderItem {
  readonly activityId: string
  readonly activityTitle: string
}

export interface ActivityView {
  id: string
  source: ActivitySource
  sourceLabel: string
  kind: ActivityKind
  kindLabel: string
  title: string
  status: ActivityStatus
  statusLabel: string
  /** 原始时刻：页面按 tab / 本周分组时用，展示仍走 whenLabel */
  startsAt: string | null
  publishedAt: string | null
  registrationDeadlineAt: string | null
  registrationDeadlineRaw: string | null
  whenLabel: string
  location: string | null
  organizer: string | null
  deadline: RegistrationDeadlineView | null
  registrationUrl: string | null
  evidenceText: string
  confidence: number
  confidenceLabel: string
  confidenceTone: 'high' | 'medium' | 'low'
  sourceUrl: string | null
  publishedLabel: string | null
  stale: boolean
  isCandidate: boolean
}

export interface RegistrationDeadlineView {
  label: string
  /** 是否有确定的绝对时刻（false = 只有原文） */
  known: boolean
  /** 是否已截止（只有 known 时才能判断） */
  passed: boolean
  /** 24 小时内（只有 known 且未截止时才能判断） */
  urgent: boolean
}

/* ------------------------------------------------------------------ *
 * 时区工具（显式 Asia/Shanghai，与设备时区无关）
 * ------------------------------------------------------------------ */

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  /** 0 = 周日 */
  weekday: number
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

function zonedParts(epochMs: number, timeZone: string = ACTIVITY_TIME_ZONE): ZonedParts | null {
  if (!Number.isFinite(epochMs)) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs))

  const pick = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value ?? ''
    return Number.parseInt(value, 10)
  }
  const year = pick('year')
  const month = pick('month')
  const day = pick('day')
  const hour = pick('hour')
  const minute = pick('minute')
  if (![year, month, day, hour, minute].every((value) => Number.isFinite(value))) return null

  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  }
}

/**
 * 把用户在上海时区选择的「日期 + 时刻」转成绝对时刻（UTC ISO）。
 *
 * ⚠️ 不用 `new Date(`${date} ${time}`)`：那会按设备时区解释，
 * 学生在伦敦打开就会差 8 小时。这里显式拼 `+08:00`。
 */
export function parseShanghaiDateTime(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  if (!/^\d{1,2}:\d{2}$/.test(time)) return null
  const [hourText, minuteText] = time.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null

  const [yearText, monthText, dayText] = date.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const ms = Date.parse(`${date}T${pad2(hour)}:${pad2(minute)}:00+08:00`)
  if (!Number.isFinite(ms)) return null

  // 往返校验：`Date.parse` 会把 2026-02-30 静默滚到 3 月 2 日。
  // 只有解析回来的上海本地日期 / 时刻与输入完全一致才算合法。
  const parts = zonedParts(ms)
  if (
    parts === null ||
    parts.year !== year ||
    parts.month !== month ||
    parts.day !== day ||
    parts.hour !== hour ||
    parts.minute !== minute
  ) {
    return null
  }
  return new Date(ms).toISOString()
}

/** 日期选择器的下界 / 初值：上海本地日期 `YYYY-MM-DD` */
export function shanghaiDateInput(now: Date): string {
  const parts = zonedParts(now.getTime())
  if (parts === null) return ''
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

/** 把某个 UTC 时刻映射成「上海本地的日序号」（用于今天 / 本周比较） */
function zonedDayNumber(epochMs: number): number | null {
  const parts = zonedParts(epochMs)
  if (parts === null) return null
  return Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS
}

/** 上海时区里以周一为起点的周序号 */
function zonedWeekStart(epochMs: number): number | null {
  const parts = zonedParts(epochMs)
  const day = zonedDayNumber(epochMs)
  if (parts === null || day === null) return null
  const offsetFromMonday = (parts.weekday + 6) % 7
  return day - offsetFromMonday
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  )
}

function parseInstant(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  // 只接受带时刻与时区的 ISO：`YYYY-MM-DD` 会被 `Date` 当成 UTC 零点，
  // 在上海变成前一天 08:00 —— 这正是要避免的漂移。
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      trimmed,
    )
  ) {
    return null
  }

  // `Date.parse` 会把 2026-02-30 静默滚到 3 月 2 日；先按日历校验日期部分。
  const [yearText, monthText, dayText] = trimmed.slice(0, 10).split('-')
  if (!isRealCalendarDate(Number(yearText), Number(monthText), Number(dayText))) return null

  const ms = Date.parse(trimmed)
  return Number.isFinite(ms) ? ms : null
}

function normalizeInstant(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const ms = parseInstant(value)
  return ms === null ? null : new Date(ms).toISOString()
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 把一个 UTC 时刻格式化成学校本地时间。
 *
 * 例：`2026-11-23T01:30:00.000Z` → `11月23日 周一 09:30`
 * 跨年时补年份（否则「1月2日」会被误读成今年）。
 */
export function formatActivityInstant(
  iso: string | null,
  now: Date,
  timeZone: string = ACTIVITY_TIME_ZONE,
): string {
  if (iso === null) return '时间待定'
  const ms = parseInstant(iso)
  const parts = ms === null ? null : zonedParts(ms, timeZone)
  if (parts === null) return '时间待定'

  const nowParts = zonedParts(now.getTime(), timeZone)
  const yearLabel = nowParts !== null && nowParts.year !== parts.year ? `${parts.year}年` : ''
  return `${yearLabel}${parts.month}月${parts.day}日 ${WEEKDAY_LABELS[parts.weekday]} ${pad2(
    parts.hour,
  )}:${pad2(parts.minute)}`
}

/** 活动时间文案：同一天显示 `开始–结束`，跨天两端都写日期 */
export function formatActivityWhen(item: Pick<ActivityItem, 'startsAt' | 'endsAt'>, now: Date): string {
  if (item.startsAt === null) return '时间待定'
  const startLabel = formatActivityInstant(item.startsAt, now)
  if (item.endsAt === null) return startLabel

  const startMs = parseInstant(item.startsAt)
  const endMs = parseInstant(item.endsAt)
  if (startMs === null || endMs === null) return startLabel

  const startDay = zonedDayNumber(startMs)
  const endDay = zonedDayNumber(endMs)
  const endParts = zonedParts(endMs)
  if (startDay === null || endDay === null || endParts === null) return startLabel

  if (startDay === endDay) {
    return `${startLabel}–${pad2(endParts.hour)}:${pad2(endParts.minute)}`
  }
  return `${startLabel} 至 ${formatActivityInstant(item.endsAt, now)}`
}

/* ------------------------------------------------------------------ *
 * 报名截止
 * ------------------------------------------------------------------ */

/**
 * 报名截止的展示视图。
 *
 * ⚠️ 只有 `registrationDeadlineRaw` 时返回 `known: false`，界面必须写
 * 「原文未给出具体时刻」——把「11月24日」补成 23:59 会让用户按一个
 * 我们编出来的时间行动。
 */
export function registrationDeadlineView(
  item: Pick<ActivityItem, 'registrationDeadlineAt' | 'registrationDeadlineRaw'>,
  now: Date,
): RegistrationDeadlineView | null {
  const atMs = parseInstant(item.registrationDeadlineAt)
  if (atMs !== null) {
    const passed = atMs <= now.getTime()
    const urgent = !passed && atMs - now.getTime() <= DAY_MS
    const suffix = passed ? '（已截止）' : urgent ? '（24 小时内）' : ''
    return {
      label: `报名截止 ${formatActivityInstant(item.registrationDeadlineAt, now)}${suffix}`,
      known: true,
      passed,
      urgent,
    }
  }

  const raw = item.registrationDeadlineRaw?.trim() ?? ''
  if (raw === '') return null
  return {
    label: `报名截止 ${raw}（原文未给出具体时刻）`,
    known: false,
    passed: false,
    urgent: false,
  }
}

/* ------------------------------------------------------------------ *
 * 列表：tab / 来源筛选 / 排序
 * ------------------------------------------------------------------ */

export interface ActivityTiming {
  status: ActivityStatus
  startsAt: string | null
}

export function activityTabMatches(item: ActivityTiming, tab: ActivityTab, now: Date): boolean {
  if (item.status === 'dismissed') return false
  if (tab === 'pending') return item.status === 'candidate'
  if (tab === 'all') return true

  // 「今天 / 本周」是日历视图：只放已加入日程的条目；
  // 候选活动仍在「待确认」里，避免同一件事在两个 tab 里抢注意力。
  if (item.status === 'candidate') return false
  if (item.startsAt === null) return false

  const startMs = parseInstant(item.startsAt)
  if (startMs === null) return false

  if (tab === 'today') {
    const startDay = zonedDayNumber(startMs)
    const today = zonedDayNumber(now.getTime())
    return startDay !== null && today !== null && startDay === today
  }

  const startWeek = zonedWeekStart(startMs)
  const currentWeek = zonedWeekStart(now.getTime())
  return startWeek !== null && currentWeek !== null && startWeek === currentWeek
}

export function activitySourceMatches(
  item: Pick<ActivityItem, 'source'>,
  source: ActivitySourceFilter,
): boolean {
  return source === 'all' || item.source === source
}

export function buildActivityTabCounts<T extends ActivityTiming>(
  items: readonly T[],
  now: Date,
): Record<ActivityTab, number> {
  const counts: Record<ActivityTab, number> = { pending: 0, today: 0, week: 0, all: 0 }
  for (const item of items) {
    for (const tab of ACTIVITY_TABS) {
      if (activityTabMatches(item, tab, now)) counts[tab] += 1
    }
  }
  return counts
}

function compareStarts(
  left: ActivityTiming & { title: string },
  right: ActivityTiming & { title: string },
): number {
  const leftMs = parseInstant(left.startsAt)
  const rightMs = parseInstant(right.startsAt)
  if (leftMs === null && rightMs === null) return left.title.localeCompare(right.title)
  if (leftMs === null) return 1
  if (rightMs === null) return -1
  return leftMs - rightMs
}

export function sortActivities<T extends ActivityTiming & { confidence: number; publishedAt: string | null; title: string }>(
  items: readonly T[],
  tab: ActivityTab,
): T[] {
  const copied = [...items]
  if (tab === 'pending') {
    copied.sort((left, right) => {
      if (right.confidence !== left.confidence) return right.confidence - left.confidence
      const leftPublished = left.publishedAt === null ? 0 : (parseInstant(left.publishedAt) ?? 0)
      const rightPublished = right.publishedAt === null ? 0 : (parseInstant(right.publishedAt) ?? 0)
      return rightPublished - leftPublished || compareStarts(left, right)
    })
    return copied
  }
  copied.sort(compareStarts)
  return copied
}

/* ------------------------------------------------------------------ *
 * 派生视图
 * ------------------------------------------------------------------ */

export function confidenceTone(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.8) return 'high'
  if (confidence >= 0.5) return 'medium'
  return 'low'
}

export function summarizeActivity(item: ActivityItem, now: Date): ActivityView {
  const confidence = clampConfidence(item.confidence)
  return {
    id: item.id,
    source: item.source,
    sourceLabel: item.sourceLabel ?? ACTIVITY_SOURCE_LABELS[item.source],
    kind: item.kind,
    kindLabel: ACTIVITY_KIND_LABELS[item.kind] ?? ACTIVITY_KIND_LABELS.other,
    title: item.title,
    status: item.status,
    statusLabel: ACTIVITY_STATUS_LABELS[item.status],
    startsAt: item.startsAt,
    publishedAt: item.publishedAt,
    registrationDeadlineAt: item.registrationDeadlineAt,
    registrationDeadlineRaw: item.registrationDeadlineRaw,
    whenLabel: formatActivityWhen(item, now),
    location: item.location,
    organizer: item.organizer,
    deadline: registrationDeadlineView(item, now),
    registrationUrl: item.registrationUrl,
    evidenceText: item.evidenceText,
    confidence,
    confidenceLabel: `${Math.round(confidence * 100)}%`,
    confidenceTone: confidenceTone(confidence),
    sourceUrl: item.sourceUrl,
    publishedLabel:
      item.publishedAt === null ? null : formatActivityInstant(item.publishedAt, now),
    stale: item.stale,
    isCandidate: item.status === 'candidate',
  }
}

/* ------------------------------------------------------------------ *
 * 默认提醒
 * ------------------------------------------------------------------ */

export interface ReminderPlanItem {
  kind: 'registration' | 'start'
  remindAt: string
  channel: 'inapp'
}

export type ReminderSkipReason = 'target-passed' | 'time-unknown'

export interface ReminderPlanSkipped {
  kind: 'registration' | 'start'
  reason: ReminderSkipReason
}

export interface ReminderPlan {
  reminders: ReminderPlanItem[]
  skipped: ReminderPlanSkipped[]
}

function planReminder(
  kind: 'registration' | 'start',
  targetIso: string | null,
  leadMs: number,
  now: Date,
  reminders: ReminderPlanItem[],
  skipped: ReminderPlanSkipped[],
): void {
  const targetMs = parseInstant(targetIso)
  if (targetMs === null) {
    skipped.push({ kind, reason: 'time-unknown' })
    return
  }
  if (targetMs <= now.getTime()) {
    // 目标已过：不补发一条迟到的提醒
    skipped.push({ kind, reason: 'target-passed' })
    return
  }

  // 计算出来的时刻已过、但目标还在未来：允许落到 now + 5min。
  // 若目标本身比 5 分钟还近，提醒不晚于目标 —— 否则会变成「截止后才提醒」。
  const leadAt = targetMs - leadMs
  const remindAt =
    leadAt > now.getTime() ? leadAt : Math.min(targetMs, now.getTime() + FIVE_MINUTES_MS)

  reminders.push({
    kind,
    remindAt: new Date(remindAt).toISOString(),
    channel: 'inapp',
  })
}

/**
 * 确认加入日程后的默认提醒：
 *   · 报名截止前 24h
 *   · 开始前 1h
 *
 * 目标已过 → 不建；目标未知 → 不建（不按 23:59 推算）；
 * 计算时刻已过但目标未来 → now + 5min。
 */
export function defaultReminderPlan(
  item: Pick<ActivityItem, 'startsAt' | 'registrationDeadlineAt'>,
  now: Date,
): ReminderPlan {
  const reminders: ReminderPlanItem[] = []
  const skipped: ReminderPlanSkipped[] = []

  planReminder('registration', item.registrationDeadlineAt, DAY_MS, now, reminders, skipped)
  planReminder('start', item.startsAt, HOUR_MS, now, reminders, skipped)

  return { reminders, skipped }
}

/* ------------------------------------------------------------------ *
 * 状态机
 * ------------------------------------------------------------------ */

export function canConfirmActivity(item: Pick<ActivityItem, 'status'>): boolean {
  return item.status === 'candidate'
}

export function canDismissActivity(item: Pick<ActivityItem, 'status'>): boolean {
  return item.status === 'candidate'
}

/* ------------------------------------------------------------------ *
 * 输入校验
 * ------------------------------------------------------------------ */

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/**
 * 只保留 ≤200 字的证据片段，并压缩空白。
 *
 * 注意：这里不做「加省略号」——省略号也占字数，而且会让用户以为原文就是
 * 这么短。真要看全文请回到来源（邮件 / 公众号）里看。
 */
export function clampEvidence(input: string): string {
  const collapsed = input.replace(/\s+/g, ' ').trim()
  return Array.from(collapsed).slice(0, EVIDENCE_MAX_LENGTH).join('')
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > 2048) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username !== '' || url.password !== '') return null
    return url.toString()
  } catch {
    return null
  }
}

function nullableText(value: unknown, maxLength = 200): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : Array.from(trimmed).slice(0, maxLength).join('')
}

export function normalizeActivityItem(raw: unknown): ActivityItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>

  const id = nullableText(value.id, 128)
  const title = nullableText(value.title, ACTIVITY_TITLE_MAX)
  const source = value.source
  const status = value.status
  if (id === null || title === null) return null
  if (!ACTIVITY_SOURCES.includes(source as ActivitySource)) return null
  if (!ACTIVITY_STATUSES.includes(status as ActivityStatus)) return null

  const resolvedSource = source as ActivitySource
  const kind = ACTIVITY_KINDS.includes(value.kind as ActivityKind)
    ? (value.kind as ActivityKind)
    : 'other'

  const startsAt = normalizeInstant(value.startsAt)
  const endsAtRaw = normalizeInstant(value.endsAt)
  const startsMs = parseInstant(startsAt)
  const endsMs = parseInstant(endsAtRaw)
  const endsAt = startsMs !== null && endsMs !== null && endsMs < startsMs ? null : endsAtRaw

  return {
    id,
    source: resolvedSource,
    kind,
    title,
    startsAt,
    endsAt,
    location: nullableText(value.location),
    organizer: nullableText(value.organizer),
    registrationDeadlineAt: normalizeInstant(value.registrationDeadlineAt),
    registrationDeadlineRaw: nullableText(value.registrationDeadlineRaw, EVIDENCE_MAX_LENGTH),
    registrationUrl: safeHttpUrl(value.registrationUrl),
    evidenceText: clampEvidence(typeof value.evidenceText === 'string' ? value.evidenceText : ''),
    confidence: clampConfidence(value.confidence),
    status: status as ActivityStatus,
    sourceUrl: safeHttpUrl(value.sourceUrl),
    sourceLabel: nullableText(value.sourceLabel, 160) ?? ACTIVITY_SOURCE_LABELS[resolvedSource],
    publishedAt: normalizeInstant(value.publishedAt),
    stale: value.stale === true,
  }
}

export function normalizeActivityItems(raw: unknown): ActivityItem[] {
  if (!Array.isArray(raw)) return []
  const items: ActivityItem[] = []
  for (const entry of raw) {
    const normalized = normalizeActivityItem(entry)
    if (normalized !== null) items.push(normalized)
  }
  return items
}

export function normalizeActivityReminder(raw: unknown): ActivityReminderItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>

  const id = nullableText(value.id, 128)
  const remindAt = normalizeInstant(value.remindAt)
  if (id === null || remindAt === null) return null
  if (!REMINDER_KINDS.includes(value.kind as ActivityReminderKind)) return null
  if (!REMINDER_CHANNELS.includes(value.channel as ActivityReminderChannel)) return null
  const status = nullableText(value.status, 40) ?? 'pending'
  if (!ACTIVITY_REMINDER_STATUSES.includes(status as ActivityReminderStatus)) return null

  return {
    id,
    kind: value.kind as ActivityReminderKind,
    remindAt,
    channel: value.channel as ActivityReminderChannel,
    status: status as ActivityReminderStatus,
  }
}

export function normalizeActivityReminders(raw: unknown): ActivityReminderItem[] {
  if (!Array.isArray(raw)) return []
  const items: ActivityReminderItem[] = []
  for (const entry of raw) {
    const normalized = normalizeActivityReminder(entry)
    if (normalized !== null) items.push(normalized)
  }
  return items
}

export function normalizeActivityReminderWithActivity(
  raw: unknown,
): ActivityReminderWithActivity | null {
  const reminder = normalizeActivityReminder(raw)
  if (reminder === null || typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const activityId = nullableText(value.activityId, 128)
  const activityTitle = nullableText(value.activityTitle, ACTIVITY_TITLE_MAX)
  if (activityId === null || activityTitle === null) return null
  return { ...reminder, activityId, activityTitle }
}

export function normalizeActivityRemindersWithActivity(
  raw: unknown,
): ActivityReminderWithActivity[] {
  if (!Array.isArray(raw)) return []
  const items: ActivityReminderWithActivity[] = []
  for (const entry of raw) {
    const normalized = normalizeActivityReminderWithActivity(entry)
    if (normalized !== null) items.push(normalized)
  }
  return items
}

/* ------------------------------------------------------------------ *
 * 手动录入 / 公众号导入
 * ------------------------------------------------------------------ */

export interface ManualActivityDraft {
  title: string
  kind: ActivityKind
  startsAt?: string | null
  endsAt?: string | null
  location?: string | null
  organizer?: string | null
  registrationDeadlineAt?: string | null
  registrationDeadlineRaw?: string | null
  registrationUrl?: string | null
  evidenceText?: string | null
}

export function manualActivityProblem(draft: ManualActivityDraft): string | null {
  const title = draft.title.trim()
  if (title.length === 0 || Array.from(title).length > ACTIVITY_TITLE_MAX) {
    return `标题 1–${ACTIVITY_TITLE_MAX} 字`
  }
  if (!ACTIVITY_KINDS.includes(draft.kind)) return '请选择活动类型'

  const startsMs = draft.startsAt == null ? null : parseInstant(draft.startsAt)
  if (draft.startsAt != null && startsMs === null) return '开始时间格式不正确'
  const endsMs = draft.endsAt == null ? null : parseInstant(draft.endsAt)
  if (draft.endsAt != null && endsMs === null) return '结束时间格式不正确'
  if (startsMs !== null && endsMs !== null && endsMs < startsMs) return '结束时间不能早于开始时间'

  if (
    draft.registrationDeadlineAt != null &&
    parseInstant(draft.registrationDeadlineAt) === null
  ) {
    return '报名截止时间格式不正确'
  }
  if (draft.registrationUrl != null && draft.registrationUrl.trim() !== '') {
    if (safeHttpUrl(draft.registrationUrl) === null) return '报名链接必须是 http(s) 地址'
  }
  return null
}

export interface WechatImportInput {
  link?: string
  text?: string
}

const WECHAT_URL_PATTERN = /https?:\/\/mp\.weixin\.qq\.com\/s[^\s"'<>]*/gi

/**
 * 公众号单篇导入的客户端校验。
 *
 * 只支持**用户主动**粘一篇链接 / 正文：
 *   · 不做自动发现、不做批量历史抓取；
 *   · 不做 web-view（未备案业务域名会白屏），链接只用于复制；
 *   · 不绕过微信验证。
 */
export function wechatImportProblem(input: WechatImportInput): string | null {
  const link = input.link?.trim() ?? ''
  const text = input.text?.trim() ?? ''
  if (link === '' && text === '') return '请粘贴公众号文章链接或正文'
  if (link !== '' && text !== '') return '一次只导入一篇：链接或正文二选一'

  if (link !== '') {
    if (/\s/.test(link)) return '一次只导入一篇，请不要粘贴多条链接'
    if (link.length > 2048) return '链接过长'
    let url: URL
    try {
      url = new URL(link)
    } catch {
      return '链接格式不正确'
    }
    if (url.protocol !== 'https:') return '只支持 https 链接'
    if (url.hostname.toLowerCase() !== 'mp.weixin.qq.com') return '只支持公众号文章链接'
    if (url.pathname !== '/s' && !url.pathname.startsWith('/s/')) return '这不是一篇公众号文章'
    return null
  }

  if (Array.from(text).length < 10) return '正文太短，至少粘贴一段活动说明'
  if (Array.from(text).length > 20000) return '正文过长，请只粘贴这一篇的活动说明'
  const matches = text.match(WECHAT_URL_PATTERN) ?? []
  if (matches.length > 1) return '一次只导入一篇，请只保留一篇文章'
  return null
}

/** 把任意输入归一成 UTC ISO 时刻；只有日期 / 非法值返回 null */
export function normalizeActivityInstant(value: string | null | undefined): string | null {
  return normalizeInstant(value)
}

/** 只放行 http(s)、无内嵌凭证的 URL；其余返回 null（页面只复制，不做 web-view） */
export function normalizeActivityUrl(value: unknown): string | null {
  return safeHttpUrl(value)
}

/* ------------------------------------------------------------------ *
 * 手机日历（ICS 降级）
 * ------------------------------------------------------------------ */

function formatIcsUtc(ms: number): string {
  const date = new Date(ms)
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
    'T',
    pad2(date.getUTCHours()),
    pad2(date.getUTCMinutes()),
    pad2(date.getUTCSeconds()),
    'Z',
  ].join('')
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * 生成可复制到系统日历的 ICS。
 *
 * 平台不支持 `wx.addPhoneCalendar` 时走这条降级通道；**不是**微信订阅消息，
 * 也不会产生任何推送。没有确定开始时间就返回 null —— 不猜一个时刻。
 */
export function buildActivityIcs(
  item: Pick<
    ActivityItem,
    | 'id'
    | 'title'
    | 'startsAt'
    | 'endsAt'
    | 'location'
    | 'organizer'
    | 'registrationUrl'
    | 'evidenceText'
  >,
  now: Date,
): string | null {
  const startMs = parseInstant(item.startsAt)
  if (startMs === null) return null

  const endMs = parseInstant(item.endsAt)
  const safeEndMs = endMs !== null && endMs > startMs ? endMs : startMs + HOUR_MS
  const stampMs = Number.isFinite(now.getTime()) ? now.getTime() : startMs

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kedaya//Activities//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(item.id)}@kedaya`,
    `DTSTAMP:${formatIcsUtc(stampMs)}`,
    `DTSTART:${formatIcsUtc(startMs)}`,
    `DTEND:${formatIcsUtc(safeEndMs)}`,
    `SUMMARY:${escapeIcsText(item.title)}`,
  ]

  if (item.location !== null && item.location.trim() !== '') {
    lines.push(`LOCATION:${escapeIcsText(item.location.trim())}`)
  }
  if (item.organizer !== null && item.organizer.trim() !== '') {
    lines.push(`ORGANIZER:${escapeIcsText(item.organizer.trim())}`)
  }
  if (item.evidenceText.trim() !== '') {
    lines.push(`DESCRIPTION:${escapeIcsText(item.evidenceText.trim())}`)
  }
  if (item.registrationUrl !== null) {
    lines.push(`URL:${item.registrationUrl}`)
  }

  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}
