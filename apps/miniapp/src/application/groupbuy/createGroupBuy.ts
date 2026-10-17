import { err, ok, type Result } from '@kedaya/shared'

import {
  GROUP_BUY_CATEGORIES,
  GROUP_BUY_DEADLINE_PRESETS,
  findOffsetPreset,
  offsetIso,
  summarize,
} from '../../domain/models/groupbuy'
import type { GroupBuy, GroupBuyCategory, GroupBuySummary, OffsetPreset } from '../../domain/models/groupbuy'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { CreateGroupBuyInput, GroupBuyRepository } from '../../domain/ports/groupbuyRepository'
import type { SessionStorePort } from '../../domain/ports/sessionPort'

/**
 * 「发起拼单」用例 —— 垂直切片的写动作。
 *
 * 与服务端**同一套规则**（只做即时提示，服务端仍会再校验一次）：
 *   · 标题 1–60 字、说明 ≤500 字、取货地点 ≤60 字；
 *   · 成团份数 2–99；
 *   · 单价为整数分且 ≤ 1 万元；
 *   · 截止时间必须晚于现在。
 *
 * 归属只认会话：`initiatorId` / `initiatorName` 由这里从会话填入，
 * 再交给仓储（mock 需要它记账；http 仓储不会把它发出去）。
 */

export const GROUP_BUY_TITLE_MAX = 60
export const GROUP_BUY_DESCRIPTION_MAX = 500
export const GROUP_BUY_PICKUP_MAX = 60
export const GROUP_BUY_MIN_TARGET = 2
export const GROUP_BUY_MAX_TARGET = 99
/** 与后端 `GROUPBUY_MAX_UNIT_PRICE_FEN` 一致：单价上限 1 万元 */
export const GROUP_BUY_MAX_UNIT_PRICE_FEN = 1_000_000
const GROUP_BUY_MAX_DESCRIPTION_LENGTH = GROUP_BUY_DESCRIPTION_MAX

/** 表单原始值（未校验）—— 页面直接持有它，校验与提交都以此为准 */
export interface GroupBuyDraft {
  title: string
  description: string
  /** 分类原始值（可能为 `''`：用户还没选） */
  category: string
  /** 成团份数原始值（可能不是正整数） */
  targetCount: number
  /** 单价，整数分（`NaN` 表示输入框还是空/非法） */
  priceFen: number
  /** 截止时间，ISO 字符串；`null` 表示尚未产生有效时间 */
  deadlineIso: string | null
  pickupPlace: string
}

/** 客户端校验 —— 返回人类可读的问题列表（空数组 = 没问题） */
export function validateGroupBuyDraft(draft: GroupBuyDraft, now: Date): string[] {
  const problems: string[] = []

  const title = draft.title.trim()
  if (title.length === 0) {
    problems.push('请填写拼单标题')
  } else if ([...title].length > GROUP_BUY_TITLE_MAX) {
    problems.push(`标题最多 ${GROUP_BUY_TITLE_MAX} 个字`)
  }

  if (!(GROUP_BUY_CATEGORIES as readonly string[]).includes(draft.category)) {
    problems.push('请选择分类')
  }

  if (!Number.isInteger(draft.targetCount)) {
    problems.push('成团份数必须是整数')
  } else if (draft.targetCount < GROUP_BUY_MIN_TARGET) {
    problems.push(`成团份数至少 ${GROUP_BUY_MIN_TARGET} 份`)
  } else if (draft.targetCount > GROUP_BUY_MAX_TARGET) {
    problems.push(`成团份数最多 ${GROUP_BUY_MAX_TARGET} 份`)
  }

  if (!Number.isInteger(draft.priceFen)) {
    problems.push('请填写单价')
  } else if (draft.priceFen < 0) {
    problems.push('单价不能是负数')
  } else if (draft.priceFen > GROUP_BUY_MAX_UNIT_PRICE_FEN) {
    problems.push('单价上限为 1 万元')
  }

  if ([...draft.description].length > GROUP_BUY_MAX_DESCRIPTION_LENGTH) {
    problems.push(`说明最多 ${GROUP_BUY_DESCRIPTION_MAX} 个字`)
  }
  if ([...draft.pickupPlace].length > GROUP_BUY_PICKUP_MAX) {
    problems.push(`取货地点最多 ${GROUP_BUY_PICKUP_MAX} 个字`)
  }

  if (draft.deadlineIso === null) {
    problems.push('请选择截止时间')
  } else {
    const deadline = new Date(draft.deadlineIso).getTime()
    if (Number.isNaN(deadline)) problems.push('截止时间格式不正确')
    else if (deadline <= now.getTime()) problems.push('截止时间必须晚于现在')
  }

  return problems
}

/** 解析「预设 / 自定义小时」为 ISO；非法时返回 null */
export function resolveGroupBuyDeadline(now: Date, presetId: string): { preset: OffsetPreset; iso: string } {
  const preset =
    findOffsetPreset(GROUP_BUY_DEADLINE_PRESETS, presetId) ??
    GROUP_BUY_DEADLINE_PRESETS[0] ?? { id: '1d', label: '明天此刻', offsetMinutes: 1_440 }
  return { preset, iso: offsetIso(now, preset.offsetMinutes) }
}

export function hoursFromNowIso(now: Date, hoursText: string): string | null {
  const hours = Number(hoursText)
  if (!Number.isFinite(hours) || hours <= 0) return null
  return offsetIso(now, Math.round(hours * 60))
}

export interface CreateGroupBuyDeps {
  repository: GroupBuyRepository
  session: SessionStorePort
  clock: ClockPort
  /** 创建成功后的回调（装配层接列表用例的 `reset()`），保证新单立刻出现在列表顶部 */
  onCreated?: () => void
}

export interface CreateGroupBuyOutcome {
  groupBuy: GroupBuy
  summary: GroupBuySummary
}

export interface CreateGroupBuyUseCase {
  create(draft: GroupBuyDraft): Promise<Result<CreateGroupBuyOutcome, RepositoryError>>
}

export function createCreateGroupBuyUseCase(deps: CreateGroupBuyDeps): CreateGroupBuyUseCase {
  const { repository, session, clock, onCreated } = deps

  return {
    async create(draft: GroupBuyDraft): Promise<Result<CreateGroupBuyOutcome, RepositoryError>> {
      const profile = session.getSnapshot().profile
      if (profile === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录后再发起拼单' })
      }

      const now = clock.now()
      const problems = validateGroupBuyDraft(draft, now)
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查填写内容' })
      }

      // 走到这里，`category` 与 `deadlineIso` 一定已经过校验
      const input: CreateGroupBuyInput = {
        title: draft.title.trim(),
        description: draft.description.trim() === '' ? null : draft.description.trim(),
        category: draft.category as GroupBuyCategory,
        targetCount: draft.targetCount,
        priceFen: draft.priceFen,
        deadline: draft.deadlineIso as string,
        pickupPlace: draft.pickupPlace.trim() === '' ? null : draft.pickupPlace.trim(),
        initiatorId: profile.id,
        initiatorName: profile.nickname,
      }

      const created = await repository.create(input)
      if (!created.ok) return created

      onCreated?.()
      return ok({ groupBuy: created.value, summary: summarize(created.value, now) })
    },
  }
}
