import { modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import type { DishRecommendation, NutritionGaps, NutritionTotals } from '@kedaya/shared'
import { err, ok, sumItems, type Result } from '@kedaya/shared'

import { isDishCategory, MEAL_TYPES } from '../../domain/models/nutrition'
import type {
  CanteenDish,
  CreateDishInput,
  DishCategory,
  MealItem,
  MealRecord,
  MealTrend,
  MealType,
  NutritionTargetProfile,
  RecognizeCandidate,
  RecordMealInput,
  SaveTargetInput,
  UpdateMealInput,
} from '../../domain/models/nutrition'
import type { NutritionTarget } from '../../domain/models/nutrition'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  DishPage,
  DishSearchQuery,
  NutritionDashboard,
  NutritionRepository,
  RecognizeResult,
} from '../../domain/ports/nutritionRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端营养管家园仓储（契约 §6.1）。
 *
 * 端点与后端 `canteen` 模块对齐：
 * ```
 * GET    /canteen/dashboard       首页聚合（today + target + gaps + recommendations）
 * GET    /canteen/today           今日营养汇总
 * GET    /canteen/meals?date=     某一天餐记录
 * POST   /canteen/meals           记录当餐（带 Idempotency-Key）
 * PATCH  /canteen/meals/:id       改餐型 / 备注 / 份数
 * DELETE /canteen/meals/:id       删除当餐
 * GET    /canteen/stats?days=     近 N 日趋势
 * GET    /canteen/dishes          菜品检索
 * POST   /canteen/items           录入菜品（管理员）
 * GET    /canteen/targets         我的每日需求
 * PUT    /canteen/targets         设置/更新每日需求
 * POST   /canteen/recognize       拍照识别（演示期 mock）
 * GET    /canteen/recommendations 缺口 + 推荐
 * ```
 *
 * 这里只做「URL + 类型」映射；信封解包、Bearer、trace、401 重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 */

/** 传输层字符串 → 菜品品类。后端只吐合法值，非法值收敛为 other（不崩 UI） */
function toDishCategory(value: unknown): DishCategory {
  return typeof value === 'string' && isDishCategory(value) ? value : 'other'
}

function toMealType(value: unknown): MealType {
  return typeof value === 'string' && (MEAL_TYPES as readonly string[]).includes(value)
    ? (value as MealType)
    : 'lunch'
}

function toIso(value: unknown): string {
  if (typeof value !== 'string') return new Date().toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

interface RawDish {
  id: string
  canteen: string
  name: string
  category?: string
  servingG?: number
  caloriesKcal: number
  proteinG: number
  fatG: number
  carbG: number
  fiberG?: number
  sodiumMg?: number
  priceFen?: number
  source?: string | null
  lastVerifiedAt?: string | null
  allergens?: string[]
}

function toDish(raw: RawDish): CanteenDish {
  return {
    id: raw.id,
    canteen: raw.canteen,
    name: raw.name,
    category: toDishCategory(raw.category),
    servingG: raw.servingG ?? 100,
    caloriesKcal: raw.caloriesKcal,
    proteinG: raw.proteinG,
    fatG: raw.fatG,
    carbG: raw.carbG,
    fiberG: raw.fiberG ?? 0,
    sodiumMg: raw.sodiumMg ?? 0,
    priceFen: raw.priceFen ?? 0,
    source: raw.source ?? null,
    lastVerifiedAt: raw.lastVerifiedAt ?? null,
    allergens: raw.allergens ?? [],
  }
}

interface RawMealItem {
  dishId?: string | null
  dishName: string
  category?: string
  servings?: number
  caloriesKcal: number
  proteinG: number
  fatG: number
  carbG: number
  fiberG?: number
  sodiumMg?: number
}

function toMealItem(raw: RawMealItem): MealItem {
  return {
    dishId: raw.dishId ?? null,
    dishName: raw.dishName,
    category: toDishCategory(raw.category),
    servings: raw.servings ?? 1,
    caloriesKcal: raw.caloriesKcal,
    proteinG: raw.proteinG,
    fatG: raw.fatG,
    carbG: raw.carbG,
    fiberG: raw.fiberG ?? 0,
    sodiumMg: raw.sodiumMg ?? 0,
  }
}

interface RawMealRecord {
  id: string
  mealType?: string
  source?: string
  eatenAt: string
  note?: string | null
  items: RawMealItem[]
}

function toMealRecord(raw: RawMealRecord): MealRecord {
  const items = raw.items.map(toMealItem)
  return {
    id: raw.id,
    mealType: toMealType(raw.mealType),
    source: raw.source === 'photo' ? 'photo' : 'manual',
    eatenAt: toIso(raw.eatenAt),
    note: raw.note ?? null,
    items,
    // 汇总由 shared 统一计算（与后端同一份代码），不在传输层各算一套
    totals: sumItems(items),
  }
}

interface RawTrendDay {
  date: string
  totals: NutritionTotals
  meals: number
  /** 后端新版会带；老版本没有 → 形象判定降级但不报错 */
  mealCounts?: Record<string, number>
  itemsByCategory?: Record<string, number>
}

interface RawTrend {
  days: RawTrendDay[]
  streak: number
  recordedDays: number
  average: NutritionTotals | null
  coverage?: { triedDishCount: number; dishCount: number; rate: number }
}

function toTrend(raw: RawTrend): MealTrend {
  return {
    days: raw.days.map((day) => ({
      date: day.date,
      totals: day.totals,
      meals: day.meals,
      mealCounts: day.mealCounts,
      itemsByCategory: day.itemsByCategory,
    })),
    streak: raw.streak,
    recordedDays: raw.recordedDays,
    average: raw.average,
    coverage: raw.coverage,
  }
}

/** 后端推荐项里的 dish 是完整菜品行；UI 只需要点选用的形态 */
interface RawRecommendation {
  dish: RawDish
  score: number
  reason: string
  fills: Record<string, number>
}

function toRecommendation(raw: RawRecommendation): DishRecommendation {
  return {
    dish: toDish(raw.dish),
    score: raw.score,
    reason: raw.reason,
    fills: raw.fills as DishRecommendation['fills'],
  }
}

export function createHttpNutritionRepository(client: ApiClient): NutritionRepository {
  return {
    async today(): Promise<Result<{ date: string; meals: MealRecord[] }, RepositoryError>> {
      const result = await client.get<{ date: string; meals: RawMealRecord[] }>(
        modulePath('canteen', 'today'),
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({ date: result.value.date, meals: result.value.meals.map(toMealRecord) })
    },

    async dashboard(): Promise<Result<NutritionDashboard, RepositoryError>> {
      const result = await client.get<{
        date: string
        target: NutritionTarget | null
        consumed: NutritionTotals
        gaps: NutritionGaps | null
        recommendations: RawRecommendation[]
        meals: RawMealRecord[]
      }>(modulePath('canteen', 'dashboard'))
      if (!result.ok) return err(toRepositoryError(result.error))
      const value = result.value
      return ok({
        date: value.date,
        target: value.target,
        consumed: value.consumed,
        gaps: value.gaps,
        recommendations: value.recommendations.map(toRecommendation),
        meals: value.meals.map(toMealRecord),
      })
    },

    async mealsByDate(date: string): Promise<Result<{ date: string; meals: MealRecord[] }, RepositoryError>> {
      const result = await client.get<{ date: string; meals: RawMealRecord[] }>(
        modulePath('canteen', 'meals'),
        { date },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({ date: result.value.date, meals: result.value.meals.map(toMealRecord) })
    },

    async recordMeal(input: RecordMealInput): Promise<Result<MealRecord, RepositoryError>> {
      const result = await client.post<RawMealRecord, RecordMealInput>(
        modulePath('canteen', 'meals'),
        input,
        // 弱网重试 / 双击：同一 key 只落一条（契约 §6.1 幂等约定）
        { idempotencyKey: input.clientRequestId },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(toMealRecord(result.value))
    },

    async updateMeal(id: string, input: UpdateMealInput): Promise<Result<MealRecord, RepositoryError>> {
      const result = await client.patch<RawMealRecord, UpdateMealInput>(
        modulePath('canteen', `meals/${encodeURIComponent(id)}`),
        input,
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(toMealRecord(result.value))
    },

    async deleteMeal(id: string): Promise<Result<{ id: string; deleted: true }, RepositoryError>> {
      const result = await client.del<{ id: string; deleted: true }>(
        modulePath('canteen', `meals/${encodeURIComponent(id)}`),
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async trend(days = 7): Promise<Result<MealTrend, RepositoryError>> {
      const result = await client.get<RawTrend>(modulePath('canteen', 'stats'), { days })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(toTrend(result.value))
    },

    async listDishes(query: DishSearchQuery = {}): Promise<Result<DishPage, RepositoryError>> {
      const result = await client.get<Page<RawDish>>(modulePath('canteen', 'dishes'), {
        q: query.q,
        category: query.category,
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? 20,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({
        items: result.value.items.map(toDish),
        nextCursor: result.value.nextCursor,
      })
    },

    async createDish(input: CreateDishInput): Promise<Result<CanteenDish, RepositoryError>> {
      const result = await client.post<RawDish, CreateDishInput>(
        modulePath('canteen', 'items'),
        input,
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(toDish(result.value))
    },

    async getTarget(): Promise<Result<NutritionTargetProfile | null, RepositoryError>> {
      const result = await client.get<NutritionTargetProfile | null>(modulePath('canteen', 'targets'))
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async saveTarget(input: SaveTargetInput): Promise<Result<NutritionTargetProfile, RepositoryError>> {
      const result = await client.put<NutritionTargetProfile, SaveTargetInput>(
        modulePath('canteen', 'targets'),
        input,
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async recognize(imageUrl: string): Promise<Result<RecognizeResult, RepositoryError>> {
      const result = await client.post<
        { mode: RecognizeCandidate['mode']; candidates: Array<RecognizeCandidate & { dish?: RawDish | null }> },
        { imageUrl: string }
      >(modulePath('canteen', 'recognize'), { imageUrl })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({
        mode: result.value.mode,
        candidates: result.value.candidates.map((candidate) => ({
          ...candidate,
          dish: candidate.dish ? toDish(candidate.dish) : null,
        })),
      })
    },

    async recommendations(): Promise<
      Result<
        {
          target: NutritionTarget
          consumed: NutritionTarget
          gaps: NutritionGaps
          recommendations: DishRecommendation[]
        },
        RepositoryError
      >
    > {
      const result = await client.get<{
        target: NutritionTarget
        consumed: NutritionTarget
        gaps: NutritionGaps
        recommendations: RawRecommendation[]
      }>(modulePath('canteen', 'recommendations'))
      if (!result.ok) return err(toRepositoryError(result.error))
      const value = result.value
      return ok({
        target: value.target,
        consumed: value.consumed,
        gaps: value.gaps,
        recommendations: value.recommendations.map(toRecommendation),
      })
    },
  }
}
