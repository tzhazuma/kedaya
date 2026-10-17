import {
  computeGaps,
  computeStreak,
  dayRange,
  NUTRIENT_KEYS,
  recommendDishes,
  sumItems,
  err,
  ok,
  type MealType,
  type NutritionTotals,
  type Result,
} from '@kedaya/shared'

import { validateDishInput } from '../../domain/models/nutrition'
import type {
  CreateDishInput,
  DailyMealSummary,
  MealRecord,
  MealTrend,
  NutritionTarget,
  NutritionTargetProfile,
  RecognizeCandidate,
  RecordMealInput,
  SaveTargetInput,
  UpdateMealInput,
} from '../../domain/models/nutrition'
import { MEAL_TYPES } from '../../domain/models/nutrition'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  DishPage,
  DishSearchQuery,
  NutritionDashboard,
  NutritionRepository,
  RecognizeResult,
} from '../../domain/ports/nutritionRepository'
import type { CanteenDish } from '../../domain/models/nutrition'
import { createNutritionDatabase, type NutritionDatabase } from '../mock/nutritionDatabase'

/**
 * Mock 营养管家园仓储 —— 契约 §7 硬规则 4：必须有 mock adapter，让 UI 在无后端时开发。
 *
 * 与 mockGroupBuyRepository 同风格：除端口外暴露演示控制面
 * （reset / failNextRequests / setLatency），空态 / 错误态可真实触发。
 */

export interface MockNutritionRepository extends NutritionRepository {
  readonly kind: 'mock'
  reset(): void
  /** 让接下来 N 次请求失败（演示错误态） */
  failNextRequests(times: number): void
  setLatency(ms: number): void
  /** 演示数据：往前补 N 天记录（趋势图 / 周报用），返回新增条数 */
  seedPastDays(days: number): number
}

export interface MockNutritionRepositoryOptions {
  latencyMs?: number
  now?: () => Date
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createMockNutritionRepository(
  options: MockNutritionRepositoryOptions = {},
): MockNutritionRepository {
  const db: NutritionDatabase = createNutritionDatabase()
  const now = options.now ?? (() => new Date())
  let latencyMs = options.latencyMs ?? 220
  let remainingFailures = 0

  async function guard<T>(work: () => Result<T, RepositoryError>): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  function requireTarget(): Result<NutritionTarget, RepositoryError> {
    const target = db.getTarget()
    if (target === null) {
      return err({ code: 'VALIDATION_FAILED', message: '请先设置每日营养需求' })
    }
    return ok(target)
  }

  function todayMeals(): MealRecord[] {
    return db.mealsForDay(dayRange(now()).key, now())
  }

  function buildRecommendations(
    target: NutritionTarget & { avoidAllergens?: string[] },
    consumed: NutritionTotals,
    meals: MealRecord[],
  ) {
    const items = meals.flatMap((meal) => meal.items)
    return recommendDishes(db.listDishes({ limit: 100 }).items, target, consumed, {
      limit: 5,
      eatenCategories: items.map((item) => item.category),
      // 今天已经吃过的菜不再推荐（与后端同一口径）
      eatenDishIds: items.map((item) => item.dishId).filter((id): id is string => id !== null),
      // 忌口/过敏原硬过滤（与后端同一口径）
      excludeAllergens: target.avoidAllergens ?? [],
    })
  }

  /** 近 N 日趋势：没有记录的天也补齐（HTML 柱状图需要等宽的列） */
  function buildTrend(days: number): MealTrend {
    // 与后端同一口径：上限 92 天（季度形象要近 90 天）
    const span = Number.isInteger(days) && days >= 1 && days <= 92 ? days : 7
    const from = new Date(now().getTime() - (span - 1) * 24 * 60 * 60 * 1000)
    const start = dayRange(from).from
    const records = db.mealsSince(start)

    const byDay = new Map<string, MealRecord[]>()
    for (const meal of records) {
      const key = dayRange(new Date(meal.eatenAt)).key
      const bucket = byDay.get(key)
      if (bucket === undefined) byDay.set(key, [meal])
      else bucket.push(meal)
    }

    const list: DailyMealSummary[] = []
    for (let offset = span - 1; offset >= 0; offset -= 1) {
      const date = new Date(now().getTime() - offset * 24 * 60 * 60 * 1000)
      const key = dayRange(date).key
      const dayMeals = byDay.get(key) ?? []
      const mealCounts: Partial<Record<MealType, number>> = {}
      const itemsByCategory: Record<string, number> = {}
      for (const meal of dayMeals) {
        mealCounts[meal.mealType] = (mealCounts[meal.mealType] ?? 0) + 1
        for (const item of meal.items) {
          itemsByCategory[item.category] = (itemsByCategory[item.category] ?? 0) + 1
        }
      }
      list.push({
        date: key,
        totals: sumItems(dayMeals.flatMap((meal) => meal.items)),
        meals: dayMeals.length,
        mealCounts,
        itemsByCategory,
      })
    }

    const recorded = list.filter((day) => day.meals > 0)
    const average =
      recorded.length === 0
        ? null
        : recorded.reduce<NutritionTotals>(
            (sum, day) => {
              for (const key of NUTRIENT_KEYS) sum[key] += day.totals[key] / recorded.length
              return sum
            },
            { caloriesKcal: 0, proteinG: 0, fatG: 0, carbG: 0, fiberG: 0, sodiumMg: 0 },
          )

    return {
      days: list,
      streak: computeStreak(recorded.map((day) => day.date), dayRange(now()).key),
      recordedDays: recorded.length,
      average,
      coverage: (() => {
        // 与后端同一口径：窗口内吃过的不同菜品 / 菜品库总数
        const tried = new Set<string>()
        for (const meal of records) {
          for (const item of meal.items) if (item.dishId !== null) tried.add(item.dishId)
        }
        const dishCount = db.countDishes()
        return {
          triedDishCount: tried.size,
          dishCount,
          rate: dishCount === 0 ? 0 : tried.size / dishCount,
        }
      })(),
    }
  }

  return {
    kind: 'mock',

    today(): Promise<Result<{ date: string; meals: MealRecord[] }, RepositoryError>> {
      return guard(() => ok({ date: dayRange(now()).key, meals: todayMeals() }))
    },

    dashboard(): Promise<Result<NutritionDashboard, RepositoryError>> {
      return guard(() => {
        const meals = todayMeals()
        const consumed = sumItems(meals.flatMap((meal) => meal.items))
        const target = db.getTarget()
        return ok({
          date: dayRange(now()).key,
          target,
          consumed,
          gaps: target === null ? null : computeGaps(target, consumed),
          recommendations: target === null ? [] : buildRecommendations(target, consumed, meals),
          meals,
        })
      })
    },

    mealsByDate(date: string): Promise<Result<{ date: string; meals: MealRecord[] }, RepositoryError>> {
      return guard(() => ok({ date, meals: db.mealsForDay(date, now()) }))
    },

    recordMeal(input: RecordMealInput): Promise<Result<MealRecord, RepositoryError>> {
      return guard(() => {
        if (!(MEAL_TYPES as readonly string[]).includes(input.mealType)) {
          return err({ code: 'VALIDATION_FAILED', message: '请选择餐型' })
        }
        if (input.items.length === 0) {
          return err({ code: 'VALIDATION_FAILED', message: '至少选择一道菜' })
        }
        try {
          return ok(db.addMeal(input, now()))
        } catch (error) {
          return err({
            code: 'VALIDATION_FAILED',
            message: error instanceof Error ? error.message : '记录失败',
          })
        }
      })
    },

    updateMeal(id: string, input: UpdateMealInput): Promise<Result<MealRecord, RepositoryError>> {
      return guard(() => {
        const updated = db.updateMeal(id, input)
        if (updated === null) {
          return err({ code: 'NOT_FOUND', message: '这条用餐记录不存在' })
        }
        return ok(updated)
      })
    },

    deleteMeal(id: string): Promise<Result<{ id: string; deleted: true }, RepositoryError>> {
      return guard(() => {
        const removed = db.deleteMeal(id)
        if (!removed) return err({ code: 'NOT_FOUND', message: '这条用餐记录不存在' })
        return ok({ id, deleted: true as const })
      })
    },

    trend(days = 7): Promise<Result<MealTrend, RepositoryError>> {
      return guard(() => ok(buildTrend(days)))
    },

    listDishes(query: DishSearchQuery = {}): Promise<Result<DishPage, RepositoryError>> {
      return guard(() => ok(db.listDishes(query)))
    },

    createDish(input: CreateDishInput): Promise<Result<CanteenDish, RepositoryError>> {
      return guard(() => {
        const invalid = validateDishInput(input)
        if (invalid !== null) return err({ code: 'VALIDATION_FAILED', message: invalid })
        return ok(db.addDish(input))
      })
    },

    getTarget(): Promise<Result<NutritionTargetProfile | null, RepositoryError>> {
      return guard(() => ok(db.getTarget()))
    },

    saveTarget(input: SaveTargetInput): Promise<Result<NutritionTargetProfile, RepositoryError>> {
      return guard(() => {
        if (input.caloriesKcal < 1 || input.caloriesKcal > 10000) {
          return err({ code: 'VALIDATION_FAILED', message: '热量目标需在 1-10000 kcal 之间' })
        }
        return ok(db.setTarget(input))
      })
    },

    recognize(imageUrl: string): Promise<Result<RecognizeResult, RepositoryError>> {
      return guard(() => {
        const result = db.recognize(imageUrl)
        const candidates: RecognizeCandidate[] = result.candidates
        return ok({ mode: result.mode, candidates })
      })
    },

    recommendations(): Promise<
      Result<
        {
          target: NutritionTarget
          consumed: NutritionTarget
          gaps: ReturnType<typeof computeGaps>
          recommendations: ReturnType<typeof recommendDishes>
        },
        RepositoryError
      >
    > {
      return guard(() => {
        const targetResult = requireTarget()
        if (!targetResult.ok) return targetResult
        const target = targetResult.value

        const meals = todayMeals()
        const consumed = sumItems(meals.flatMap((meal) => meal.items))

        return ok({
          target,
          consumed,
          gaps: computeGaps(target, consumed),
          recommendations: buildRecommendations(target, consumed, meals),
        })
      })
    },

    reset(): void {
      db.reset()
      remainingFailures = 0
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    setLatency(ms: number): void {
      latencyMs = Math.max(0, ms)
    },

    seedPastDays(days: number): number {
      return db.seedPastDays(Math.max(0, Math.floor(days)), now())
    },
  }
}
