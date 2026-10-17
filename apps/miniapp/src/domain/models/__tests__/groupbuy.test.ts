import { describe, expect, it } from 'vitest'

import {
  canJoin,
  deriveStatus,
  joinedQuantity,
  progressPercent,
  remainingSlots,
  summarize,
  totalAmountFen,
} from '../groupbuy'
import type { GroupBuy, GroupBuyParticipant } from '../groupbuy'

/**
 * domain 层纯逻辑测试 —— 零框架依赖，跑在 node 环境。
 *
 * 这里覆盖的是**规则唯一真相**：参团资格、状态推导、派生摘要。
 * mock 仓储与真后端共用这些函数，因此本文件是防规则漂移的第一道闸。
 */

const NOW = new Date('2026-10-16T12:00:00.000Z')

function hoursFromNow(hours: number): string {
  return new Date(NOW.getTime() + hours * 3_600_000).toISOString()
}

function participant(id: string, quantity: number, anonymous = false): GroupBuyParticipant {
  return {
    id,
    displayName: anonymous ? '匿名同学' : id,
    anonymous,
    quantity,
    joinedAt: NOW.toISOString(),
  }
}

function makeGroupBuy(overrides: Partial<GroupBuy> = {}): GroupBuy {
  return {
    id: 'gb-test',
    title: '测试拼单',
    description: '测试用',
    category: 'food',
    initiatorId: 'u-owner',
    initiatorName: '发起人',
    priceFen: 1000,
    targetCount: 4,
    participants: [participant('u-owner', 1)],
    deadline: hoursFromNow(6),
    pickupPlace: '测试地点',
    status: 'open',
    createdAt: hoursFromNow(-2),
    updatedAt: hoursFromNow(-1),
    ...overrides,
  }
}

describe('groupbuy 领域派生量', () => {
  it('按份数（不是人数）统计已凑与剩余', () => {
    const groupBuy = makeGroupBuy({
      targetCount: 5,
      participants: [participant('u-1', 2), participant('u-2', 1, true)],
    })

    expect(groupBuy.participants).toHaveLength(2)
    expect(joinedQuantity(groupBuy)).toBe(3)
    expect(remainingSlots(groupBuy)).toBe(2)
    expect(progressPercent(groupBuy)).toBe(60)
  })

  it('剩余份数不会为负，进度不会超过 100%', () => {
    const groupBuy = makeGroupBuy({
      targetCount: 3,
      participants: [participant('u-1', 5)],
    })

    expect(remainingSlots(groupBuy)).toBe(0)
    expect(progressPercent(groupBuy)).toBe(100)
  })

  it('合计金额用整数分累加（浮点绝不参与）', () => {
    const groupBuy = makeGroupBuy({
      priceFen: 1850,
      participants: [participant('u-1', 2), participant('u-2', 1)],
    })

    const total = totalAmountFen(groupBuy)
    expect(total).toBe(5550)
    expect(Number.isInteger(total)).toBe(true)
  })

  it('targetCount 为 0 时进度为 0，不产生 NaN', () => {
    expect(progressPercent(makeGroupBuy({ targetCount: 0, participants: [] }))).toBe(0)
  })
})

describe('deriveStatus 状态推导', () => {
  it('人数未满且未截止 → open', () => {
    expect(deriveStatus(makeGroupBuy(), NOW)).toBe('open')
  })

  it('份数达到目标 → full', () => {
    const groupBuy = makeGroupBuy({ targetCount: 2, participants: [participant('u-1', 2)] })
    expect(deriveStatus(groupBuy, NOW)).toBe('full')
  })

  it('已过截止时间 → closed', () => {
    const groupBuy = makeGroupBuy({ deadline: hoursFromNow(-1) })
    expect(deriveStatus(groupBuy, NOW)).toBe('closed')
  })

  it('显式 cancelled 优先级最高，不会被人数/时间覆盖', () => {
    const groupBuy = makeGroupBuy({
      status: 'cancelled',
      targetCount: 1,
      participants: [participant('u-1', 3)],
      deadline: hoursFromNow(-10),
    })
    expect(deriveStatus(groupBuy, NOW)).toBe('cancelled')
  })

  it('full 优先于 closed（已成团就不该显示「已截止」）', () => {
    const groupBuy = makeGroupBuy({
      targetCount: 2,
      participants: [participant('u-1', 2)],
      deadline: hoursFromNow(-1),
    })
    expect(deriveStatus(groupBuy, NOW)).toBe('full')
  })
})

describe('canJoin 参团资格', () => {
  it('未登录（userId=null）且状态可参团 → 允许', () => {
    expect(canJoin(makeGroupBuy(), null, NOW)).toEqual({ allowed: true })
  })

  it('重复参团 → already-joined', () => {
    const groupBuy = makeGroupBuy()
    const result = canJoin(groupBuy, 'u-owner', NOW)
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason).toBe('already-joined')
      expect(result.message).toContain('已经参团')
    }
  })

  it('已满 → full', () => {
    const groupBuy = makeGroupBuy({ targetCount: 1, participants: [participant('u-1', 1)] })
    const result = canJoin(groupBuy, 'u-me', NOW)
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('full')
  })

  it('已截止 → expired', () => {
    const result = canJoin(makeGroupBuy({ deadline: hoursFromNow(-1) }), 'u-me', NOW)
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('expired')
  })

  it('已取消 → not-open', () => {
    const result = canJoin(makeGroupBuy({ status: 'cancelled' }), 'u-me', NOW)
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('not-open')
  })

  it('份数不是正整数 → invalid-quantity', () => {
    const result = canJoin(makeGroupBuy(), 'u-me', NOW, 0)
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('invalid-quantity')
  })

  it('要的份数超过剩余 → full，且文案带剩余份数', () => {
    const groupBuy = makeGroupBuy({
      targetCount: 3,
      participants: [participant('u-1', 1)],
    })
    const result = canJoin(groupBuy, 'u-me', NOW, 3)
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason).toBe('full')
      expect(result.message).toContain('2')
    }
  })
})

describe('summarize 展示摘要', () => {
  it('一次性给出 UI 需要的全部派生字段', () => {
    const summary = summarize(
      makeGroupBuy({ targetCount: 4, participants: [participant('u-1', 1), participant('u-2', 2)] }),
      NOW,
    )

    expect(summary.categoryLabel).toBe('拼饭')
    expect(summary.status).toBe('open')
    expect(summary.statusLabel).toBe('可参团')
    expect(summary.joinedCount).toBe(2)
    expect(summary.joinedQuantity).toBe(3)
    expect(summary.remainingSlots).toBe(1)
    expect(summary.progressPercent).toBe(75)
    expect(summary.joinable).toBe(true)
    expect(summary.deadlineLabel).toContain('还有')
    // 截止的两个标记由下面专门的用例覆盖（fixture 是 6 小时后 → 未过期）
    expect(summary.deadlinePassed).toBe(false)
  })

  it('临期（≤12 小时）与已截止是两个互斥标记 —— 卡片据此催单', () => {
    // 6 小时后截止 → 临期（拼单以天计，12 小时内算"今天就到点了"）
    const soon = summarize(makeGroupBuy({ deadline: hoursFromNow(6) }), NOW)
    expect(soon.deadlineUrgent).toBe(true)
    expect(soon.deadlinePassed).toBe(false)
    expect(soon.joinable).toBe(true)

    // 3 天后 → 不催
    expect(summarize(makeGroupBuy({ deadline: hoursFromNow(72) }), NOW).deadlineUrgent).toBe(false)

    // 已过 → 只剩 passed，urgent 必须为 false（否则卡片会同时"催"和"划线"）
    const gone = summarize(makeGroupBuy({ deadline: hoursFromNow(-1) }), NOW)
    expect(gone.deadlinePassed).toBe(true)
    expect(gone.deadlineUrgent).toBe(false)
  })

  it('已截止时 joinable=false 且文案为「已截止」', () => {
    const summary = summarize(makeGroupBuy({ deadline: hoursFromNow(-1) }), NOW)
    expect(summary.status).toBe('closed')
    expect(summary.statusLabel).toBe('已截止')
    expect(summary.joinable).toBe(false)
    expect(summary.deadlineLabel).toBe('已截止')
  })

  it('匿名参团不泄露实名（displayName 已被替换）', () => {
    const groupBuy = makeGroupBuy({ participants: [participant('u-1', 1, true)] })
    expect(groupBuy.participants[0]?.displayName).toBe('匿名同学')
    expect(groupBuy.participants[0]?.anonymous).toBe(true)
  })
})
