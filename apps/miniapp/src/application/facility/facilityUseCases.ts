import type { Result } from '@kedaya/shared'
import { err } from '@kedaya/shared'

import {
  canCancel,
  facilityNameProblem,
  feeProblem,
  kindProblem,
  summarize,
  timeRangeProblem,
} from '../../domain/models/facility'
import type {
  CreateFacilityBookingInput,
  FacilityBooking,
  FacilityBookingSummary,
} from '../../domain/models/facility'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { FacilityRepository } from '../../domain/ports/facilityRepository'
import { createListUseCase } from '../common/listUseCase'
import type { CachedListPage, ListUseCase } from '../common/listUseCase'

/**
 * 场馆预约用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 列表机制（缓存 → 刷新 → 静默降级 → 游标续页）来自 `application/common/listUseCase`，
 * 本文件只负责模块特有的事：
 *   1. 发布前做客户端校验（种类 / 名称 / 时段 / 费用）；
 *   2. 把行数据映射成卡片可直接读的摘要；
 *   3. 把「能不能取消」收在一处 —— 页面不要自己写 `status === 'booked'`。
 *
 * ⚠️ **不判时段冲突**：客户端拿到的是分页视图，看不到完整占用；
 * 在客户端"算出"没冲突再提交，只会换来一个 409。冲突文案由服务端给。
 */

const PAGE_SIZE = 10
const CACHE_KEY_ROOT = 'kdy.facility.list'

export interface FacilityListQuery extends Record<string, unknown> {
  /** 预留：以后可加「只看我的」筛选 */
  readonly mine: boolean
}

export interface FacilityUseCases {
  readonly list: ListUseCase<FacilityListQuery, FacilityBookingSummary>
  detail(id: string): Promise<Result<FacilityBooking, RepositoryError>>
  create(input: CreateFacilityBookingInput): Promise<Result<FacilityBooking, RepositoryError>>
  cancel(id: string): Promise<Result<FacilityBooking, RepositoryError>>
  canCancel(booking: Pick<FacilityBooking, 'status' | 'ownerId'>, currentUserId: string | null): boolean
}

export interface FacilityUseCaseDeps {
  readonly repository: FacilityRepository
  readonly cache: CachePort
  readonly clock: ClockPort
  /** 当前登录用户 id（未登录为 null）—— 与全仓 `viewerId` 同构 */
  viewerId: () => string | null
}

export function createFacilityUseCases(deps: FacilityUseCaseDeps): FacilityUseCases {
  const { repository, cache, clock } = deps

  const list = createListUseCase<FacilityListQuery, FacilityBooking, FacilityBookingSummary>({
    cache,
    clock,
    cacheKey: CACHE_KEY_ROOT,
    defaultQuery: { mine: false },
    async fetchPage(_query, cursor) {
      const result = await repository.list({ cursor, limit: PAGE_SIZE })
      if (!result.ok) return result
      return {
        ok: true,
        value: { items: result.value.items, nextCursor: result.value.nextCursor },
      }
    },
    mapItem(item, _now) {
      return summarize(item, deps.viewerId())
    },
    isCachedPage(value: unknown): value is CachedListPage<FacilityBooking> {
      if (typeof value !== 'object' || value === null) return false
      const candidate = value as { items?: unknown; nextCursor?: unknown }
      return Array.isArray(candidate.items)
    },
  })

  return {
    list,

    detail(id) {
      return repository.detail(id)
    },

    create(input) {
      // 客户端只做"说得通"的校验
      const problem =
        kindProblem(input.kind) ??
        facilityNameProblem(input.facilityName) ??
        timeRangeProblem(input.startsAt, input.endsAt, clock.now()) ??
        feeProblem(input.feeFen)
      if (problem !== null) {
        return Promise.resolve(err({ code: 'VALIDATION_FAILED', message: problem }))
      }
      return repository.create(input)
    },

    cancel(id) {
      return repository.cancel(id)
    },

    canCancel(booking, currentUserId) {
      return canCancel(booking, currentUserId)
    },
  }
}
