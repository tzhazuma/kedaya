import {
  estimateDailyTargets,
  type EstimateTargetsInput,
  type NutritionTarget,
} from '@kedaya/shared'

import type { NutritionTargetProfile, SaveTargetInput } from '../../domain/models/nutrition'
import type { NutritionRepository } from '../../domain/ports/nutritionRepository'

/**
 * 每日营养需求用例 —— 「因人而异，由使用者提出」的落点。
 *
 * 估算器（Mifflin-St Jeor）是 shared 里的**纯函数**，本用例只是转发：
 * 它只负责预填，最终值永远由使用者自己改、自己存。
 * 身体档案（性别/年龄/身高/体重/活动量/目标）随需求一起保存，
 * 下次重估不用重填，体重变了也能一键更新。
 */

export type TargetsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface NutritionTargetsState {
  status: TargetsStatus
  target: NutritionTargetProfile | null
  saving: boolean
  error: string | null
}

export interface NutritionTargetsUseCase {
  getSnapshot(): NutritionTargetsState
  subscribe(listener: () => void): () => void
  load(): Promise<NutritionTargetsState>
  save(input: SaveTargetInput): Promise<boolean>
  /** 估算器预填（纯函数，不落库） */
  estimate(input: EstimateTargetsInput): NutritionTarget
  reset(): void
}

const INITIAL_STATE: NutritionTargetsState = {
  status: 'idle',
  target: null,
  saving: false,
  error: null,
}

export function createNutritionTargetsUseCase(deps: {
  repository: NutritionRepository
}): NutritionTargetsUseCase {
  const { repository } = deps

  let state: NutritionTargetsState = INITIAL_STATE
  const listeners = new Set<() => void>()

  function patch(next: Partial<NutritionTargetsState>): NutritionTargetsState {
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

    async load(): Promise<NutritionTargetsState> {
      patch({ status: 'loading', error: null })
      const result = await repository.getTarget()
      if (!result.ok) {
        return patch({ status: 'error', error: result.error.message })
      }
      return patch({ status: 'ready', target: result.value, error: null })
    },

    async save(input: SaveTargetInput): Promise<boolean> {
      patch({ saving: true, error: null })
      const result = await repository.saveTarget(input)
      if (!result.ok) {
        patch({ saving: false, error: result.error.message })
        return false
      }
      patch({ saving: false, target: result.value, status: 'ready', error: null })
      return true
    },

    estimate(input: EstimateTargetsInput): NutritionTarget {
      return estimateDailyTargets(input)
    },

    reset(): void {
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
