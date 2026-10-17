import { describe, expect, it } from 'vitest'

import {
  allNutrientProgress,
  nutrientProgress,
  validateDishInput,
} from '../nutrition'
import type { CreateDishInput, NutritionTarget } from '../nutrition'

/**
 * 营养管家园 domain 派生测试 —— 进度行与录入校验。
 * 计算真相在 shared，这里测的是**展示派生**（UI 直接渲染的形状）。
 */

const TARGET: NutritionTarget = {
  caloriesKcal: 2000,
  proteinG: 100,
  fatG: 60,
  carbG: 250,
  fiberG: 25,
  sodiumMg: 2000,
}

const EMPTY = { caloriesKcal: 0, proteinG: 0, fatG: 0, carbG: 0, fiberG: 0, sodiumMg: 0 }

describe('nutrientProgress（单项进度）', () => {
  it('目标型：达到目标即 met', () => {
    const row = nutrientProgress('proteinG', TARGET, { ...EMPTY, proteinG: 100 })
    expect(row.met).toBe(true)
    expect(row.percent).toBe(100)
    expect(row.isUpperLimit).toBe(false)
  })

  it('目标型：未达到不 met，百分比四舍五入', () => {
    const row = nutrientProgress('proteinG', TARGET, { ...EMPTY, proteinG: 33 })
    expect(row.met).toBe(false)
    expect(row.percent).toBe(33)
  })

  it('上限型（钠）：不超才是 met，超了 percent 可过 100', () => {
    const under = nutrientProgress('sodiumMg', TARGET, { ...EMPTY, sodiumMg: 1500 })
    expect(under.met).toBe(true)
    expect(under.isUpperLimit).toBe(true)

    const over = nutrientProgress('sodiumMg', TARGET, { ...EMPTY, sodiumMg: 2600 })
    expect(over.met).toBe(false)
    expect(over.percent).toBe(130)
  })

  it('目标为 0 时 percent 记 0（不除零）', () => {
    const row = nutrientProgress('fiberG', { ...TARGET, fiberG: 0 }, EMPTY)
    expect(row.percent).toBe(0)
  })
})

describe('allNutrientProgress（六项顺序）', () => {
  it('热量在最前，共六项', () => {
    const rows = allNutrientProgress(TARGET, EMPTY)
    expect(rows).toHaveLength(6)
    const first = rows[0]
    expect(first).toBeDefined()
    if (first === undefined) return
    expect(first.key).toBe('caloriesKcal')
    expect(rows.map((row) => row.key)).toEqual([
      'caloriesKcal',
      'proteinG',
      'fatG',
      'carbG',
      'fiberG',
      'sodiumMg',
    ])
  })
})

describe('validateDishInput（录入校验，shared 唯一真相）', () => {
  const valid: CreateDishInput = {
    canteen: '一食堂',
    name: '测试菜',
    category: 'meat',
    servingG: 200,
    caloriesKcal: 300,
    proteinG: 10,
    fatG: 10,
    carbG: 10,
    fiberG: 1,
    sodiumMg: 100,
    priceFen: 500,
  }

  it('合法输入返回 null', () => {
    expect(validateDishInput(valid)).toBeNull()
  })

  it('空菜名 / 空食堂拒绝', () => {
    expect(validateDishInput({ ...valid, name: '  ' })).toBe('菜名不能为空')
    expect(validateDishInput({ ...valid, canteen: '' })).toBe('请填写食堂')
  })

  it('份数必须为正整数', () => {
    expect(validateDishInput({ ...valid, servingG: 0 })).toBe('每份克数必须是正整数')
    expect(validateDishInput({ ...valid, servingG: 1.5 })).toBe('每份克数必须是正整数')
  })

  it('负营养值拒绝', () => {
    expect(validateDishInput({ ...valid, sodiumMg: -1 })).toBe('钠必须是非负整数')
  })
})
