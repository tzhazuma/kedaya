import { describe, expect, it } from 'vitest'
import { err, ok } from '@kedaya/shared'

import type { ActivityItem, ActivityReminderItem } from '../../../../domain/models/activity'
import type { ConfirmActivityResult } from '../../../../application/activities/activityUseCases'
import {
  confirmOutcome,
  reminderLoadFailure,
  reminderLoadSuccess,
  reminderPanelStart,
} from '../detail/detailState'

/**
 * 详情页的状态边界（纯逻辑）：
 *   · 提醒读取失败必须是「错误 + 重试」，不能伪装成「没有提醒」；
 *   · 服务端返回非 confirmed 时不能提示「已加入日程」；
 *   · 确认成功但提醒读取失败时，活动确实进日程，提醒部分要如实报错。
 */

const NOW = new Date('2026-11-22T04:00:00.000Z')

function activity(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'act-1',
    source: 'campus-mail',
    kind: 'lecture',
    title: '分布式系统讲座',
    startsAt: '2026-11-24T06:00:00.000Z',
    endsAt: null,
    location: '1A-200',
    organizer: '信息学院',
    registrationDeadlineAt: '2026-11-23T06:00:00.000Z',
    registrationDeadlineRaw: null,
    registrationUrl: null,
    evidenceText: '11月24日 14:00 信息学院 1A-200',
    confidence: 0.8,
    status: 'candidate',
    sourceUrl: null,
    sourceLabel: '校园邮箱',
    publishedAt: '2026-11-20T00:00:00.000Z',
    stale: false,
    ...overrides,
  }
}

function reminder(overrides: Partial<ActivityReminderItem> = {}): ActivityReminderItem {
  return {
    id: 'rem-1',
    kind: 'registration',
    remindAt: '2026-11-22T06:00:00.000Z',
    channel: 'inapp',
    status: 'pending',
    ...overrides,
  }
}

describe('详情页提醒读取状态', () => {
  it('读取失败 → error 状态，带可读错误，不能落到「没有提醒」', () => {
    const state = reminderLoadFailure('提醒服务暂不可用')

    expect(state.status).toBe('error')
    expect(state.items).toEqual([])
    expect(state.error).toContain('提醒服务暂不可用')
    expect(state.status).not.toBe('ready')
  })

  it('读取成功但为空 → ready + 空列表（页面才可以显示「还没有提醒」）', () => {
    const state = reminderLoadSuccess([])

    expect(state.status).toBe('ready')
    expect(state.items).toEqual([])
    expect(state.error).toBeNull()
  })

  it('读取成功 → 保留服务端返回的提醒', () => {
    const state = reminderLoadSuccess([reminder()])

    expect(state.status).toBe('ready')
    expect(state.items.map((item) => item.id)).toEqual(['rem-1'])
  })

  it('开始读取 → loading，清空旧错误', () => {
    const state = reminderPanelStart()

    expect(state.status).toBe('loading')
    expect(state.error).toBeNull()
  })
})

describe('确认结果文案', () => {
  it('服务端返回 candidate（非 confirmed）时不得提示已加入日程', () => {
    const result: ConfirmActivityResult = {
      item: activity({ status: 'candidate' }),
      reminders: [],
      reminderWarning: null,
    }

    const outcome = confirmOutcome(result)

    expect(outcome.confirmed).toBe(false)
    expect(outcome.tone).toBe('error')
    expect(outcome.message).not.toContain('已加入日程')
    expect(outcome.message).toContain('没有确认')
  })

  it('确认成功且有默认提醒 → 明确说已加入日程并安排提醒', () => {
    const outcome = confirmOutcome({
      item: activity({ status: 'confirmed' }),
      reminders: [reminder()],
      reminderWarning: null,
    })

    expect(outcome.confirmed).toBe(true)
    expect(outcome.tone).toBe('success')
    expect(outcome.message).toContain('已加入日程')
    expect(outcome.message).toContain('提醒')
  })

  it('确认成功但提醒读取失败 → 活动已进日程，提醒部分报错并可重试', () => {
    const outcome = confirmOutcome({
      item: activity({ status: 'confirmed' }),
      reminders: [],
      reminderWarning: '活动已确认，但提醒读取失败：提醒服务暂不可用',
    })

    expect(outcome.confirmed).toBe(true)
    expect(outcome.tone).toBe('error')
    expect(outcome.message).toContain('已加入日程')
    expect(outcome.message).toContain('提醒读取失败')
  })
})

describe('提醒读取结果适配', () => {
  it('用例层 Result 直接适配成面板状态', () => {
    const failure = reminderLoadFailure('网络不可用')
    expect(failure.status).toBe('error')

    const success = reminderLoadSuccess([])
    expect(success.status).toBe('ready')

    // 这里只确认 ok/err 的形状与页面适配一致，不引入 Taro。
    expect(ok(true).ok).toBe(true)
    expect(err({ code: 'NETWORK', message: '网络不可用' }).ok).toBe(false)
  })
})

describe('详情页时间展示基线', () => {
  it('NOW 固定为上海时间 12:00', () => {
    expect(NOW.toISOString()).toBe('2026-11-22T04:00:00.000Z')
  })
})
