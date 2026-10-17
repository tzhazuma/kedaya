import type { Result } from '@kedaya/shared'
import { err } from '@kedaya/shared'

import {
  ERRAND_DEADLINE_PRESETS,
  ERRAND_DETAIL_MAX,
  ERRAND_MAX_REWARD_FEN,
  ERRAND_PLACE_MAX,
  ERRAND_TITLE_MAX,
  findOffsetPreset,
  offsetIso,
  summarizeErrandTask,
} from '../../domain/models/errand'
import type {
  CreateErrandTaskInput,
  ErrandTask,
  ErrandTaskFilters,
  ErrandTaskSummary,
  OffsetPreset,
  UpdateErrandTaskInput,
} from '../../domain/models/errand'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ErrandTaskRepository } from '../../domain/ports/errandRepository'
import { createDetailUseCase } from '../common/detailUseCase'
import type { DetailUseCase } from '../common/detailUseCase'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'

/**
 * 跑腿用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 列表与详情的**机制**来自 `application/common/*`（六个模块共用、单独有测试），
 * 本文件只负责三件模块特有的事：
 *   1. 把筛选条件翻译成仓储查询（范围 scope → mine / role）；
 *   2. 把行数据映射成卡片直接可读的 `ErrandTaskSummary`；
 *   3. 发布前做客户端校验（与服务端同一套规则，只做即时提示），
 *      并把领域动作（接单 / 送达 / 完成 / 取消）包进 `detail.mutate()`。
 */

const PAGE_SIZE = 10

export interface ErrandDraft {
  title: string
  detail: string
  /** 整数分 */
  rewardFen: number
  fromPlace: string
  toPlace: string
  /** ISO 字符串；无效时为 null */
  deadlineIso: string | null
}

/**
 * 客户端校验 —— 与服务端 `errand.service.ts` 的归一化一一对应。
 * 返回人类可读的问题列表（空数组 = 通过），页面直接展示第一条。
 */
export function validateErrandDraft(draft: ErrandDraft, now: Date): string[] {
  const problems: string[] = []

  const title = draft.title.trim()
  if (title.length === 0) problems.push('请填写任务标题')
  else if ([...title].length > ERRAND_TITLE_MAX) {
    problems.push(`标题最多 ${ERRAND_TITLE_MAX} 个字`)
  }

  if (!Number.isInteger(draft.rewardFen) || draft.rewardFen < 0) {
    problems.push('请填写正确的悬赏金额')
  } else if (draft.rewardFen > ERRAND_MAX_REWARD_FEN) {
    problems.push(`悬赏最多 ${ERRAND_MAX_REWARD_FEN / 100} 元`)
  }

  const fromPlace = draft.fromPlace.trim()
  if (fromPlace.length === 0) problems.push('请填写出发地')
  else if ([...fromPlace].length > ERRAND_PLACE_MAX) {
    problems.push(`出发地最多 ${ERRAND_PLACE_MAX} 个字`)
  }

  const toPlace = draft.toPlace.trim()
  if (toPlace.length === 0) problems.push('请填写目的地')
  else if ([...toPlace].length > ERRAND_PLACE_MAX) {
    problems.push(`目的地最多 ${ERRAND_PLACE_MAX} 个字`)
  }

  if ([...draft.detail].length > ERRAND_DETAIL_MAX) {
    problems.push(`任务明细最多 ${ERRAND_DETAIL_MAX} 个字`)
  }

  if (draft.deadlineIso === null) {
    problems.push('请选择截止时间')
  } else {
    const deadline = new Date(draft.deadlineIso)
    if (Number.isNaN(deadline.getTime())) problems.push('截止时间格式不正确')
    else if (deadline.getTime() <= now.getTime()) problems.push('截止时间必须晚于当前时间')
  }

  return problems
}

export interface ErrandUseCasesDeps {
  repository: ErrandTaskRepository
  cache: CachePort
  clock: ClockPort
  /** 列表缓存 key 由装配层注入 */
  cacheKey: string
  /** 当前登录用户 id（未登录为 null） */
  viewerId: () => string | null
}

export interface ErrandUseCases {
  list: ListUseCase<ErrandTaskFilters, ErrandTaskSummary>
  detail: DetailUseCase<ErrandTask>
  /** 发布：本地校验通过后才发请求；成功后让列表重取 */
  create(input: CreateErrandTaskInput): Promise<Result<ErrandTask, RepositoryError>>
  update(id: string, input: UpdateErrandTaskInput): Promise<Result<ErrandTask, RepositoryError>>
  remove(id: string): Promise<Result<{ id: string }, RepositoryError>>
  /** 领域动作：成功后自动用返回的实体刷新详情页 */
  accept(id: string): Promise<Result<ErrandTask, RepositoryError>>
  deliver(id: string): Promise<Result<ErrandTask, RepositoryError>>
  complete(id: string): Promise<Result<ErrandTask, RepositoryError>>
  cancel(id: string): Promise<Result<ErrandTask, RepositoryError>>
}

export function createErrandUseCases(deps: ErrandUseCasesDeps): ErrandUseCases {
  const { repository, cache, clock, cacheKey, viewerId } = deps

  const list: ListUseCase<ErrandTaskFilters, ErrandTaskSummary> = createListUseCase<
    ErrandTaskFilters,
    ErrandTask,
    ErrandTaskSummary
  >({
    cache,
    clock,
    cacheKey,
    defaultQuery: { sort: 'latest', scope: 'all' },
    isCachedPage: createCachedPageGuard<ErrandTask>(),
    fetchPage: (filters, cursor) => repository.list({ cursor, limit: PAGE_SIZE, filters }),
    // 每次映射时取当前用户：登录后重新 load 即可拿到正确的「我的 / 我接的」标记
    mapItem: (task, now) => summarizeErrandTask(task, viewerId(), now),
  })

  const detail = createDetailUseCase<ErrandTask>((id) => repository.detail(id))

  return {
    list,
    detail,

    async create(input) {
      if (viewerId() === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录后再发布跑腿任务' })
      }
      const problems = validateErrandDraft(
        {
          title: input.title,
          detail: input.detail ?? '',
          rewardFen: input.rewardFen,
          fromPlace: input.fromPlace,
          toPlace: input.toPlace,
          deadlineIso: input.deadline,
        },
        clock.now(),
      )
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查填写内容' })
      }

      const result = await repository.create({
        title: input.title.trim(),
        detail: input.detail?.trim() === '' ? null : (input.detail?.trim() ?? null),
        rewardFen: input.rewardFen,
        fromPlace: input.fromPlace.trim(),
        toPlace: input.toPlace.trim(),
        deadline: input.deadline,
      })
      if (result.ok) list.reset()
      return result
    },

    update: (id, input) => repository.update(id, input),

    async remove(id) {
      const result = await repository.remove(id)
      if (result.ok) list.reset()
      return result
    },

    accept: (id) => detail.mutate(() => repository.accept(id)),
    deliver: (id) => detail.mutate(() => repository.deliver(id)),
    complete: (id) => detail.mutate(() => repository.complete(id)),
    cancel: (id) => detail.mutate(() => repository.cancel(id)),
  }
}

/* ------------------------------------------------------------------ *
 * 截止时间快捷选项（页面用，避免引入原生 Picker）
 * ------------------------------------------------------------------ */

export interface ResolvedPreset {
  preset: OffsetPreset
  iso: string
}

/**
 * 把「快捷选项 id」解成绝对 ISO 时间；未知 id 回落到第一个选项。
 * `now` 由页面从 `container.clock` 取，保证 mock / 真实模式用的是同一个时钟。
 */
export function resolveErrandDeadline(now: Date, presetId: string): ResolvedPreset {
  const preset =
    findOffsetPreset(ERRAND_DEADLINE_PRESETS, presetId) ??
    ERRAND_DEADLINE_PRESETS[0] ?? { id: '1h', label: '1 小时后', offsetMinutes: 60 }
  return { preset, iso: offsetIso(now, preset.offsetMinutes) }
}

/** 自定义「N 小时后」→ ISO；输入非法时返回 null */
export function hoursFromNowIso(now: Date, hoursText: string): string | null {
  const hours = Number(hoursText)
  if (!Number.isFinite(hours) || hours <= 0) return null
  return offsetIso(now, Math.round(hours * 60))
}
