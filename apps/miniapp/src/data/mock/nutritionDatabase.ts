import { inferAllergensFromName, sumItems, type NutritionTotals } from '@kedaya/shared'

import type {
  CanteenDish,
  CreateDishInput,
  DishCategory,
  MealItem,
  MealRecord,
  MealType,
  NutritionTargetProfile,
  RecognizeCandidate,
  SaveTargetInput,
} from '../../domain/models/nutrition'
import type { NutritionTarget } from '../../domain/models/nutrition'
import type { DishPage, DishSearchQuery } from '../../domain/ports/nutritionRepository'
import { MOCK_DISHES, MOCK_NUTRITION_TARGET, MOCK_UNMATCHED_DISHES } from './nutritionFixtures'

/**
 * 营养管家园内存数据库 —— mock repository 的存储内核。
 *
 * 游标分页语义与后端保持一致（契约 §6.1）：`cursor` 是上一条记录的 id。
 * 「今天已吃」的种子餐按注入的 `now` 生成，保证任何时候演示都看得见进度环。
 */

export interface NutritionDatabase {
  listDishes(query?: DishSearchQuery): DishPage
  findDish(id: string): CanteenDish | null
  /** 菜品库总数（菜品覆盖率的分母） */
  countDishes(): number
  addDish(input: CreateDishInput): CanteenDish
  getTarget(): NutritionTargetProfile | null
  setTarget(target: SaveTargetInput): NutritionTargetProfile
  addMeal(input: {
    mealType: MealType
    source: 'manual' | 'photo'
    eatenAt?: string
    note?: string
    items: Array<{ dishId?: string; dishName: string; servings?: number }>
  }, now: Date): MealRecord
  mealsForDay(dateKey: string, now: Date): MealRecord[]
  /** 某时刻之后的全部记录（趋势用） */
  mealsSince(from: Date): MealRecord[]
  /** 修改当餐：餐型 / 备注 / 份数（按明细顺序） */
  updateMeal(id: string, input: { mealType?: MealType; note?: string | null; servings?: number[] }): MealRecord | null
  /** 删除当餐 */
  deleteMeal(id: string): boolean
  /**
   * 演示数据：往前补 N 天的记录（每天 2~3 餐，数值按天轮换）。
   * 返回新增条数；已存在的同一天不会重复补。
   */
  seedPastDays(days: number, now: Date): number
  recognize(imageUrl: string): { mode: 'mock'; candidates: RecognizeCandidate[] }
  reset(): void
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 本地时区 YYYY-MM-DD */
function dateKeyOf(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 今天的某个时刻（演示餐的落点） */
function atHour(now: Date, hour: number, minute: number): Date {
  const date = new Date(now)
  date.setHours(hour, minute, 0, 0)
  return date
}

/** 指定「往前第 N 天」的某个时刻 */
function atDayOffset(now: Date, dayOffset: number, hour: number, minute: number): Date {
  const date = new Date(now)
  date.setDate(date.getDate() - dayOffset)
  date.setHours(hour, minute, 0, 0)
  return date
}

function toItem(dish: CanteenDish, servings: number): MealItem {
  return {
    dishId: dish.id,
    dishName: dish.name,
    category: dish.category,
    servings,
    caloriesKcal: dish.caloriesKcal,
    proteinG: dish.proteinG,
    fatG: dish.fatG,
    carbG: dish.carbG,
    fiberG: dish.fiberG,
    sodiumMg: dish.sodiumMg,
  }
}

function withTotals(record: Omit<MealRecord, 'totals'>): MealRecord {
  return { ...record, totals: sumItems(record.items) as NutritionTotals }
}

function matchesKeyword(dish: CanteenDish, keyword: string | undefined): boolean {
  if (keyword === undefined || keyword.trim() === '') return true
  return dish.name.toLowerCase().includes(keyword.trim().toLowerCase())
}

/** 稳定字符串哈希（djb2）—— 同一张"照片"永远识别出同一组菜 */
function hashOf(input: string): number {
  let h = 5381
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export function createNutritionDatabase(
  seedDishes: readonly CanteenDish[] = MOCK_DISHES,
  seedTarget: NutritionTarget | null = MOCK_NUTRITION_TARGET,
): NutritionDatabase {
  let dishes: CanteenDish[] = seedDishes.map(clone)
  let target: NutritionTargetProfile | null = seedTarget === null ? null : clone(seedTarget)
  let meals: MealRecord[] = []
  let nextDishSeq = 1
  let nextMealSeq = 1
  /**
   * 种子餐只落一次。
   * 不能再用 `meals.length === 0` 判断 —— 用户把当天记录全删掉之后，
   * 那个判断会把演示种子餐「复活」，看起来像删除失败。
   */
  let seeded = false

  /** 种子餐：今天早餐 + 午餐已吃（让进度环一进来就有内容；只落一次） */
  function seedMeals(now: Date): void {
    if (seeded) return
    seeded = true
    const byId = (id: string): CanteenDish => {
      const found = dishes.find((dish) => dish.id === id)
      if (found === undefined) throw new Error(`种子菜品缺失: ${id}`)
      return found
    }
    const breakfast = withTotals({
      id: 'meal-seed-1',
      mealType: 'breakfast',
      source: 'manual',
      eatenAt: atHour(now, 7, 30).toISOString(),
      note: null,
      items: [toItem(byId('dish-doujiang'), 1), toItem(byId('dish-bun'), 1)],
    })
    const lunch = withTotals({
      id: 'meal-seed-2',
      mealType: 'lunch',
      source: 'manual',
      eatenAt: atHour(now, 12, 10).toISOString(),
      note: null,
      items: [
        toItem(byId('dish-rice'), 1),
        toItem(byId('dish-paigu'), 1),
        toItem(byId('dish-bocai'), 1),
      ],
    })
    meals = [lunch, breakfast]
  }

  function resolveItem(item: { dishId?: string; dishName: string; servings?: number }): MealItem | null {
    const dish =
      (item.dishId === undefined ? undefined : dishes.find((d) => d.id === item.dishId)) ??
      dishes.find((d) => d.name === item.dishName)
    if (dish === undefined) return null
    return toItem(dish, item.servings ?? 1)
  }

  return {
    listDishes(query: DishSearchQuery = {}): DishPage {
      const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 20)), 100)
      const filtered = dishes
        .filter((dish) => query.category === undefined || dish.category === query.category)
        .filter((dish) => matchesKeyword(dish, query.q))
        .sort((a, b) => a.id.localeCompare(b.id))

      const cursor = query.cursor ?? null
      const startIndex = cursor === null ? 0 : filtered.findIndex((dish) => dish.id === cursor) + 1
      const page = filtered.slice(startIndex, startIndex + limit)
      const hasMore = startIndex + limit < filtered.length
      const last = page.length > 0 ? page[page.length - 1] : undefined

      return {
        items: page.map(clone),
        nextCursor: hasMore && last !== undefined ? last.id : null,
      }
    },

    findDish(id: string): CanteenDish | null {
      const found = dishes.find((dish) => dish.id === id)
      return found === undefined ? null : clone(found)
    },

    countDishes(): number {
      return dishes.length
    },

    addDish(input: CreateDishInput): CanteenDish {
      const dish: CanteenDish = {
        id: `dish-user-${nextDishSeq++}`,
        canteen: input.canteen,
        name: input.name,
        category: input.category,
        servingG: input.servingG,
        caloriesKcal: input.caloriesKcal,
        proteinG: input.proteinG,
        fatG: input.fatG,
        carbG: input.carbG,
        fiberG: input.fiberG,
        sodiumMg: input.sodiumMg,
        priceFen: input.priceFen,
        // 手动录入的菜同样按菜名推断过敏原（后台可再修正）
        allergens: inferAllergensFromName(input.name),
      }
      dishes = [...dishes, dish]
      return clone(dish)
    },

    getTarget(): NutritionTargetProfile | null {
      return target === null ? null : clone(target)
    },

    setTarget(next: SaveTargetInput): NutritionTargetProfile {
      target = clone(next)
      return clone(target)
    },

    addMeal(input, now: Date): MealRecord {
      // 与 mealsForDay 同一守卫：第一次碰「餐」就落位种子餐，
      // 用户从记录页直接进 demo 也能看见进度环（不等 today() 先被调用）
      if (meals.length === 0) seedMeals(now)
      const items: MealItem[] = []
      for (const item of input.items) {
        const resolved = resolveItem(item)
        if (resolved === null) {
          throw new Error(`菜品库中找不到「${item.dishName}」`)
        }
        items.push(resolved)
      }
      const record = withTotals({
        id: `meal-user-${nextMealSeq++}`,
        mealType: input.mealType,
        source: input.source,
        eatenAt: input.eatenAt ?? now.toISOString(),
        note: input.note ?? null,
        items,
      })
      meals = [record, ...meals]
      return clone(record)
    },

    mealsForDay(dateKey: string, now: Date): MealRecord[] {
      // 种子餐在首次访问时按今天的日期落点生成（幂等）
      if (meals.length === 0) seedMeals(now)
      return meals
        .filter((meal) => dateKeyOf(new Date(meal.eatenAt)) === dateKey)
        .map(clone)
    },

    /**
     * 演示数据：往前补 N 天。
     *
     * 为什么需要它：趋势图 / 周报 / 连续天数这些功能，靠「今天两餐」是看不出效果的。
     * 这里按天轮换菜品、并刻意让某些天「没记晚餐」「钠超标」，这样图表与周报的
     * 每个数字都能对上，不用手点十几次。
     */
    seedPastDays(days: number, now: Date): number {
      if (meals.length === 0) seedMeals(now)
      if (dishes.length === 0) return 0

      const pick = (index: number): CanteenDish => {
        const dish = dishes[((index % dishes.length) + dishes.length) % dishes.length]
        if (dish === undefined) throw new Error('菜品池为空')
        return dish
      }

      let created = 0
      for (let offset = 1; offset <= days; offset += 1) {
        const plans: Array<{ type: MealType; hour: number; minute: number; picks: number[] }> = [
          { type: 'breakfast', hour: 7, minute: 45, picks: [8 + (offset % 3), 1] },
          { type: 'lunch', hour: 12, minute: 15, picks: [0, 6 + (offset % 4), 11 + (offset % 3)] },
        ]
        // 每 4 天里有一天「没记晚餐」—— 让「连续记录/达标天数」有真实的缺口
        if (offset % 4 !== 3) {
          plans.push({ type: 'dinner', hour: 18, minute: 20, picks: [3 + (offset % 5), 13 + (offset % 3)] })
        }
        // 每 2 天里有一次「加餐喝了奶茶」—— 让「奶茶妹」和别的形象能同时命中
        if (offset % 2 === 0) {
          plans.push({ type: 'snack', hour: 15, minute: 30, picks: [18] })
        }

        for (const plan of plans) {
          const id = `meal-demo-${offset}-${plan.type}`
          if (meals.some((meal) => meal.id === id)) continue
          const record = withTotals({
            id,
            mealType: plan.type,
            source: 'manual',
            eatenAt: atDayOffset(now, offset, plan.hour, plan.minute).toISOString(),
            note: null,
            items: plan.picks.map((index) => toItem(pick(index), 1)),
          })
          meals = [...meals, record]
          created += 1
        }
      }
      return created
    },

    mealsSince(from: Date): MealRecord[] {
      return meals
        .filter((meal) => new Date(meal.eatenAt).getTime() >= from.getTime())
        .map(clone)
    },

    updateMeal(
      id: string,
      input: { mealType?: MealType; note?: string | null; servings?: number[] },
    ): MealRecord | null {
      const current = meals.find((meal) => meal.id === id)
      if (current === undefined) return null
      if (input.servings !== undefined && input.servings.length !== current.items.length) return null

      const items =
        input.servings === undefined
          ? current.items
          : current.items.map((item, index) => ({ ...item, servings: input.servings?.[index] ?? item.servings }))

      const next = withTotals({
        ...current,
        mealType: input.mealType ?? current.mealType,
        note: input.note === undefined ? current.note : input.note,
        items,
      })
      meals = meals.map((meal) => (meal.id === id ? next : meal))
      return clone(next)
    },

    deleteMeal(id: string): boolean {
      const before = meals.length
      meals = meals.filter((meal) => meal.id !== id)
      return meals.length < before
    },

    recognize(imageUrl: string): { mode: 'mock'; candidates: RecognizeCandidate[] } {
      const seed = hashOf(imageUrl)
      const count = 3 + (seed % 3)
      const offset = seed % dishes.length
      const candidates: RecognizeCandidate[] = []
      for (let i = 0; i < count; i += 1) {
        const dish = dishes[(offset + i * 3) % dishes.length]
        // 索引恒在界内；undefined 分支不可达，仅为满足 noUncheckedIndexedAccess
        if (dish === undefined) continue
        candidates.push({
          name: dish.name,
          category: dish.category as DishCategory,
          confidence: Math.round((0.95 - i * 0.11) * 100) / 100,
          mode: 'mock' as const,
          dish: clone(dish),
        })
      }
      // 末尾追加一个「菜品库还没有」的候选，演示诚实提示
      const unmatched = MOCK_UNMATCHED_DISHES[seed % MOCK_UNMATCHED_DISHES.length]
      if (unmatched !== undefined) {
        candidates.push({
          name: unmatched.name,
          category: unmatched.category,
          confidence: 0.42,
          mode: 'mock',
          dish: null,
        })
      }
      return { mode: 'mock', candidates }
    },

    reset(): void {
      dishes = seedDishes.map(clone)
      target = seedTarget === null ? null : clone(seedTarget)
      meals = []
      nextDishSeq = 1
      nextMealSeq = 1
      seeded = false
    },
  }
}
