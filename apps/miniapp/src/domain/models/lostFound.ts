import { formatRelativeTime } from '@kedaya/shared'

import { imageSummary } from './media'

/**
 * 失物招领（`lost-found`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 与后端 `services/api/src/modules/lost-found/domain/lost-found.domain.ts`
 * 及 `lost-found.service.ts` 逐条对齐：
 *   · 类型 `kind` 是**白名单** lost | found（丢了东西 / 捡到东西）；
 *   · 状态机 `open ↔ resolved`：resolve 幂等冲突返回 CONFLICT，
 *     reopen 反向且**清空 resolvedAt**；
 *   · 事发时间允许 5 分钟时钟偏差（手机时钟略快不该导致发布失败），
 *     但「未来的丢东西」没有意义，超出偏差一律拒绝。
 *
 * 这里是客户端与 mock 仓储共用的**同一份规则**：白名单判定、校验文案、
 * 动作闸门都从这里导出，避免页面 / 用例 / mock 各写一遍后悄悄漂移。
 */

/** 信息类型：丢了东西（lost）/ 捡到东西（found） */
export const LOST_FOUND_KINDS = ['lost', 'found'] as const
export type LostFoundKind = (typeof LOST_FOUND_KINDS)[number]

export const LOST_FOUND_STATUS = {
  open: 'open',
  resolved: 'resolved',
} as const
export type LostFoundStatus = (typeof LOST_FOUND_STATUS)[keyof typeof LOST_FOUND_STATUS]

export const LOST_FOUND_STATUSES = [LOST_FOUND_STATUS.open, LOST_FOUND_STATUS.resolved] as const

/** 排序方式（按**事发时间**，不是发布时间） */
export const LOST_FOUND_SORTS = ['latest', 'oldest'] as const
export type LostFoundSort = (typeof LOST_FOUND_SORTS)[number]

/** 事发时间允许的时钟偏差：5 分钟（与后端 `LOST_FOUND_CLOCK_SKEW_MS` 同值） */
export const LOST_FOUND_CLOCK_SKEW_MS = 5 * 60 * 1000

/* 文本上限（与后端 Zod schema / normalize* 完全一致） */
export const LOST_FOUND_TITLE_MAX = 60
export const LOST_FOUND_PLACE_MAX = 60
export const LOST_FOUND_DESCRIPTION_MAX = 2000
export const LOST_FOUND_CONTACT_MAX = 60

export const LOST_FOUND_KIND_LABELS: Readonly<Record<LostFoundKind, string>> = {
  lost: '寻物启事',
  found: '招领启事',
}

/** 卡片左侧的文字徽标（小程序规范禁止 emoji 充当功能图标，因此只用文字） */
export const LOST_FOUND_KIND_BADGES: Readonly<Record<LostFoundKind, string>> = {
  lost: '寻物',
  found: '招领',
}

/** 发布表单里的类型说明 */
export const LOST_FOUND_KIND_HINTS: Readonly<Record<LostFoundKind, string>> = {
  lost: '我丢了东西',
  found: '我捡到了东西',
}

export const LOST_FOUND_STATUS_LABELS: Readonly<Record<LostFoundStatus, string>> = {
  open: '进行中',
  resolved: '已解决',
}

export const LOST_FOUND_SORT_LABELS: Readonly<Record<LostFoundSort, string>> = {
  latest: '最新事发',
  oldest: '最早事发',
}

/** 领域模型：字段与后端 `LostFoundItemModel` 一一对应，时间以 ISO 字符串传输 */
export interface LostFoundItem {
  id: string
  /** 发布者；服务端从 JWT 取主体，客户端不参与 */
  reporterId: string
  kind: string
  title: string
  description: string | null
  place: string
  /** 事发时间（ISO-8601） */
  happenedAt: string
  contactHint: string | null
  status: string
  /** 图片地址（只可能是本平台上传的地址；上传时已剥离 EXIF GPS） */
  imageUrls: string[]
  /** 标记已解决的时间（reopen 会清空） */
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateLostFoundItemInput {
  kind: string
  title: string
  description?: string | null
  place: string
  /** ISO-8601 */
  happenedAt: string
  contactHint?: string | null
  /** 已上传成功的图片地址（见 `useImageAttachments`） */
  imageUrls?: string[]
}

export interface UpdateLostFoundItemInput {
  kind?: string
  title?: string
  description?: string | null
  place?: string
  happenedAt?: string
  contactHint?: string | null
  imageUrls?: string[]
}

/** 列表筛选条件（`mine=1` 由用例翻译成「只看自己」） */
export interface LostFoundItemFilters extends Record<string, unknown> {
  keyword?: string
  kind?: LostFoundKind
  status?: LostFoundStatus
  place?: string
  sort?: LostFoundSort
  mine?: boolean
}

/** 卡片/列表直接可读的派生视图 —— UI 不再自己算标签 */
export interface LostFoundItemSummary {
  id: string
  title: string
  badge: string
  kindLabel: string
  statusLabel: string
  status: LostFoundStatus
  place: string
  /** 事发时间相对文案 */
  happenedLabel: string
  createdLabel: string
  descriptionPreview: string
  contactHint: string | null
  /** 列表缩略图（第一张；没有图时为 null） */
  thumbnailUrl: string | null
  imageCount: number
  resolved: boolean
  mine: boolean
}

export function isLostFoundKind(value: unknown): value is LostFoundKind {
  return typeof value === 'string' && (LOST_FOUND_KINDS as readonly string[]).includes(value)
}

export function isLostFoundStatus(value: unknown): value is LostFoundStatus {
  return value === LOST_FOUND_STATUS.open || value === LOST_FOUND_STATUS.resolved
}

export function isLostFoundSort(value: unknown): value is LostFoundSort {
  return typeof value === 'string' && (LOST_FOUND_SORTS as readonly string[]).includes(value)
}

export function kindLabel(kind: string): string {
  return isLostFoundKind(kind) ? LOST_FOUND_KIND_LABELS[kind] : '失物信息'
}

export function kindBadge(kind: string): string {
  return isLostFoundKind(kind) ? LOST_FOUND_KIND_BADGES[kind] : '信息'
}

export function statusLabel(status: string): string {
  return isLostFoundStatus(status) ? LOST_FOUND_STATUS_LABELS[status] : '未知状态'
}

/** 动作文案随类型变化：捡到东西叫「已归还」，丢了东西叫「已找回」 */
export function resolveActionLabel(kind: string): string {
  return kind === 'found' ? '标记已归还' : '标记已找回'
}

export function resolveDoneLabel(kind: string): string {
  return kind === 'found' ? '已归还' : '已找回'
}

export function summarize(
  item: LostFoundItem,
  viewerId: string | null,
  now: Date,
): LostFoundItemSummary {
  const images = imageSummary(item.imageUrls)
  return {
    id: item.id,
    title: item.title,
    badge: kindBadge(item.kind),
    kindLabel: kindLabel(item.kind),
    statusLabel: statusLabel(item.status),
    status: isLostFoundStatus(item.status) ? item.status : LOST_FOUND_STATUS.open,
    place: item.place,
    happenedLabel: formatRelativeTime(item.happenedAt, now),
    createdLabel: formatRelativeTime(item.createdAt, now),
    descriptionPreview: (item.description ?? '').slice(0, 60),
    contactHint: item.contactHint,
    thumbnailUrl: images.thumbnailUrl,
    imageCount: images.imageCount,
    resolved: item.status === LOST_FOUND_STATUS.resolved,
    mine: viewerId !== null && item.reporterId === viewerId,
  }
}

/* ------------------------------------------------------------------ *
 * 校验（纯函数，用例、mock 仓储与页面共用同一份文案）
 * ------------------------------------------------------------------ */

export function titleProblem(title: string): string | null {
  const text = title.trim()
  if (text.length === 0) return '请填写物品名称'
  if ([...text].length > LOST_FOUND_TITLE_MAX) return `物品名称最多 ${LOST_FOUND_TITLE_MAX} 个字`
  return null
}

export function placeProblem(place: string): string | null {
  const text = place.trim()
  if (text.length === 0) return '请填写地点'
  if ([...text].length > LOST_FOUND_PLACE_MAX) return `地点最多 ${LOST_FOUND_PLACE_MAX} 个字`
  return null
}

/** 选填长文本：空串等价于「没填」（后端 normalizeText 会返回 null） */
export function descriptionProblem(text: string): string | null {
  if ([...text.trim()].length > LOST_FOUND_DESCRIPTION_MAX) {
    return `详细描述最多 ${LOST_FOUND_DESCRIPTION_MAX} 个字`
  }
  return null
}

export function contactHintProblem(text: string): string | null {
  if ([...text.trim()].length > LOST_FOUND_CONTACT_MAX) {
    return `联系方式提示最多 ${LOST_FOUND_CONTACT_MAX} 个字`
  }
  return null
}

export function kindProblem(kind: string): string | null {
  return isLostFoundKind(kind) ? null : '信息类型不在支持范围内'
}

/**
 * 事发时间校验 —— 与后端 `normalizeHappenedAt` 同一套判定：
 * 非法日期 / 超出 5 分钟时钟偏差都被拒绝。
 */
export function happenedAtProblem(happenedAt: Date, now: Date): string | null {
  if (Number.isNaN(happenedAt.getTime())) return '事发时间格式不正确'
  if (happenedAt.getTime() > now.getTime() + LOST_FOUND_CLOCK_SKEW_MS) {
    return '事发时间不能晚于当前时间'
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

/** 详情页可用的领域动作（按钮只渲染这里有权限的项） */
export type LostFoundAction = 'resolve' | 'reopen' | 'edit' | 'delete'

export const LOST_FOUND_ACTION_LABELS: Readonly<Record<LostFoundAction, string>> = {
  resolve: '标记已解决',
  reopen: '重新开放',
  edit: '编辑',
  delete: '删除',
}

export interface ActionEligibility {
  allowed: boolean
  message: string
}

/**
 * 动作权限判定 —— 纯函数，用例与 UI 共用同一份规则。
 *
 * 与后端 `LostFoundItemService` 一致：
 *   · 改 / 删 / resolve / reopen **都**只允许发布者；
 *   · 编辑与删除不受状态限制（resolved 之后仍可改错别字 / 删除）；
 *   · resolve 只对 open 有效，reopen 只对 resolved 有效。
 */
export function availableActions(item: LostFoundItem, viewerId: string | null): LostFoundAction[] {
  if (viewerId === null) return []
  if (item.reporterId !== viewerId) return []

  const resolved = item.status === LOST_FOUND_STATUS.resolved
  return resolved ? ['reopen', 'edit', 'delete'] : ['resolve', 'edit', 'delete']
}

export function resolveEligibility(item: LostFoundItem, viewerId: string | null): ActionEligibility {
  if (viewerId === null) return { allowed: false, message: '登录后才能标记已解决' }
  if (item.reporterId !== viewerId) {
    return { allowed: false, message: '只有发布者可以标记为已解决' }
  }
  if (item.status === LOST_FOUND_STATUS.resolved) {
    return { allowed: false, message: '这条信息已经标记为已解决' }
  }
  return { allowed: true, message: '' }
}

export function reopenEligibility(item: LostFoundItem, viewerId: string | null): ActionEligibility {
  if (viewerId === null) return { allowed: false, message: '登录后才能重新开放' }
  if (item.reporterId !== viewerId) {
    return { allowed: false, message: '只有发布者可以重新开放' }
  }
  if (item.status !== LOST_FOUND_STATUS.resolved) {
    return { allowed: false, message: '这条信息当前不是已解决状态' }
  }
  return { allowed: true, message: '' }
}
