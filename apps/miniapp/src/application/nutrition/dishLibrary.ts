import { isDishCategory } from '@kedaya/shared'

import type { CanteenDish } from '../../domain/models/nutrition'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { NutritionRepository } from '../../domain/ports/nutritionRepository'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'

/**
 * 「菜品库（按食堂看）」用例 —— 营养管家里的**只读**菜品目录。
 *
 * 为什么单独一个用例，而不是复用记当餐页的 `logMeal` 检索：
 *   · `logMeal` 的状态里混着当餐购物车与拍照候选，两者生命周期完全不同
 *     （购物车在「记录当餐」页里跨页保留，而浏览菜品库不该碰它）；
 *   · 菜品库要多一个**品类**筛选维度（按食堂 + 品类 + 菜名叠加），
 *     `logMeal` 的检索不需要它。
 *
 * 列表机制（hydrate 缓存 → 后台刷新 → 失败静默降级 → 游标续页）全部来自
 * `application/common/listUseCase.ts` —— 这里只负责把筛选条件翻译成仓储查询。
 */

/** 每页条数：一屏 20 行够用，且远小于后端 `limit` 上限（100） */
export const DISH_LIBRARY_PAGE_SIZE = 20

/**
 * 筛选条件。
 *
 * 空字符串表示「不限」—— 而不是 `undefined`：`listUseCase` 的 query 会整体
 * 写进缓存与状态，用 `''` 才能让「清空筛选」这件事在缓存里也表达得出来
 * （`undefined` 在 JSON 里会直接消失，读回来就分不清「不限」和「没存」）。
 */
export interface DishLibraryQuery extends Record<string, unknown> {
  /** 菜名模糊搜索（`''` = 不限） */
  q: string
  /** 食堂**精确**筛选（`''` = 全部食堂） */
  canteen: string
  /** 菜的种类（`''` = 全部） */
  category: string
}

export const DISH_LIBRARY_DEFAULT_QUERY: DishLibraryQuery = { q: '', canteen: '', category: '' }

/**
 * 把状态里的 `query`（`Record<string, unknown>`）读回成强类型筛选条件。
 *
 * `listUseCase` 的状态只承诺「记着筛选条件」，类型是宽泛的 `unknown` 记录；
 * 页面要按字段回显筛选器，于是这一步归一化收在**拥有这个形状的用例文件**里，
 * 而不是让页面到处写 `typeof x === 'string' ? x : ''` 或 `as` 断言。
 */
export function readDishLibraryQuery(query: Record<string, unknown>): DishLibraryQuery {
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  return { q: text(query.q), canteen: text(query.canteen), category: text(query.category) }
}

export type DishLibraryUseCase = ListUseCase<DishLibraryQuery, CanteenDish>

export interface DishLibraryDeps {
  repository: NutritionRepository
  cache: CachePort
  clock: ClockPort
  /** 缓存 key 由装配层注入（application 不感知存储实现） */
  cacheKey: string
}

export function createDishLibraryUseCase(deps: DishLibraryDeps): DishLibraryUseCase {
  const { repository, cache, clock, cacheKey } = deps

  return createListUseCase<DishLibraryQuery, CanteenDish, CanteenDish>({
    cache,
    clock,
    cacheKey,
    defaultQuery: { ...DISH_LIBRARY_DEFAULT_QUERY },
    isCachedPage: createCachedPageGuard<CanteenDish>(),
    // 行数据本身就是 UI 要的形状（菜名 / 食堂 / 六项营养 / 每份克数 / 价格），
    // 不再包一层 summary —— 包了反而要维护两份字段名。
    mapItem: (dish) => dish,
    fetchPage: (query, cursor) =>
      repository.listDishes({
        q: query.q.trim() === '' ? undefined : query.q.trim(),
        canteen: query.canteen === '' ? undefined : query.canteen,
        // 品类只在合法时下传：脏值（旧缓存里的老枚举）不该变成一次 400
        category: isDishCategory(query.category) ? query.category : undefined,
        cursor,
        limit: DISH_LIBRARY_PAGE_SIZE,
      }),
  })
}
