import { isValidServings, SERVING_LIMITS, sumItems, type NutritionTotals } from '@kedaya/shared'

import type {
  CanteenDish,
  CartDish,
  CartItem,
  MealRecord,
  MealType,
  RecognizeCandidate,
  RecordMealInput,
} from '../../domain/models/nutrition'
import type { NutritionRepository } from '../../domain/ports/nutritionRepository'

/**
 * 记录当餐用例 —— 对应需求里的两种入口：
 *
 *   · photo  拍照：`recognize()` 出候选 → 用户勾选 → `addToCart()`
 *   · manual 输菜名：`search()` 搜菜品库 → 用户点选 → `addToCart()`
 *
 * 两条路都汇到购物车，`confirm()` 一次性落库。
 * 客户端**永远不传营养值** —— 落库时由仓储按菜品快照（与后端同一约定）。
 */

export type LogMealSource = 'manual' | 'photo'

export interface LogMealState {
  /** 菜名检索 */
  query: string
  results: CanteenDish[]
  searching: boolean
  /** 拍照识别 */
  recognizing: boolean
  candidates: RecognizeCandidate[]
  recognizeError: string | null
  /** 当餐购物车 */
  cart: CartItem[]
  /** 落库 */
  saving: boolean
  saveError: string | null
  /**
   * 本次提交的幂等键：第一次点「保存」时生成，失败重试沿用同一个键，
   * 于是「弱网超时但服务端已落库」不会被记成两餐。
   */
  pendingRequestId: string | null
}

export interface LogMealUseCase {
  getSnapshot(): LogMealState
  subscribe(listener: () => void): () => void
  setQuery(query: string): void
  search(query: string): Promise<void>
  recognize(imageUrl: string): Promise<void>
  /** 加入当餐：搜索/识别/推荐三个入口都走这里（只要求最小字段集） */
  addToCart(dish: CartDish, servings?: number): void
  removeFromCart(dishId: string): void
  setServings(dishId: string, servings: number): void
  clearCart(): void
  /** 购物车营养汇总（shared sumItems，UI 直接渲染） */
  cartTotals(): NutritionTotals
  confirm(input: { mealType: MealType; source: LogMealSource; note?: string }): Promise<MealRecord | null>
  reset(): void
}

const INITIAL_STATE: LogMealState = {
  query: '',
  results: [],
  searching: false,
  recognizing: false,
  candidates: [],
  recognizeError: null,
  cart: [],
  saving: false,
  saveError: null,
  pendingRequestId: null,
}

/** 幂等键：时间戳 + 随机串（小程序不需要全局唯一，只要同一用户内不撞） */
function newRequestId(): string {
  return `meal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createLogMealUseCase(deps: { repository: NutritionRepository }): LogMealUseCase {
  const { repository } = deps

  let state: LogMealState = INITIAL_STATE
  const listeners = new Set<() => void>()

  function patch(next: Partial<LogMealState>): LogMealState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    setQuery(query: string): void {
      patch({ query })
    },

    async search(query: string): Promise<void> {
      patch({ query, searching: true, recognizeError: null })
      const result = await repository.listDishes({ q: query, limit: 20 })
      patch({
        searching: false,
        results: result.ok ? result.value.items : [],
        saveError: result.ok ? null : result.error.message,
      })
    },

    async recognize(imageUrl: string): Promise<void> {
      patch({ recognizing: true, recognizeError: null })
      const result = await repository.recognize(imageUrl)
      patch({
        recognizing: false,
        candidates: result.ok ? result.value.candidates : [],
        recognizeError: result.ok ? null : result.error.message,
      })
    },

    addToCart(dish: CartDish, servings = 1): void {
      const existing = state.cart.find((item) => item.dish.id === dish.id)
      if (existing === undefined) {
        patch({ cart: [...state.cart, { dish, servings }] })
        return
      }
      // 已在车里的菜品：叠加份数（上限 SERVING_LIMITS.max）
      patch({
        cart: state.cart.map((item) =>
          item.dish.id === dish.id
            ? { ...item, servings: Math.min(SERVING_LIMITS.max, item.servings + servings) }
            : item,
        ),
      })
    },

    removeFromCart(dishId: string): void {
      patch({ cart: state.cart.filter((item) => item.dish.id !== dishId) })
    },

    setServings(dishId: string, servings: number): void {
      // 支持 0.5 步进（半份），而不是只允许整数
      if (!isValidServings(servings)) return
      patch({
        cart: state.cart.map((item) => (item.dish.id === dishId ? { ...item, servings } : item)),
      })
    },

    clearCart(): void {
      patch({ cart: [], pendingRequestId: null })
    },

    cartTotals(): NutritionTotals {
      return sumItems(
        state.cart.map((item) => ({
          dishName: item.dish.name,
          category: item.dish.category,
          servings: item.servings,
          caloriesKcal: item.dish.caloriesKcal,
          proteinG: item.dish.proteinG,
          fatG: item.dish.fatG,
          carbG: item.dish.carbG,
          fiberG: item.dish.fiberG,
          sodiumMg: item.dish.sodiumMg,
        })),
      )
    },

    async confirm(input: {
      mealType: MealType
      source: LogMealSource
      note?: string
    }): Promise<MealRecord | null> {
      if (state.cart.length === 0) {
        patch({ saveError: '当餐还没有添加任何菜' })
        return null
      }

      // 同一次提交复用一个幂等键：重试不会记成两餐
      const clientRequestId = state.pendingRequestId ?? newRequestId()

      const payload: RecordMealInput = {
        mealType: input.mealType,
        source: input.source,
        note: input.note,
        clientRequestId,
        items: state.cart.map((item) => ({
          dishId: item.dish.id,
          dishName: item.dish.name,
          servings: item.servings,
        })),
      }

      patch({ saving: true, saveError: null, pendingRequestId: clientRequestId })
      const result = await repository.recordMeal(payload)
      if (!result.ok) {
        patch({ saving: false, saveError: result.error.message })
        return null
      }

      patch({ saving: false, cart: [], candidates: [], results: [], query: '', pendingRequestId: null })
      return result.value
    },

    reset(): void {
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
