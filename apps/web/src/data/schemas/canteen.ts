/**
 * 菜品传输层校验（zod）—— 与后端 `canteen` 模块的字段一一对应。
 *
 * 六项营养口径：每份（不是每 100g）。契约 §6.1：时间一律 ISO-8601 UTC 字符串。
 */

import { z } from 'zod';

import type { CreateDishInput, CanteenDish, DishPage, UpdateDishInput } from '@/domain/models/canteen';

type AssertAssignable<From extends To, To> = true;

const dishCategorySchema = z.enum([
  'staple',
  'meat',
  'vegetable',
  'soup',
  'dessert',
  'drink',
  'fruit',
  'other',
]);

const nutritionInt = z.number().int().min(0);

export const dishSchema = z.object({
  id: z.string().min(1),
  canteen: z.string().min(1),
  name: z.string().min(1),
  category: dishCategorySchema,
  servingG: z.number().int().positive(),
  caloriesKcal: nutritionInt,
  proteinG: nutritionInt,
  fatG: nutritionInt,
  carbG: nutritionInt,
  fiberG: nutritionInt,
  sodiumMg: nutritionInt,
  priceFen: nutritionInt,
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
});

export const dishPageSchema = z.object({
  items: z.array(dishSchema),
  nextCursor: z.string().nullable(),
});

/** 后台表单提交体（不含 id / 时间戳） */
export const createDishSchema = z.object({
  canteen: z.string().min(1),
  name: z.string().min(1),
  category: dishCategorySchema,
  servingG: z.number().int().positive(),
  caloriesKcal: nutritionInt,
  proteinG: nutritionInt,
  fatG: nutritionInt,
  carbG: nutritionInt,
  fiberG: nutritionInt,
  sodiumMg: nutritionInt,
  priceFen: nutritionInt,
});

export const updateDishSchema = createDishSchema.partial();

/* ---------------------------------- 防漂移 ---------------------------------- */

export type __DishSchemaMatchesDomain = AssertAssignable<
  z.infer<typeof dishSchema>,
  CanteenDish
>;
export type __CreateDishSchemaMatchesDomain = AssertAssignable<
  z.infer<typeof createDishSchema>,
  CreateDishInput
>;
export type __UpdateDishSchemaMatchesDomain = AssertAssignable<
  z.infer<typeof updateDishSchema>,
  UpdateDishInput
>;
export type __DishPageSchemaMatchesDomain = AssertAssignable<
  z.infer<typeof dishPageSchema>,
  DishPage
>;

/* ---------------------------------- 解析助手 ---------------------------------- */

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

export function safeParseDish(input: unknown): { ok: true; value: CanteenDish } | { ok: false; issues: string[] } {
  const result = dishSchema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false, issues: formatZodIssues(result.error) };
}

export function safeParseDishPage(input: unknown): { ok: true; value: DishPage } | { ok: false; issues: string[] } {
  const result = dishPageSchema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false, issues: formatZodIssues(result.error) };
}
