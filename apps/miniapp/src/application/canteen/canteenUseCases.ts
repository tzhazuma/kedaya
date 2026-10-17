import { err, type Result } from '@kedaya/shared'

import {
  caloriesProblem,
  canteenNameProblem,
  dishNameProblem,
  macroProblem,
  parseIntegerText,
  parseYuanText,
  priceProblem,
  summarize,
} from '../../domain/models/canteen'
import type {
  CanteenCalorieSummary,
  CanteenDish,
  CanteenDishFilters,
  CanteenDishSummary,
} from '../../domain/models/canteen'
import type { CachePort } from '../../domain/ports/cachePort'
import type { CanteenRepository } from '../../domain/ports/canteenRepository'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import { createDetailUseCase } from '../common/detailUseCase'
import type { DetailUseCase } from '../common/detailUseCase'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'

/**
 * 食堂营养用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 列表与详情的**机制**来自 `application/common/*`（各模块共用、单独有测试），
 * 本文件只负责模块特有的事：
 *   1. 把筛选条件（食堂精确 / 菜名模糊）翻译成仓储查询；
 *   2. 把行数据映射成卡片直接可读的 `CanteenDishSummary`（单位、金额、相对时间）；
 *   3. 发布前把**表单文本**解析成整数 / 分并做客户端校验
 *      —— 创建匿名（后端不带归属字段），因此不需要登录，但数值边界一样要挡。
 */

const PAGE_SIZE = 10

/** 创建表单的原始文本草稿（提交前才转数字） */
export interface CanteenDishDraft {
  canteen: string
  name: string
  /** 千卡（文本，非负整数） */
  caloriesText: string
  /** 蛋白质 / 脂肪 / 碳水（克） */
  proteinText: string
  fatText: string
  carbText: string
  /** 元（文本，最多两位小数） */
  priceText: string
}

/**
 * 客户端校验（与服务端同一套规则，只做即时提示）。
 * 返回空数组表示可以提交。
 */
export function validateDraft(draft: CanteenDishDraft): string[] {
  const problems: string[] = []
  const push = (problem: string | null): void => {
    if (problem !== null) problems.push(problem)
  }

  push(canteenNameProblem(draft.canteen))
  push(dishNameProblem(draft.name))
  push(caloriesProblem(draft.caloriesText))
  push(macroProblem(draft.proteinText, '蛋白质'))
  push(macroProblem(draft.fatText, '脂肪'))
  push(macroProblem(draft.carbText, '碳水'))
  push(priceProblem(draft.priceText))

  return problems
}

export interface CanteenDeps {
  repository: CanteenRepository
  cache: CachePort
  clock: ClockPort
  /** 列表缓存 key 由装配层注入 */
  cacheKey: string
}

export interface CanteenUseCases {
  list: ListUseCase<CanteenDishFilters, CanteenDishSummary>
  detail: DetailUseCase<CanteenDish>
  /** 创建：本地校验 + 文本 → 数字 / 分转换通过后才发请求 */
  create(draft: CanteenDishDraft): Promise<Result<CanteenDish, RepositoryError>>
  /** 某食堂汇总（`GET /canteen/calories?canteen=`） */
  calories(canteen: string): Promise<Result<CanteenCalorieSummary, RepositoryError>>
}

export function createCanteenUseCases(deps: CanteenDeps): CanteenUseCases {
  const { repository, cache, clock, cacheKey } = deps

  const list: ListUseCase<CanteenDishFilters, CanteenDishSummary> = createListUseCase<
    CanteenDishFilters,
    CanteenDish,
    CanteenDishSummary
  >({
    cache,
    clock,
    cacheKey,
    defaultQuery: {},
    isCachedPage: createCachedPageGuard<CanteenDish>(),
    fetchPage: (filters, cursor) => repository.list({ cursor, limit: PAGE_SIZE, filters }),
    mapItem: (dish, now) => summarize(dish, now),
  })

  const detail = createDetailUseCase<CanteenDish>((id) => repository.detail(id))

  return {
    list,
    detail,

    async create(draft) {
      const problems = validateDraft(draft)
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查填写内容' })
      }

      // validateDraft 已保证可解析；这里再判一次只是为了让类型收窄
      const caloriesKcal = parseIntegerText(draft.caloriesText)
      const proteinG = parseIntegerText(draft.proteinText)
      const fatG = parseIntegerText(draft.fatText)
      const carbG = parseIntegerText(draft.carbText)
      const priceFen = parseYuanText(draft.priceText)
      if (
        caloriesKcal === null ||
        proteinG === null ||
        fatG === null ||
        carbG === null ||
        priceFen === null
      ) {
        return err({ code: 'VALIDATION_FAILED', message: '请检查填写内容' })
      }

      const result: Result<CanteenDish, RepositoryError> = await repository.create({
        canteen: draft.canteen,
        name: draft.name.trim(),
        caloriesKcal,
        proteinG,
        fatG,
        carbG,
        priceFen,
      })
      // 新菜品会影响列表首屏与所在食堂的汇总，让列表缓存失效，下次进入重新拉取
      if (result.ok) list.reset()
      return result
    },

    calories: (canteen) => repository.calories(canteen),
  }
}
