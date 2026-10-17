import { describe, expect, it } from 'vitest'
import { err, ok } from '@kedaya/shared'

import { createDishLibraryUseCase, readDishLibraryQuery } from '../dishLibrary'
import type { CanteenDish } from '../../../domain/models/nutrition'
import type { CachePort } from '../../../domain/ports/cachePort'
import type { ClockPort } from '../../../domain/ports/clockPort'
import type { DishSearchQuery, NutritionRepository } from '../../../domain/ports/nutritionRepository'

/**
 * 菜品库（按食堂看）用例测试。
 *
 * 回归背景：食堂分类在移植里只剩「记当餐」的搜索态才看得见，营养管家没有
 * 按食堂浏览菜品的入口 —— 于是用户「看不到第一/第二/第三/清真/教工食堂、咖啡吧」。
 * 这里把三件事钉住：
 *   · 食堂是**精确**筛选，且与菜名 / 品类**叠加**（不是二选一）；
 *   · 三个条件为空时一律**不下传**（`undefined`，不是空串）—— 空串会被后端当成筛选值；
 *   · 非法品类只丢掉品类，不把整个请求变成 400（旧缓存里可能存着老枚举）。
 */

const DISH: CanteenDish = {
  id: 'dish-mapodoufu',
  canteen: '第二食堂',
  name: '麻婆豆腐',
  category: 'vegetable',
  servingG: 250,
  caloriesKcal: 210,
  proteinG: 12,
  fatG: 14,
  carbG: 8,
  fiberG: 2,
  sodiumMg: 800,
  priceFen: 600,
  source: '第二食堂公告栏公示',
  lastVerifiedAt: '2026-10-01T00:00:00.000Z',
}

const NOW = new Date('2026-10-18T09:00:00.000Z')
const clock: ClockPort = { now: () => NOW }

function createFakeCache(seed?: Record<string, unknown>): CachePort {
  const store = new Map<string, unknown>(Object.entries(seed ?? {}))
  return {
    read: <T>(key: string): T | null => (store.has(key) ? (store.get(key) as T) : null),
    write: <T>(key: string, value: T): void => {
      store.set(key, value)
    },
    remove: (key: string): void => {
      store.delete(key)
    },
  }
}

function createFakeRepository(
  options: { dishes?: CanteenDish[]; failure?: string; nextCursor?: string | null } = {},
): { repository: NutritionRepository; calls: DishSearchQuery[] } {
  const dishes = options.dishes ?? [DISH]
  const calls: DishSearchQuery[] = []
  const unused =
    (name: string) =>
    async (): Promise<never> => {
      throw new Error(`本用例不该调用 ${name}`)
    }

  const repository: NutritionRepository = {
    listDishes: async (query = {}) => {
      calls.push(query)
      if (options.failure !== undefined) {
        return err({ code: 'UPSTREAM_UNAVAILABLE', message: options.failure })
      }
      return ok({ items: dishes, nextCursor: options.nextCursor ?? null })
    },
    today: unused('today'),
    dashboard: unused('dashboard'),
    mealsByDate: unused('mealsByDate'),
    recordMeal: unused('recordMeal'),
    updateMeal: unused('updateMeal'),
    deleteMeal: unused('deleteMeal'),
    trend: unused('trend'),
    createDish: unused('createDish'),
    getTarget: unused('getTarget'),
    saveTarget: unused('saveTarget'),
    recognize: unused('recognize'),
    recommendations: unused('recommendations'),
  }

  return { repository, calls }
}

function setup(options: Parameters<typeof createFakeRepository>[0] = {}) {
  const { repository, calls } = createFakeRepository(options)
  const useCase = createDishLibraryUseCase({
    repository,
    cache: createFakeCache(),
    clock,
    cacheKey: 'test:dish-library',
  })
  return { useCase, calls }
}

describe('菜品库用例 · 食堂分类筛选', () => {
  it('默认不限：三个条件都不下传，状态里是空串（「不限」在缓存里表达得出来）', async () => {
    const { useCase, calls } = setup()

    await useCase.load()

    expect(calls[0]).toMatchObject({
      q: undefined,
      canteen: undefined,
      category: undefined,
      limit: 20,
    })
    expect(readDishLibraryQuery(useCase.getSnapshot().query)).toEqual({
      q: '',
      canteen: '',
      category: '',
    })
    expect(useCase.getSnapshot().items).toHaveLength(1)
    expect(useCase.getSnapshot().status).toBe('ready')
  })

  it('选食堂：canteen 精确下传', async () => {
    const { useCase, calls } = setup()

    await useCase.load({ canteen: '清真食堂' })

    expect(calls.at(-1)?.canteen).toBe('清真食堂')
    expect(readDishLibraryQuery(useCase.getSnapshot().query).canteen).toBe('清真食堂')
  })

  it('食堂 + 菜名 + 品类是叠加条件（后续 load 不丢已选条件）', async () => {
    const { useCase, calls } = setup()

    await useCase.load({ canteen: '第一食堂' })
    await useCase.load({ q: ' 排骨 ' })
    await useCase.load({ category: 'meat' })

    expect(calls.at(-1)).toMatchObject({
      canteen: '第一食堂',
      // 首尾空白在用例层就去掉：用户看到的筛选条件必须与发出去的请求一致
      q: '排骨',
      category: 'meat',
    })
  })

  it('非法品类只丢品类，不把请求变成 400', async () => {
    const { useCase, calls } = setup()

    await useCase.load({ canteen: '第三食堂', category: 'not-a-category' })

    expect(calls.at(-1)?.category).toBeUndefined()
    expect(calls.at(-1)?.canteen).toBe('第三食堂')
  })

  it('加载失败：错误文案给人看，列表不留下上一次的结果', async () => {
    const { useCase } = setup({ failure: '菜品库暂时不可用' })

    await useCase.load()

    const state = useCase.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('菜品库暂时不可用')
    expect(state.items).toEqual([])
  })
})
