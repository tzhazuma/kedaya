import { describe, expect, it } from 'vitest'
import { err, ok } from '@kedaya/shared'

import { createLogMealUseCase } from '../logMeal'
import type { CanteenDish } from '../../../domain/models/nutrition'
import type { DishSearchQuery, NutritionRepository } from '../../../domain/ports/nutritionRepository'

/**
 * 记录当餐用例测试 —— 只覆盖**检索筛选**这条线。
 *
 * 回归背景：食堂分类筛选在一次功能移植里被丢过（后端 `?canteen=` 一直支持，
 * 但客户端端口没透传），于是「点食堂筛不出来」。这里把它钉住：
 *   · 筛选与关键词是**并列**条件（不是二选一）；
 *   · 切换食堂会立刻用当前关键词重查（不需要用户再敲一次搜索）。
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

/**
 * 只实现 `listDishes` 的假仓储。
 *
 * 其余方法一旦被调用就抛错 —— 比返回假数据更早暴露「用例偷偷多调了一个接口」，
 * 也不用维护一堆用不上的假返回值。
 */
function createFakeRepository(
  options: { dishes?: CanteenDish[]; failure?: string } = {},
): {
  repository: NutritionRepository
  calls: DishSearchQuery[]
} {
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
      return ok({ items: dishes, nextCursor: null })
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

describe('记录当餐用例 · 菜品检索筛选', () => {
  it('默认不限食堂：canteen 不下传（undefined 而不是空串）', async () => {
    const { repository, calls } = createFakeRepository()
    const logMeal = createLogMealUseCase({ repository })

    await logMeal.search('豆腐')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.q).toBe('豆腐')
    expect(calls[0]?.canteen).toBeUndefined()
    expect(logMeal.getSnapshot().canteen).toBeNull()
  })

  it('选食堂后立刻用当前关键词重查，两个条件一起下传', async () => {
    const { repository, calls } = createFakeRepository()
    const logMeal = createLogMealUseCase({ repository })

    logMeal.setQuery('豆腐')
    await logMeal.setCanteen('第二食堂')

    // 只发了一次请求（切换食堂自己触发），且关键词没有丢
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ q: '豆腐', canteen: '第二食堂', limit: 20 })
    expect(logMeal.getSnapshot().canteen).toBe('第二食堂')
  })

  it('后续搜索沿用已选食堂（不会悄悄退回全部）', async () => {
    const { repository, calls } = createFakeRepository()
    const logMeal = createLogMealUseCase({ repository })

    await logMeal.setCanteen('第三食堂')
    await logMeal.search('蛋炒饭')

    expect(calls.at(-1)).toMatchObject({ q: '蛋炒饭', canteen: '第三食堂' })
  })

  it('切回「全部食堂」后 canteen 不再下传', async () => {
    const { repository, calls } = createFakeRepository()
    const logMeal = createLogMealUseCase({ repository })

    await logMeal.setCanteen('第二食堂')
    await logMeal.setCanteen(null)

    expect(calls.at(-1)?.canteen).toBeUndefined()
    expect(logMeal.getSnapshot().canteen).toBeNull()
  })

  it('检索失败时不留下上一次的结果（避免「筛选生效了」的错觉）', async () => {
    const { repository } = createFakeRepository({ failure: '菜品库加载失败' })
    const logMeal = createLogMealUseCase({ repository })

    await logMeal.search('豆腐')

    expect(logMeal.getSnapshot().results).toEqual([])
    expect(logMeal.getSnapshot().searching).toBe(false)
    expect(logMeal.getSnapshot().saveError).toBe('菜品库加载失败')
  })
})
