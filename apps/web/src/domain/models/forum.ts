/**
 * 论坛（forum）领域模型 —— 纯逻辑，零框架、零 IO（契约 §7）。
 *
 * 字段与状态机对齐 `docs/architecture/02-domain-model.md` §2.4：
 * - `ForumPost.status` ∈ DRAFT | PUBLISHED | LOCKED | HIDDEN | DELETED（状态机见该节 mermaid）
 * - 治理：3 个**不同**用户举报 → 自动 HIDDEN 并进人工队列；发帖/回复有频率上限
 * - 匿名：`anonymous = true` 时 `authorId` 是 `AnonymousIdentity.id`，与实名身份解耦存储；
 *   同一匿名身份在同一版块内**可被版主追溯**，对普通用户不可见（契约 §9）
 * - 时间一律 ISO-8601 UTC 字符串；本层不做本地化（那是 application 层的事）
 *
 * ⚠️ 本文件不得 import 任何框架 / IO。
 */
import { containsLikelyPii, isLengthWithin } from '@kedaya/shared';

/* ------------------------------------------------------------------ *
 * 基础类型
 * ------------------------------------------------------------------ */

export type ForumBoardVisibility = 'public' | 'campus_only';

export interface ForumBoard {
  id: string;
  /** 唯一，由 `slugify` 生成（契约 §2.4） */
  slug: string;
  /** 1–30 字 */
  name: string;
  /** ≤200 字 */
  description?: string;
  visibility: ForumBoardVisibility;
  /** 冗余计数 */
  postCount: number;
  /** 最近活跃时间（ISO-8601 UTC），无主题时为 null */
  lastPostAt: string | null;
}

export type ForumPostStatus = 'DRAFT' | 'PUBLISHED' | 'LOCKED' | 'HIDDEN' | 'DELETED';

export interface ForumPost {
  id: string;
  boardId: string;
  /** 1–100 字 */
  title: string;
  /** ≤20000 字，Markdown 子集 */
  body: string;
  status: ForumPostStatus;
  /** 默认 false */
  anonymous: boolean;
  /** 匿名时为 `AnonymousIdentity.id` */
  authorId: string;
  /** 展示用昵称；匿名条目固定为 `匿名同学`（由 `resolveAuthorLabel` 决定） */
  authorNickname: string;
  /** ≤5 个，每个 ≤16 字 */
  tags: string[];
  replyCount: number;
  likeCount: number;
  /** 置顶时间，null 表示未置顶 */
  pinnedAt: string | null;
  createdAt: string;
  lastActivityAt: string;
}

export type ForumReplyStatus = 'PUBLISHED' | 'HIDDEN' | 'DELETED';

export interface ForumReply {
  id: string;
  postId: string;
  /** 二级回复 */
  parentReplyId: string | null;
  /** ≤5000 字 */
  body: string;
  status: ForumReplyStatus;
  anonymous: boolean;
  authorId: string;
  authorNickname: string;
  likeCount: number;
  createdAt: string;
}

export type ForumReportTargetType = 'POST' | 'REPLY';

export type ForumReportReason = 'spam' | 'abuse' | 'illegal' | 'privacy' | 'other';

export type ForumReportStatus = 'PENDING' | 'UPHELD' | 'DISMISSED';

export interface ForumReport {
  id: string;
  targetType: ForumReportTargetType;
  targetId: string;
  reason: ForumReportReason;
  status: ForumReportStatus;
  /** 举报人（可匿名） */
  reporterId: string;
  anonymous: boolean;
  note?: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * 文案表（UI 不得自己写死中文，避免同一状态两套说法）
 * ------------------------------------------------------------------ */

export const FORUM_POST_STATUS_LABELS: Record<ForumPostStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  LOCKED: '已锁定',
  HIDDEN: '已隐藏',
  DELETED: '已删除',
};

export const FORUM_REPLY_STATUS_LABELS: Record<ForumReplyStatus, string> = {
  PUBLISHED: '已发布',
  HIDDEN: '已隐藏',
  DELETED: '已删除',
};

export const FORUM_BOARD_VISIBILITY_LABELS: Record<ForumBoardVisibility, string> = {
  public: '公开',
  campus_only: '校内可见',
};

export const FORUM_REPORT_REASON_LABELS: Record<ForumReportReason, string> = {
  spam: '垃圾广告',
  abuse: '人身攻击 / 辱骂',
  illegal: '违法违规',
  privacy: '泄露隐私',
  other: '其他',
};

export const FORUM_REPORT_TARGET_LABELS: Record<ForumReportTargetType, string> = {
  POST: '主题',
  REPLY: '回复',
};

export const FORUM_REPORT_STATUS_LABELS: Record<ForumReportStatus, string> = {
  PENDING: '待人工复核',
  UPHELD: '举报成立',
  DISMISSED: '举报不成立',
};

/** 匿名条目的展示昵称（绝不回退到实名昵称） */
export const ANONYMOUS_AUTHOR_LABEL = '匿名同学';

/**
 * 匿名开关的**唯一文案**（发帖页 / 回复框共用）。
 *
 * 必须同时说清两件事，否则是误导用户：
 * 1. 实名身份不会与帖子关联（契约 §9「匿名可用」）；
 * 2. 同一匿名身份在版块内可被版主追溯（域模型 §2.4 治理规则）。
 */
export const ANONYMITY_NOTICE =
  '匿名后你的实名身份不会与帖子关联：帖子只记录一个匿名身份，普通用户看不到你的姓名、学号与院系。' +
  '注意：为处理违规内容，同一匿名身份在同一版块内可被版主追溯，该信息不对普通用户公开。';

export const ANONYMITY_TOGGLE_LABEL = '匿名发布';

/* ------------------------------------------------------------------ *
 * 治理阈值与频率上限（域模型 §2.4）
 * ------------------------------------------------------------------ */

/** 3 个不同用户举报 → 自动隐藏 */
export const REPORT_AUTO_HIDE_THRESHOLD = 3;

export interface RateLimitRule {
  /** 时间窗（毫秒） */
  windowMs: number;
  /** 窗口内允许的最大次数 */
  max: number;
  label: string;
}

export const POST_RATE_LIMIT: RateLimitRule = {
  windowMs: 10 * 60_000,
  max: 3,
  label: '10 分钟内最多发 3 帖',
};

export const POST_DAILY_LIMIT: RateLimitRule = {
  windowMs: 24 * 60 * 60_000,
  max: 20,
  label: '24 小时内最多发 20 帖',
};

export const REPLY_RATE_LIMIT: RateLimitRule = {
  windowMs: 60_000,
  max: 5,
  label: '1 分钟内最多回复 5 次',
};

/** 内容长度上限（契约 §2.4） */
export const FORUM_LIMITS = {
  boardNameMax: 30,
  boardDescriptionMax: 200,
  postTitleMin: 1,
  postTitleMax: 100,
  postBodyMax: 20_000,
  replyBodyMax: 5_000,
  tagMax: 16,
  tagCountMax: 5,
} as const;

/**
 * 敏感词表 —— 命中即**拦截**并返回 `VALIDATION_FAILED`，**不静默改写**（域模型 §2.4）。
 * 这里是演示用最小集合；真实词库由后端配置下发。
 */
export const DEFAULT_SENSITIVE_WORDS: readonly string[] = [
  '代写作业',
  '代考',
  '刷单',
  '博彩',
  '赌球',
  '枪支',
  '毒品',
  '办证',
];

/* ------------------------------------------------------------------ *
 * 状态可见性 / 治理：被隐藏的主题必须**显式**展示状态，不得静默消失
 * ------------------------------------------------------------------ */

export interface PostVisibility {
  /** 是否出现在列表里（HIDDEN/LOCKED 仍要在列表里出现，只是带明确状态） */
  listable: boolean;
  /** 内容正文是否对普通用户可见 */
  contentVisible: boolean;
  /** 是否还能回复 */
  replyable: boolean;
  /** 列表 / 详情上必须展示的治理说明；无治理动作时为 null */
  notice: string | null;
  /** 徽章语义色名（具体色值由 design-tokens 决定，domain 不写色值） */
  tone: 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';
}

const POST_VISIBILITY: Record<ForumPostStatus, PostVisibility> = {
  DRAFT: {
    listable: false,
    contentVisible: false,
    replyable: false,
    notice: '草稿仅你自己可见，发布后其他同学才能看到。',
    tone: 'neutral',
  },
  PUBLISHED: {
    listable: true,
    contentVisible: true,
    replyable: true,
    notice: null,
    tone: 'success',
  },
  LOCKED: {
    listable: true,
    contentVisible: true,
    replyable: false,
    notice: '版主已锁定该主题：内容仍可阅读，但不再接受新回复。',
    tone: 'warning',
  },
  HIDDEN: {
    listable: true,
    contentVisible: false,
    replyable: false,
    notice:
      '该主题因举报被隐藏，正在人工复核：内容暂时不可见，也不会静默消失。作者可在「我的」里查看处理进度并申诉。',
    tone: 'danger',
  },
  DELETED: {
    listable: false,
    contentVisible: false,
    replyable: false,
    notice: '该主题已被删除。',
    tone: 'neutral',
  },
};

export function postVisibility(status: ForumPostStatus): PostVisibility {
  return POST_VISIBILITY[status];
}

/** 主题是否出现在列表里（DELETED / DRAFT 不出现） */
export function isPostListable(post: Pick<ForumPost, 'status'>): boolean {
  return POST_VISIBILITY[post.status].listable;
}

/** 正文是否对普通用户可见 */
export function isPostContentVisible(post: Pick<ForumPost, 'status'>): boolean {
  return POST_VISIBILITY[post.status].contentVisible;
}

/** 是否还能回复：只有 PUBLISHED 可以（LOCKED 明确禁止） */
export function canReplyToPost(post: Pick<ForumPost, 'status'>): boolean {
  return POST_VISIBILITY[post.status].replyable;
}

/** 不能回复时的原因文案；可以回复时返回 null */
export function replyBlockedReason(post: Pick<ForumPost, 'status'>): string | null {
  if (canReplyToPost(post)) return null;
  return POST_VISIBILITY[post.status].notice ?? '该主题当前不接受回复。';
}

/* ------------------------------------------------------------------ *
 * 状态机（严格对齐域模型 §2.4 的 mermaid）
 * ------------------------------------------------------------------ */

const POST_TRANSITIONS: Record<ForumPostStatus, readonly ForumPostStatus[]> = {
  DRAFT: ['PUBLISHED', 'DELETED'],
  PUBLISHED: ['LOCKED', 'HIDDEN', 'DELETED'],
  LOCKED: ['PUBLISHED', 'HIDDEN', 'DELETED'],
  HIDDEN: ['PUBLISHED', 'DELETED'],
  DELETED: [],
};

export function canTransitionPost(from: ForumPostStatus, to: ForumPostStatus): boolean {
  return POST_TRANSITIONS[from].includes(to);
}

/** 非法迁移返回 null（调用方决定怎么提示） */
export function transitionPostStatus(
  post: ForumPost,
  to: ForumPostStatus,
): ForumPost | null {
  if (!canTransitionPost(post.status, to)) return null;
  return { ...post, status: to };
}

/** 合法后继状态（版主操作菜单用） */
export function nextPostStatuses(from: ForumPostStatus): ForumPostStatus[] {
  return [...POST_TRANSITIONS[from]];
}

const REPLY_TRANSITIONS: Record<ForumReplyStatus, readonly ForumReplyStatus[]> = {
  PUBLISHED: ['HIDDEN', 'DELETED'],
  HIDDEN: ['PUBLISHED', 'DELETED'],
  DELETED: [],
};

export function canTransitionReply(from: ForumReplyStatus, to: ForumReplyStatus): boolean {
  return REPLY_TRANSITIONS[from].includes(to);
}

export function transitionReplyStatus(
  reply: ForumReply,
  to: ForumReplyStatus,
): ForumReply | null {
  if (!canTransitionReply(reply.status, to)) return null;
  return { ...reply, status: to };
}

/* ------------------------------------------------------------------ *
 * 举报治理
 * ------------------------------------------------------------------ */

/** 举报去重：同一用户重复举报只算 1 票 */
export function distinctReporters(reports: readonly Pick<ForumReport, 'reporterId'>[]): string[] {
  return [...new Set(reports.map((r) => r.reporterId))];
}

/** 是否达到自动隐藏阈值（3 个**不同**用户） */
export function reportThresholdReached(
  reports: readonly Pick<ForumReport, 'reporterId'>[],
  threshold: number = REPORT_AUTO_HIDE_THRESHOLD,
): boolean {
  return distinctReporters(reports).length >= threshold;
}

/**
 * 达到阈值的**生效中**举报是否应该把主题打成 HIDDEN。
 * 已 DISMISSED 的举报不计票；已 UPHELD 的仍计票（人工维持隐藏）。
 */
export function shouldAutoHide(
  reports: readonly Pick<ForumReport, 'reporterId' | 'status'>[],
  threshold: number = REPORT_AUTO_HIDE_THRESHOLD,
): boolean {
  const effective = reports.filter((r) => r.status !== 'DISMISSED');
  return reportThresholdReached(effective, threshold);
}

/** 是否已举报过（同一用户对同一目标只能举报一次） */
export function hasReported(
  reports: readonly Pick<ForumReport, 'reporterId' | 'targetId'>[],
  reporterId: string,
  targetId: string,
): boolean {
  return reports.some((r) => r.reporterId === reporterId && r.targetId === targetId);
}

/* ------------------------------------------------------------------ *
 * 匿名身份（契约 §9：与实名身份解耦存储）
 * ------------------------------------------------------------------ */

/** FNV-1a 32 位 —— 纯函数、无 crypto 依赖，三端可复现 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * 派生匿名身份 id。
 *
 * - 同一 (userId, boardId) 恒定 → 版主可在**同一版块内**追溯同一匿名作者（域模型 §2.4）
 * - 不同版块不同 → 跨版块无法拼接同一个人的发言
 * - 输出**不含** userId 明文（解耦存储，避免泄露实名身份）
 */
export function deriveAnonymousIdentityId(userId: string, boardId: string): string {
  return `anon_${fnv1a(`${boardId}\u0000${userId}`)}`;
}

/** 展示用作者名：匿名一律 `匿名同学`，绝不回退到实名昵称 */
export function resolveAuthorLabel(
  entry: Pick<ForumPost, 'anonymous' | 'authorNickname'> | Pick<ForumReply, 'anonymous' | 'authorNickname'>,
): string {
  return entry.anonymous ? ANONYMOUS_AUTHOR_LABEL : entry.authorNickname;
}

/* ------------------------------------------------------------------ *
 * 频率限制
 * ------------------------------------------------------------------ */

export interface RateLimitVerdict {
  allowed: boolean;
  /** 不允许时的中文原因 */
  reason?: string;
  /** 距离可以再次操作还有多久（毫秒） */
  retryAfterMs?: number;
  /** 命中的规则 */
  rule?: string;
}

function checkRule(
  createdAtList: readonly string[],
  rule: RateLimitRule,
  now: Date,
): RateLimitVerdict {
  const nowMs = now.getTime();
  const windowStart = nowMs - rule.windowMs;
  const inWindow = createdAtList
    .map((iso) => new Date(iso).getTime())
    .filter((t) => !Number.isNaN(t) && t > windowStart && t <= nowMs)
    .sort((a, b) => a - b);

  if (inWindow.length < rule.max) return { allowed: true };

  const oldest = inWindow[0] ?? nowMs;
  return {
    allowed: false,
    reason: `发布过于频繁：${rule.label}，请稍后再试。`,
    retryAfterMs: Math.max(0, oldest + rule.windowMs - nowMs),
    rule: rule.label,
  };
}

/** 发帖频率校验（10 分钟 3 帖 + 24 小时 20 帖） */
export function checkPostRateLimit(
  createdAtList: readonly string[],
  now: Date = new Date(),
): RateLimitVerdict {
  const short = checkRule(createdAtList, POST_RATE_LIMIT, now);
  if (!short.allowed) return short;
  return checkRule(createdAtList, POST_DAILY_LIMIT, now);
}

/** 回复频率校验（1 分钟 5 回复） */
export function checkReplyRateLimit(
  createdAtList: readonly string[],
  now: Date = new Date(),
): RateLimitVerdict {
  return checkRule(createdAtList, REPLY_RATE_LIMIT, now);
}

/* ------------------------------------------------------------------ *
 * 草稿校验（纯函数，不依赖 zod —— domain 层零外部依赖）
 * ------------------------------------------------------------------ */

export interface ForumPostDraft {
  boardId: string;
  title: string;
  body: string;
  tags: string[];
  anonymous: boolean;
}

export interface ForumReplyDraft {
  postId: string;
  body: string;
  anonymous: boolean;
  parentReplyId?: string | null;
}

/** 标签归一：去空白、去重、丢弃空串、上限 5 个 */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= FORUM_LIMITS.tagCountMax) break;
  }
  return out;
}

/** 从逗号/空格分隔的输入框解析标签 */
export function parseTagInput(input: string): string[] {
  return normalizeTags(input.split(/[,，\s]+/));
}

/** 命中敏感词（命中即拦截，不静默改写） */
export function findSensitiveWords(
  text: string,
  words: readonly string[] = DEFAULT_SENSITIVE_WORDS,
): string[] {
  const lower = text.toLowerCase();
  return words.filter((word) => lower.includes(word.toLowerCase()));
}

export function validateForumPostDraft(draft: ForumPostDraft): string[] {
  const problems: string[] = [];
  if (!draft.boardId.trim()) problems.push('请选择版块');
  if (!isLengthWithin(draft.title, FORUM_LIMITS.postTitleMin, FORUM_LIMITS.postTitleMax)) {
    problems.push(`标题长度需在 ${FORUM_LIMITS.postTitleMin}–${FORUM_LIMITS.postTitleMax} 字之间`);
  }
  const body = draft.body.trim();
  if (!body) problems.push('正文不能为空');
  if ([...body].length > FORUM_LIMITS.postBodyMax) {
    problems.push(`正文不能超过 ${FORUM_LIMITS.postBodyMax} 字`);
  }
  if (normalizeTags(draft.tags).length !== draft.tags.filter((t) => t.trim()).length) {
    problems.push(`标签最多 ${FORUM_LIMITS.tagCountMax} 个，且不能重复`);
  }
  for (const tag of draft.tags) {
    if ([...tag.trim()].length > FORUM_LIMITS.tagMax) {
      problems.push(`单个标签不能超过 ${FORUM_LIMITS.tagMax} 字`);
      break;
    }
  }
  const hits = findSensitiveWords(`${draft.title}\n${body}`);
  if (hits.length > 0) {
    problems.push(`内容命中敏感词（${hits.join('、')}），请自行修改后重试（不会被静默改写）`);
  }
  return problems;
}

export function validateForumReplyDraft(draft: ForumReplyDraft): string[] {
  const problems: string[] = [];
  if (!draft.postId.trim()) problems.push('缺少主题 id');
  const body = draft.body.trim();
  if (!body) problems.push('回复内容不能为空');
  if ([...body].length > FORUM_LIMITS.replyBodyMax) {
    problems.push(`回复不能超过 ${FORUM_LIMITS.replyBodyMax} 字`);
  }
  const hits = findSensitiveWords(body);
  if (hits.length > 0) {
    problems.push(`内容命中敏感词（${hits.join('、')}），请自行修改后重试（不会被静默改写）`);
  }
  return problems;
}

/** 内容里疑似含个人信息（前端提示，非安全边界） */
export function draftPrivacyHints(
  draft: Pick<ForumPostDraft, 'title' | 'body'> & { anonymous?: boolean },
): string[] {
  const hits: string[] = [];
  const text = `${draft.title}\n${draft.body}`;
  if (containsLikelyPii(text)) {
    hits.push('内容里疑似包含手机号 / 学号 / 邮箱等个人信息，发帖前建议先脱敏。');
  }
  // 匿名帖里自报身份是最常见的去匿名化路径：提示但不拦截（不替用户做决定）
  if (draft.anonymous && /(我是|我叫|学号|宿舍|院系|班级)/.test(text)) {
    hits.push('匿名发布时请避免在正文里自报姓名 / 学号 / 宿舍号，否则匿名没有意义。');
  }
  return hits;
}

/* ------------------------------------------------------------------ *
 * 排序与聚合
 * ------------------------------------------------------------------ */

function timeValue(iso: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** 置顶在前（置顶时间新的更前），其余按最近活跃倒序；非法时间排最后 */
export function sortPosts<T extends Pick<ForumPost, 'pinnedAt' | 'lastActivityAt'>>(
  posts: readonly T[],
): T[] {
  return [...posts].sort((a, b) => {
    const pinnedA = timeValue(a.pinnedAt);
    const pinnedB = timeValue(b.pinnedAt);
    const aPinned = a.pinnedAt !== null;
    const bPinned = b.pinnedAt !== null;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    if (aPinned && bPinned && pinnedA !== pinnedB) return pinnedB - pinnedA;
    return timeValue(b.lastActivityAt) - timeValue(a.lastActivityAt);
  });
}

/** 回复按时间正序（楼层顺序），隐藏回复保留在列表里但带状态 */
export function sortReplies<T extends Pick<ForumReply, 'createdAt'>>(replies: readonly T[]): T[] {
  return [...replies].sort((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt));
}

export function countPostsByStatus(
  posts: readonly Pick<ForumPost, 'status'>[],
): Record<ForumPostStatus, number> {
  const acc: Record<ForumPostStatus, number> = {
    DRAFT: 0,
    PUBLISHED: 0,
    LOCKED: 0,
    HIDDEN: 0,
    DELETED: 0,
  };
  for (const post of posts) acc[post.status] += 1;
  return acc;
}

/** 版块是否可访问：campus_only 需登录（契约 §2.4 visibility） */
export function isBoardAccessible(
  board: Pick<ForumBoard, 'visibility'>,
  options: { authenticated: boolean },
): boolean {
  if (board.visibility === 'public') return true;
  return options.authenticated;
}

/** 摘要：去掉 Markdown 标记后的前 n 个字符 */
export function excerpt(body: string, max = 120): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...plain];
  return chars.length <= max ? plain : `${chars.slice(0, max).join('')}…`;
}
