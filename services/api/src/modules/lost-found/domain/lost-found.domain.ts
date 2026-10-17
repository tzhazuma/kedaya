import type { Page } from '@kedaya/contracts';

/**
 * 失物招领 · lost-found（契约 §4 模块 id：`lost-found`）
 *
 * ⚠️ 本模块**不再是脚手架生成的占位实现**：它已经承载真实的领域规则
 * （归属校验、状态机、筛选与搜索）。请直接改本文件，不要重跑 `npm run scaffold`。
 *
 * 安全基线（所有模块统一）：
 *   1. `reporterId` **永远**来自 JWT 解出的主体，不接受请求体传入；
 *   2. 改 / 删 / 标记找回只允许发布者本人；
 *   3. 状态机由服务层强制，非法跃迁返回 CONFLICT 而不是静默改写。
 */

/** 信息类型：丢了东西（lost）/ 捡到东西（found） */
export const LOST_FOUND_KINDS = ['lost', 'found'] as const;
export type LostFoundKind = (typeof LOST_FOUND_KINDS)[number];

/** 状态机：open → resolved（发布者标记已找回 / 已归还） */
export const LOST_FOUND_STATUS = {
  open: 'open',
  resolved: 'resolved',
} as const;
export type LostFoundStatus = (typeof LOST_FOUND_STATUS)[keyof typeof LOST_FOUND_STATUS];

/** 供 Zod `z.enum` 复用的状态白名单 */
export const LOST_FOUND_STATUSES = [LOST_FOUND_STATUS.open, LOST_FOUND_STATUS.resolved] as const;

/** 排序方式（按事发时间；默认最新） */
export const LOST_FOUND_SORTS = ['latest', 'oldest'] as const;
export type LostFoundSort = (typeof LOST_FOUND_SORTS)[number];

/** 事发时间允许的时钟偏差：5 分钟（手机时间可能略快于服务器） */
export const LOST_FOUND_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface LostFoundItemModel {
  id: string;
  reporterId: string;
  kind: string;
  title: string;
  description: string | null;
  place: string;
  happenedAt: Date;
  /** 联系方式提示（建议只写「站内私信」之类，不强制收集手机号） */
  contactHint: string | null;
  /** 图片地址（仅本平台上传的地址；上传时已剥离 EXIF GPS） */
  imageUrls: string[];
  status: string;
  /** 标记已解决的时间 */
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。`reporterId` 由服务层从登录主体补全，客户端传了也会被忽略。 */
export interface CreateLostFoundItemInput {
  reporterId?: string;
  kind: string;
  title: string;
  description?: string | null;
  place: string;
  happenedAt: Date;
  contactHint?: string | null;
  imageUrls?: string[];
}

/** 更新输入（全部可选；不允许改 reporterId / status —— 状态只能走领域动作） */
export interface UpdateLostFoundItemInput {
  kind?: string;
  title?: string;
  description?: string | null;
  place?: string;
  happenedAt?: Date;
  contactHint?: string | null;
  imageUrls?: string[];
}

/** 状态动作可写的字段集合 */
export interface LostFoundStatePatch {
  status: LostFoundStatus;
  resolvedAt?: Date | null;
}

/** 列表查询条件 */
export interface LostFoundItemListQuery {
  cursor?: string;
  limit: number;
  kind?: string;
  status?: string;
  /** 标题 / 描述 / 地点模糊搜索 */
  keyword?: string;
  place?: string;
  /** 我发布的（`mine=1` 由服务层填成当前用户） */
  reporterId?: string;
  sort: LostFoundSort;
}

/** 端口：service 只依赖本类型，实现见 data/lost-found.repository.ts */
export interface LostFoundItemRepository {
  list(query: LostFoundItemListQuery): Promise<Page<LostFoundItemModel>>;
  create(input: CreateLostFoundItemInput & { reporterId: string }): Promise<LostFoundItemModel>;
  findById(id: string): Promise<LostFoundItemModel | null>;
  update(id: string, input: UpdateLostFoundItemInput): Promise<LostFoundItemModel>;
  applyStatus(id: string, patch: LostFoundStatePatch): Promise<LostFoundItemModel>;
  remove(id: string): Promise<void>;
}

export const LOST_FOUND_ITEM_REPOSITORY = Symbol('KEDAYA_LOST_FOUND_ITEM_REPOSITORY');
