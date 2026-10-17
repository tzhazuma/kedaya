import { fenToYuan, formatDeadline, formatRelativeTime } from '@kedaya/shared'

/**
 * 跑腿 · errand 领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 与后端 `services/api/src/modules/errand/domain/errand.domain.ts` 逐条对齐：
 *   状态机 `open → accepted → delivered → completed`，`cancelled` 为终态；
 *   排序白名单 `latest | reward-desc | deadline`；悬赏上限 1000 元。
 *
 * 金额一律整数**分**（契约 §6.1），只在展示层用 `fenToYuan` 转元。
 * 时间统一 ISO-8601 字符串（传输层形状），展示层用 `formatRelativeTime` 本地化。
 */

export type ErrandStatus = 'open' | 'accepted' | 'delivered' | 'completed' | 'cancelled'

/** 与后端 `ERRAND_STATUSES` 同一份白名单 */
export const ERRAND_STATUSES: readonly ErrandStatus[] = [
  'open',
  'accepted',
  'delivered',
  'completed',
  'cancelled',
]

export const ERRAND_STATUS_LABELS: Readonly<Record<ErrandStatus, string>> = {
  open: '待接单',
  accepted: '已接单',
  delivered: '已送达',
  completed: '已完成',
  cancelled: '已取消',
}

export type ErrandSort = 'latest' | 'reward-desc' | 'deadline'

export const ERRAND_SORTS: readonly ErrandSort[] = ['latest', 'reward-desc', 'deadline']

export const ERRAND_SORT_LABELS: Readonly<Record<ErrandSort, string>> = {
  latest: '最新发布',
  'reward-desc': '悬赏最高',
  deadline: '最紧急',
}

/** 单笔悬赏上限：1000 元（分）—— 与服务端 `ERRAND_MAX_REWARD_FEN` 一致 */
export const ERRAND_MAX_REWARD_FEN = 100_000

/** 文本长度上限（与服务端 Zod schema 一致） */
export const ERRAND_TITLE_MAX = 60
export const ERRAND_DETAIL_MAX = 2000
export const ERRAND_PLACE_MAX = 60

export interface ErrandTask {
  id: string
  requesterId: string
  /** 接单者，未接单为 null */
  runnerId: string | null
  title: string
  detail: string | null
  /** 悬赏，单位 **分** */
  rewardFen: number
  fromPlace: string
  toPlace: string
  deadline: string
  status: string
  acceptedAt: string | null
  deliveredAt: string | null
  settledAt: string | null
  createdAt: string
  updatedAt: string
}

/** 创建输入。`requesterId` 由服务端从 JWT 主体补全，客户端不传。 */
export interface CreateErrandTaskInput {
  title: string
  detail?: string | null
  rewardFen: number
  fromPlace: string
  toPlace: string
  /** ISO-8601，必须晚于当前时间 */
  deadline: string
}

/** 更新输入（全部可选；状态只能走领域动作） */
export interface UpdateErrandTaskInput {
  title?: string
  detail?: string | null
  rewardFen?: number
  fromPlace?: string
  toPlace?: string
  deadline?: string
}

/**
 * 列表范围：`all` 全部；`requester` 我发布的（后端 `mine=1`）；
 * `runner` 我接下的（后端 `role=runner`）。后两个需要登录。
 */
export type ErrandScope = 'all' | 'requester' | 'runner'

export interface ErrandTaskFilters extends Record<string, unknown> {
  keyword?: string
  status?: ErrandStatus
  fromPlace?: string
  toPlace?: string
  sort?: ErrandSort
  scope?: ErrandScope
}

/** 卡片直接可读的派生视图 —— UI 不再自己算标签 */
export interface ErrandTaskSummary {
  id: string
  title: string
  rewardFen: number
  rewardLabel: string
  routeLabel: string
  /** 「还有 6 小时」/「已截止」 */
  deadlineLabel: string
  timeLabel: string
  status: ErrandStatus
  statusLabel: string
  detailPreview: string
  /** 我发布的 */
  mine: boolean
  /** 我接的单 */
  takenByMe: boolean
  /** 是否已经有人接单（用于「待接单」卡片提示） */
  hasRunner: boolean
}

export function isErrandStatus(value: unknown): value is ErrandStatus {
  return typeof value === 'string' && (ERRAND_STATUSES as readonly string[]).includes(value)
}

/** 未知状态降级为可读文案而不是抛错（旧数据 / 新状态向前兼容） */
export function errandStatusLabel(status: string): string {
  return isErrandStatus(status) ? ERRAND_STATUS_LABELS[status] : '未知状态'
}

export function isErrandSort(value: unknown): value is ErrandSort {
  return typeof value === 'string' && (ERRAND_SORTS as readonly string[]).includes(value)
}

export function errandSortLabel(sort: string): string {
  return isErrandSort(sort) ? ERRAND_SORT_LABELS[sort] : ERRAND_SORT_LABELS.latest
}

/** 展示用：`图书馆 → 3 号楼 502` */
export function errandRouteLabel(task: Pick<ErrandTask, 'fromPlace' | 'toPlace'>): string {
  return `${task.fromPlace} → ${task.toPlace}`
}

/**
 * 绝对时间文案（`MM-DD HH:mm`，本地时区）。
 *
 * 纯函数：跑在 presentation 之外的测试里也不需要 Taro / 时区库。
 */
export function formatMoment(iso: string | null): string {
  if (iso === null) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function summarizeErrandTask(
  task: ErrandTask,
  viewerId: string | null,
  now: Date,
): ErrandTaskSummary {
  return {
    id: task.id,
    title: task.title,
    rewardFen: task.rewardFen,
    rewardLabel: fenToYuan(task.rewardFen),
    routeLabel: errandRouteLabel(task),
    deadlineLabel: formatDeadline(task.deadline, now),
    timeLabel: formatRelativeTime(task.updatedAt === '' ? task.createdAt : task.updatedAt, now),
    status: isErrandStatus(task.status) ? task.status : 'open',
    statusLabel: errandStatusLabel(task.status),
    detailPreview: (task.detail ?? '').slice(0, 60),
    mine: viewerId !== null && task.requesterId === viewerId,
    takenByMe: viewerId !== null && task.runnerId === viewerId,
    hasRunner: task.runnerId !== null,
  }
}

/** 详情页可用的领域动作（按钮只渲染这里有权限的项） */
export type ErrandAction = 'accept' | 'deliver' | 'complete' | 'cancel' | 'edit' | 'delete'

export const ERRAND_ACTION_LABELS: Readonly<Record<ErrandAction, string>> = {
  accept: '接单',
  deliver: '确认送达',
  complete: '确认完成',
  cancel: '取消任务',
  edit: '编辑',
  delete: '删除',
}

export interface ActionEligibility {
  allowed: boolean
  message: string
}

/**
 * 动作权限判定 —— 纯函数，与服务端 `ErrandTaskService` 的闸门一一对应。
 *
 * 服务端仍是最终裁决，这里只是**提前**把不该出现的按钮藏掉：
 *   · 发布者：可改 / 删（未结束时）、可取消（open/accepted）、可确认完成（delivered）；
 *   · 接单者：仅 accepted 时可确认送达；
 *   · 其他人：仅 open 时可接单（且不能接自己的单）。
 */
export function availableErrandActions(task: ErrandTask, viewerId: string | null): ErrandAction[] {
  if (viewerId === null) return []
  const status = isErrandStatus(task.status) ? task.status : 'open'

  if (task.requesterId === viewerId) {
    // completed / cancelled 之后任务已结束：不可改 / 删 / 取消（服务端返回 CONFLICT）
    if (status === 'completed' || status === 'cancelled') return []
    if (status === 'delivered') return ['complete', 'edit', 'delete']
    return ['cancel', 'edit', 'delete']
  }

  if (task.runnerId === viewerId) {
    // 只有「已接单」可确认送达；delivered 之后接单者没有可执行动作
    return status === 'accepted' ? ['deliver'] : []
  }

  // 路人：只有待接单可接
  return status === 'open' ? ['accept'] : []
}

/** 接单闸门（与服务端 accept 的错误语义一致） */
export function canAcceptErrand(task: ErrandTask, viewerId: string | null): ActionEligibility {
  if (viewerId === null) {
    return { allowed: false, message: '登录后才能接单' }
  }
  if (task.requesterId === viewerId) {
    return { allowed: false, message: '不能接自己发布的跑腿任务' }
  }
  if (task.status !== 'open') {
    if (task.runnerId === viewerId) return { allowed: false, message: '你已经接过这一单了' }
    return { allowed: false, message: '该任务已被接单或已结束' }
  }
  return { allowed: true, message: '' }
}

/** 展示用：当前用户在这条任务里的角色（详情页提示语） */
export function errandViewerRole(task: ErrandTask, viewerId: string | null): 'requester' | 'runner' | null {
  if (viewerId === null) return null
  if (task.requesterId === viewerId) return 'requester'
  if (task.runnerId === viewerId) return 'runner'
  return null
}

/* ------------------------------------------------------------------ *
 * 截止时间的「快捷选项」
 *
 * 小程序禁用原生 Picker（见 apps/miniapp/AGENTS.md），所以截止时间用
 * 一组偏移胶囊 + 一个自定义小时数输入框表达，全部由纯函数算成 ISO。
 * ------------------------------------------------------------------ */

export interface OffsetPreset {
  id: string
  label: string
  /** 相对当前时间的分钟数 */
  offsetMinutes: number
}

export const ERRAND_DEADLINE_PRESETS: readonly OffsetPreset[] = [
  { id: '30m', label: '30 分钟后', offsetMinutes: 30 },
  { id: '1h', label: '1 小时后', offsetMinutes: 60 },
  { id: '3h', label: '3 小时后', offsetMinutes: 180 },
  { id: 'tonight', label: '6 小时后', offsetMinutes: 360 },
  { id: 'tomorrow', label: '明天此刻', offsetMinutes: 1_440 },
]

/** `now + minutes` 的 ISO 字符串 */
export function offsetIso(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString()
}

export function findOffsetPreset(
  presets: readonly OffsetPreset[],
  id: string,
): OffsetPreset | null {
  return presets.find((preset) => preset.id === id) ?? null
}
