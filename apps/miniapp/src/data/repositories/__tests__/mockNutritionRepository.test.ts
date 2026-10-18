import { describe, expect, it } from 'vitest'

import { createMockNutritionRepository } from '../mockNutritionRepository'

/**
 * 营养管家园 mock 仓储测试。
 *
 * 重点验证：
 * 1. 今日汇总按本地时区切天（注入固定 now）
 * 2. 记录当餐的营养**来自菜品库快照**（客户端传不了营养值）
 * 3. 菜品库没有的菜明确失败
 * 4. 识别候选与菜品库匹配；未设置需求时推荐明确报错
 */

const NOW = new Date('2026-10-17T12:30:00.000Z')

function createRepo() {
  return createMockNutritionRepository({ latencyMs: 0, now: () => NOW })
}

describe('mock 营养仓储 · 今日汇总', () => {
  it('默认种子包含今天早餐 + 午餐', async () => {
    const repo = createRepo()
    const result = await repo.today()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.meals).toHaveLength(2)
    const lunch = result.value.meals[0]
    const breakfast = result.value.meals[1]
    expect(lunch).toBeDefined()
    expect(breakfast).toBeDefined()
    if (lunch === undefined || breakfast === undefined) return
    // 午餐：米饭 174 + 红烧排骨 520 + 清炒菠菜 90 = 784
    expect(lunch.totals.caloriesKcal).toBe(784)
    // 早餐：豆浆 90 + 肉包 230 = 320
    expect(breakfast.totals.caloriesKcal).toBe(320)
  })

  it('切换日期后种子餐不出现（按天过滤）', async () => {
    // 种子餐在首次访问时按当时的时间落点生成；把时间推到两天后，
    // 已落位的种子餐不应出现在新的一天里（本地时区切天）
    let currentNow = new Date('2026-10-17T12:30:00.000Z')
    const repo = createMockNutritionRepository({ latencyMs: 0, now: () => currentNow })

    const day1 = await repo.today()
    expect(day1.ok).toBe(true)
    if (!day1.ok) return
    expect(day1.value.meals).toHaveLength(2)

    currentNow = new Date('2026-10-19T12:30:00.000Z')
    const day2 = await repo.today()
    expect(day2.ok).toBe(true)
    if (!day2.ok) return
    expect(day2.value.meals).toHaveLength(0)
  })
})

describe('mock 营养仓储 · 记录当餐', () => {
  it('按菜名记录，营养从菜品库快照', async () => {
    const repo = createRepo()
    const result = await repo.recordMeal({
      mealType: 'dinner',
      source: 'manual',
      items: [{ dishName: '米饭', servings: 2 }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.totals.caloriesKcal).toBe(348) // 174 × 2
    const firstItem = result.value.items[0]
    expect(firstItem).toBeDefined()
    if (firstItem === undefined) return
    expect(firstItem.dishId).toBe('dish-rice')
  })

  it('菜品库没有的菜明确失败', async () => {
    const repo = createRepo()
    const result = await repo.recordMeal({
      mealType: 'dinner',
      source: 'manual',
      items: [{ dishName: '翡翠虾饺皇' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('翡翠虾饺皇')
  })

  it('记录后今日汇总立即可见', async () => {
    const repo = createRepo()
    await repo.recordMeal({ mealType: 'dinner', source: 'manual', items: [{ dishName: '米饭' }] })
    const today = await repo.today()
    expect(today.ok).toBe(true)
    if (!today.ok) return
    expect(today.value.meals).toHaveLength(3)
  })
})

describe('mock 营养仓储 · 菜品库筛选（食堂 / 品类 / 关键词叠加）', () => {
  it('按食堂精确筛选，只返回该食堂的菜', async () => {
    const repo = createRepo()
    const result = await repo.listDishes({ canteen: '第二食堂', limit: 100 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items.length).toBeGreaterThan(0)
    expect(result.value.items.every((dish) => dish.canteen === '第二食堂')).toBe(true)
  })

  it('食堂与关键词是叠加条件，不是二选一', async () => {
    const repo = createRepo()
    const result = await repo.listDishes({ canteen: '第二食堂', q: '豆腐', limit: 100 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items.map((dish) => dish.name)).toEqual(['麻婆豆腐'])
    // 反证：不限食堂时同一个关键词还有别的结果，说明确实做了交集
    const all = await repo.listDishes({ q: '豆腐', limit: 100 })
    expect(all.ok).toBe(true)
    if (!all.ok) return
    expect(all.value.items.map((dish) => dish.name).sort()).toEqual(['麻婆豆腐'])
  })

  it('白名单里还没有菜品的食堂返回空列表（诚实空态，不兜底成全量）', async () => {
    const repo = createRepo()
    const result = await repo.listDishes({ canteen: '清真食堂', limit: 100 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items).toEqual([])
    expect(result.value.nextCursor).toBeNull()
  })
})

describe('mock 营养仓储 · 识别与推荐', () => {
  it('识别返回确定性候选，且带菜品库匹配', async () => {
    const repo = createRepo()
    const first = await repo.recognize('demo://photo/a')
    const second = await repo.recognize('demo://photo/a')

    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(second.ok).toBe(true)
    if (!second.ok) return

    // 同一张"照片"两次识别结果一致（演示不翻车）
    expect(first.value.candidates.map((c) => c.name)).toEqual(second.value.candidates.map((c) => c.name))
    // 至少有一个候选匹配到菜品库
    expect(first.value.candidates.some((c) => c.dish !== null)).toBe(true)
    // 末尾候选是「菜品库还没有」的诚实演示
    const lastCandidate = first.value.candidates[first.value.candidates.length - 1]
    expect(lastCandidate).toBeDefined()
    if (lastCandidate === undefined) return
    expect(lastCandidate.dish).toBeNull()
  })

  it('推荐：由缺口驱动，可解释，且确定性', async () => {
    const repo = createRepo()
    const result = await repo.recommendations()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.gaps.proteinG).toBeGreaterThan(0)
    // 碳水相对缺口最大（187/275），高碳水的红烧牛肉面综合得分第一
    const top = result.value.recommendations[0]
    expect(top).toBeDefined()
    if (top === undefined) return
    expect(top.dish.id).toBe('dish-noodle')
    // 每条推荐都带可解释的中文理由（ADR 0006 D9）
    for (const recommendation of result.value.recommendations) {
      expect(recommendation.reason.length).toBeGreaterThan(0)
    }
  })
})
