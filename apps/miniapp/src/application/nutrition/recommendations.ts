import type {
  DishRecommendation,
  NutritionGaps,
  NutritionTarget,
  NutritionTotals,
} from '@kedaya/shared'

import type { NutritionRepository } from '../../domain/ports/nutritionRepository'

/**
 * 推荐用例 —— 「当天还需要吃什么」的数据源。
 *
 * 缺口计算与推荐打分全部在后端 / mock 的 shared 同一份代码里完成，
 * 本用例只做状态编排（loading / ready / error 三态）。
 */

export type RecommendationsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface RecommendationsState {
  status: RecommendationsStatus
  target: NutritionTarget | null
  consumed: NutritionTotals | null
  gaps: NutritionGaps | null
  items: DishRecommendation[]
  error: string | null
}

export interface RecommendationsUseCase {
  getSnapshot(): RecommendationsState
  subscribe(listener: () => void): () => void
  load(): Promise<RecommendationsState>
  reset(): void
}

const INITIAL_STATE: RecommendationsState = {
  status: 'idle',
  target: null,
  consumed: null,
  gaps: null,
  items: [],
  error: null,
}

export function createRecommendationsUseCase(deps: {
  repository: NutritionRepository
}): RecommendationsUseCase {
  const { repository } = deps

  let state: RecommendationsState = INITIAL_STATE
  const listeners = new Set<() => void>()

  function patch(next: Partial<RecommendationsState>): RecommendationsState {
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

    async load(): Promise<RecommendationsState> {
      patch({ status: 'loading', error: null })
      const result = await repository.recommendations()
      if (!result.ok) {
        return patch({ status: 'error', error: result.error.message })
      }
      return patch({
        status: 'ready',
        target: result.value.target,
        consumed: result.value.consumed,
        gaps: result.value.gaps,
        items: result.value.recommendations,
        error: null,
      })
    },

    reset(): void {
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
