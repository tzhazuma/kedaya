import type { Page } from '@kedaya/contracts';

/**
 * 跳蚤市场 · flea-market（契约 §4 模块 id：`flea-market`）
 *
 * ⚠️ 本模块**不再是脚手架生成的占位实现**：它已经承载真实的领域规则
 * （归属校验、状态机、筛选与搜索）。请直接改本文件，不要重跑 `npm run scaffold`。
 *
 * 安全基线（所有模块统一）：
 *   1. `sellerId` **永远**来自 JWT 解出的主体，不接受请求体传入 —— 否则任何人都能
 *      以别人的名义发帖；
 *   2. 改 / 删 / 标记售出只允许发布者本人；
 *   3. 状态机由服务层强制，非法跃迁返回 CONFLICT 而不是静默改写。
 */

/** 商品分类（对外契约的一部分，客户端筛选器直接用它渲染） */
export const FLEA_CATEGORIES = [
  'electronics',
  'books',
  'clothing',
  'daily',
  'sports',
  'tickets',
  'other',
] as const;
export type FleaCategory = (typeof FLEA_CATEGORIES)[number];

/** 成色 */
export const FLEA_CONDITIONS = ['new', 'like-new', 'good', 'fair'] as const;
export type FleaCondition = (typeof FLEA_CONDITIONS)[number];

/** 状态机：on-sale → reserved → sold；sold 为终态 */
export const FLEA_STATUS = {
  onSale: 'on-sale',
  reserved: 'reserved',
  sold: 'sold',
} as const;
export type FleaStatus = (typeof FLEA_STATUS)[keyof typeof FLEA_STATUS];

/** 排序方式（默认最新） */
export const FLEA_SORTS = ['latest', 'price-asc', 'price-desc'] as const;
export type FleaSort = (typeof FLEA_SORTS)[number];

/** 单件商品价格上限：100 万元（分）—— 防止误填导致的荒谬数据 */
export const FLEA_MAX_PRICE_FEN = 100_000_000;

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface FleaItemModel {
  id: string;
  sellerId: string;
  title: string;
  description: string | null;
  /** 价格，单位 **分**（契约 §6.1 硬规则：金额不用浮点） */
  priceFen: number;
  category: string;
  condition: string;
  campusSpot: string | null;
  status: string;
  /** 预定者（买家）。未预定为 null */
  reservedById: string | null;
  soldAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。`sellerId` 由服务层从登录主体补全，客户端传了也会被忽略。 */
export interface CreateFleaItemInput {
  sellerId?: string;
  title: string;
  description?: string | null;
  priceFen: number;
  category: string;
  condition?: string;
  campusSpot?: string | null;
}

/** 更新输入（全部可选；不允许改 sellerId / status —— 状态只能走领域动作） */
export interface UpdateFleaItemInput {
  title?: string;
  description?: string | null;
  priceFen?: number;
  category?: string;
  condition?: string;
  campusSpot?: string | null;
}

/** 列表查询条件 */
export interface FleaItemListQuery {
  cursor?: string;
  limit: number;
  category?: string;
  condition?: string;
  status?: string;
  /** 标题/描述模糊搜索 */
  keyword?: string;
  /** 只看某个发布者（`mine=1` 时由服务层填成当前用户） */
  sellerId?: string;
  sort: FleaSort;
}

/** 端口：service 只依赖本类型，实现见 data/flea-market.repository.ts */
export interface FleaItemRepository {
  list(query: FleaItemListQuery): Promise<Page<FleaItemModel>>;
  create(input: CreateFleaItemInput & { sellerId: string }): Promise<FleaItemModel>;
  findById(id: string): Promise<FleaItemModel | null>;
  update(id: string, input: UpdateFleaItemInput): Promise<FleaItemModel>;
  /**
   * 状态与归属相关的字段更新。
   *
   * 单独开一个方法（而不是塞进 `update`）是为了让「客户端可改的字段」
   * 与「状态机可改的字段」在类型层面就分开，避免将来有人从 `update`
   * 把 `status` 传进来绕过状态机。
   */
  applyState(
    id: string,
    patch: { status: FleaStatus; reservedById?: string | null; soldAt?: Date | null },
  ): Promise<FleaItemModel>;
  remove(id: string): Promise<void>;
}

export const FLEA_ITEM_REPOSITORY = Symbol('KEDAYA_FLEA_ITEM_REPOSITORY');
