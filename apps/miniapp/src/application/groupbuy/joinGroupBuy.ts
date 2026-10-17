import { err, ok, type Result } from '@kedaya/shared'

import { canJoin, summarize } from '../../domain/models/groupbuy'
import type { GroupBuy, GroupBuySummary } from '../../domain/models/groupbuy'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { GroupBuyRepository } from '../../domain/ports/groupbuyRepository'
import type { SessionStorePort } from '../../domain/ports/sessionPort'

/**
 * 「参团」用例 —— 垂直切片的写动作。
 *
 * 顺序刻意如此：
 * 1. 先看会话（未登录直接返回 `UNAUTHENTICATED`，不发无意义的请求）
 * 2. 拉详情，用 **domain 的 `canJoin`** 做本地预校验（规则只写一次）
 * 3. 才真正调用仓储的 `join`
 *
 * 第 2 步很关键：它让「已满 / 已截止 / 已参团」这些情况在弱网下也能立刻给出反馈，
 * 而且和后端用的是同一份判定逻辑（后端仍会再校验一次，前端只是提前拦）。
 */

export interface JoinGroupBuyDeps {
  repository: GroupBuyRepository
  session: SessionStorePort
  clock: ClockPort
}

export interface JoinGroupBuyOutcome {
  groupBuy: GroupBuy
  summary: GroupBuySummary
}

export interface JoinGroupBuyUseCase {
  join(id: string, quantity?: number, anonymous?: boolean, note?: string, selections?: Array<{ item: string; quantity: number }>): Promise<Result<JoinGroupBuyOutcome, RepositoryError>>
}

export function createJoinGroupBuyUseCase(deps: JoinGroupBuyDeps): JoinGroupBuyUseCase {
  const { repository, session, clock } = deps

  return {
    async join(
      id: string,
      quantity = 1,
      anonymous = false,
      note = '',
      selections,
    ): Promise<Result<JoinGroupBuyOutcome, RepositoryError>> {
      const profile = session.getSnapshot().profile
      if (profile === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录后再参团' })
      }

      const detail = await repository.detail(id)
      if (!detail.ok) return detail

      const now = clock.now()
      const eligibility = canJoin(detail.value, profile.id, now, quantity)
      if (!eligibility.allowed) {
        return err({
          code: 'CONFLICT',
          message: eligibility.message,
          details: { reason: eligibility.reason },
        })
      }

      const joined = await repository.join(id, {
        userId: profile.id,
        displayName: profile.nickname,
        quantity,
        anonymous,
        note,
        selections,
        // 契约 §6.1：写操作带幂等键，防止弱网重试造成重复参团
        idempotencyKey: `groupbuy:join:${id}:${profile.id}:${quantity}:${note}`,
      })
      if (!joined.ok) return joined

      return ok({ groupBuy: joined.value, summary: summarize(joined.value, now) })
    },
  }
}
