import type { Result } from '@kedaya/shared'
import { err } from '@kedaya/shared'

import {
  detailProblem,
  happenedAtProblem,
  orderNoProblem,
  parseHappenedAtInput,
  placeProblem,
  summarize,
} from '../../domain/models/takeoutGuard'
import type {
  TakeoutGuardReport,
  TakeoutGuardReportFilters,
  TakeoutGuardReportSummary,
} from '../../domain/models/takeoutGuard'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { TakeoutGuardRepository } from '../../domain/ports/takeoutGuardRepository'
import { createDetailUseCase } from '../common/detailUseCase'
import type { DetailUseCase } from '../common/detailUseCase'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'

/**
 * 偷外卖用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 列表与详情的**机制**来自 `application/common/*`（六个模块共用、单独有测试），
 * 本文件只负责模块特有的事：
 *   1. 列表永远是"我的记录"（仓储与后端都按主体收窄，这里没有 mine 参数）；
 *   2. 把行数据映射成卡片直接可读的 `TakeoutGuardReportSummary`（后四位、状态标签、时间文案）；
 *   3. 发布前做客户端校验（含「发生时间」文本解析与 5 分钟时钟偏差），
 *      与服务端同一套文案 —— 不靠"发一个注定 400 的请求"来试探。
 */

const PAGE_SIZE = 10

export interface TakeoutGuardDraft {
  orderNo: string
  place: string
  /** 表单里的本地时间文本 `YYYY-MM-DD HH:mm` */
  happenedAtText: string
  detail: string
  /** 已上传成功的证据图地址（`useImageAttachments` 的产物，最多一张） */
  evidenceUrl?: string | null
}

/**
 * 客户端校验（与服务端同一套规则，只做即时提示）。
 *
 * `now` 由调用方注入（页面的容器时钟），因此「发生时间不能晚于当前时间」可复现、可测试。
 */
export function validateDraft(draft: TakeoutGuardDraft, now: Date): string[] {
  const problems: string[] = []

  const orderNo = orderNoProblem(draft.orderNo)
  if (orderNo !== null) problems.push(orderNo)

  const place = placeProblem(draft.place)
  if (place !== null) problems.push(place)

  if (draft.happenedAtText.trim() === '') {
    problems.push('请填写发生时间')
  } else {
    const happenedAt = parseHappenedAtInput(draft.happenedAtText)
    if (happenedAt === null) {
      problems.push('请按「YYYY-MM-DD HH:mm」填写发生时间')
    } else {
      const problem = happenedAtProblem(happenedAt, now)
      if (problem !== null) problems.push(problem)
    }
  }

  const detail = detailProblem(draft.detail)
  if (detail !== null) problems.push(detail)

  return problems
}

export interface TakeoutGuardDeps {
  repository: TakeoutGuardRepository
  cache: CachePort
  clock: ClockPort
  /** 列表缓存 key 由装配层注入 */
  cacheKey: string
  /** 当前登录用户 id（未登录为 null）—— 用来在发请求前就挡住注定 401 的创建 */
  viewerId: () => string | null
}

export interface TakeoutGuardUseCases {
  list: ListUseCase<TakeoutGuardReportFilters, TakeoutGuardReportSummary>
  detail: DetailUseCase<TakeoutGuardReport>
  /** 记录一次：本地校验 + 时间文本解析通过后才发请求 */
  create(draft: TakeoutGuardDraft): Promise<Result<TakeoutGuardReport, RepositoryError>>
  /**
   * 领域动作：成功后**用服务端返回的实体刷新详情**（`detail.mutate`），
   * 页面因此不需要自己写"乐观更新 + 回滚"。
   */
  escalate(id: string): Promise<Result<TakeoutGuardReport, RepositoryError>>
  resolve(id: string): Promise<Result<TakeoutGuardReport, RepositoryError>>
}

export function createTakeoutGuardUseCases(deps: TakeoutGuardDeps): TakeoutGuardUseCases {
  const { repository, cache, clock, cacheKey, viewerId } = deps

  const list: ListUseCase<TakeoutGuardReportFilters, TakeoutGuardReportSummary> = createListUseCase<
    TakeoutGuardReportFilters,
    TakeoutGuardReport,
    TakeoutGuardReportSummary
  >({
    cache,
    clock,
    cacheKey,
    // 默认不筛状态（后端本来就只返回"我的"，这里没有 mine）
    defaultQuery: {},
    isCachedPage: createCachedPageGuard<TakeoutGuardReport>(),
    fetchPage: (filters, cursor) => repository.list({ cursor, limit: PAGE_SIZE, filters }),
    mapItem: (report, now) => summarize(report, now),
  })

  const detail = createDetailUseCase<TakeoutGuardReport>((id) => repository.detail(id))

  return {
    list,
    detail,

    async create(draft) {
      if (viewerId() === null) {
        return err({ code: 'UNAUTHENTICATED', message: '记录外卖被拿错需要先登录' })
      }

      const problems = validateDraft(draft, clock.now())
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查填写内容' })
      }

      // validateDraft 已保证可解析；这里再判一次只是为了让类型收窄
      const happenedAt = parseHappenedAtInput(draft.happenedAtText)
      if (happenedAt === null) {
        return err({ code: 'VALIDATION_FAILED', message: '请按「YYYY-MM-DD HH:mm」填写发生时间' })
      }

      const result = await repository.create({
        orderNo: draft.orderNo.trim(),
        place: draft.place.trim(),
        happenedAt: happenedAt.toISOString(),
        detail: draft.detail.trim(),
        evidenceUrl: draft.evidenceUrl ?? null,
      })
      // 新记录会出现在列表最前面，重置缓存让下次进入列表重新拉取
      if (result.ok) list.reset()
      return result
    },

    escalate: (id) => detail.mutate(() => repository.escalate(id)),
    resolve: (id) => detail.mutate(() => repository.resolve(id)),
  }
}
