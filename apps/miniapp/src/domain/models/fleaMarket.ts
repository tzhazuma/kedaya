import { fenToYuan, formatRelativeTime } from '@kedaya/shared'

/**
 * 跳蚤市场（`flea-market`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 与后端 `services/api/src/modules/flea-market/domain/flea-market.domain.ts` 对齐：
 *   状态机 on-sale → reserved → sold；分类 / 成色都是**白名单**，客户端与服务端同一份。
 *
 * 金额一律整数**分**（契约 §6.1），只在展示层用 `fenToYuan` 转元。
 */

export type FleaCategory = 'electronics' | 'books' | 'clothing' | 'daily' | 'sports' | 'tickets' | 'other'

export type FleaCondition = 'new' | 'like-new' | 'good' | 'fair'

export type FleaStatus = 'on-sale' | 'reserved' | 'sold'

export type FleaSort = 'latest' | 'price-asc' | 'price-desc'

export const FLEA_CATEGORIES: readonly FleaCategory[] = [
  'electronics',
  'books',
  'clothing',
  'daily',
  'sports',
  'tickets',
  'other',
]

export const FLEA_CATEGORY_LABELS: Readonly<Record<FleaCategory, string>> = {
  electronics: '数码',
  books: '书籍',
  clothing: '服饰',
  daily: '日用',
  sports: '运动',
  tickets: '票券',
  other: '其它',
}

export const FLEA_CONDITIONS: readonly FleaCondition[] = ['new', 'like-new', 'good', 'fair']

export const FLEA_CONDITION_LABELS: Readonly<Record<FleaCondition, string>> = {
  new: '全新',
  'like-new': '几乎全新',
  good: '成色良好',
  fair: '有使用痕迹',
}

export const FLEA_STATUS_LABELS: Readonly<Record<FleaStatus, string>> = {
  'on-sale': '在售',
  reserved: '已预定',
  sold: '已售出',
}

export const FLEA_SORT_LABELS: Readonly<Record<FleaSort, string>> = {
  latest: '最新发布',
  'price-asc': '价格从低到高',
  'price-desc': '价格从高到低',
}

export interface FleaItem {
  id: string
  sellerId: string
  title: string
  description: string | null
  /** 整数分 */
  priceFen: number
  category: string
  condition: string
  campusSpot: string | null
  status: string
  reservedById: string | null
  soldAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateFleaItemInput {
  title: string
  description?: string | null
  priceFen: number
  category: string
  condition?: string
  campusSpot?: string | null
}

export interface UpdateFleaItemInput {
  title?: string
  description?: string | null
  priceFen?: number
  category?: string
  condition?: string
  campusSpot?: string | null
}

/** 列表筛选条件（`mine=1` 由用例翻译成「只看自己」） */
export interface FleaItemFilters extends Record<string, unknown> {
  keyword?: string
  category?: FleaCategory
  condition?: FleaCondition
  status?: FleaStatus
  sort?: FleaSort
  mine?: boolean
}

/** 卡片/列表直接可读的派生视图 —— UI 不再自己算标签 */
export interface FleaItemSummary {
  id: string
  title: string
  badge: string
  priceLabel: string
  categoryLabel: string
  conditionLabel: string
  statusLabel: string
  status: FleaStatus
  campusSpot: string | null
  timeLabel: string
  preference: string
  descriptionPreview: string
  /** 是否是我发布的（决定卡片上显不显示「我的」标记） */
  mine: boolean
  /** 是否被我预定 */
  reservedByMe: boolean
  sold: boolean
}

export function isFleaCategory(value: unknown): value is FleaCategory {
  return typeof value === 'string' && (FLEA_CATEGORIES as readonly string[]).includes(value)
}

export function isFleaCondition(value: unknown): value is FleaCondition {
  return typeof value === 'string' && (FLEA_CONDITIONS as readonly string[]).includes(value)
}

export function categoryLabel(category: string): string {
  return isFleaCategory(category) ? FLEA_CATEGORY_LABELS[category] : '其它'
}

/**
 * 卡片左侧的视觉锚点文本 —— 用分类标签本身，而不是 emoji/图片。
 *
 * 小程序规范明确禁止「emoji 充当功能图标」；这里给出的是**文字**，
 * 既符合扁平风格，也不引入图片资源体积。
 */
export function categoryBadge(category: string): string {
  return categoryLabel(category)
}

export function conditionLabel(condition: string): string {
  return isFleaCondition(condition) ? FLEA_CONDITION_LABELS[condition] : '成色未知'
}

export function statusLabel(status: string): string {
  return isFleaStatus(status) ? FLEA_STATUS_LABELS[status] : '未知状态'
}

export function isFleaStatus(value: unknown): value is FleaStatus {
  return value === 'on-sale' || value === 'reserved' || value === 'sold'
}

export function summarize(item: FleaItem, viewerId: string | null, now: Date): FleaItemSummary {
  return {
    id: item.id,
    title: item.title,
    badge: categoryBadge(item.category),
    priceLabel: fenToYuan(item.priceFen),
    categoryLabel: categoryLabel(item.category),
    conditionLabel: conditionLabel(item.condition),
    statusLabel: statusLabel(item.status),
    status: isFleaStatus(item.status) ? item.status : 'on-sale',
    campusSpot: item.campusSpot,
    timeLabel: formatRelativeTime(item.createdAt, now),
    preference: `${conditionLabel(item.condition)} · ${categoryLabel(item.category)}`,
    descriptionPreview: (item.description ?? '').slice(0, 60),
    mine: viewerId !== null && item.sellerId === viewerId,
    reservedByMe: viewerId !== null && item.reservedById === viewerId,
    sold: item.status === 'sold',
  }
}

/** 详情页可用的领域动作（按钮只渲染这里有权限的项） */
export type FleaAction = 'reserve' | 'release' | 'sold' | 'edit' | 'delete'

export interface ActionEligibility {
  allowed: boolean
  message: string
}

/**
 * 动作权限判定 —— 纯函数，用例与 UI 共用同一份规则（避免「按钮亮着但请求 403」）。
 * 服务端仍是最终裁决，这里只是**提前**把不该出现的按钮藏掉。
 */
export function availableActions(item: FleaItem, viewerId: string | null): FleaAction[] {
  if (viewerId === null) return []
  const isOwner = item.sellerId === viewerId
  const status = isFleaStatus(item.status) ? item.status : 'on-sale'

  if (isOwner) {
    if (status === 'sold') return ['delete']
    return status === 'reserved' ? ['sold', 'release', 'edit', 'delete'] : ['sold', 'edit', 'delete']
  }

  // 买家：只有在售且不是自己发布的才能预定
  if (status === 'on-sale') return ['reserve']
  if (status === 'reserved' && item.reservedById === viewerId) return []
  return []
}

export function canReserve(item: FleaItem, viewerId: string | null): ActionEligibility {
  if (viewerId === null) {
    return { allowed: false, message: '登录后才能预定' }
  }
  if (item.sellerId === viewerId) {
    return { allowed: false, message: '不能预定自己发布的商品' }
  }
  if (item.status === 'reserved') {
    return { allowed: false, message: '该商品已被预定' }
  }
  if (item.status === 'sold') {
    return { allowed: false, message: '该商品已售出' }
  }
  return { allowed: true, message: '' }
}

/** 展示用的动作文案（详情页按钮） */
export const FLEA_ACTION_LABELS: Readonly<Record<FleaAction, string>> = {
  reserve: '我想要',
  release: '解除预定',
  sold: '标记已售出',
  edit: '编辑',
  delete: '删除',
}
