import { dayRange, summarizeWeek, sumItems, type NutritionTotals, type WeekSummary } from '@kedaya/shared'

import type { MealRecord, MealTrend, NutritionTargetProfile } from '../../domain/models/nutrition'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { NutritionRepository } from '../../domain/ports/nutritionRepository'

/**
 * 历史与趋势用例 —— 「昨天吃了什么」「这周达标了吗」。
 *
 * 后端 `GET /canteen/meals?date=` 与 `GET /canteen/stats` 早就有了，
 * 但一直没有客户端入口（只能看今天），等于趋势数据白存。
 *
 * 这里同时管两件事：
 *   · 选中某一天 → 列出当天餐记录（可删）
 *   · 近 7 日趋势 → 柱状图 + 连续记录天数
 */

export type MealHistoryStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface MealHistoryState {
  status: MealHistoryStatus
  /** 当前查看的日期（YYYY-MM-DD） */
  date: string
  /** 今天（用于禁用「下一天」与高亮） */
  todayKey: string
  meals: MealRecord[]
  totals: NutritionTotals
  trend: MealTrend | null
  /** 近 N 日小结（达标天数 / 钠超标 / 一句结论），没设置需求时为 null */
  summary: WeekSummary | null
  /** 当前每日需求（趋势图的目标线要用），没设置为 null */
  target: NutritionTargetProfile | null
  error: string | null
  deletingId: string | null
}

export interface MealHistoryDeps {
  repository: NutritionRepository
  clock: ClockPort
}

export interface MealHistoryUseCase {
  getSnapshot(): MealHistoryState
  subscribe(listener: () => void): () => void
  load(dateKey?: string): Promise<MealHistoryState>
  /** 前后翻页：-1 前一天，+1 后一天（不允许翻到未来） */
  shift(days: number): Promise<MealHistoryState>;
  removeMeal(id: string): Promise<boolean>
  reset(): void
}

const EMPTY: NutritionTotals = { caloriesKcal: 0, proteinG: 0, fatG: 0, carbG: 0, fiberG: 0, sodiumMg: 0 }

/** YYYY-MM-DD 加天数（用本地日期算法，不做时区换算） */
export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
  date.setDate(date.getDate() + days)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function createMealHistoryUseCase(deps: MealHistoryDeps): MealHistoryUseCase {
  const { repository, clock } = deps

  function nowKey(): string {
    return dayRange(clock.now()).key
  }

  let state: MealHistoryState = {
    status: 'idle',
    date: nowKey(),
    todayKey: nowKey(),
    meals: [],
    totals: EMPTY,
    trend: null,
    summary: null,
    target: null,
    error: null,
    deletingId: null,
  }
  const listeners = new Set<() => void>()

  function patch(next: Partial<MealHistoryState>): MealHistoryState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  async function load(dateKey?: string): Promise<MealHistoryState> {
    const todayKey = nowKey()
    const date = dateKey ?? state.date
    patch({ status: state.meals.length > 0 ? 'ready' : 'loading', date, todayKey, error: null })

    const [mealsResult, trendResult, targetResult] = await Promise.all([
      repository.mealsByDate(date),
      // 一次取 90 天：趋势图用最后 7 天，季度形象用全部（后端上限 92）
      repository.trend(90),
      repository.getTarget(),
    ])

    if (!mealsResult.ok) {
      return patch({ status: 'error', error: mealsResult.error.message })
    }

    const meals = mealsResult.value.meals
    const trend = trendResult.ok ? trendResult.value : state.trend
    const target = targetResult.ok ? targetResult.value : null
    // 周报只看最近 7 天；形象看整个季度 —— 两个口径都来自 shared
    const weekDays = trend === null ? [] : trend.days.slice(-7)
    const summary =
      trend === null || target === null
        ? null
        : summarizeWeek(weekDays, target, trend.streak)

    return patch({
      status: 'ready',
      date: mealsResult.value.date,
      todayKey,
      meals,
      totals: sumItems(meals.flatMap((meal) => meal.items)),
      trend,
      summary,
      target,
      error: null,
    })
  }

  async function shift(days: number): Promise<MealHistoryState> {
    const next = shiftDateKey(state.date, days)
    // 不允许翻到未来：营养记录只对已经吃过的日子有意义
    if (next > nowKey()) return state
    return load(next)
  }

  async function removeMeal(id: string): Promise<boolean> {
    patch({ deletingId: id })
    const result = await repository.deleteMeal(id)
    patch({ deletingId: null })
    if (!result.ok) {
      patch({ error: result.error.message })
      return false
    }
    await load(state.date)
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
    load,
    shift,
    removeMeal,
    reset(): void {
      state = {
        status: 'idle',
        date: nowKey(),
        todayKey: nowKey(),
        meals: [],
        totals: EMPTY,
        trend: null,
        summary: null,
        target: null,
        error: null,
        deletingId: null,
      }
      for (const listener of listeners) listener()
    },
  }
}
