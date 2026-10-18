import {
  computeGaps,
  dayRange,
  sumByMealType,
  sumItems,
  type DishRecommendation,
  type MealTypeTotals,
  type NutritionGaps,
  type NutritionTarget,
  type NutritionTotals,
} from '@kedaya/shared'

import { allNutrientProgress } from '../../domain/models/nutrition'
import type { MealRecord, NutrientProgress, UpdateMealInput } from '../../domain/models/nutrition'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { NutritionRepository } from '../../domain/ports/nutritionRepository'

/**
 * 今日营养用例 —— 营养管家园首页的数据源。
 *
 * 契约 §8 启动时序：
 * 1. `hydrate()`：**同步**读本地缓存（缓存带日期，非今天的一律作废）
 * 2. 页面先渲染缓存
 * 3. `load()`：**一次**拉首页聚合（今日汇总 + 需求 + 缺口 + 推荐），
 *    再在本地用 shared 复算一遍派生数据 —— 两端口径同一份代码，不会漂移。
 *
 * 记错了要能改：`removeMeal` / `updateMeal` 落库后重新 `load()`，
 * 首页立刻反映真实摄入（没有删除能力时，一条错记录会永久污染当天进度）。
 */

export type TodayStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface TodayNutritionState {
  status: TodayStatus
  date: string | null
  meals: MealRecord[]
  totals: NutritionTotals
  /** 未设置每日需求时为 null（页面引导去设置） */
  target: NutritionTarget | null
  gaps: NutritionGaps | null
  progress: NutrientProgress[]
  /** 早/午/晚/加餐各自的汇总（四类恒定返回） */
  byMealType: MealTypeTotals[]
  /** 今日推荐（首页预览用；没设置需求时为空） */
  recommendations: DishRecommendation[]
  error: string | null
  fromCache: boolean
  updatedAt: string | null
  /** 正在删除的记录 id（按钮 loading 用） */
  deletingId: string | null
}

export interface CachedTodayNutrition {
  date: string
  meals: MealRecord[]
  updatedAt: string
}

export interface TodayNutritionDeps {
  repository: NutritionRepository
  cache: CachePort
  clock: ClockPort
  /** 缓存 key 由装配层（app/container）注入 */
  cacheKey: string
}

export interface TodayNutritionUseCase {
  getSnapshot(): TodayNutritionState
  subscribe(listener: () => void): () => void
  hydrate(): TodayNutritionState
  load(): Promise<TodayNutritionState>
  /** 删除一条记录（只能删自己的；失败返回 false 并带回错误文案） */
  removeMeal(id: string): Promise<boolean>
  /** 改餐型 / 备注 / 份数 */
  updateMeal(id: string, input: UpdateMealInput): Promise<boolean>
  reset(): void
}

const INITIAL_STATE: TodayNutritionState = {
  status: 'idle',
  date: null,
  meals: [],
  totals: { caloriesKcal: 0, proteinG: 0, fatG: 0, carbG: 0, fiberG: 0, sodiumMg: 0 },
  target: null,
  gaps: null,
  progress: [],
  byMealType: [],
  recommendations: [],
  error: null,
  fromCache: false,
  updatedAt: null,
  deletingId: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 缓存可能由旧版本写入，必须做形状校验；且**只认今天**的缓存 */
export function isCachedTodayNutrition(value: unknown, todayKey: string): value is CachedTodayNutrition {
  if (!isRecord(value)) return false
  return value.date === todayKey && Array.isArray(value.meals) && typeof value.updatedAt === 'string'
}

export function createTodayNutritionUseCase(deps: TodayNutritionDeps): TodayNutritionUseCase {
  const { repository, cache, clock, cacheKey } = deps

  let state: TodayNutritionState = INITIAL_STATE
  let hydrated = false
  const listeners = new Set<() => void>()

  function patch(next: Partial<TodayNutritionState>): TodayNutritionState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function todayKey(): string {
    return dayRange(clock.now()).key
  }

  function hydrate(): TodayNutritionState {
    if (hydrated) return state
    hydrated = true

    const cached = cache.read<unknown>(cacheKey)
    if (!isCachedTodayNutrition(cached, todayKey())) return state

    const totals = sumItems(cached.meals.flatMap((meal) => meal.items))
    return patch({
      status: 'ready',
      date: cached.date,
      meals: cached.meals,
      totals,
      byMealType: sumByMealType(cached.meals),
      error: null,
      fromCache: true,
      updatedAt: cached.updatedAt,
    })
  }

  async function load(): Promise<TodayNutritionState> {
    patch({ status: state.meals.length > 0 ? 'ready' : 'loading', error: null })

    const result = await repository.dashboard()
    if (!result.ok) {
      return patch({
        status: state.meals.length > 0 ? 'ready' : 'error',
        error: result.error.message,
        fromCache: state.meals.length > 0,
      })
    }

    const { date, meals, target, consumed, recommendations } = result.value
    // 用 shared 再算一遍（与后端同一份纯函数）：即使后端漏算某个字段，展示也不会错
    const totals = sumItems(meals.flatMap((meal) => meal.items))
    const gaps = target === null ? null : computeGaps(target, consumed)
    const progress = target === null ? [] : allNutrientProgress(target, consumed)

    const updatedAt = clock.now().toISOString()
    const payload: CachedTodayNutrition = { date, meals, updatedAt }
    cache.write(cacheKey, payload)

    return patch({
      status: 'ready',
      date,
      meals,
      totals,
      target,
      gaps,
      progress,
      byMealType: sumByMealType(meals),
      recommendations,
      error: null,
      fromCache: false,
      updatedAt,
    })
  }

  async function removeMeal(id: string): Promise<boolean> {
    patch({ deletingId: id })
    const result = await repository.deleteMeal(id)
    patch({ deletingId: null })
    if (!result.ok) {
      patch({ error: result.error.message })
      return false
    }
    await load()
    return true
  }

  async function updateMeal(id: string, input: UpdateMealInput): Promise<boolean> {
    patch({ deletingId: id })
    const result = await repository.updateMeal(id, input)
    patch({ deletingId: null })
    if (!result.ok) {
      patch({ error: result.error.message })
      return false
    }
    await load()
    return true
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    hydrate,
    load,
    removeMeal,
    updateMeal,
    reset(): void {
      hydrated = false
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
