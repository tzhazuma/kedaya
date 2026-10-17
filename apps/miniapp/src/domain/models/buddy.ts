import { formatRelativeTime } from '@kedaya/shared'

/**
 * 找搭子 · buddy 领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 与后端 `services/api/src/modules/buddy/domain/buddy.domain.ts` 逐条对齐：
 *   活动类型白名单 7 项；状态机 `recruiting → full → closed`，`cancelled` 为终态；
 *   容量区间 2~50 人；排序 `latest | soon`。
 *
 * 与跳蚤不同，本模块有**成员关系**：列表行只有小组信息（拿不到人数），
 * 详情才带成员列表，因此「已加入人数」只在详情/成员可见的地方展示。
 */

export type BuddyActivity = 'study' | 'sport' | 'meal' | 'travel' | 'game' | 'movie' | 'other'

/** 与后端 `BUDDY_ACTIVITIES` 同一份白名单（客户端筛选器直接用它渲染） */
export const BUDDY_ACTIVITIES: readonly BuddyActivity[] = [
  'study',
  'sport',
  'meal',
  'travel',
  'game',
  'movie',
  'other',
]

export const BUDDY_ACTIVITY_LABELS: Readonly<Record<BuddyActivity, string>> = {
  study: '自习',
  sport: '运动',
  meal: '吃饭',
  travel: '出行',
  game: '游戏',
  movie: '观影',
  other: '其它',
}

export type BuddyStatus = 'recruiting' | 'full' | 'closed' | 'cancelled'

export const BUDDY_STATUSES: readonly BuddyStatus[] = ['recruiting', 'full', 'closed', 'cancelled']

export const BUDDY_STATUS_LABELS: Readonly<Record<BuddyStatus, string>> = {
  recruiting: '招募中',
  full: '已满员',
  closed: '已停止招募',
  cancelled: '已取消',
}

export type BuddySort = 'latest' | 'soon'

export const BUDDY_SORTS: readonly BuddySort[] = ['latest', 'soon']

export const BUDDY_SORT_LABELS: Readonly<Record<BuddySort, string>> = {
  latest: '最新发布',
  soon: '即将开始',
}

/** 容量区间：至少「我 + 一个搭子」，最多 50 人（与服务端一致） */
export const BUDDY_MIN_CAPACITY = 2
export const BUDDY_MAX_CAPACITY = 50

/** 文本长度上限（与服务端 Zod schema 一致） */
export const BUDDY_TITLE_MAX = 60
export const BUDDY_DESCRIPTION_MAX = 2000
export const BUDDY_SPOT_MAX = 60

export interface BuddyGroup {
  id: string
  ownerId: string
  activity: string
  title: string
  description: string | null
  campusSpot: string
  startsAt: string
  capacity: number
  status: string
  createdAt: string
  updatedAt: string
}

/** 成员对外视图：带上展示名与头像，供详情页渲染 */
export interface BuddyMemberView {
  userId: string
  role: string
  joinedAt: string
  displayName: string
  avatarUrl: string | null
}

/**
 * 成员关系行（对应后端 `BuddyMemberModel`）。
 *
 * 客户端只用它来保存/回放本地数据（mock 仓储与测试种子）；
 * 详情页渲染一律用 `BuddyMemberView`。
 */
export interface BuddyMemberRow {
  id: string
  groupId: string
  userId: string
  role: string
  joinedAt: string
}

/** 详情 = 小组 + 成员列表 */
export interface BuddyGroupDetail extends BuddyGroup {
  members: BuddyMemberView[]
}

/** 创建输入。`ownerId` 由服务端从 JWT 主体补全，客户端不传。 */
export interface CreateBuddyGroupInput {
  activity: string
  title: string
  description?: string | null
  campusSpot: string
  /** ISO-8601，必须晚于当前时间 */
  startsAt: string
  capacity: number
}

/**
 * 列表范围：`all` 全部；`mine` 我发起的（后端 `mine=1`）；
 * `joined` 我加入的（后端 `joined=1`）。后两个需要登录。
 */
export type BuddyScope = 'all' | 'mine' | 'joined'

export interface BuddyGroupFilters extends Record<string, unknown> {
  keyword?: string
  activity?: BuddyActivity
  status?: BuddyStatus
  sort?: BuddySort
  scope?: BuddyScope
  /** 只看还没开始的（后端 `upcoming=1`） */
  onlyUpcoming?: boolean
}

export const BUDDY_ROLE_LABELS: Readonly<Record<string, string>> = {
  owner: '组长',
  member: '搭子',
}

export function buddyRoleLabel(role: string): string {
  return BUDDY_ROLE_LABELS[role] ?? '成员'
}

/** 卡片/列表直接可读的派生视图 */
export interface BuddyGroupSummary {
  id: string
  title: string
  badge: string
  activityLabel: string
  status: BuddyStatus
  statusLabel: string
  campusSpot: string
  /** 「1 天后开始」 */
  startsLabel: string
  /** 「共 4 个名额」 */
  capacityLabel: string
  descriptionPreview: string
  timeLabel: string
  /** 我发起的 */
  mine: boolean
}

export function isBuddyActivity(value: unknown): value is BuddyActivity {
  return typeof value === 'string' && (BUDDY_ACTIVITIES as readonly string[]).includes(value)
}

export function buddyActivityLabel(activity: string): string {
  return isBuddyActivity(activity) ? BUDDY_ACTIVITY_LABELS[activity] : '其它'
}

export function isBuddyStatus(value: unknown): value is BuddyStatus {
  return typeof value === 'string' && (BUDDY_STATUSES as readonly string[]).includes(value)
}

export function buddyStatusLabel(status: string): string {
  return isBuddyStatus(status) ? BUDDY_STATUS_LABELS[status] : '未知状态'
}

export function isBuddySort(value: unknown): value is BuddySort {
  return typeof value === 'string' && (BUDDY_SORTS as readonly string[]).includes(value)
}

export function buddySortLabel(sort: string): string {
  return isBuddySort(sort) ? BUDDY_SORT_LABELS[sort] : BUDDY_SORT_LABELS.latest
}

/**
 * 卡片左侧的视觉锚点 —— 用活动类型的**文字**标签，
 * 而不是 emoji / 图片（AGENTS.md 禁止 emoji 充当功能图标）。
 */
export function buddyActivityBadge(activity: string): string {
  return buddyActivityLabel(activity)
}

export function buddyCapacityLabel(capacity: number): string {
  return `共 ${capacity} 个名额`
}

export function summarizeBuddyGroup(
  group: BuddyGroup,
  viewerId: string | null,
  now: Date,
): BuddyGroupSummary {
  return {
    id: group.id,
    title: group.title,
    badge: buddyActivityBadge(group.activity),
    activityLabel: buddyActivityLabel(group.activity),
    status: isBuddyStatus(group.status) ? group.status : 'recruiting',
    statusLabel: buddyStatusLabel(group.status),
    campusSpot: group.campusSpot,
    startsLabel: `${formatRelativeTime(group.startsAt, now)}开始`,
    capacityLabel: buddyCapacityLabel(group.capacity),
    descriptionPreview: (group.description ?? '').slice(0, 60),
    timeLabel: formatRelativeTime(group.createdAt, now),
    mine: viewerId !== null && group.ownerId === viewerId,
  }
}

/** 详情页可用的领域动作（按钮只渲染这里有权限的项） */
export type BuddyAction = 'join' | 'leave' | 'close' | 'cancel'

export const BUDDY_ACTION_LABELS: Readonly<Record<BuddyAction, string>> = {
  join: '加入搭子',
  leave: '退出搭子',
  close: '停止招募',
  cancel: '取消招募',
}

export interface ActionEligibility {
  allowed: boolean
  message: string
}

/** 找出当前用户在成员列表里的身份（组长也占一个成员名额） */
export function findViewerMembership(
  members: readonly BuddyMemberView[],
  viewerId: string | null,
): BuddyMemberView | null {
  if (viewerId === null) return null
  return members.find((member) => member.userId === viewerId) ?? null
}

export function countMembers(members: readonly BuddyMemberView[]): number {
  return members.length
}

/** 绝对时间文案（`MM-DD HH:mm`，本地时区）—— 纯函数 */
export function formatMoment(iso: string | null): string {
  if (iso === null) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 动作权限判定 —— 纯函数，与服务端 `BuddyGroupService` 的闸门一一对应。
 *
 *   · 组长：招募中可停止招募 / 取消；满员只能取消；
 *   · 普通成员：可退出（组长必须走取消，服务端会拒绝）；
 *   · 其他人：招募中且未满员时可加入。
 */
export function availableBuddyActions(
  group: BuddyGroupDetail,
  viewerId: string | null,
): BuddyAction[] {
  if (viewerId === null) return []
  const status = isBuddyStatus(group.status) ? group.status : 'recruiting'
  const membership = findViewerMembership(group.members, viewerId)

  if (group.ownerId === viewerId || membership?.role === 'owner') {
    if (status === 'recruiting') return ['close', 'cancel']
    if (status === 'full') return ['cancel']
    return []
  }

  if (membership !== null) return ['leave']

  const seams = countMembers(group.members)
  if (status === 'recruiting' && seams < group.capacity) return ['join']
  return []
}

/** 加入闸门（与服务端 join 的错误语义一致） */
export function canJoinBuddy(
  group: BuddyGroupDetail,
  viewerId: string | null,
): ActionEligibility {
  if (viewerId === null) {
    return { allowed: false, message: '登录后才能加入搭子' }
  }
  if (group.ownerId === viewerId) {
    return { allowed: false, message: '不能加入自己创建的搭子' }
  }
  if (findViewerMembership(group.members, viewerId) !== null) {
    return { allowed: false, message: '你已经加入这个搭子了' }
  }
  if (group.status !== 'recruiting') {
    return {
      allowed: false,
      message: group.status === 'full' ? '这个搭子已经满员了' : '这个搭子已经停止招募了',
    }
  }
  if (countMembers(group.members) >= group.capacity) {
    return { allowed: false, message: '这个搭子已经满员了' }
  }
  return { allowed: true, message: '' }
}

/** 展示用：当前用户在这条搭子里的角色（详情页提示语） */
export function buddyViewerRole(
  group: BuddyGroupDetail,
  viewerId: string | null,
): 'owner' | 'member' | null {
  if (viewerId === null) return null
  if (group.ownerId === viewerId) return 'owner'
  const membership = findViewerMembership(group.members, viewerId)
  return membership === null ? null : 'member'
}

/* ------------------------------------------------------------------ *
 * 开始时间的「快捷选项」（同样为了绕开原生 Picker）
 * ------------------------------------------------------------------ */

export interface OffsetPreset {
  id: string
  label: string
  /** 相对当前时间的分钟数 */
  offsetMinutes: number
}

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

export const BUDDY_START_PRESETS: readonly OffsetPreset[] = [
  { id: '2h', label: '2 小时后', offsetMinutes: 120 },
  { id: '6h', label: '6 小时后', offsetMinutes: 360 },
  { id: '1d', label: '明天此刻', offsetMinutes: 1_440 },
  { id: '2d', label: '2 天后', offsetMinutes: 2_880 },
  { id: '3d', label: '3 天后', offsetMinutes: 4_320 },
]
