import type { Page } from '@kedaya/contracts';

/**
 * 论坛 · forum（契约 §4 模块 id：`forum`）
 *
 * ⚠️ 本模块**不再是脚手架生成的占位实现**：它已经承载真实的领域规则
 * （版块白名单、匿名解耦、状态机、热度排序）。请直接改本文件，不要重跑 `npm run scaffold`。
 *
 * 匿名设计（契约 §9）：
 *   · 帖子 / 回复都允许匿名。请求体带 `anonymous: true` 时，`authorId` **存 null**，
 *     改用服务端生成的 `anonHandle`；
 *   · 匿名内容**不得泄漏 userId**：返回实体里 `authorId` 恒为 null，
 *     且 `anonHandle` 由 `匿名种子 + 帖子/回复 id` 派生，不含任何实名信息；
 *   · 因为匿名帖不存 `authorId`，作者无法再被识别 —— 因此匿名帖**不允许**关闭 / 删除。
 */

/** 版块白名单（对外契约的一部分，客户端版块导航直接用它渲染） */
export const FORUM_BOARDS = [
  'campus',
  'study',
  'life',
  'trade',
  'lost',
  'help',
  'treehole',
] as const;
export type ForumBoard = (typeof FORUM_BOARDS)[number];

/** 帖子状态：published（可回复）→ closed（停止回复）；closed 不是删除 */
export const FORUM_STATUS = {
  published: 'published',
  closed: 'closed',
} as const;
export type ForumStatus = (typeof FORUM_STATUS)[keyof typeof FORUM_STATUS];

/** 供 Zod `z.enum` 复用的状态白名单 */
export const FORUM_STATUSES = [FORUM_STATUS.published, FORUM_STATUS.closed] as const;

/** 排序方式：latest（最新）/ hot（回复数 + 最近回复） */
export const FORUM_SORTS = ['latest', 'hot'] as const;
export type ForumSort = (typeof FORUM_SORTS)[number];

/** 详情页单页最多返回的回复数（契约把回复做了轻量分页） */
export const FORUM_REPLIES_PAGE_SIZE = 50;

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface ForumPostModel {
  id: string;
  board: string;
  /** 实名作者；匿名帖为 null */
  authorId: string | null;
  /** 匿名 handle；实名帖为 null */
  anonHandle: string | null;
  title: string;
  body: string;
  status: string;
  /** 置顶/加精等治理位（0 = 普通） */
  pinnedRank: number;
  replyCount: number;
  lastReplyAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ForumReplyModel {
  id: string;
  postId: string;
  authorId: string | null;
  anonHandle: string | null;
  body: string;
  status: string;
  createdAt: Date;
}

/** 版块 + 该版块帖子数（`GET boards`） */
export interface ForumBoardStat {
  board: string;
  postCount: number;
}

/**
 * 落库用的发帖数据：`authorId` / `anonHandle` 已由服务层按匿名规则解析完成，
 * 客户端**无法**直接提供（请求体里的 authorId 会被忽略）。
 */
export interface ForumPostCreateData {
  board: string;
  authorId: string | null;
  anonHandle: string | null;
  title: string;
  body: string;
}

export interface ForumReplyCreateData {
  postId: string;
  authorId: string | null;
  anonHandle: string | null;
  body: string;
}

/** 帖子可更新字段（不允许改 authorId —— 归属是身份，不是内容） */
export interface ForumPostPatch {
  title?: string;
  body?: string;
  status?: ForumStatus;
  /** 匿名帖创建后再补写 handle（seed 需要帖子 id） */
  anonHandle?: string | null;
}

/** 回复可更新字段（匿名回复创建后补写 handle） */
export interface ForumReplyPatch {
  anonHandle?: string | null;
  status?: string;
}

/** 服务层发帖输入（控制器把 `anonymous` 原样传下来） */
export interface CreateForumPostInput {
  board: string;
  title: string;
  body: string;
  anonymous?: boolean;
}

/** 服务层回复输入 */
export interface CreateForumReplyInput {
  body: string;
  anonymous?: boolean;
}

/** 帖子列表查询条件 */
export interface ForumPostListQuery {
  cursor?: string;
  limit: number;
  board?: string;
  status?: string;
  /** 标题 / 正文模糊搜索 */
  keyword?: string;
  /** 我发的（`mine=1`；匿名帖不计入，因为没有 authorId） */
  authorId?: string;
  sort: ForumSort;
}

/** 回复列表查询条件 */
export interface ForumReplyListQuery {
  postId: string;
  cursor?: string;
  limit: number;
}

/** 详情 = 帖子 + 一页回复（契约 §4：`GET posts/:id` 返回 replies） */
export interface ForumPostDetail {
  post: ForumPostModel;
  replies: Page<ForumReplyModel>;
}

/** 端口：service 只依赖本类型，实现见 data/forum.repository.ts */
export interface ForumPostRepository {
  list(query: ForumPostListQuery): Promise<Page<ForumPostModel>>;
  create(data: ForumPostCreateData): Promise<ForumPostModel>;
  findById(id: string): Promise<ForumPostModel | null>;
  update(id: string, patch: ForumPostPatch): Promise<ForumPostModel>;
  remove(id: string): Promise<void>;
  /** 一次 groupBy 拿到全部版块的帖子数（避免 7 次 count） */
  boardCounts(): Promise<ForumBoardStat[]>;
  listReplies(query: ForumReplyListQuery): Promise<Page<ForumReplyModel>>;
  /** 回复落库 + 帖子 replyCount/lastReplyAt 自增（同一事务） */
  addReply(data: ForumReplyCreateData): Promise<ForumReplyModel>;
  updateReply(id: string, patch: ForumReplyPatch): Promise<ForumReplyModel>;
}

export const FORUM_POST_REPOSITORY = Symbol('KEDAYA_FORUM_POST_REPOSITORY');
