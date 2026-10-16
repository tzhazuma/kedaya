/**
 * 论坛（`forum`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 对应 `docs/architecture/02-domain-model.md` §2.4。契约要点：
 * - `ForumPost.status` 的状态机（DRAFT/PUBLISHED/LOCKED/HIDDEN/DELETED）只在这里判定，
 *   UI 与用例层共用同一份规则，避免「能不能回复」这类判断在页面里各写一遍。
 * - 契约 §9：`forum` 支持**匿名**身份，与实名身份解耦存储。匿名只是**展示层**隐藏，
 *   治理层（版主）仍可在板块内追溯同一匿名身份 —— 这条必须让用户看到，不能只写在代码里。
 * - 时间一律 ISO-8601 UTC 字符串；长度/敏感词是**前端预校验**，权威判定在后端。
 */

import { containsLikelyPii, formatRelativeTime, isLengthWithin } from '@kedaya/shared'

export type ForumBoardVisibility = 'public' | 'campus_only'

export type ForumPostStatus = 'DRAFT' | 'PUBLISHED' | 'LOCKED' | 'HIDDEN' | 'DELETED'

export type ForumReplyStatus = 'PUBLISHED' | 'HIDDEN' | 'DELETED'

export type ForumReportTargetType = 'POST' | 'REPLY'

/** 与 domain-model §2.4 的 `ForumReport.reason` 完全一致 */
export type ForumReportReason = 'spam' | 'abuse' | 'illegal' | 'privacy' | 'other'

export type ForumReportStatus = 'PENDING' | 'UPHELD' | 'DISMISSED'

export interface ForumBoard {
  id: string
  /** 唯一，`slugify` 生成 */
  slug: string
  name: string
  description?: string
  visibility: ForumBoardVisibility
  /** 冗余计数 */
  postCount: number
}

export interface ForumPost {
  id: string
  boardId: string
  title: string
  body: string
  status: ForumPostStatus
  /** 匿名发帖；为 true 时 `authorId` 是 `AnonymousIdentity.id` */
  anonymous: boolean
  authorId: string
  /** 实名昵称；匿名时 UI 必须用 `displayAuthorName()` 而非本字段 */
  authorName: string
  tags: string[]
  replyCount: number
  likeCount: number
  pinnedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ForumReply {
  id: string
  postId: string
  /** 二级回复的父回复 id；顶层回复为空 */
  parentReplyId?: string
  body: string
  status: ForumReplyStatus
  anonymous: boolean
  authorId: string
  authorName: string
  createdAt: string
}

export interface ForumReport {
  id: string
  targetType: ForumReportTargetType
  targetId: string
  reason: ForumReportReason
  status: ForumReportStatus
  /** 举报人（真实身份，用于「3 个不同用户举报」阈值判定） */
  reporterId: string
  /** 举报是否以匿名身份提交（契约 §9：`reporterId 可匿名`） */
  anonymous: boolean
  createdAt: string
}

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

/** 匿名身份的展示名 —— 全端统一，禁止各处自行拼字符串 */
export const ANONYMOUS_DISPLAY_NAME = '匿名同学'

export const FORUM_TITLE_MIN_LENGTH = 1
export const FORUM_TITLE_MAX_LENGTH = 100
export const FORUM_BODY_MAX_LENGTH = 20_000
export const FORUM_REPLY_MIN_LENGTH = 1
export const FORUM_REPLY_MAX_LENGTH = 5_000
export const FORUM_MAX_TAGS = 5
export const FORUM_TAG_MAX_LENGTH = 16

/** 治理规则：3 个不同用户举报 → 自动 HIDDEN + 进人工队列（domain-model §2.4） */
export const FORUM_REPORT_HIDE_THRESHOLD = 3

/**
 * 匿名发帖的隐私说明 —— 契约 §9 要求「匿名可用」，但 domain-model §2.4 同时规定
 * 「同一 AnonymousIdentity 在板块内可被版主追溯，对普通用户不可见」。
 * 用户必须在发帖前看到这两句，否则是误导性的隐私承诺。
 */
export const FORUM_ANONYMITY_NOTICE =
  '匿名发布后，其他同学看不到你的昵称与学号。但为配合社区治理，版主可在本板块内追溯同一匿名身份。'

export const FORUM_ANONYMITY_NOTICE_SHORT = '匿名仅对普通同学隐藏身份，版主可追溯。'

export const FORUM_POST_STATUS_LABELS: Readonly<Record<ForumPostStatus, string>> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  LOCKED: '已锁定',
  HIDDEN: '已隐藏',
  DELETED: '已删除',
}

export const FORUM_REPLY_STATUS_LABELS: Readonly<Record<ForumReplyStatus, string>> = {
  PUBLISHED: '已发布',
  HIDDEN: '已隐藏',
  DELETED: '已删除',
}

export const FORUM_REPORT_REASON_LABELS: Readonly<Record<ForumReportReason, string>> = {
  spam: '垃圾广告',
  abuse: '辱骂攻击',
  illegal: '违法违规',
  privacy: '泄露隐私',
  other: '其它',
}

export const FORUM_REPORT_STATUS_LABELS: Readonly<Record<ForumReportStatus, string>> = {
  PENDING: '待处理',
  UPHELD: '已受理',
  DISMISSED: '已驳回',
}

export const FORUM_BOARD_VISIBILITY_LABELS: Readonly<Record<ForumBoardVisibility, string>> = {
  public: '公开',
  campus_only: '仅校内',
}

export const FORUM_REPORT_REASONS: readonly ForumReportReason[] = [
  'spam',
  'abuse',
  'illegal',
  'privacy',
  'other',
]

/**
 * 本地敏感词预校验表 —— **骨架占位**。
 *
 * domain-model §2.4：「敏感词命中即拦截并返回 `VALIDATION_FAILED`，不静默改写」。
 * 权威词表在后端；这里只为了让用户在点「发布」之前就得到即时反馈。
 * 前端**只拦截、不改写**，与后端语义保持一致。
 */
export const FORUM_LOCAL_BLOCKED_KEYWORDS: readonly string[] = [
  '代考',
  '代写论文',
  '枪手代做',
  '网络赌博',
  '博彩平台',
  '出售违禁品',
  '办假证',
]

/* ------------------------------------------------------------------ *
 * 纯函数
 * ------------------------------------------------------------------ */

export function postStatusLabel(status: ForumPostStatus): string {
  return FORUM_POST_STATUS_LABELS[status]
}

export function replyStatusLabel(status: ForumReplyStatus): string {
  return FORUM_REPLY_STATUS_LABELS[status]
}

export function reportReasonLabel(reason: ForumReportReason): string {
  return FORUM_REPORT_REASON_LABELS[reason]
}

export function boardVisibilityLabel(visibility: ForumBoardVisibility): string {
  return FORUM_BOARD_VISIBILITY_LABELS[visibility]
}

/** 匿名时一律返回统一展示名，避免调用方泄漏实名（契约 §9） */
export function displayAuthorName(anonymous: boolean, authorName: string): string {
  return anonymous ? ANONYMOUS_DISPLAY_NAME : authorName
}

/**
 * 主题是否对普通用户可见（HIDDEN / DELETED 不可见，DRAFT 只有作者可见）。
 * 详情页据此决定是否渲染正文。
 */
export function isPostVisible(post: ForumPost): boolean {
  return post.status === 'PUBLISHED' || post.status === 'LOCKED'
}

/** 主题是否可被举报：只有可见的主题才谈得上举报 */
export function canReportPost(post: ForumPost): boolean {
  return isPostVisible(post)
}

export function canReportReply(reply: ForumReply): boolean {
  return reply.status === 'PUBLISHED'
}

/** 回复资格判定结果 —— 判别联合，UI 可直接 switch（与 groupbuy 的 `JoinEligibility` 同构） */
export type ReplyEligibility =
  | { allowed: true }
  | {
      allowed: false
      reason: 'locked' | 'hidden' | 'deleted' | 'not-published'
      message: string
    }

/**
 * 能否回复某主题 —— domain-model §2.4 状态机的唯一落点。
 *
 * `LOCKED`：版主锁定，禁止**新回复**（已有回复仍可见）；
 * `HIDDEN`：被举报且审核通过；`DELETED`：作者/管理员删除；`DRAFT`：尚未发布。
 */
export function canReply(post: ForumPost): ReplyEligibility {
  switch (post.status) {
    case 'PUBLISHED':
      return { allowed: true }
    case 'LOCKED':
      return { allowed: false, reason: 'locked', message: '该主题已被版主锁定，无法回复' }
    case 'HIDDEN':
      return { allowed: false, reason: 'hidden', message: '该主题因举报被隐藏，无法回复' }
    case 'DELETED':
      return { allowed: false, reason: 'deleted', message: '该主题已被删除' }
    case 'DRAFT':
      return { allowed: false, reason: 'not-published', message: '该主题尚未发布' }
  }
}

/** 列表卡片用的派生摘要 —— UI 只读这个，不在组件里重复计算 */
export interface ForumPostSummary {
  id: string
  boardId: string
  title: string
  /** 正文摘要（去换行，截断） */
  excerpt: string
  status: ForumPostStatus
  statusLabel: string
  authorName: string
  anonymous: boolean
  tags: string[]
  replyCount: number
  likeCount: number
  pinned: boolean
  createdAtLabel: string
  visible: boolean
  commentable: boolean
}

export interface ForumBoardSummary {
  id: string
  slug: string
  name: string
  description: string
  visibility: ForumBoardVisibility
  visibilityLabel: string
  postCount: number
  campusOnly: boolean
}

export const FORUM_EXCERPT_MAX_LENGTH = 60

/** 正文摘要：压平换行 + 截断（纯函数，便于测试） */
export function excerptOf(body: string, maxLength = FORUM_EXCERPT_MAX_LENGTH): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  if (flat.length <= maxLength) return flat
  return `${flat.slice(0, maxLength)}…`
}

export function summarizePost(post: ForumPost, now: Date = new Date()): ForumPostSummary {
  return {
    id: post.id,
    boardId: post.boardId,
    title: post.title,
    excerpt: excerptOf(post.body),
    status: post.status,
    statusLabel: postStatusLabel(post.status),
    authorName: displayAuthorName(post.anonymous, post.authorName),
    anonymous: post.anonymous,
    tags: [...post.tags],
    replyCount: post.replyCount,
    likeCount: post.likeCount,
    pinned: post.pinnedAt !== undefined,
    createdAtLabel: formatRelativeTime(post.createdAt, now),
    visible: isPostVisible(post),
    commentable: canReply(post).allowed,
  }
}

export function summarizeBoard(board: ForumBoard): ForumBoardSummary {
  return {
    id: board.id,
    slug: board.slug,
    name: board.name,
    description: board.description ?? '',
    visibility: board.visibility,
    visibilityLabel: boardVisibilityLabel(board.visibility),
    postCount: board.postCount,
    campusOnly: board.visibility === 'campus_only',
  }
}

/* ------------------------------------------------------------------ *
 * 草稿校验（前端预校验，权威判定在后端）
 * ------------------------------------------------------------------ */

export interface DraftFieldError {
  field: string
  message: string
}

export interface PostDraft {
  boardId: string
  title: string
  body: string
  tags?: readonly string[]
}

export interface NormalizedPostDraft {
  boardId: string
  title: string
  body: string
  tags: string[]
}

export type DraftValidation<T> =
  | { valid: true; value: T; warnings: string[] }
  | { valid: false; errors: DraftFieldError[]; warnings: string[] }

/** 命中本地敏感词（只做包含匹配；权威词表在后端） */
export function containsBlockedKeyword(text: string): boolean {
  const needle = text.toLowerCase()
  return FORUM_LOCAL_BLOCKED_KEYWORDS.some((keyword) => needle.includes(keyword.toLowerCase()))
}

/** 规范化标签：去空白、去空项、去重，保持首次出现顺序 */
export function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (tags === undefined) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of tags) {
    const tag = raw.trim()
    if (tag === '' || seen.has(tag)) continue
    seen.add(tag)
    result.push(tag)
  }
  return result
}

/** 校验并规范化发帖草稿（长度 + 标签数量 + 敏感词 + PII 提示） */
export function validatePostDraft(draft: PostDraft): DraftValidation<NormalizedPostDraft> {
  const errors: DraftFieldError[] = []
  const warnings: string[] = []

  const title = draft.title.trim()
  const body = draft.body.trim()
  const tags = normalizeTags(draft.tags)

  if (draft.boardId.trim() === '') {
    errors.push({ field: 'boardId', message: '请选择版块' })
  }
  if (!isLengthWithin(title, FORUM_TITLE_MIN_LENGTH, FORUM_TITLE_MAX_LENGTH)) {
    errors.push({
      field: 'title',
      message: `标题需为 ${FORUM_TITLE_MIN_LENGTH}–${FORUM_TITLE_MAX_LENGTH} 字`,
    })
  }
  if (body === '') {
    errors.push({ field: 'body', message: '正文不能为空' })
  } else if ([...body].length > FORUM_BODY_MAX_LENGTH) {
    errors.push({ field: 'body', message: `正文不能超过 ${FORUM_BODY_MAX_LENGTH} 字` })
  }
  if (tags.length > FORUM_MAX_TAGS) {
    errors.push({ field: 'tags', message: `标签最多 ${FORUM_MAX_TAGS} 个` })
  }
  if (tags.some((tag) => [...tag].length > FORUM_TAG_MAX_LENGTH)) {
    errors.push({ field: 'tags', message: `单个标签不能超过 ${FORUM_TAG_MAX_LENGTH} 字` })
  }

  // 敏感词：命中即拦截，**不静默改写**（domain-model §2.4）
  if (containsBlockedKeyword(`${title}\n${body}`)) {
    errors.push({ field: 'body', message: '内容命中敏感词，已被拦截（不会自动改写）' })
  }

  // PII 只提示不拦截：同学可能确实需要留下联系方式，但平台有义务提醒
  if (containsLikelyPii(`${title}\n${body}`)) {
    warnings.push('内容里似乎包含手机号 / 学号 / 邮箱，发帖是公开的，请注意隐私')
  }

  if (errors.length > 0) return { valid: false, errors, warnings }
  return { valid: true, value: { boardId: draft.boardId.trim(), title, body, tags }, warnings }
}

export function validateReplyDraft(body: string): DraftValidation<string> {
  const errors: DraftFieldError[] = []
  const warnings: string[] = []
  const trimmed = body.trim()

  if (trimmed === '') {
    errors.push({ field: 'body', message: '回复内容不能为空' })
  } else if ([...trimmed].length > FORUM_REPLY_MAX_LENGTH) {
    errors.push({ field: 'body', message: `回复不能超过 ${FORUM_REPLY_MAX_LENGTH} 字` })
  }
  if (containsBlockedKeyword(trimmed)) {
    errors.push({ field: 'body', message: '内容命中敏感词，已被拦截（不会自动改写）' })
  }
  if (containsLikelyPii(trimmed)) {
    warnings.push('回复里似乎包含手机号 / 学号 / 邮箱，请注意隐私')
  }

  if (errors.length > 0) return { valid: false, errors, warnings }
  return { valid: true, value: trimmed, warnings }
}

/* ------------------------------------------------------------------ *
 * 回复树（一级楼中楼）
 * ------------------------------------------------------------------ */

export interface ForumReplyThread {
  root: ForumReply
  children: ForumReply[]
}

/**
 * 把扁平回复列表组装成「一级楼中楼」。
 *
 * 刻意只支持**一级**：domain-model §2.4 的 `parentReplyId` 没有层级深度语义，
 * 无限嵌套在手机屏幕上不可读，也容易让治理变复杂。
 * 父回复不存在（被删除/不在当前页）的回复退化为顶层，不丢数据。
 */
export function buildReplyThreads(replies: readonly ForumReply[]): ForumReplyThread[] {
  const byId = new Map(replies.map((reply) => [reply.id, reply]))

  /**
   * 找到一条回复所属的**顶层**回复 id。
   *
   * 必须沿 `parentReplyId` 向上走，而不是假设「父回复一定先出现」：
   * 分页、局部刷新、后端乱序都会打破那个假设，而重复建根会让同一条回复出现两次。
   * 带环保护（数据异常时退化为自身为根，绝不无限循环）。
   */
  function effectiveRootId(reply: ForumReply): string {
    let current = reply
    const seen = new Set<string>([reply.id])
    for (;;) {
      const parentId = current.parentReplyId
      if (parentId === undefined) return current.id
      const parent = byId.get(parentId)
      if (parent === undefined) return current.id
      if (seen.has(parent.id)) return reply.id
      seen.add(parent.id)
      current = parent
    }
  }

  const threads: ForumReplyThread[] = []
  const index = new Map<string, ForumReplyThread>()

  for (const reply of replies) {
    const rootId = effectiveRootId(reply)
    const root = byId.get(rootId) ?? reply
    let thread = index.get(rootId)
    if (thread === undefined) {
      thread = { root, children: [] }
      index.set(rootId, thread)
      threads.push(thread)
    }
    if (reply.id !== root.id) thread.children.push(reply)
  }

  const byCreatedAt = (a: ForumReply, b: ForumReply): number => a.createdAt.localeCompare(b.createdAt)
  for (const thread of threads) thread.children.sort(byCreatedAt)
  return threads.sort((a, b) => byCreatedAt(a.root, b.root))
}

/** 待展示的回复：过滤掉 HIDDEN / DELETED（治理状态不进 UI） */
export function visibleReplies(replies: readonly ForumReply[]): ForumReply[] {
  return replies.filter((reply) => reply.status === 'PUBLISHED')
}
