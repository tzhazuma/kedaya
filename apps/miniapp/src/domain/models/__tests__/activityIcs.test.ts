import { describe, expect, it } from 'vitest'

import { buildActivityIcs, type ActivityItem } from '../activity'

/**
 * 「加入手机日历」的降级通道：平台不支持 `wx.addPhoneCalendar` 时复制 ICS。
 *
 * 这里只测纯文本生成 —— 不 import Taro，也不声称微信订阅消息已接通。
 */

const NOW = new Date('2026-11-22T04:00:00.000Z')

function activity(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'act-1',
    source: 'campus-mail',
    kind: 'lecture',
    title: '分布式系统讲座',
    startsAt: '2026-11-24T06:00:00.000Z',
    endsAt: '2026-11-24T08:00:00.000Z',
    location: '1A-200',
    organizer: '信息学院',
    registrationDeadlineAt: null,
    registrationDeadlineRaw: null,
    registrationUrl: 'https://example.com/signup',
    evidenceText: '11月24日 14:00 信息学院 1A-200',
    confidence: 0.8,
    status: 'confirmed',
    sourceUrl: null,
    sourceLabel: '校园邮箱',
    publishedAt: '2026-11-20T00:00:00.000Z',
    stale: false,
    ...overrides,
  }
}

describe('活动 ICS', () => {
  it('生成 UTC DTSTART / DTEND、标题、地点与来源链接', () => {
    const ics = buildActivityIcs(activity(), NOW)

    expect(ics).not.toBeNull()
    const text = ics as string
    expect(text).toContain('BEGIN:VCALENDAR')
    expect(text).toContain('BEGIN:VEVENT')
    expect(text).toContain('UID:act-1@kedaya')
    expect(text).toContain('DTSTAMP:20261122T040000Z')
    expect(text).toContain('DTSTART:20261124T060000Z')
    expect(text).toContain('DTEND:20261124T080000Z')
    expect(text).toContain('SUMMARY:分布式系统讲座')
    expect(text).toContain('LOCATION:1A-200')
    expect(text).toContain('URL:https://example.com/signup')
    expect(text).toContain('END:VCALENDAR')
  })

  it('没有结束时间时用 1 小时时长，而不是编一个跨天事件', () => {
    const text = buildActivityIcs(activity({ endsAt: null }), NOW) as string

    expect(text).toContain('DTSTART:20261124T060000Z')
    expect(text).toContain('DTEND:20261124T070000Z')
  })

  it('转义逗号、分号、反斜杠与换行', () => {
    const text = buildActivityIcs(
      activity({ title: '讲座, 第一场; 请准时\\到场\n带校园卡' }),
      NOW,
    ) as string

    expect(text).toContain('SUMMARY:讲座\\, 第一场\\; 请准时\\\\到场\\n带校园卡')
  })

  it('没有确定开始时间 → 不生成日历（不猜时刻）', () => {
    expect(buildActivityIcs(activity({ startsAt: null }), NOW)).toBeNull()
    expect(buildActivityIcs(activity({ startsAt: '2026-02-30T10:00:00.000Z' }), NOW)).toBeNull()
  })
})
