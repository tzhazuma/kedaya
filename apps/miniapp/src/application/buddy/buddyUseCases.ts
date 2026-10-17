import type { Result } from '@kedaya/shared'
import { err } from '@kedaya/shared'

import {
  BUDDY_ACTIVITIES,
  BUDDY_DESCRIPTION_MAX,
  BUDDY_MAX_CAPACITY,
  BUDDY_MIN_CAPACITY,
  BUDDY_SPOT_MAX,
  BUDDY_START_PRESETS,
  BUDDY_TITLE_MAX,
  findOffsetPreset,
  offsetIso,
  summarizeBuddyGroup,
} from '../../domain/models/buddy'
import type {
  BuddyGroup,
  BuddyGroupDetail,
  BuddyGroupFilters,
  BuddyGroupSummary,
  CreateBuddyGroupInput,
  OffsetPreset,
} from '../../domain/models/buddy'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { BuddyRepository } from '../../domain/ports/buddyRepository'
import { createDetailUseCase } from '../common/detailUseCase'
import type { DetailUseCase } from '../common/detailUseCase'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'

/**
 * 找搭子用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 与跳蚤/跑腿的差别在**动作后的刷新方式**：`join / leave / close / cancel`
 * 返回的是小组（不含成员列表），而详情页需要成员变化立刻可见，
 * 因此这里在动作成功后**重新拉一次详情**，再用它刷新 `detail`。
 */

const PAGE_SIZE = 10

export interface BuddyDraft {
  activity: string
  title: string
  description: string
  campusSpot: string
  capacityText: string
  /** ISO 字符串；无效时为 null */
  startsAtIso: string | null
}

/** 客户端校验 —— 与服务端 `buddy.service.ts` 的归一化一一对应 */
export function validateBuddyDraft(draft: BuddyDraft, now: Date): string[] {
  const problems: string[] = []

  if (!(BUDDY_ACTIVITIES as readonly string[]).includes(draft.activity)) {
    problems.push('请选择活动类型')
  }

  const title = draft.title.trim()
  if (title.length === 0) problems.push('请填写搭子标题')
  else if ([...title].length > BUDDY_TITLE_MAX) {
    problems.push(`标题最多 ${BUDDY_TITLE_MAX} 个字`)
  }

  const spot = draft.campusSpot.trim()
  if (spot.length === 0) problems.push('请填写集合地点')
  else if ([...spot].length > BUDDY_SPOT_MAX) {
    problems.push(`集合地点最多 ${BUDDY_SPOT_MAX} 个字`)
  }

  if ([...draft.description].length > BUDDY_DESCRIPTION_MAX) {
    problems.push(`搭子简介最多 ${BUDDY_DESCRIPTION_MAX} 个字`)
  }

  const capacity = Number(draft.capacityText)
  if (!Number.isInteger(capacity)) {
    problems.push('人数上限必须是整数')
  } else if (capacity < BUDDY_MIN_CAPACITY || capacity > BUDDY_MAX_CAPACITY) {
    problems.push(`人数上限需在 ${BUDDY_MIN_CAPACITY}~${BUDDY_MAX_CAPACITY} 之间`)
  }

  if (draft.startsAtIso === null) {
    problems.push('请选择开始时间')
  } else {
    const startsAt = new Date(draft.startsAtIso)
    if (Number.isNaN(startsAt.getTime())) problems.push('开始时间格式不正确')
    else if (startsAt.getTime() <= now.getTime()) problems.push('开始时间必须晚于当前时间')
  }

  return problems
}

export interface BuddyUseCasesDeps {
  repository: BuddyRepository
  cache: CachePort
  clock: ClockPort
  cacheKey: string
  viewerId: () => string | null
}

export interface BuddyUseCases {
  list: ListUseCase<BuddyGroupFilters, BuddyGroupSummary>
  detail: DetailUseCase<BuddyGroupDetail>
  /** 发起招募：本地校验通过后才发请求；成功后让列表重取 */
  create(input: CreateBuddyGroupInput): Promise<Result<BuddyGroup, RepositoryError>>
  /** 领域动作：成功后重新拉详情（成员列表也要一起更新） */
  join(id: string): Promise<Result<BuddyGroupDetail, RepositoryError>>
  leave(id: string): Promise<Result<BuddyGroupDetail, RepositoryError>>
  close(id: string): Promise<Result<BuddyGroupDetail, RepositoryError>>
  cancel(id: string): Promise<Result<BuddyGroupDetail, RepositoryError>>
}

export function createBuddyUseCases(deps: BuddyUseCasesDeps): BuddyUseCases {
  const { repository, cache, clock, cacheKey, viewerId } = deps

  const list: ListUseCase<BuddyGroupFilters, BuddyGroupSummary> = createListUseCase<
    BuddyGroupFilters,
    BuddyGroup,
    BuddyGroupSummary
  >({
    cache,
    clock,
    cacheKey,
    defaultQuery: { sort: 'latest', scope: 'all', onlyUpcoming: false },
    isCachedPage: createCachedPageGuard<BuddyGroup>(),
    fetchPage: (filters, cursor) => repository.list({ cursor, limit: PAGE_SIZE, filters }),
    mapItem: (group, now) => summarizeBuddyGroup(group, viewerId(), now),
  })

  const detail = createDetailUseCase<BuddyGroupDetail>((id) => repository.detail(id))

  /**
   * 动作统一收口：先执行动作，成功后**重新取详情**。
   * 这样成员增减、满员状态变化都会立刻反映到页面上。
   */
  function act(
    id: string,
    action: () => Promise<Result<BuddyGroup, RepositoryError>>,
  ): Promise<Result<BuddyGroupDetail, RepositoryError>> {
    return detail.mutate(async () => {
      const result = await action()
      if (!result.ok) return result
      return repository.detail(id)
    })
  }

  return {
    list,
    detail,

    async create(input) {
      if (viewerId() === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录后再发起搭子招募' })
      }
      const problems = validateBuddyDraft(
        {
          activity: input.activity,
          title: input.title,
          description: input.description ?? '',
          campusSpot: input.campusSpot,
          capacityText: String(input.capacity),
          startsAtIso: input.startsAt,
        },
        clock.now(),
      )
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查填写内容' })
      }

      const result = await repository.create({
        activity: input.activity,
        title: input.title.trim(),
        description: input.description?.trim() === '' ? null : (input.description?.trim() ?? null),
        campusSpot: input.campusSpot.trim(),
        startsAt: input.startsAt,
        capacity: input.capacity,
      })
      if (result.ok) list.reset()
      return result
    },

    join: (id) => act(id, () => repository.join(id)),
    leave: (id) => act(id, () => repository.leave(id)),
    close: (id) => act(id, () => repository.close(id)),
    cancel: (id) => act(id, () => repository.cancel(id)),
  }
}

/* ------------------------------------------------------------------ *
 * 开始时间快捷选项（页面用，避免引入原生 Picker）
 * ------------------------------------------------------------------ */

export interface ResolvedPreset {
  preset: OffsetPreset
  iso: string
}

export function resolveBuddyStart(now: Date, presetId: string): ResolvedPreset {
  const preset =
    findOffsetPreset(BUDDY_START_PRESETS, presetId) ??
    BUDDY_START_PRESETS[0] ?? { id: '1d', label: '明天此刻', offsetMinutes: 1_440 }
  return { preset, iso: offsetIso(now, preset.offsetMinutes) }
}

/** 自定义「N 小时后」→ ISO；输入非法时返回 null */
export function hoursFromNowIso(now: Date, hoursText: string): string | null {
  const hours = Number(hoursText)
  if (!Number.isFinite(hours) || hours <= 0) return null
  return offsetIso(now, Math.round(hours * 60))
}
