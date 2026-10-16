/**
 * 论坛 · forum —— 领域层（契约 §4 / §9 / §11.2；02-domain-model §2.4）
 *
 * ⚠️ 本文件**手写**，不在 `scripts/scaffold.mjs` 的 SPEC 表里。
 * 原因：forum 的领域形状（版块目录 + 主题状态机 + 匿名身份派生 +
 * 举报阈值治理 + 回复子资源）已经超出生成器能表达的「一套 CRUD + 一个动作」。
 * 生成器现在只负责另外 13 个形状统一的模块（见 scaffold.mjs 顶部说明）。
 *
 * 本层零框架依赖（不 import Prisma / Nest）：只依赖 `node:crypto`、
 * `@kedaya/contracts` 的类型与 `@kedaya/shared` 的纯函数。
 *
 * wire 形状（Lead v1.2 裁决，与 OpenAPI + 三端客户端一致）：
 *   · 主题用 `boardId`（→ `ForumBoard.id`）、状态用**大写**枚举、对外暴露 `anonymous`
 *   · 列表筛选参数 `boardId` / `keyword`
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Page } from '@kedaya/contracts';
import { containsLikelyPii } from '@kedaya/shared';
import type { ListParams, ResourceRepository } from '../../../common/crud/resource';
import { InternalError, ValidationError } from '../../../common/errors/app-error';

export const FORUM_MODULE_ID = 'forum';

/* ================================================================== *
 * 1. 匿名身份（契约 §9：与实名身份**解耦存储**）
 *
 * 设计要点（这是本模块最容易做错的地方，逐条说明）：
 *
 *   · `anonymous=true` 时 `authorId` **恒为 null** —— 数据库里根本
 *     不存在「这帖是谁发的」这一列。实名身份不落库，而不是落库后隐藏。
 *
 *   · 对外可见的是 `anonHandle = HMAC(secret, userId + '|' + 'thread:<postId>')`。
 *     作用域是**主题**，于是：
 *       - 同一个人在同一主题内（含他自己发的帖与他的回复）handle 一致
 *         → 读者能看出"这是同一个人"；
 *       - 同一个人在不同主题 handle 不同，且 HMAC 不可逆
 *         → **跨帖不可关联**（拿不到 secret 就无法判断两个 handle 是否同人）。
 *
 *   · 作者自助编辑/删除靠**重算** handle 证明身份（`verifyAnonymousHandle`），
 *     因此不需要额外存一张"匿名身份 ↔ 实名"映射表 —— 不存就不会泄漏。
 *
 *   · 对外 DTO 里 `authorId` 对匿名内容返回**匿名 handle 本身**（不透明、
 *     主题作用域内稳定），这样客户端能把它当"同一个人"的标识用，
 *     而拿不到任何实名信息。
 *
 *   · 与 02-domain-model §2.4「同一 AnonymousIdentity 在板块内可被版主追溯」
 *     存在**刻意偏离**：板块内可追溯 = 跨帖可关联，与任务书要求的
 *     「跨帖不可关联」直接冲突。此处以任务书为准，并已在交付说明中上报。
 * ================================================================== */

/** 匿名 handle 前缀，便于日志/调试一眼区分实名 id 与匿名 handle */
export const ANON_HANDLE_PREFIX = 'anon_';

/** 匿名内容的展示昵称（客户端 UI 文案） */
export const ANONYMOUS_NICKNAME = '匿名同学';

/** 匿名 handle 的作用域：以**主题**为单位（帖与回复共用同一作用域） */
export function anonThreadScope(postId: string): string {
  return `thread:${postId}`;
}

/**
 * 派生匿名 handle。密钥由用例层注入（不在这里读 process.env —— domain 层不做 IO）。
 */
export function anonHandleFor(userId: string, scope: string, secret: string): string {
  if (!userId) throw new ValidationError('匿名内容必须先完成第一级身份认证');
  if (!secret) throw new InternalError('匿名 handle 密钥未配置（ANON_HANDLE_SECRET 或 JWT_SECRET）');
  const mac = createHmac('sha256', secret).update(`${userId}|${scope}`).digest('base64url');
  return `${ANON_HANDLE_PREFIX}${mac.slice(0, 22)}`;
}

/** 常量时间比较：证明"当前登录者就是这条匿名内容的作者" */
export function verifyAnonymousHandle(
  userId: string,
  storedHandle: string | null | undefined,
  scope: string,
  secret: string,
): boolean {
  if (!userId || !storedHandle) return false;
  const expected = Buffer.from(anonHandleFor(userId, scope, secret), 'utf8');
  const actual = Buffer.from(storedHandle, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** 生成一个与实名无关的随机 handle（仅用于"无法归属"的极端兜底，正常路径不用） */
export function randomAnonHandle(): string {
  return `${ANON_HANDLE_PREFIX}${randomBytes(16).toString('base64url')}`;
}

/* ================================================================== *
 * 2. 主题状态机（02-domain-model §2.4；状态流转只走领域函数）
 * ================================================================== */

export const FORUM_POST_STATUSES = ['DRAFT', 'PUBLISHED', 'LOCKED', 'HIDDEN', 'DELETED'] as const;
export type ForumPostStatus = (typeof FORUM_POST_STATUSES)[number];

export function isForumPostStatus(value: unknown): value is ForumPostStatus {
  return typeof value === 'string' && (FORUM_POST_STATUSES as readonly string[]).includes(value);
}

/**
 * 大小写不敏感地解析状态。
 * 对外 canonical 是**大写**（02-domain-model §2.4 + 三端客户端），
 * 但容忍小写输入 —— 骨架期生成的客户端可能仍发小写。
 */
export function normalizePostStatus(value: unknown): ForumPostStatus | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return isForumPostStatus(upper) ? upper : null;
}

export function isForumReplyStatus(value: unknown): value is ForumReplyStatus {
  return typeof value === 'string' && (FORUM_REPLY_STATUSES as readonly string[]).includes(value);
}

/**
 * 允许的状态迁移，逐条对应 02-domain-model §2.4 的状态图：
 *   DRAFT→PUBLISHED / DRAFT→DELETED
 *   PUBLISHED↔LOCKED（锁定/解锁）
 *   PUBLISHED|LOCKED→HIDDEN（举报审核通过）
 *   HIDDEN→PUBLISHED（申诉成功/恢复）
 *   PUBLISHED|LOCKED|HIDDEN→DELETED
 */
export const FORUM_POST_TRANSITIONS: ReadonlyArray<readonly [ForumPostStatus, ForumPostStatus]> = [
  ['DRAFT', 'PUBLISHED'],
  ['DRAFT', 'DELETED'],
  ['PUBLISHED', 'LOCKED'],
  ['LOCKED', 'PUBLISHED'],
  ['PUBLISHED', 'HIDDEN'],
  ['LOCKED', 'HIDDEN'],
  ['HIDDEN', 'PUBLISHED'],
  ['PUBLISHED', 'DELETED'],
  ['LOCKED', 'DELETED'],
  ['HIDDEN', 'DELETED'],
];

export function canTransitionForumPost(from: ForumPostStatus, to: ForumPostStatus): boolean {
  if (from === to) return true; // 幂等：PATCH 传同样的状态不算冲突
  return FORUM_POST_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/**
 * 需要**版主**权限的迁移。
 * 其余迁移（草稿发布、作者删除自己的帖子）由作者本人即可完成。
 */
export const MODERATOR_ONLY_POST_TRANSITIONS: ReadonlyArray<readonly [ForumPostStatus, ForumPostStatus]> = [
  ['PUBLISHED', 'LOCKED'],
  ['LOCKED', 'PUBLISHED'],
  ['PUBLISHED', 'HIDDEN'],
  ['LOCKED', 'HIDDEN'],
  ['HIDDEN', 'PUBLISHED'],
];

export function requiresModeratorForPostTransition(from: ForumPostStatus, to: ForumPostStatus): boolean {
  return MODERATOR_ONLY_POST_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/** 作者还能改正文的状态：已隐藏/已删除的帖子不允许作者自行改写内容 */
export const POST_STATUSES_EDITABLE_BY_AUTHOR: readonly ForumPostStatus[] = ['DRAFT', 'PUBLISHED', 'LOCKED'];

/** 该状态下还能新增回复（锁定/隐藏/删除都禁止） */
export function canReplyToPost(status: ForumPostStatus): boolean {
  return status === 'PUBLISHED';
}

export const FORUM_REPLY_STATUSES = ['PUBLISHED', 'HIDDEN', 'DELETED'] as const;
export type ForumReplyStatus = (typeof FORUM_REPLY_STATUSES)[number];

export const FORUM_REPLY_TRANSITIONS: ReadonlyArray<readonly [ForumReplyStatus, ForumReplyStatus]> = [
  ['PUBLISHED', 'HIDDEN'],
  ['HIDDEN', 'PUBLISHED'],
  ['PUBLISHED', 'DELETED'],
  ['HIDDEN', 'DELETED'],
];

export function canTransitionForumReply(from: ForumReplyStatus, to: ForumReplyStatus): boolean {
  if (from === to) return true;
  return FORUM_REPLY_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/* ================================================================== *
 * 3. 举报（契约 §11.2 冻结 action 名 `report`）
 * ================================================================== */

/**
 * 举报原因枚举。
 *
 * ⚠️ 契约冲突（已上报 Lead）：任务书与 OpenAPI 给的是 `spam|abuse|pii|illegal|other`，
 * 而 02-domain-model §2.4 写的是 `spam|abuse|illegal|privacy|other`。
 * 处理方式（Lead v1.2 裁决：保持不变）：以 `pii` 为**规范值**，
 * 同时接受旧写法 `privacy` 并归一化为 `pii`（见 `normalizeReportReason`）。
 */
export const FORUM_REPORT_REASONS = ['spam', 'abuse', 'pii', 'illegal', 'other'] as const;
export type ForumReportReason = (typeof FORUM_REPORT_REASONS)[number];

export const LEGACY_REPORT_REASON_ALIASES: Readonly<Record<string, ForumReportReason>> = {
  privacy: 'pii',
};

export function normalizeReportReason(raw: string): ForumReportReason | null {
  const value = raw.trim().toLowerCase();
  if ((FORUM_REPORT_REASONS as readonly string[]).includes(value)) return value as ForumReportReason;
  return LEGACY_REPORT_REASON_ALIASES[value] ?? null;
}

export const FORUM_REPORT_TARGET_TYPES = ['POST', 'REPLY'] as const;
export type ForumReportTargetType = (typeof FORUM_REPORT_TARGET_TYPES)[number];

export const FORUM_REPORT_STATUSES = ['PENDING', 'UPHELD', 'DISMISSED'] as const;
export type ForumReportStatus = (typeof FORUM_REPORT_STATUSES)[number];

/** 治理规则：3 个**不同**用户举报 → 自动隐藏并进人工队列（02-domain-model §2.4） */
export const FORUM_REPORT_AUTO_HIDE_THRESHOLD = 3;

/* ================================================================== *
 * 4. 内容提示（**不是**安全边界，只是提示；契约 §9 / 02-domain-model §2.4）
 * ================================================================== */

/**
 * 疑似含个人敏感信息的提示位。
 * 复用 `@kedaya/shared` 的 `containsLikelyPii`（手机号/身份证/学号/邮箱）。
 * 刻意**不拦截** —— 拦截会误伤正常的"帮我找一下我丢的卡，联系 138…"。
 */
export function piiHintFor(...texts: Array<string | null | undefined>): boolean {
  return texts.some((text) => (text ? containsLikelyPii(text) : false));
}

/** 逗号分隔的敏感词表（策略输入，由运维配置；不在代码里硬编码词库） */
export function parseKeywordList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((word) => word.trim()).filter(Boolean))];
}

/**
 * 命中敏感词 → 返回命中的词（用例层据此抛 `VALIDATION_FAILED`，**不静默改写**）。
 * 词表为空时永不命中（默认不引入任何审查词库）。
 */
export function findBannedKeyword(text: string, banned: readonly string[]): string | null {
  const haystack = text.toLowerCase();
  for (const word of banned) {
    if (word && haystack.includes(word.toLowerCase())) return word;
  }
  return null;
}

/* ================================================================== *
 * 5. 领域模型（字段与 Prisma 行字段一一对应；domain 不 import Prisma）
 * ================================================================== */

export interface ForumBoardModel {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: string;
  postCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ForumPostModel {
  id: string;
  boardId: string;
  authorId: string | null;
  anonHandle: string | null;
  title: string;
  body: string;
  status: string;
  tags: string[];
  replyCount: number;
  likeCount: number;
  pinnedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ForumReplyModel {
  id: string;
  postId: string;
  parentReplyId: string | null;
  authorId: string | null;
  anonHandle: string | null;
  body: string;
  status: string;
  likeCount: number;
  createdAt: Date;
}

export interface ForumReportModel {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  detail: string | null;
  status: string;
  reporterId: string | null;
  reporterKey: string;
  createdAt: Date;
  updatedAt: Date;
}

/* ================================================================== *
 * 6. 对外 DTO（wire 形状；与 OpenAPI + 三端客户端一致）
 *
 * 关键点：匿名内容**不暴露实名** —— `authorId` 返回匿名 handle，
 * `authorNickname` 固定为「匿名同学」，`anonymous` 供 UI 分支。
 * ================================================================== */

export interface ForumPostView {
  id: string;
  boardId: string;
  title: string;
  body: string;
  status: ForumPostStatus;
  anonymous: boolean;
  authorId: string;
  authorNickname: string;
  tags: string[];
  replyCount: number;
  likeCount: number;
  pinnedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** 最近活跃时间（当前实现 = updatedAt，供列表排序展示） */
  lastActivityAt: Date;
}

export interface ForumReplyView {
  id: string;
  postId: string;
  parentReplyId: string | null;
  body: string;
  status: ForumReplyStatus;
  anonymous: boolean;
  authorId: string;
  authorNickname: string;
  likeCount: number;
  createdAt: Date;
}

export interface ForumBoardView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: string;
  postCount: number;
  /** 最近活跃时间（该版块最新主题的 updatedAt），无主题为 null */
  lastPostAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ForumReportView {
  id: string;
  targetType: ForumReportTargetType;
  targetId: string;
  reason: ForumReportReason;
  status: ForumReportStatus;
  /** 实名举报人为 userId；匿名举报人为匿名 handle（不透明） */
  reporterId: string;
  anonymous: boolean;
  /** 举报补充说明（客户端字段名 `note`） */
  note: string | null;
  createdAt: Date;
}

/** 匿名内容判定：`authorId` 为空且有 handle（见契约 §9 的解耦存储） */
export function isAnonymousContent(row: { authorId: string | null; anonHandle: string | null }): boolean {
  return row.authorId === null && row.anonHandle !== null;
}

/** 对外展示的作者标识：实名用 userId，匿名用**匿名 handle**（不泄漏实名） */
export function publicAuthorId(row: { authorId: string | null; anonHandle: string | null }): string {
  return row.authorId ?? row.anonHandle ?? '';
}

/* ================================================================== *
 * 7. 输入 / 过滤条件
 * ================================================================== */

/** 创建主题：**已经过用例层解析**的行输入（匿名已解耦成 anonHandle） */
export interface CreateForumPostInput {
  id: string;
  boardId: string;
  authorId: string | null;
  anonHandle: string | null;
  title: string;
  body: string;
  status: ForumPostStatus;
  tags: string[];
}

/** 更新主题：只含要改的字段（JSON Merge Patch，契约 §11.1） */
export interface UpdateForumPostInput {
  title?: string;
  body?: string;
  status?: ForumPostStatus;
  tags?: string[];
  pinnedAt?: Date | null;
}

/** 控制器/用例层的创建命令（`anonymous` 只在这里出现，绝不透传给 Prisma） */
export interface CreateForumPostCommand {
  /** 02-domain-model 的字段名（→ ForumBoard.id；也接受 slug） */
  boardId?: string;
  /** 兼容别名（骨架期生成的控制台/客户端用过） */
  board?: string;
  title: string;
  body: string;
  tags?: string[];
  anonymous?: boolean;
  status?: string;
}

export interface UpdateForumPostCommand {
  title?: string | null;
  body?: string | null;
  status?: string | null;
  tags?: string[] | null;
  pinnedAt?: Date | string | null;
}

export interface CreateForumReplyInput {
  id: string;
  postId: string;
  parentReplyId: string | null;
  authorId: string | null;
  anonHandle: string | null;
  body: string;
  status: ForumReplyStatus;
}

export interface CreateForumReplyCommand {
  body: string;
  parentReplyId?: string | null;
  anonymous?: boolean;
}

export interface UpdateForumReplyInput {
  body?: string;
  status?: ForumReplyStatus;
}

export interface CreateForumBoardInput {
  /** 省略时由 `slugify(name)` 生成（中文名会退化，此时用例层补一个 ULID slug） */
  slug?: string;
  name: string;
  description?: string | null;
  visibility?: string;
}

export interface CreateForumReportInput {
  targetType: ForumReportTargetType;
  targetId: string;
  reason: ForumReportReason;
  detail: string | null;
  reporterId: string | null;
  reporterKey: string;
}

export interface ForumPostListFilter extends ListParams {
  /** 版块 id（也接受 slug，由用例层解析） */
  boardId?: string;
  /** 关键词搜索 */
  keyword?: string;
  /** 单个状态或状态集合（集合走 Prisma `in`，用于"默认只看 PUBLISHED+LOCKED"） */
  status?: ForumPostStatus | ForumPostStatus[];
}

export interface ForumReportListFilter extends ListParams {
  targetType?: ForumReportTargetType;
  targetId?: string;
  status?: ForumReportStatus;
}

/** 创建主题的返回：DTO + 提示位（提示位不落库，只影响本次响应） */
export type ForumPostWithHints = ForumPostView & { piiWarning: boolean };

/* ================================================================== *
 * 8. 端口（service 只依赖这些接口，Prisma 实现见 data/forum.repository.ts）
 * ================================================================== */

export interface ForumPostRepository
  extends ResourceRepository<ForumPostModel, CreateForumPostInput, UpdateForumPostInput> {
  /** 带过滤的游标分页（boardId / keyword / status），契约 §6.1 不用 offset */
  listFiltered(filter: ForumPostListFilter): Promise<Page<ForumPostModel>>;
  addReply(input: CreateForumReplyInput): Promise<ForumReplyModel>;
  listReplies(filter: { postId: string; includeHidden?: boolean } & ListParams): Promise<Page<ForumReplyModel>>;
  findReplyById(id: string): Promise<ForumReplyModel | null>;
  updateReply(id: string, input: UpdateForumReplyInput): Promise<ForumReplyModel>;
  /** 维护主题的回复数冗余计数 */
  adjustReplyCount(postId: string, delta: number): Promise<void>;
}

export interface ForumBoardRepository {
  listBoards(params: ListParams): Promise<Page<ForumBoardModel>>;
  /** 按 id **或** slug 解析版块（wire 上客户端拿到的可能是 id，路由里可能是 slug） */
  findBoardByIdOrSlug(value: string): Promise<ForumBoardModel | null>;
  /** `slug` 必填 —— 用例层负责 `slugify` 兜底后传入 */
  createBoard(input: CreateForumBoardInput & { slug: string }): Promise<ForumBoardModel>;
  /** 维护版块的未删除主题数冗余计数 */
  adjustBoardPostCount(boardId: string, delta: number): Promise<void>;
  /** 每个版块的最新主题时间（`lastPostAt`），一次 groupBy 查询 */
  latestPostAtByBoard(): Promise<Map<string, Date>>;
}

export interface ForumReportRepository {
  createReport(input: CreateForumReportInput): Promise<ForumReportModel>;
  findReportByReporter(
    targetType: ForumReportTargetType,
    targetId: string,
    reporterKey: string,
  ): Promise<ForumReportModel | null>;
  /** 不同举报人数量（阈值判定的唯一依据） */
  countDistinctReporters(targetType: ForumReportTargetType, targetId: string): Promise<number>;
  listReports(filter: ForumReportListFilter): Promise<Page<ForumReportModel>>;
  setReportStatus(id: string, status: ForumReportStatus): Promise<ForumReportModel>;
}

/** 作者昵称目录（IO 端口；实现读 `User.displayName`，缺失时回退） */
export interface ForumUserDirectoryPort {
  displayNamesFor(userIds: string[]): Promise<Map<string, string>>;
}

export const FORUM_POST_REPOSITORY = Symbol('KEDAYA_FORUM_POST_REPOSITORY');
export const FORUM_BOARD_REPOSITORY = Symbol('KEDAYA_FORUM_BOARD_REPOSITORY');
export const FORUM_REPORT_REPOSITORY = Symbol('KEDAYA_FORUM_REPORT_REPOSITORY');
export const FORUM_USER_DIRECTORY = Symbol('KEDAYA_FORUM_USER_DIRECTORY');

/** 举报人/作者的归属判定键（实名用 user: 前缀，匿名用 anon: 前缀，二者不混用） */
export function reporterKeyFor(userId: string | undefined, anonHandle: string | undefined): string {
  if (userId) return `user:${userId}`;
  if (anonHandle) return `anon:${anonHandle}`;
  throw new ValidationError('举报需要第一级身份（实名或匿名均可，但必须登录）');
}
