import type { Result } from '@kedaya/shared'
import { err, ok } from '@kedaya/shared'

import { FLEA_CATEGORIES, FLEA_CONDITIONS, summarize } from '../../domain/models/fleaMarket'
import type {
  CreateFleaItemInput,
  FleaItem,
  FleaItemFilters,
  FleaItemSummary,
  UpdateFleaItemInput,
} from '../../domain/models/fleaMarket'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { FleaItemRepository } from '../../domain/ports/fleaMarketRepository'
import { createDetailUseCase } from '../common/detailUseCase'
import type { DetailUseCase } from '../common/detailUseCase'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'

/**
 * 跳蚤市场用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 列表与详情的**机制**来自 `application/common/*`（六个模块共用、单独有测试），
 * 本文件只负责三件模块特有的事：
 *   1. 把筛选条件翻译成仓储查询；
 *   2. 把行数据映射成卡片直接可读的 `FleaItemSummary`；
 *   3. 发布前做客户端校验（即时提示），并保证「发布者只能是自己」。
 */

const PAGE_SIZE = 10

/** 商品标题 / 价格 / 描述的客户端校验（与服务端同一套规则，只做即时提示） */
export const FLEA_TITLE_MAX = 60
export const FLEA_DESCRIPTION_MAX = 2000
export const FLEA_PRICE_MAX_FEN = 100_000_000

export interface FleaDraft {
  title: string
  description: string
  priceFen: number
  category: string
  condition: string
  campusSpot: string
}

export function validateDraft(draft: FleaDraft): string[] {
  const problems: string[] = []
  const title = draft.title.trim()
  if (title.length === 0) problems.push('请填写商品标题')
  if ([...title].length > FLEA_TITLE_MAX) problems.push(`标题最多 ${FLEA_TITLE_MAX} 个字`)

  if (!Number.isInteger(draft.priceFen) || draft.priceFen < 0) {
    problems.push('请填写正确的价格')
  } else if (draft.priceFen > FLEA_PRICE_MAX_FEN) {
    problems.push('价格超出上限')
  }

  if (!(FLEA_CATEGORIES as readonly string[]).includes(draft.category)) {
    problems.push('请选择商品分类')
  }
  if (!(FLEA_CONDITIONS as readonly string[]).includes(draft.condition)) {
    problems.push('请选择成色')
  }
  if ([...draft.description].length > FLEA_DESCRIPTION_MAX) {
    problems.push(`描述最多 ${FLEA_DESCRIPTION_MAX} 个字`)
  }
  return problems
}

export interface FleaMarketDeps {
  repository: FleaItemRepository
  cache: CachePort
  clock: ClockPort
  /** 列表缓存 key 由装配层注入 */
  cacheKey: string
  /** 当前登录用户 id（未登录为 null）—— 用来判定「这是我发的」 */
  viewerId: () => string | null
}

export interface FleaMarketUseCases {
  list: ListUseCase<FleaItemFilters, FleaItemSummary>
  detail: DetailUseCase<FleaItem>
  /** 发布：本地校验通过后才发请求 */
  create(input: CreateFleaItemInput): Promise<Result<FleaItem, RepositoryError>>
  update(id: string, input: UpdateFleaItemInput): Promise<Result<FleaItem, RepositoryError>>
  remove(id: string): Promise<Result<{ id: string }, RepositoryError>>
  /** 领域动作：成功后自动用返回的实体刷新详情页 */
  reserve(id: string): Promise<Result<FleaItem, RepositoryError>>
  release(id: string): Promise<Result<FleaItem, RepositoryError>>
  markSold(id: string): Promise<Result<FleaItem, RepositoryError>>
}

export function createFleaMarketUseCases(deps: FleaMarketDeps): FleaMarketUseCases {
  const { repository, cache, clock, cacheKey, viewerId } = deps

  const list: ListUseCase<FleaItemFilters, FleaItemSummary> = createListUseCase<
    FleaItemFilters,
    FleaItem,
    FleaItemSummary
  >({
    cache,
    clock,
    cacheKey,
    defaultQuery: { sort: 'latest' },
    isCachedPage: createCachedPageGuard<FleaItem>(),
    fetchPage: (filters, cursor) => repository.list({ cursor, limit: PAGE_SIZE, filters }),
    // 每次映射时取当前用户：登录后重新 load 即可拿到正确的「我的」标记
    mapItem: (item, now) => summarize(item, viewerId(), now),
  })

  const detail = createDetailUseCase<FleaItem>((id) => repository.detail(id))

  function validate(input: CreateFleaItemInput): Result<true, RepositoryError> {
    const problems = validateDraft({
      title: input.title,
      description: input.description ?? '',
      priceFen: input.priceFen,
      category: input.category,
      condition: input.condition ?? '',
      campusSpot: input.campusSpot ?? '',
    })
    if (problems.length > 0) {
      return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查填写内容' })
    }
    return ok(true)
  }

  return {
    list,
    detail,

    async create(input) {
      if (viewerId() === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录后再发布商品' })
      }
      const checked = validate(input)
      if (!checked.ok) return checked

      const result = await repository.create({
        ...input,
        title: input.title.trim(),
        description: input.description?.trim() ?? null,
        campusSpot: input.campusSpot?.trim() ?? null,
      })
      if (result.ok) list.reset()
      return result
    },

    update: (id, input) => repository.update(id, input),
    remove: (id) => repository.remove(id),
    reserve: (id) => detail.mutate(() => repository.reserve(id)),
    release: (id) => detail.mutate(() => repository.release(id)),
    markSold: (id) => detail.mutate(() => repository.markSold(id)),
  }
}
