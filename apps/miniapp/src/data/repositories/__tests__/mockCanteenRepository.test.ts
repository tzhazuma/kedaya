import { describe, expect, it } from 'vitest'

import { createMockCanteenRepository } from '../mockCanteenRepository'
import { createMemoryStorage } from '../../storage/memoryStorage'
import { STORAGE_PREFIX } from '../../storage/keys'
import { validateDraft } from '../../../application/canteen/canteenUseCases'
import {
  CANTEEN_CALORIES_MAX,
  CANTEEN_MACRO_MAX,
  CANTEEN_OPTIONS,
  CANTEEN_PRICE_MAX_FEN,
  calorieLevel,
  calorieLevelLabel,
  caloriesLabel,
  canteenNameProblem,
  dishNameProblem,
  isCanteenName,
  macroLabel,
  parseIntegerText,
  parseYuanText,
  priceLabel,
  priceProblem,
  summarize,
} from '../../../domain/models/canteen'
import type { CanteenDish } from '../../../domain/models/canteen'

/**
 * 食堂营养「领域规则 + Mock 仓储」的可执行规格。
 *
 * Mock 仓储的价值在于**规则一致** —— 食堂精确筛选、菜名模糊搜索、
 * 最新在前（含 id 兜底）、汇总取整、创建边界，都要和后端 `CanteenDishService` 一样。
 * 所以这里既测纯函数，也测 mock 真的执行了同样的规则（而不是"看起来像"）。
 */

const NOW = new Date('2026-05-01T12:00:00.000Z')

function dish(overrides: Partial<CanteenDish> = {}): CanteenDish {
  return {
    id: 'cd-1',
    canteen: '第一食堂',
    name: '红烧肉盖饭',
    caloriesKcal: 780,
    proteinG: 32,
    fatG: 28,
    carbG: 96,
    priceFen: 1_800,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  }
}

function repo(dishes: CanteenDish[] = [dish()]) {
  const repository = createMockCanteenRepository({
    cache: createMemoryStorage(),
    latencyMs: 0,
    now: () => NOW,
  })
  repository.seed(dishes)
  return repository
}

describe('白名单、单位标签与派生视图', () => {
  it('食堂白名单只认登记过的名字', () => {
    expect(CANTEEN_OPTIONS).toContain('第一食堂')
    expect(isCanteenName('咖啡吧')).toBe(true)
    expect(isCanteenName('第八食堂')).toBe(false)
    expect(isCanteenName(undefined)).toBe(false)
    expect(canteenNameProblem('第一食堂')).toBeNull()
    expect(canteenNameProblem('第八食堂')).toBe('请选择食堂')
  })

  it('菜品名称必填且有长度上限', () => {
    expect(dishNameProblem('红烧肉盖饭')).toBeNull()
    expect(dishNameProblem('   ')).toBe('请填写菜品名称')
    expect(dishNameProblem('x'.repeat(61))).not.toBeNull()
  })

  it('热量档位 / 单位文案都是纯展示规则', () => {
    expect(calorieLevel(120)).toBe('light')
    expect(calorieLevel(400)).toBe('moderate')
    expect(calorieLevel(900)).toBe('heavy')
    expect(calorieLevelLabel(780)).toBe('偏高')
    expect(caloriesLabel(780)).toBe('780 千卡')
    expect(macroLabel(32)).toBe('32 g')
    expect(priceLabel(1_800)).toBe('¥18.00')
  })

  it('summarize 给出可读的营养卡片视图', () => {
    const summary = summarize(dish(), NOW)
    expect(summary.caloriesLabel).toBe('780 千卡')
    expect(summary.priceLabel).toBe('¥18.00')
    expect(summary.macroSummary).toBe('蛋白 32g · 脂肪 28g · 碳水 96g')
    expect(summary.calorieLevelLabel).toBe('偏高')
    expect(summary.createdLabel).toBe('2 小时前')
  })
})

describe('文本 → 整数 / 分 的解析', () => {
  it('parseIntegerText 只接受纯非负整数', () => {
    expect(parseIntegerText('780')).toBe(780)
    expect(parseIntegerText('  12 ')).toBe(12)
    expect(parseIntegerText('0')).toBe(0)
    expect(parseIntegerText('')).toBeNull()
    expect(parseIntegerText('-5')).toBeNull()
    expect(parseIntegerText('1.5')).toBeNull()
    // `Number('1e3')` 会得到 1000，这不是"所见即所得"
    expect(parseIntegerText('1e3')).toBeNull()
    expect(parseIntegerText('12abc')).toBeNull()
  })

  it('parseYuanText 复用共享金额解析，非法输入返回 null', () => {
    expect(parseYuanText('18')).toBe(1_800)
    expect(parseYuanText('18.5')).toBe(1_850)
    expect(parseYuanText(' 12.34 ')).toBe(1_234)
    expect(parseYuanText('')).toBeNull()
    expect(parseYuanText('abc')).toBeNull()
    // 三位小数无法精确到分
    expect(parseYuanText('1.234')).toBeNull()
    // 负数可以解析，交由 priceProblem 判范围
    expect(parseYuanText('-1')).toBe(-100)
  })

  it('数值边界校验给出可读文案', () => {
    expect(priceProblem('18')).toBeNull()
    expect(priceProblem('')).toBe('请填写价格')
    expect(priceProblem('abc')).toBe('价格请填数字，最多两位小数')
    expect(priceProblem('-1')).toBe('价格不能为负数')
    expect(priceProblem(String(CANTEEN_PRICE_MAX_FEN / 100 + 1))).toContain('不能超过')
  })
})

describe('Mock 仓储 · 种子数据', () => {
  it('种子 ≥ 8 道菜，且数值 / 价格都合理（非负整数、分计价、食堂在白名单内）', async () => {
    const r = createMockCanteenRepository({
      cache: createMemoryStorage(),
      latencyMs: 0,
      now: () => NOW,
    })

    const result = await r.list({ cursor: null, limit: 50, filters: {} })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.items.length).toBeGreaterThanOrEqual(8)
    for (const item of result.value.items) {
      expect(CANTEEN_OPTIONS).toContain(item.canteen)
      expect(item.name.trim().length).toBeGreaterThan(0)
      expect(Number.isInteger(item.caloriesKcal)).toBe(true)
      expect(item.caloriesKcal).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(item.proteinG)).toBe(true)
      expect(Number.isInteger(item.fatG)).toBe(true)
      expect(Number.isInteger(item.carbG)).toBe(true)
      expect(Number.isInteger(item.priceFen)).toBe(true)
      // 分计价：种子价格都是正的整数分
      expect(item.priceFen).toBeGreaterThan(0)
    }
  })
})

describe('Mock 仓储 · 列表筛选与排序', () => {
  const seed: CanteenDish[] = [
    dish({ id: 'a', canteen: '第一食堂', name: '红烧肉盖饭', createdAt: '2026-05-01T09:00:00.000Z' }),
    dish({
      id: 'b',
      canteen: '第二食堂',
      name: '麻婆豆腐盖饭',
      createdAt: '2026-05-01T11:00:00.000Z',
    }),
    dish({
      id: 'c',
      canteen: '第二食堂',
      name: '水煮肉片',
      createdAt: '2026-05-01T08:00:00.000Z',
    }),
    dish({
      id: 'd',
      canteen: '咖啡吧',
      name: 'Cafe Latte',
      createdAt: '2026-05-01T10:00:00.000Z',
    }),
  ]

  it('无筛选时按 createdAt 倒序（最新在前）', async () => {
    const r = repo(seed)
    const result = await r.list({ cursor: null, filters: {} })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items.map((i) => i.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('同一毫秒落库时用 id 倒序兜底（避免翻页跳项）', async () => {
    const r = repo([
      dish({ id: 'x', createdAt: '2026-05-01T10:00:00.000Z' }),
      dish({ id: 'y', createdAt: '2026-05-01T10:00:00.000Z' }),
    ])
    const result = await r.list({ cursor: null, filters: {} })
    if (result.ok) expect(result.value.items.map((i) => i.id)).toEqual(['y', 'x'])
  })

  it('食堂精确筛选：只返回该食堂，未知食堂返回空', async () => {
    const r = repo(seed)
    const second = await r.list({ cursor: null, filters: { canteen: '第二食堂' } })
    if (second.ok) expect(second.value.items.map((i) => i.id).sort()).toEqual(['b', 'c'])

    const unknown = await r.list({ cursor: null, filters: { canteen: '第八食堂' } })
    if (unknown.ok) expect(unknown.value.items).toHaveLength(0)
  })

  it('菜名模糊搜索不区分大小写', async () => {
    const r = repo(seed)
    const upper = await r.list({ cursor: null, filters: { q: 'LATTE' } })
    if (upper.ok) expect(upper.value.items.map((i) => i.id)).toEqual(['d'])

    const chinese = await r.list({ cursor: null, filters: { q: '豆腐' } })
    if (chinese.ok) expect(chinese.value.items.map((i) => i.id)).toEqual(['b'])
  })

  it('食堂筛选与关键词是两个独立条件，可以叠加', async () => {
    const r = repo(seed)
    const both = await r.list({ cursor: null, filters: { canteen: '第二食堂', q: '肉' } })
    if (both.ok) expect(both.value.items.map((i) => i.id)).toEqual(['c'])

    const conflict = await r.list({ cursor: null, filters: { canteen: '第一食堂', q: '豆腐' } })
    if (conflict.ok) expect(conflict.value.items).toHaveLength(0)
  })

  it('空的关键词 / 食堂被忽略，不会变成"搜空字符串"', async () => {
    const r = repo(seed)
    const result = await r.list({ cursor: null, filters: { canteen: '   ', q: '  ' } })
    if (result.ok) expect(result.value.items).toHaveLength(4)
  })

  it('游标分页只返回下一页，并给出正确的 nextCursor', async () => {
    const r = repo(seed)
    const first = await r.list({ cursor: null, limit: 3, filters: {} })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.items.map((i) => i.id)).toEqual(['b', 'd', 'a'])
    expect(first.value.nextCursor).toBe('a')
    // 后端不返回 total（Page.total 是可选字段）
    expect(first.value.total).toBeUndefined()

    const second = await r.list({ cursor: 'a', limit: 3, filters: {} })
    if (second.ok) {
      expect(second.value.items.map((i) => i.id)).toEqual(['c'])
      expect(second.value.nextCursor).toBeNull()
    }
  })
})

describe('Mock 仓储 · 详情与创建', () => {
  it('详情存在即可读，不存在统一 NOT_FOUND', async () => {
    const r = repo()
    const found = await r.detail('cd-1')
    expect(found.ok).toBe(true)

    const missing = await r.detail('ghost')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND')
  })

  it('创建匿名（无需登录）：落库并出现在列表最前', async () => {
    const r = repo([])
    const created = await r.create({
      canteen: '第三食堂',
      name: '  牛肉拉面（大碗）  ',
      caloriesKcal: 700,
      proteinG: 30,
      fatG: 20,
      carbG: 98,
      priceFen: 1_500,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.name).toBe('牛肉拉面（大碗）')
    expect(created.value.createdAt).toBe(NOW.toISOString())

    const listed = await r.list({ cursor: null, filters: {} })
    if (listed.ok) expect(listed.value.items.map((i) => i.id)).toContain(created.value.id)
  })

  it('创建的边界校验：食堂白名单 / 名称 / 营养 / 价格统一 VALIDATION_FAILED', async () => {
    const r = repo([])
    const base = {
      canteen: '第三食堂',
      name: '牛肉拉面',
      caloriesKcal: 700,
      proteinG: 30,
      fatG: 20,
      carbG: 98,
      priceFen: 1_500,
    }

    const cases = [
      { ...base, canteen: '第八食堂' },
      { ...base, name: '   ' },
      { ...base, name: 'x'.repeat(61) },
      { ...base, caloriesKcal: -1 },
      { ...base, caloriesKcal: CANTEEN_CALORIES_MAX + 1 },
      { ...base, caloriesKcal: 12.5 },
      { ...base, proteinG: CANTEEN_MACRO_MAX + 1 },
      { ...base, fatG: -1 },
      { ...base, priceFen: -1 },
      { ...base, priceFen: CANTEEN_PRICE_MAX_FEN + 1 },
    ]

    for (const input of cases) {
      const result = await r.create(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    }
  })
})

describe('Mock 仓储 · 食堂汇总', () => {
  const seed: CanteenDish[] = [
    dish({ id: 'a', canteen: '第一食堂', caloriesKcal: 780, priceFen: 1_800 }),
    dish({ id: 'b', canteen: '第一食堂', caloriesKcal: 520, priceFen: 2_200 }),
    dish({ id: 'c', canteen: '第二食堂', caloriesKcal: 720, priceFen: 1_900 }),
  ]

  it('按食堂做真实聚合：菜数 / 总热量 / 均价（取整）', async () => {
    const r = repo(seed)
    const summary = await r.calories('第一食堂')
    expect(summary.ok).toBe(true)
    if (!summary.ok) return
    expect(summary.value).toEqual({ dishes: 2, totalCaloriesKcal: 1_300, avgPriceFen: 2_000 })
  })

  it('均价四舍五入到分，空食堂返回 0 且不除零', async () => {
    const r = repo([
      dish({ id: 'a', canteen: '第一食堂', caloriesKcal: 100, priceFen: 1 }),
      dish({ id: 'b', canteen: '第一食堂', caloriesKcal: 100, priceFen: 1 }),
      dish({ id: 'c', canteen: '第一食堂', caloriesKcal: 100, priceFen: 998 }),
    ])
    const rounding = await r.calories('第一食堂')
    if (rounding.ok) expect(rounding.value.avgPriceFen).toBe(333)

    const empty = await r.calories('清真食堂')
    if (empty.ok) {
      expect(empty.value).toEqual({ dishes: 0, totalCaloriesKcal: 0, avgPriceFen: 0 })
    }
  })

  it('食堂为空 → VALIDATION_FAILED（与后端 controller 一致）', async () => {
    const r = repo(seed)
    const result = await r.calories('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('Mock 仓储 · 持久化与演示控制', () => {
  it('数据落在 CachePort：新实例读到同一份数据（刷新页面不丢）', async () => {
    const cache = createMemoryStorage()
    const options = { cache, latencyMs: 0, now: () => NOW }

    const first = createMockCanteenRepository(options)
    const created = await first.create({
      canteen: '咖啡吧',
      name: '厚乳拿铁（中杯）',
      caloriesKcal: 210,
      proteinG: 8,
      fatG: 10,
      carbG: 22,
      priceFen: 1_800,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const second = createMockCanteenRepository(options)
    const listed = await second.list({ cursor: null, filters: {} })
    if (listed.ok) expect(listed.value.items.map((i) => i.id)).toContain(created.value.id)
  })

  it('数据集与列表缓存使用不同的 key：写缓存不会覆盖数据集', async () => {
    const cache = createMemoryStorage()
    const r = createMockCanteenRepository({ cache, latencyMs: 0, now: () => NOW })
    r.seed([dish()])

    // 模拟 listUseCase.writeCache 往列表缓存 key 写一页载荷（key 由装配层注入）
    cache.write(`${STORAGE_PREFIX}cache:canteen:list`, {
      items: [],
      nextCursor: null,
      updatedAt: NOW.toISOString(),
    })

    const listed = await r.list({ cursor: null, filters: {} })
    if (listed.ok) expect(listed.value.items.map((i) => i.id)).toEqual(['cd-1'])
  })

  it('failNextRequests 只影响接下来 N 次请求', async () => {
    const r = repo()
    r.failNextRequests(1)
    const failed = await r.list({ cursor: null, filters: {} })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    const succeed = await r.list({ cursor: null, filters: {} })
    expect(succeed.ok).toBe(true)
  })

  it('clearAll 之后是真的空列表；reset 后种子恢复', async () => {
    const r = repo()
    r.clearAll()
    const empty = await r.list({ cursor: null, filters: {} })
    if (empty.ok) expect(empty.value.items).toHaveLength(0)

    r.reset()
    const restored = await r.list({ cursor: null, filters: {} })
    if (restored.ok) expect(restored.value.items.length).toBeGreaterThanOrEqual(8)
  })
})

describe('用例校验（validateDraft，提交前即时提示）', () => {
  it('空表单逐项给出提示', () => {
    const problems = validateDraft({
      canteen: '',
      name: '',
      caloriesText: '',
      proteinText: '',
      fatText: '',
      carbText: '',
      priceText: '',
    })
    expect(problems).toContain('请选择食堂')
    expect(problems).toContain('请填写菜品名称')
    expect(problems).toContain('请填写热量')
    expect(problems).toContain('请填写价格')
  })

  it('数值超界 / 事件非法时给出可读提示', () => {
    const problems = validateDraft({
      canteen: '第一食堂',
      name: '红烧肉盖饭',
      caloriesText: '-1',
      proteinText: '1.5',
      fatText: String(CANTEEN_MACRO_MAX + 1),
      carbText: '96',
      priceText: '1.234',
    })
    expect(problems).toContain('热量要填非负整数')
    expect(problems).toContain('蛋白质要填非负整数')
    expect(problems).toContain(`脂肪不能超过 ${CANTEEN_MACRO_MAX}`)
    expect(problems).toContain('价格请填数字，最多两位小数')
  })

  it('合法草稿没有任何问题', () => {
    expect(
      validateDraft({
        canteen: '第二食堂',
        name: '麻婆豆腐盖饭',
        caloriesText: '640',
        proteinText: '22',
        fatText: '24',
        carbText: '84',
        priceText: '14',
      }),
    ).toEqual([])
  })
})
