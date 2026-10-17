/**
 * 营养管家园（`canteen`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 计算全部委托 `@kedaya/shared` 的 `nutrition.ts`（三端唯一真相），
 * 本文件只放小程序侧的**模型形状**与**展示派生**（进度行等）。
 *
 * 契约要点：
 * - 金额一律整数分（`priceFen`），展示层才用 `fenToYuan` 转元
 * - 时间一律 ISO-8601 UTC 字符串（`eatenAt`）
 * - 菜品营养字段 = **每份**口径，与后端 `CanteenDish` 一致
 */

import {
  DISH_CATEGORIES,
  DISH_CATEGORY_LABELS,
  isDishCategory,
  MEAL_TYPES,
  MEAL_TYPE_LABELS,
  NUTRIENT_LABELS,
  NUTRIENT_UNITS,
  suggestMealType,
  type ActivityLevel,
  type DishCategory,
  type MealType,
  type NutritionGoal,
  type NutritionTarget,
  type NutritionTotals,
  type Sex,
} from '@kedaya/shared'

export {
  DISH_CATEGORIES,
  DISH_CATEGORY_LABELS,
  isDishCategory,
  MEAL_TYPES,
  MEAL_TYPE_LABELS,
  NUTRIENT_LABELS,
  NUTRIENT_UNITS,
  suggestMealType,
}
export type { ActivityLevel, DishCategory, MealType, NutritionGoal, NutritionTarget, NutritionTotals, Sex }

/**
 * 估算器需要的身体档案。
 *
 * 为什么和每日需求一起存：不存的话，用户每次重新估算都要重填性别/年龄/身高/体重，
 * 体重变了也无法一键更新目标 —— 「因人而异」就变成了一次性动作。
 */
export interface BodyProfile {
  sex?: Sex
  age?: number
  heightCm?: number
  weightKg?: number
  activity?: ActivityLevel
  goal?: NutritionGoal
}

/** 保存每日需求的输入（六项 + 可选身体档案 + 忌口） */
export type SaveTargetInput = NutritionTarget &
  BodyProfile & {
    /** 忌口 / 过敏原（机器值，见 shared 的 ALLERGENS）；推荐阶段硬过滤 */
    avoidAllergens?: string[]
  }

/** 读取到的每日需求（含身体档案与忌口，可空） */
export type NutritionTargetProfile = NutritionTarget &
  Partial<BodyProfile> & {
    avoidAllergens?: string[]
  }

/** 菜品库中的一道菜（营养为每份口径） */
export interface CanteenDish {
  id: string
  canteen: string
  name: string
  category: DishCategory
  /** 每份克数（仅说明一份多大，营养值已是整份） */
  servingG: number
  caloriesKcal: number
  proteinG: number
  fatG: number
  carbG: number
  fiberG: number
  sodiumMg: number
  /** 价格，整数分 */
  priceFen: number
  /** 营养数据来源（食堂公示 / 人工录入 / 供应商提供），可空 */
  source?: string | null
  /** 营养数据最后一次核对时间（ISO），可空 */
  lastVerifiedAt?: string | null
  /** 过敏原 / 忌口标签（机器值）；空数组 = 未标注 */
  allergens?: string[]
}

/**
 * 购物车只需要「能显示 + 能落库」的字段。
 *
 * 推荐卡、识别候选、搜索结果的形状略有不同（推荐卡没有 canteen/servingG/priceFen），
 * 统一成这个最小形状后，三个入口都能一键加入当餐。
 */
export type CartDish = Pick<
  CanteenDish,
  'id' | 'name' | 'category' | 'caloriesKcal' | 'proteinG' | 'fatG' | 'carbG' | 'fiberG' | 'sodiumMg'
> &
  Partial<
    Pick<CanteenDish, 'canteen' | 'servingG' | 'priceFen' | 'source' | 'lastVerifiedAt' | 'allergens'>
  >

/** 当餐明细（营养快照） */
export interface MealItem {
  dishId: string | null
  dishName: string
  category: DishCategory
  /** 份数，支持 0.5（半份） */
  servings: number
  caloriesKcal: number
  proteinG: number
  fatG: number
  carbG: number
  fiberG: number
  sodiumMg: number
}

/** 当餐记录 */
export interface MealRecord {
  id: string
  mealType: MealType
  /** manual 菜名选择 / photo 拍照识别 */
  source: 'manual' | 'photo'
  eatenAt: string
  note: string | null
  items: MealItem[]
  /** 本餐营养汇总（快照值之和） */
  totals: NutritionTotals
}

/** 拍照识别候选（dish 为 null = 菜品库还没有这道菜，UI 须诚实提示） */
export interface RecognizeCandidate {
  name: string
  category: DishCategory
  /** 置信度 0-1（演示值为演出数据） */
  confidence: number
  mode: 'mock' | 'vision-api'
  dish: CanteenDish | null
}

/** 记录当餐的输入（客户端传不了营养值，一律由菜品库快照） */
export interface RecordMealInput {
  mealType: MealType
  source: 'manual' | 'photo'
  eatenAt?: string
  note?: string
  /** 幂等键：弱网重试 / 双击不会记成两餐 */
  clientRequestId?: string
  items: Array<{ dishId?: string; dishName: string; servings?: number }>
}

/**
 * 修改当餐：只改「餐型 / 备注 / 份数」。
 * 换菜等于换营养快照，走「删除 + 重记」，不在这里猜用户意图。
 */
export interface UpdateMealInput {
  mealType?: MealType
  note?: string | null
  /** 与 items 等长的份数数组 */
  servings?: number[]
}

/** 某一天的营养汇总（趋势图的一个点） */
export interface DailyMealSummary {
  date: string
  totals: NutritionTotals
  meals: number
  /** 各餐型条数（形象判定用；老后端可能没有） */
  mealCounts?: Partial<Record<MealType, number>>
  /** 各品类菜品条数（形象判定用；老后端可能没有） */
  itemsByCategory?: Record<string, number>
}

/** 近 N 日趋势 */
export interface MealTrend {
  days: DailyMealSummary[]
  streak: number
  recordedDays: number
  average: NutritionTotals | null
  /** 菜品覆盖率（季度形象判定用）：窗口内吃过的不同菜品 / 菜品库总数 */
  coverage?: {
    triedDishCount: number
    dishCount: number
    rate: number
  }
}

/** 新建菜品（后台录入 / 演示录入共用） */
export interface CreateDishInput {
  canteen: string
  name: string
  category: DishCategory
  servingG: number
  caloriesKcal: number
  proteinG: number
  fatG: number
  carbG: number
  fiberG: number
  sodiumMg: number
  priceFen: number
}

/* ------------------------------------------------------------------ *
 * 展示派生：营养进度
 * ------------------------------------------------------------------ */

export type NutrientKey = keyof NutritionTotals

const NUTRIENT_META: Readonly<Record<NutrientKey, { label: string; unit: string; upper: boolean }>> = {
  caloriesKcal: { label: NUTRIENT_LABELS.caloriesKcal, unit: NUTRIENT_UNITS.caloriesKcal, upper: false },
  proteinG: { label: NUTRIENT_LABELS.proteinG, unit: NUTRIENT_UNITS.proteinG, upper: false },
  fatG: { label: NUTRIENT_LABELS.fatG, unit: NUTRIENT_UNITS.fatG, upper: false },
  carbG: { label: NUTRIENT_LABELS.carbG, unit: NUTRIENT_UNITS.carbG, upper: false },
  fiberG: { label: NUTRIENT_LABELS.fiberG, unit: NUTRIENT_UNITS.fiberG, upper: false },
  sodiumMg: { label: NUTRIENT_LABELS.sodiumMg, unit: NUTRIENT_UNITS.sodiumMg, upper: true },
}

export interface NutrientProgress {
  key: NutrientKey
  label: string
  unit: string
  current: number
  target: number
  /** 0-100+，可超过 100（超限） */
  percent: number
  /** true = 上限型（钠）：越少越好 */
  isUpperLimit: boolean
  /** 目标型：current ≥ target；上限型：current ≤ target */
  met: boolean
}

/** 单项营养进度。纯函数，UI 与测试共用 */
export function nutrientProgress(
  key: NutrientKey,
  target: NutritionTarget,
  consumed: NutritionTotals,
): NutrientProgress {
  const meta = NUTRIENT_META[key]
  const targetValue = target[key]
  const current = consumed[key]
  return {
    key,
    label: meta.label,
    unit: meta.unit,
    current,
    target: targetValue,
    percent: targetValue <= 0 ? 0 : Math.round((current / targetValue) * 100),
    isUpperLimit: meta.upper,
    met: meta.upper ? current <= targetValue : current >= targetValue,
  }
}

/** 全部六项进度（顺序即展示顺序：热量在最前） */
export function allNutrientProgress(
  target: NutritionTarget,
  consumed: NutritionTotals,
): NutrientProgress[] {
  return (Object.keys(NUTRIENT_META) as NutrientKey[]).map((key) => nutrientProgress(key, target, consumed))
}

/** 查看某个营养 key 的中文名（推荐理由的 fills 徽标要用） */
export function nutrientLabel(key: string): string {
  return (NUTRIENT_LABELS as Record<string, string>)[key] ?? key
}

/** 购物车条目（记录当餐页的本地态，不落端口） */
export interface CartItem {
  dish: CartDish
  servings: number
}

/** 份数步进（半份是食堂常态） */
export const SERVING_STEP = 0.5

/**
 * 菜品（含推荐项）→ 购物车项。
 *
 * 三个入口（搜索 / 拍照识别 / 推荐）拿到的最小形状不同，
 * 统一成 `CartDish` 后都能「一键加入当餐」。
 */
export function toCartDish(dish: {
  id: string
  name: string
  category?: unknown
  caloriesKcal: number
  proteinG: number
  fatG: number
  carbG: number
  fiberG: number
  sodiumMg: number
  allergens?: readonly string[]
}): CartDish {
  return {
    id: dish.id,
    name: dish.name,
    category: isDishCategory(dish.category) ? dish.category : 'other',
    caloriesKcal: dish.caloriesKcal,
    proteinG: dish.proteinG,
    fatG: dish.fatG,
    carbG: dish.carbG,
    fiberG: dish.fiberG,
    sodiumMg: dish.sodiumMg,
    allergens: dish.allergens === undefined ? undefined : [...dish.allergens],
  }
}

/**
 * 营养数据来源的一行说明：`来源：一食堂公告栏公示 · 更新于 2026-10-12`。
 * 两个字段都没有时返回 null（UI 就不显示这一行，不编造）。
 */
export function formatNutrientSource(
  source?: string | null,
  lastVerifiedAt?: string | null,
): string | null {
  const parts: string[] = []
  if (typeof source === 'string' && source.trim() !== '') parts.push(`来源：${source.trim()}`)
  const iso = typeof lastVerifiedAt === 'string' ? new Date(lastVerifiedAt) : null
  if (iso !== null && !Number.isNaN(iso.getTime())) {
    const y = iso.getFullYear()
    const m = String(iso.getMonth() + 1).padStart(2, '0')
    const d = String(iso.getDate()).padStart(2, '0')
    parts.push(`更新于 ${y}-${m}-${d}`)
  }
  return parts.length === 0 ? null : parts.join(' · ')
}

/**
 * 菜品录入校验 —— 规则在 `@kedaya/shared` 只写一份
 * （小程序 mock 与 Web 后台共用），这里转出以保持 domain 导入面统一。
 */
export { validateDishInput } from '@kedaya/shared'
