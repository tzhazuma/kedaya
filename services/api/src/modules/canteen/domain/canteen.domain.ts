/**
 * 食堂营养 · canteen（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
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
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  priceFen: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。 * 本模块支持匿名（无必填归属字段），实名身份与匿名 handle 解耦存储（契约 §9）。 */
export interface CreateCanteenDishInput {
  canteen: string;
  name: string;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  priceFen: number;
}

/** 更新输入（全部可选） */
export interface UpdateCanteenDishInput {
  canteen?: string;
  name?: string;
  caloriesKcal?: number;
  proteinG?: number;
  fatG?: number;
  carbG?: number;
  priceFen?: number;
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
};

export const CANTEEN_DISH_REPOSITORY = Symbol('KEDAYA_CANTEEN_DISH_REPOSITORY');
