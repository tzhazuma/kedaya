/**
 * 营养管家园 · 菜品领域模型（Web 后台侧，ADR 0006）。
 *
 * 纯 TypeScript，零框架依赖（契约 §7）。营养口径与后端 / 小程序一致：
 * **每份**（不是每 100g），六项：热量 / 蛋白质 / 脂肪 / 碳水 / 膳食纤维 / 钠。
 * 计算不在这里 —— 汇总与缺口一律用 `@kedaya/shared` 的 nutrition.ts。
 */

import {
  DISH_CATEGORIES,
  DISH_CATEGORY_LABELS,
  isDishCategory,
  validateDishInput,
  type DishCategory,
} from '@kedaya/shared';

export { DISH_CATEGORIES, DISH_CATEGORY_LABELS, isDishCategory, validateDishInput };
export type { DishCategory };

/** 菜品库中的一道菜 */
export interface CanteenDish {
  id: string;
  canteen: string;
  name: string;
  category: DishCategory;
  /** 每份克数（营养字段的计量口径） */
  servingG: number;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG: number;
  sodiumMg: number;
  /** 价格，整数分 */
  priceFen: number;
  createdAt?: string;
  updatedAt?: string;
}

/** 新建菜品输入（id / 时间戳由后端生成） */
export interface CreateDishInput {
  canteen: string;
  name: string;
  category: DishCategory;
  servingG: number;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG: number;
  sodiumMg: number;
  priceFen: number;
}

/** 更新输入（全部可选） */
export type UpdateDishInput = Partial<CreateDishInput>;

/** 菜品检索查询（游标分页，契约 §6.1 不用 offset） */
export interface DishQuery {
  q?: string;
  category?: DishCategory;
  cursor?: string | null;
  limit?: number;
}

export interface DishPage {
  items: CanteenDish[];
  nextCursor: string | null;
}

/** 六项营养的展示元数据（表格列 / 表单标签共用） */
export const NUTRIENT_FIELDS: ReadonlyArray<{
  key: 'caloriesKcal' | 'proteinG' | 'fatG' | 'carbG' | 'fiberG' | 'sodiumMg';
  label: string;
  unit: string;
}> = [
  { key: 'caloriesKcal', label: '热量', unit: 'kcal' },
  { key: 'proteinG', label: '蛋白质', unit: 'g' },
  { key: 'fatG', label: '脂肪', unit: 'g' },
  { key: 'carbG', label: '碳水', unit: 'g' },
  { key: 'fiberG', label: '膳食纤维', unit: 'g' },
  { key: 'sodiumMg', label: '钠', unit: 'mg' },
];

/** 一行营养摘要（列表副文本用） */
export function dishNutritionSummary(dish: CanteenDish): string {
  return `${dish.caloriesKcal} kcal · 蛋白 ${dish.proteinG}g · 脂肪 ${dish.fatG}g · 碳水 ${dish.carbG}g · 纤维 ${dish.fiberG}g · 钠 ${dish.sodiumMg}mg`;
}
