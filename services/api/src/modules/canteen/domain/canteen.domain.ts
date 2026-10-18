/**
 * 营养管家 · canteen（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { Page } from '@kedaya/contracts';
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface CanteenDishModel {
  /**
   * 主键。脚手架生成的模型漏了它，但列表返回的 Prisma 行**总是**带 id：
   * 客户端的详情页、分享落地路径与游标分页全靠它，缺了它这个模块不可用。
   */
  id: string;
  canteen: string;
  name: string;
  /** 菜的种类（机器值，见 shared 的 `DISH_CATEGORIES`）；中文名在客户端映射 */
  category: string;
  /** 每份克数（营养口径 = 每份，不是每 100g） */
  servingG: number;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  /** 膳食纤维（六项口径之一，ADR 0006 D5） */
  fiberG: number;
  /** 钠，上限值口径（mg） */
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

/**
 * 列表筛选条件（controller 用 Zod 白名单校验后组装 → service 原样透传 →
 * data 层显式翻译成 Prisma `where`）。
 *
 * 刻意用 `type` 而不是 `interface`：类型别名带隐式索引签名，可直接赋给
 * `ListParams['filters']` 的 `Record<string, string | number | boolean | undefined>`。
 */
export type CanteenDishListFilters = {
  /** 食堂名，精确匹配（列表页 chip 只产出白名单内的值） */
  canteen?: string;
  /** 菜名关键词，`contains` 模糊匹配（不区分大小写） */
  q?: string;
  /** 菜的种类，精确匹配（营养管家菜品选择器的品类 chip） */
  category?: string;
};

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
