import { formatRelativeTime } from '@kedaya/shared'

import type { Page } from '@kedaya/contracts'

import { imageSummary } from './media'

/**
 * 论坛（`forum`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 与后端 `services/api/src/modules/forum/domain/forum.domain.ts`
 * 及 `forum.service.ts` 逐条对齐：
 *   · **版块是白名单** `FORUM_BOARDS`，客户端版块导航直接用它渲染；
 *   · 帖子 / 回复都可匿名：匿名时 `authorId` 存 null，改用 `anonHandle`；
 *   · 匿名帖**不保存作者身份**，因此作者无法自证 —— 关闭 / 删除一律拒绝；
 *   · 帖子状态 `published → closed`（closed 只是停止回复，不是删除）；
 *   · 列表排序 `latest`（最新）/ `hot`（回复多且新），后者与后端 orderBy 同序。
 *
 * 展示层只读这里导出的派生函数，不再自己判断匿名 / 状态，避免规则漂移。
 */

/** 版块白名单（对外契约的一部分） */
export const FORUM_BOARDS = [
  'campus',
  'study',
  'life',
  'trade',
  'lost',
  'help',
  'treehole',
] as const
export type ForumBoard = (typeof FORUM_BOARDS)[number]

export const FORUM_BOARD_LABELS: Readonly<Record<ForumBoard, string>> = {
  campus: '校园',
  study: '学习',
  life: '生活',
  trade: '交易',
  lost: '失物',
  help: '互助',
  treehole: '树洞',
}

/** 帖子状态：published（可回复）→ closed（停止回复）；closed 不是删除 */
export const FORUM_STATUS = {
  published: 'published',
  closed: 'closed',
} as const
export type ForumStatus = (typeof FORUM_STATUS)[keyof typeof FORUM_STATUS]

export const FORUM_STATUSES = [FORUM_STATUS.published, FORUM_STATUS.closed] as const

/** 排序方式：latest（最新）/ hot（回复数 + 最近回复） */
export const FORUM_SORTS = ['latest', 'hot'] as const
export type ForumSort = (typeof FORUM_SORTS)[number]

/** 详情页单页最多返回的回复数（后端对回复做了轻量分页） */
export const FORUM_REPLIES_PAGE_SIZE = 50
/** 详情页默认返回的回复数 */
export const FORUM_REPLIES_DEFAULT_PAGE_SIZE = 20

/* 文本上限（与后端 Zod schema / normalize* 完全一致） */
export const FORUM_TITLE_MAX = 80
export const FORUM_BODY_MAX = 5000
export const FORUM_REPLY_MAX = 2000

export const FORUM_SORT_LABELS: Readonly<Record<ForumSort, string>> = {
  latest: '最新发布',
  hot: '热门讨论',
}

export const FORUM_STATUS_LABELS: Readonly<Record<ForumStatus, string>> = {
  published: '讨论中',
  closed: '已关闭',
}

/** 卡片左侧的文字徽标（小程序规范禁止 emoji 充当功能图标，因此只用文字） */
export const FORUM_BOARD_BADGES: Readonly<Record<ForumBoard, string>> = {
  campus: '校园',
  study: '学习',
  life: '生活',
  trade: '交易',
  lost: '失物',
  help: '互助',
  treehole: '树洞',
}

/** 匿名帖 / 匿名回复在列表里的统一称呼（无 handle 时的兜底） */
export const FORUM_ANONYMOUS_LABEL = '匿名同学'

export interface ForumPost {
  id: string
  board: string
  /** 实名作者；匿名帖为 null */
  authorId: string | null
  /** 匿名 handle；实名帖为 null */
  anonHandle: string | null
  title: string
  body: string
  /** 图片地址（只可能是本平台上传的地址；上传时已剥离 EXIF GPS） */
  imageUrls: string[]
  status: string
  /** 置顶/加精等治理位（0 = 普通） */
  pinnedRank: number
  replyCount: number
  lastReplyAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ForumReply {
  id: string
  postId: string
  authorId: string | null
  anonHandle: string | null
  body: string
  status: string
  createdAt: string
}

/** 详情 = 帖子 + 一页回复（契约 §4：`GET posts/:id` 返回 replies） */
export interface ForumPostDetail {
  post: ForumPost
  replies: Page<ForumReply>
}

/** 版块 + 该版块帖子数（`GET /forum/boards`） */
export interface ForumBoardStat {
  board: string
  postCount: number
}

export interface CreateForumPostInput {
  board: string
  title: string
  body: string
  /** 匿名发帖：`authorId` 不落库，改用服务端派生的匿名 handle */
  anonymous?: boolean
  /** 已上传成功的图片地址（见 `useImageAttachments`） */
  imageUrls?: string[]
}

export interface CreateForumReplyInput {
  body: string
  anonymous?: boolean
}

/** 列表筛选条件（`mine=1` 由用例翻译成「只看自己发的实名帖」） */
export interface ForumPostFilters extends Record<string, unknown> {
  keyword?: string
  board?: ForumBoard
  /** 默认只查 published；关闭的主题要显式带 status 才看得到（与后端一致） */
  status?: ForumStatus
  sort?: ForumSort
  mine?: boolean
}

/** 卡片/列表直接可读的派生视图 —— UI 不再自己算标签 */
export interface ForumPostSummary {
  id: string
  title: string
  badge: string
  boardLabel: string
  statusLabel: string
  status: ForumStatus
  authorLabel: string
  anonymous: boolean
  mine: boolean
  pinned: boolean
  replyCount: number
  replyCountLabel: string
  bodyPreview: string
  createdLabel: string
  lastReplyLabel: string | null
  /** 列表缩略图（第一张；没有图时为 null） */
  thumbnailUrl: string | null
  imageCount: number
}

export interface ForumReplyView {
  id: string
  body: string
  authorLabel: string
  anonymous: boolean
  mine: boolean
  timeLabel: string
}

export function isForumBoard(value: unknown): value is ForumBoard {
  return typeof value === 'string' && (FORUM_BOARDS as readonly string[]).includes(value)
}

export function isForumStatus(value: unknown): value is ForumStatus {
  return value === FORUM_STATUS.published || value === FORUM_STATUS.closed
}

export function isForumSort(value: unknown): value is ForumSort {
  return typeof value === 'string' && (FORUM_SORTS as readonly string[]).includes(value)
}

export function boardLabel(board: string): string {
  return isForumBoard(board) ? FORUM_BOARD_LABELS[board] : '其它版块'
}

export function boardBadge(board: string): string {
  return isForumBoard(board) ? FORUM_BOARD_BADGES[board] : '版块'
}

export function statusLabel(status: string): string {
  return isForumStatus(status) ? FORUM_STATUS_LABELS[status] : '未知状态'
}

/**
 * 作者展示名。
 *
 * 匿名内容永远只暴露 `anonHandle`（由服务端从 id + 主体派生，不含实名信息），
 * 实名内容在别人的浏览器里只能显示「实名同学」——后端不返回昵称，
 * 客户端也不该假装知道。
 */
export function authorLabel(
  authorId: string | null,
  anonHandle: string | null,
  viewerId: string | null,
): string {
  if (authorId === null) return anonHandle ?? FORUM_ANONYMOUS_LABEL
  return viewerId !== null && viewerId === authorId ? '我' : '实名同学'
}

export function summarizePost(
  post: ForumPost,
  viewerId: string | null,
  now: Date,
): ForumPostSummary {
  const anonymous = post.authorId === null
  const images = imageSummary(post.imageUrls)
  return {
    id: post.id,
    title: post.title,
    badge: boardBadge(post.board),
    boardLabel: boardLabel(post.board),
    statusLabel: statusLabel(post.status),
    status: isForumStatus(post.status) ? post.status : FORUM_STATUS.published,
    authorLabel: authorLabel(post.authorId, post.anonHandle, viewerId),
    anonymous,
    mine: viewerId !== null && post.authorId === viewerId,
    pinned: post.pinnedRank > 0,
    replyCount: post.replyCount,
    replyCountLabel: post.replyCount === 0 ? '还没有回复' : `${post.replyCount} 条回复`,
    bodyPreview: post.body.slice(0, 60),
    createdLabel: formatRelativeTime(post.createdAt, now),
    lastReplyLabel:
      post.lastReplyAt === null ? null : `最后回复 ${formatRelativeTime(post.lastReplyAt, now)}`,
    thumbnailUrl: images.thumbnailUrl,
    imageCount: images.imageCount,
  }
}

export function summarizeReply(
  reply: ForumReply,
  viewerId: string | null,
  now: Date,
): ForumReplyView {
  return {
    id: reply.id,
    body: reply.body,
    authorLabel: authorLabel(reply.authorId, reply.anonHandle, viewerId),
    anonymous: reply.authorId === null,
    mine: viewerId !== null && reply.authorId === viewerId,
    timeLabel: formatRelativeTime(reply.createdAt, now),
  }
}

/**
 * 版块统计归一化：按**契约顺序**补齐没有帖子的版块（补 0），
 * 并丢掉后端将来可能多返回的未知版块 —— 与 `ForumPostService.boards()` 同语义。
 */
export function normalizeBoardStats(stats: readonly ForumBoardStat[]): ForumBoardStat[] {
  const counts = new Map(stats.map((row) => [row.board, Math.max(0, Math.floor(row.postCount))]))
  return FORUM_BOARDS.map((board) => ({ board, postCount: counts.get(board) ?? 0 }))
}

/* ------------------------------------------------------------------ *
 * 校验（纯函数，用例、mock 仓储与页面共用同一份文案）
 * ------------------------------------------------------------------ */

export function boardProblem(board: string): string | null {
  return isForumBoard(board) ? null : '版块不在支持范围内'
}

export function titleProblem(title: string): string | null {
  const text = title.trim()
  if (text.length === 0) return '请填写标题'
  if ([...text].length > FORUM_TITLE_MAX) return `标题最多 ${FORUM_TITLE_MAX} 个字`
  return null
}

export function bodyProblem(body: string): string | null {
  const text = body.trim()
  if (text.length === 0) return '请填写正文'
  if ([...text].length > FORUM_BODY_MAX) return `正文最多 ${FORUM_BODY_MAX} 个字`
  return null
}

export function replyProblem(body: string): string | null {
  const text = body.trim()
  if (text.length === 0) return '请填写回复内容'
  if ([...text].length > FORUM_REPLY_MAX) return `回复内容最多 ${FORUM_REPLY_MAX} 个字`
  return null
}

/* ------------------------------------------------------------------ *
 * 动作闸门（服务端仍是最终裁决，这里只是提前把不该出现的按钮藏掉）
 * ------------------------------------------------------------------ */

/** 详情页可用的领域动作 */
export type ForumPostAction = 'reply' | 'close' | 'delete'

export const FORUM_ACTION_LABELS: Readonly<Record<ForumPostAction, string>> = {
  reply: '回复',
  close: '关闭主题',
  delete: '删除主题',
}

export interface ActionEligibility {
  allowed: boolean
  message: string
}

/**
 * 动作权限判定 —— 纯函数，用例与 UI 共用同一份规则。
 *
 * 与后端 `ForumPostService` 一致：
 *   · 回复：登录用户都能回复，但只限 `published`；
 *   · 关闭：仅**实名**作者，且只对 `published` 有效（已关闭再关是 CONFLICT）；
 *   · 删除：仅**实名**作者，与状态无关；
 *   · 匿名帖的作者身份不可辨 ⇒ 任何人都不能关闭 / 删除它（含原发布者）。
 */
export function availableActions(post: ForumPost, viewerId: string | null): ForumPostAction[] {
  if (viewerId === null) return []

  const actions: ForumPostAction[] = []
  if (post.status === FORUM_STATUS.published) actions.push('reply')

  if (post.authorId !== null && post.authorId === viewerId) {
    if (post.status === FORUM_STATUS.published) actions.push('close')
    actions.push('delete')
  }
  return actions
}

export function canReply(post: ForumPost, viewerId: string | null): ActionEligibility {
  if (viewerId === null) return { allowed: false, message: '登录后才能回复' }
  if (post.status !== FORUM_STATUS.published) {
    return { allowed: false, message: '该主题已关闭，无法回复' }
  }
  return { allowed: true, message: '' }
}

export function canClose(post: ForumPost, viewerId: string | null): ActionEligibility {
  if (viewerId === null) return { allowed: false, message: '登录后才能关闭主题' }
  if (post.authorId === null) {
    return { allowed: false, message: '匿名主题不保存作者身份，出于隐私保护无法关闭' }
  }
  if (post.authorId !== viewerId) return { allowed: false, message: '只能关闭自己发布的内容' }
  if (post.status !== FORUM_STATUS.published) {
    return { allowed: false, message: '该主题已经关闭' }
  }
  return { allowed: true, message: '' }
}

export function canRemove(post: ForumPost, viewerId: string | null): ActionEligibility {
  if (viewerId === null) return { allowed: false, message: '登录后才能删除主题' }
  if (post.authorId === null) {
    return { allowed: false, message: '匿名主题不保存作者身份，出于隐私保护无法删除' }
  }
  if (post.authorId !== viewerId) return { allowed: false, message: '只能删除自己发布的内容' }
  return { allowed: true, message: '' }
}

/**
 * 匿名 handle 的本地派生 —— **仅 mock 使用**。
 *
 * 后端用 `anonymousHandle(seed) = '鸭友' + sha256(seed).slice(0, 6)`，
 * 小程序运行时没有 crypto，因此这里用 FNV-1a 得到确定性的 6 位大写串。
 * 两者都满足「不含实名信息、同一 id + 主体稳定可复现」这一展示层要求；
 * 真实鉴权与去匿名化风险只由后端承担（客户端本来也拿不到 userId）。
 */
export function deriveAnonHandle(seed: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  const suffix = hash.toString(36).toUpperCase().padStart(6, '0')
  return `鸭友${suffix.slice(-6)}`
}
