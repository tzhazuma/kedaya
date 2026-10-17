/**
 * 营养管家 · canteen（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';
import type { Page } from '@kedaya/contracts';
/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface CanteenDishModel {
  id: string;
  canteen: string;
  name: string;
  category: string;
  servingG: number;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG: number;
  sodiumMg: number;
  priceFen: number;
  /** 营养数据来源（食堂公示 / 人工录入 / 供应商提供），可空 */
  source: string | null;
  /** 营养数据最后核对时间，可空 */
  lastVerifiedAt: Date | null;
  /** 过敏原 / 忌口标签（机器值）；空数组 = 未标注 */
  allergens: string[];
  /** 软删除（下架）时间；列表/检索/推荐都应过滤掉非 null 的行 */
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。 * 本模块支持匿名（无必填归属字段），实名身份与匿名 handle 解耦存储（契约 §9）。 */
export interface CreateCanteenDishInput {
  canteen: string;
  name: string;
  category?: string;
  servingG?: number;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG?: number;
  sodiumMg?: number;
  priceFen: number;
  source?: string;
  lastVerifiedAt?: Date;
  allergens?: string[];
}

/** 更新输入（全部可选） */
export interface UpdateCanteenDishInput {
  canteen?: string;
  name?: string;
  category?: string;
  servingG?: number;
  caloriesKcal?: number;
  proteinG?: number;
  fatG?: number;
  carbG?: number;
  fiberG?: number;
  sodiumMg?: number;
  priceFen?: number;
  source?: string;
  lastVerifiedAt?: Date;
  allergens?: string[];
}

/** 端口：service 只依赖本类型，实现见 data/canteen.repository.ts */
export type CanteenDishRepository = ResourceRepository<
  CanteenDishModel,
  CreateCanteenDishInput,
  UpdateCanteenDishInput
> & {
  summarizeByCanteen(
    canteen: string,
  ): Promise<{ dishes: number; totalCaloriesKcal: number; avgPriceFen: number }>;

  /** 菜品检索（营养管家园的菜品选择器，ADR 0006） */
  searchDishes(query: {
    q?: string;
    category?: string;
    canteen?: string;
    cursor?: string;
    limit: number;
  }): Promise<Page<CanteenDishModel>>;

  /**
   * 按菜名**精确**取一道菜（未下架）。
   * 记录当餐与识别回填都必须用它 —— 用 `searchDishes(q)` + 20 条窗口再全等过滤，
   * 在菜名是常见子串时会误判「菜品库没有」（ADR 0006 D7）。
   */
  findByExactName(name: string): Promise<CanteenDishModel | null>;

  /**
   * 推荐候选池：未下架菜品，按「最近维护」优先。
   * 不能用 id 升序取前 N —— cuid 近似时间序，等于永远只推荐最早录入的 100 道。
   */
  listForRecommendation(limit: number): Promise<CanteenDishModel[]>;

  /** 未下架菜品总数（「菜品覆盖率」的分母，形象判定用） */
  countActive(): Promise<number>;
};

export const CANTEEN_DISH_REPOSITORY = Symbol('KEDAYA_CANTEEN_DISH_REPOSITORY');
