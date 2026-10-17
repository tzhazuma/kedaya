import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import {
  CANTEEN_CALORIES_MAX,
  CANTEEN_MACRO_MAX,
  CANTEEN_PRICE_MAX_FEN,
  canteenNameProblem,
  dishNameProblem,
  priceLabel,
} from '../../domain/models/canteen'
import type {
  CanteenCalorieSummary,
  CanteenDish,
  CreateCanteenDishInput,
} from '../../domain/models/canteen'
import type { CachePort } from '../../domain/ports/cachePort'
import type { CanteenRepository, ListCanteenDishesQuery } from '../../domain/ports/canteenRepository'
import type { RepositoryError } from '../../domain/ports/errors'
import { STORAGE_PREFIX } from '../storage/keys'

/**
 * Mock 食堂营养仓储（`TARO_APP_USE_MOCK !== 'false'` 时启用）。
 *
 * 与"假列表"不同，它**复刻了后端 `CanteenDishService` 的规则**：
 *   · 列表：食堂**精确**筛选 + 菜名**模糊**搜索，固定最新在前（`createdAt desc` + `id desc` 兜底）；
 *   · 汇总：与 `summarizeByCanteen` 一样做真实聚合（菜数 / 总热量 / 均价取整），空食堂不除零；
 *   · 创建：食堂白名单 + 名称 / 营养 / 价格的上界校验（创建**匿名**，不需要登录）。
 *
 * 数据落在 `CachePort`（默认 Taro Storage），刷新页面后仍然在。
 * 存储 key 刻意与列表缓存 key 分开：列表缓存存 `{ items, nextCursor, updatedAt }`，
 * 若两者共用同一个 key，一次 `list.load()` 就会把数据集覆盖成缓存载荷。
 */

export interface MockCanteenRepositoryOptions {
  cache: CachePort
  latencyMs?: number
  now?: () => Date
}

export interface MockCanteenRepository extends CanteenRepository {
  readonly kind: 'mock'
  reset(): void
  /** 让接下来 N 次请求失败（页面用它演示错误态，而不是硬编码假状态） */
  failNextRequests(times: number): void
  /** 清空数据集（演示空态）；`reset()` 之后仍能恢复种子 */
  clearAll(): void
  /** 仅供测试 / 演示：直接替换数据集，保证用例确定可复现 */
  seed(dishes: readonly CanteenDish[]): void
}

/** 与 `StorageKeys.canteenListCache` 分开：这里存的是数据集，不是列表缓存 */
const MOCK_DB_KEY = `${STORAGE_PREFIX}canteen:mock-db`

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

type SeedDish = Omit<CanteenDish, 'id' | 'createdAt' | 'updatedAt'>

/**
 * 种子数据 —— 取自后端 `prisma/seed.ts` 的 `seedCanteen()`，
 * 数值与元/分换算都经过核对，保证「真实模式长什么样，mock 就长什么样」。
 */
const SEED_DISHES: readonly SeedDish[] = [
  { canteen: '第一食堂', name: '红烧肉盖饭', caloriesKcal: 780, proteinG: 32, fatG: 28, carbG: 96, priceFen: 1_800 },
  { canteen: '第一食堂', name: '清蒸鲈鱼套餐', caloriesKcal: 520, proteinG: 38, fatG: 14, carbG: 52, priceFen: 2_200 },
  { canteen: '第一食堂', name: '番茄鸡蛋面', caloriesKcal: 560, proteinG: 20, fatG: 16, carbG: 82, priceFen: 1_200 },
  { canteen: '第一食堂', name: '蒜蓉西兰花', caloriesKcal: 120, proteinG: 6, fatG: 6, carbG: 12, priceFen: 600 },
  { canteen: '第二食堂', name: '水煮肉片', caloriesKcal: 720, proteinG: 30, fatG: 42, carbG: 38, priceFen: 1_900 },
  { canteen: '第二食堂', name: '麻婆豆腐盖饭', caloriesKcal: 640, proteinG: 22, fatG: 24, carbG: 84, priceFen: 1_400 },
  { canteen: '第二食堂', name: '上汤娃娃菜', caloriesKcal: 90, proteinG: 4, fatG: 4, carbG: 10, priceFen: 700 },
  { canteen: '第三食堂', name: '牛肉拉面（大碗）', caloriesKcal: 700, proteinG: 30, fatG: 20, carbG: 98, priceFen: 1_500 },
  { canteen: '第三食堂', name: '麻辣香锅（自选）', caloriesKcal: 850, proteinG: 26, fatG: 48, carbG: 72, priceFen: 2_600 },
  { canteen: '第三食堂', name: '广式煲仔饭', caloriesKcal: 760, proteinG: 26, fatG: 26, carbG: 100, priceFen: 2_000 },
  { canteen: '教工食堂', name: '轻食鸡胸沙拉', caloriesKcal: 380, proteinG: 34, fatG: 12, carbG: 34, priceFen: 2_200 },
  { canteen: '教工食堂', name: '杂粮饭 + 时蔬', caloriesKcal: 420, proteinG: 14, fatG: 8, carbG: 74, priceFen: 1_300 },
  { canteen: '咖啡吧', name: '美式咖啡（中杯）', caloriesKcal: 10, proteinG: 0, fatG: 0, carbG: 2, priceFen: 1_200 },
  { canteen: '咖啡吧', name: '鸡胸三明治', caloriesKcal: 330, proteinG: 22, fatG: 12, carbG: 34, priceFen: 1_600 },
]

function defaultSeed(now: Date): CanteenDish[] {
  return SEED_DISHES.map((dish, index) => {
    // 间隔 7 分钟、最新的排最前：列表按 createdAt desc 排序后顺序与数组一致，便于阅读
    const iso = new Date(now.getTime() - index * 7 * 60_000).toISOString()
    return {
      id: `cd-demo-${String(index + 1).padStart(2, '0')}`,
      ...dish,
      createdAt: iso,
      updatedAt: iso,
    }
  })
}

/** 整数营养素：非负整数且不超上界 */
function integerProblem(value: number, label: string, max: number): string | null {
  if (!Number.isInteger(value) || value < 0) return `${label}要填非负整数`
  if (value > max) return `${label}不能超过 ${max}`
  return null
}

function priceFenProblem(fen: number): string | null {
  if (!Number.isSafeInteger(fen) || fen < 0) return '价格请填数字，最多两位小数'
  if (fen > CANTEEN_PRICE_MAX_FEN) return `价格不能超过 ${priceLabel(CANTEEN_PRICE_MAX_FEN)}`
  return null
}

export function createMockCanteenRepository(
  options: MockCanteenRepositoryOptions,
): MockCanteenRepository {
  const { cache } = options
  const now = options.now ?? (() => new Date())
  const latencyMs = options.latencyMs ?? 180
  let remainingFailures = 0

  function load(): CanteenDish[] {
    const stored = cache.read<unknown>(MOCK_DB_KEY)
    // 空数组是**合法状态**（用户清空了演示数据），必须与"从未初始化"区分开
    if (Array.isArray(stored)) return stored as CanteenDish[]
    const seeded = defaultSeed(now())
    cache.write(MOCK_DB_KEY, seeded)
    return seeded
  }

  function save(dishes: CanteenDish[]): void {
    cache.write(MOCK_DB_KEY, dishes)
  }

  async function guard<T>(
    work: () => Result<T, RepositoryError>,
  ): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  /** 创建校验：食堂白名单 → 名称 → 热量 → 蛋白 / 脂肪 / 碳水 → 价格（顺序与后端一致） */
  function validateCreate(input: CreateCanteenDishInput): RepositoryError | null {
    const checks: ReadonlyArray<readonly [string, string | null]> = [
      ['canteen', canteenNameProblem(input.canteen)],
      ['name', dishNameProblem(input.name)],
      ['caloriesKcal', integerProblem(input.caloriesKcal, '热量', CANTEEN_CALORIES_MAX)],
      ['proteinG', integerProblem(input.proteinG, '蛋白质', CANTEEN_MACRO_MAX)],
      ['fatG', integerProblem(input.fatG, '脂肪', CANTEEN_MACRO_MAX)],
      ['carbG', integerProblem(input.carbG, '碳水', CANTEEN_MACRO_MAX)],
      ['priceFen', priceFenProblem(input.priceFen)],
    ]
    for (const [field, message] of checks) {
      if (message !== null) return { code: 'VALIDATION_FAILED', message, details: { field } }
    }
    return null
  }

  return {
    kind: 'mock',

    list(query: ListCanteenDishesQuery): Promise<Result<Page<CanteenDish>, RepositoryError>> {
      return guard(() => {
        let dishes = load()
        const canteen = query.filters.canteen
        const q = query.filters.q

        if (canteen !== undefined && canteen.trim() !== '') {
          // 食堂是**精确**匹配（与后端 `where.canteen = value` 一致），未知食堂返回空列表
          dishes = dishes.filter((dish) => dish.canteen === canteen.trim())
        }
        if (q !== undefined && q.trim() !== '') {
          const keyword = q.trim().toLowerCase()
          dishes = dishes.filter((dish) => dish.name.toLowerCase().includes(keyword))
        }

        // 排序在后端由数据库完成：createdAt 为主，id 为第二排序键（避免翻页跳项）
        dishes = [...dishes].sort((a, b) => {
          const diff = b.createdAt.localeCompare(a.createdAt)
          return diff !== 0 ? diff : b.id.localeCompare(a.id)
        })

        const limit = query.limit ?? 20
        const start =
          query.cursor === null
            ? 0
            : Math.max(0, dishes.findIndex((dish) => dish.id === query.cursor) + 1)
        const visible = dishes.slice(start, start + limit)
        const hasMore = start + limit < dishes.length

        return ok({
          items: visible,
          nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
        })
      })
    },

    detail(id: string): Promise<Result<CanteenDish, RepositoryError>> {
      return guard(() => {
        const found = load().find((dish) => dish.id === id) ?? null
        if (found === null) return err({ code: 'NOT_FOUND', message: '菜品不存在或已下架' })
        return ok(found)
      })
    },

    create(input: CreateCanteenDishInput): Promise<Result<CanteenDish, RepositoryError>> {
      return guard(() => {
        const problem = validateCreate(input)
        if (problem !== null) return err(problem)

        const timestamp = now().toISOString()
        const dish: CanteenDish = {
          id: `cd-local-${String(now().getTime())}-${Math.random().toString(36).slice(2, 7)}`,
          canteen: input.canteen,
          name: input.name.trim(),
          caloriesKcal: input.caloriesKcal,
          proteinG: input.proteinG,
          fatG: input.fatG,
          carbG: input.carbG,
          priceFen: input.priceFen,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        save([dish, ...load()])
        return ok(dish)
      })
    },

    calories(canteen: string): Promise<Result<CanteenCalorieSummary, RepositoryError>> {
      return guard(() => {
        if (canteen.trim() === '') {
          return err({ code: 'VALIDATION_FAILED', message: 'canteen 必填', details: { canteen } })
        }
        const matched = load().filter((dish) => dish.canteen === canteen.trim())
        const totalCaloriesKcal = matched.reduce((sum, dish) => sum + dish.caloriesKcal, 0)
        const totalPriceFen = matched.reduce((sum, dish) => sum + dish.priceFen, 0)
        return ok({
          dishes: matched.length,
          totalCaloriesKcal,
          avgPriceFen: matched.length === 0 ? 0 : Math.round(totalPriceFen / matched.length),
        })
      })
    },

    reset(): void {
      remainingFailures = 0
      cache.remove(MOCK_DB_KEY)
      load()
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    clearAll(): void {
      save([])
    },

    seed(dishes: readonly CanteenDish[]): void {
      save([...dishes])
    },
  }
}
