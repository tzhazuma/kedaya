import { describe, expect, it } from 'vitest'

import {
  summarizeActivity,
  type ActivityItem,
  type ActivityReminderWithActivity,
} from '../../../../domain/models/activity'
import { buildActivityListView } from '../list/activityListView'
import { buildActivityDetailActions } from '../detail/detailViewModel'
import { buildReminderView } from '../reminders/reminderView'

/**
 * 页面逻辑（不依赖 Taro）—— 这些是「点进去才发现不对」的地方：
 *   · tab / 来源筛选后列表为空时，文案要说下一步做什么；
 *   · candidate 的详情页只能「确认 / 忽略」，不能先设提醒；
 *   · 提醒页把「站内信」与「微信订阅消息（未接通）」分开说清楚。
 */

const NOW = new Date('2026-11-22T04:00:00.000Z')

function activity(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'act-1',
    source: 'campus-mail',
    kind: 'lecture',
    title: '分布式系统讲座',
    startsAt: '2026-11-23T06:30:00.000Z',
    endsAt: null,
    location: '1A-200',
    organizer: '信息学院',
    registrationDeadlineAt: '2026-11-22T16:00:00.000Z',
    registrationDeadlineRaw: null,
    registrationUrl: null,
    evidenceText: '11月23日 14:30 信息学院 1A-200',
    confidence: 0.82,
    status: 'candidate',
    sourceUrl: null,
    sourceLabel: '校园邮箱',
    publishedAt: '2026-11-20T02:00:00.000Z',
    stale: false,
    ...overrides,
  }
}

describe('活动列表视图', () => {
  const items = [
    activity({ id: 'today', status: 'confirmed', startsAt: '2026-11-22T10:00:00.000Z' }),
    activity({ id: 'week', status: 'confirmed', source: 'wechat-mp', startsAt: '2026-11-18T02:00:00.000Z' }),
    activity({ id: 'pending', source: 'manual' }),
  ].map((item) => summarizeActivity(item, NOW))

  it('待确认 tab 只给候选，并带下一步动作的空态', () => {
    const view = buildActivityListView(items, { tab: 'pending', source: 'all' }, NOW)

    expect(view.rows.map((row) => row.id)).toEqual(['pending'])
    expect(view.counts.pending).toBe(1)
    expect(view.emptyTitle).toContain('没有待确认')
  })

  it('今天 / 本周只给已确认，按开始时间排序', () => {
    const week = buildActivityListView(items, { tab: 'week', source: 'all' }, NOW)
    expect(week.rows.map((row) => row.id)).toEqual(['week', 'today'])

    const today = buildActivityListView(items, { tab: 'today', source: 'all' }, NOW)
    expect(today.rows.map((row) => row.id)).toEqual(['today'])
  })

  it('来源筛选叠加在 tab 上', () => {
    const view = buildActivityListView(items, { tab: 'all', source: 'wechat-mp' }, NOW)
    expect(view.rows.map((row) => row.id)).toEqual(['week'])
  })

  it('有数据但筛选为空时提示换来源，而不是「还没有活动」', () => {
    const view = buildActivityListView(items, { tab: 'today', source: 'manual' }, NOW)
    expect(view.rows).toEqual([])
    expect(view.emptyTitle).toContain('这个来源')
  })

  it('完全没有数据时给导入入口文案', () => {
    const view = buildActivityListView([], { tab: 'all', source: 'all' }, NOW)
    expect(view.emptyTitle).toBe('还没有活动')
    expect(view.emptyDescription).toContain('公众号')
  })
})

describe('活动详情动作', () => {
  it('候选只能确认 / 忽略，不能提前设提醒', () => {
    const actions = buildActivityDetailActions(activity(), [], NOW)

    expect(actions.canConfirm).toBe(true)
    expect(actions.canDismiss).toBe(true)
    expect(actions.canSetReminder).toBe(false)
    expect(actions.reminderHint).toContain('确认加入日程')
  })

  it('已确认后可以设提醒；已有提醒时提示去列表里管理', () => {
    const confirmed = activity({ status: 'confirmed' })
    const none = buildActivityDetailActions(confirmed, [], NOW)
    expect(none.canSetReminder).toBe(true)
    expect(none.hasReminders).toBe(false)

    const existing: ActivityReminderWithActivity[] = [
      {
        id: 'rem-1',
        activityId: 'act-1',
        activityTitle: '分布式系统讲座',
        kind: 'registration',
        remindAt: '2026-11-22T06:00:00.000Z',
        channel: 'inapp',
        status: 'pending',
      },
    ]
    const withReminder = buildActivityDetailActions(confirmed, existing, NOW)
    expect(withReminder.hasReminders).toBe(true)
    expect(withReminder.hasRegistrationReminder).toBe(true)
    expect(withReminder.canSetRegistrationReminder).toBe(false)
  })

  it('提醒读取失败（remindersKnown=false）时禁用补设按钮，避免与自动提醒重复', () => {
    const actions = buildActivityDetailActions(
      activity({ status: 'confirmed' }),
      [],
      NOW,
      { remindersKnown: false },
    )

    expect(actions.canSetRegistrationReminder).toBe(false)
    expect(actions.canSetStartReminder).toBe(false)
    expect(actions.registrationHint).toContain('提醒读取失败')
    expect(actions.startHint).toContain('提醒读取失败')
  })

  it('只有原文截止 / 已过截止时，报名提醒按钮不可用并说明原因', () => {
    const raw = buildActivityDetailActions(
      activity({ status: 'confirmed', registrationDeadlineAt: null, registrationDeadlineRaw: '11月24日 17:00 前' }),
      [],
      NOW,
    )
    expect(raw.canSetRegistrationReminder).toBe(false)
    expect(raw.registrationHint).toContain('没有确定的报名截止时间')

    const passed = buildActivityDetailActions(
      activity({ status: 'confirmed', registrationDeadlineAt: '2026-11-22T02:00:00.000Z' }),
      [],
      NOW,
    )
    expect(passed.canSetRegistrationReminder).toBe(false)
    expect(passed.registrationHint).toContain('已过')
  })
})

describe('提醒状态视图', () => {
  const reminders: ActivityReminderWithActivity[] = [
    {
      id: 'rem-1',
      activityId: 'act-1',
      activityTitle: '分布式系统讲座',
      kind: 'registration',
      remindAt: '2026-11-22T06:00:00.000Z',
      channel: 'inapp',
      status: 'pending',
    },
    {
      id: 'rem-2',
      activityId: 'act-1',
      activityTitle: '分布式系统讲座',
      kind: 'start',
      remindAt: '2026-11-23T05:30:00.000Z',
      channel: 'wechat-subscribe',
      status: 'sent',
    },
  ]

  it('待发送 / 已结束分组，渠道如实标注（未接通不冒充可用）', () => {
    const view = buildReminderView(reminders, NOW)

    expect(view.pending.map((row) => row.id)).toEqual(['rem-1'])
    expect(view.done.map((row) => row.id)).toEqual(['rem-2'])
    expect(view.pending[0]?.channelLabel).toBe('站内信')
    expect(view.done[0]?.channelLabel).toContain('未接通')
    expect(view.notice).toContain('只支持站内信')
  })
})
