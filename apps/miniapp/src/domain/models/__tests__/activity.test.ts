import { describe, expect, it } from 'vitest'

import {
  ACTIVITY_SOURCE_LABELS,
  parseShanghaiDateTime,
  shanghaiDateInput,
  EVIDENCE_MAX_LENGTH,
  activityTabMatches,
  buildActivityTabCounts,
  canConfirmActivity,
  canDismissActivity,
  clampEvidence,
  defaultReminderPlan,
  formatActivityInstant,
  formatActivityWhen,
  manualActivityProblem,
  normalizeActivityItem,
  normalizeActivityReminder,
  registrationDeadlineView,
  sortActivities,
  summarizeActivity,
  wechatImportProblem,
  type ActivityItem,
} from '../activity'

/**
 * 活动域（activities）—— 只放纯逻辑，不 import Taro / 数据层。
 *
 * 这一组测试守的是**最容易静默出错**的地方：
 *   · UTC 时刻按 Asia/Shanghai 展示，而不是跟设备时区漂；
 *   · 原文只有「11月24日」时**不许**补成 23:59（那会变成用户自己的错误截止时间）；
 *   · candidate 必须确认后才进入日程 / 建提醒；
 *   · 默认提醒的三条规则（前 24h / 前 1h / 已过但目标未来 → now+5min）；
 *   · 证据片段 ≤200 字，正文永远不进客户端。
 */

const NOW = new Date('2026-11-22T04:00:00.000Z') // 上海时间 2026-11-22（周日）12:00

function activity(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'act-1',
    source: 'campus-mail',
    kind: 'lecture',
    title: '分布式系统讲座',
    startsAt: '2026-11-23T06:30:00.000Z',
    endsAt: '2026-11-23T08:00:00.000Z',
    location: '信息学院 1A-200',
    organizer: '信息学院',
    registrationDeadlineAt: '2026-11-22T16:00:00.000Z',
    registrationDeadlineRaw: null,
    registrationUrl: 'https://example.edu.cn/events/1',
    evidenceText: '11月23日 14:30 信息学院 1A-200 举办分布式系统讲座',
    confidence: 0.82,
    status: 'candidate',
    sourceUrl: 'https://mail.shanghaitech.edu.cn/',
    sourceLabel: '校园邮箱',
    publishedAt: '2026-11-20T02:00:00.000Z',
    stale: false,
    ...overrides,
  }
}

describe('normalizeActivityItem', () => {
  it('拒绝未知来源 / 未知状态 —— 客户端不替后端猜', () => {
    expect(normalizeActivityItem({ ...activity(), source: 'weibo' as ActivityItem['source'] })).toBeNull()
    expect(normalizeActivityItem({ ...activity(), status: 'pending' as ActivityItem['status'] })).toBeNull()
    expect(normalizeActivityItem({ ...activity(), title: '   ' })).toBeNull()
  })

  it('证据片段压到 200 字以内，且压缩空白', () => {
    const long = `第一行\n\n${'活'.repeat(EVIDENCE_MAX_LENGTH + 50)}`
    const normalized = normalizeActivityItem({ ...activity(), evidenceText: long })
    expect(normalized).not.toBeNull()
    expect(Array.from(normalized?.evidenceText ?? '').length).toBe(EVIDENCE_MAX_LENGTH)
    expect(normalized?.evidenceText).not.toContain('\n')
  })

  it('无法解析的时刻不编造：startsAt 变 null，registrationDeadlineRaw 原样保留', () => {
    const normalized = normalizeActivityItem({
      ...activity(),
      startsAt: '11月24日 下午',
      registrationDeadlineAt: null,
      registrationDeadlineRaw: '11月24日 17:00 前',
    })

    expect(normalized?.startsAt).toBeNull()
    expect(normalized?.registrationDeadlineAt).toBeNull()
    expect(normalized?.registrationDeadlineRaw).toBe('11月24日 17:00 前')
  })

  it('合法时刻统一成 UTC ISO；结束早于开始则丢掉结束时间', () => {
    const normalized = normalizeActivityItem({
      ...activity(),
      startsAt: '2026-11-23T14:30:00+08:00',
      endsAt: '2026-11-23T13:00:00+08:00',
    })

    expect(normalized?.startsAt).toBe('2026-11-23T06:30:00.000Z')
    expect(normalized?.endsAt).toBeNull()
  })

  it('置信度夹到 0–1，非 http(s) 链接一律拒绝', () => {
    const normalized = normalizeActivityItem({
      ...activity(),
      confidence: 3,
      registrationUrl: 'javascript:alert(1)',
      sourceUrl: 'weixin://dl/chat',
    })

    expect(normalized?.confidence).toBe(1)
    expect(normalized?.registrationUrl).toBeNull()
    expect(normalized?.sourceUrl).toBeNull()
  })
})

describe('展示：UTC 时刻按 Asia/Shanghai 渲染', () => {
  it('同一 UTC 时刻在上海显示为 +8 时区', () => {
    expect(formatActivityInstant('2026-11-23T01:30:00.000Z', NOW)).toBe('11月23日 周一 09:30')
  })

  it('跨年时补年份，跨天时两端都带日期', () => {
    expect(formatActivityInstant('2027-01-02T01:00:00.000Z', NOW)).toBe('2027年1月2日 周六 09:00')

    const view = summarizeActivity(
      activity({
        startsAt: '2026-11-23T14:00:00.000Z',
        endsAt: '2026-11-24T02:00:00.000Z',
      }),
      NOW,
    )
    expect(view.whenLabel).toBe('11月23日 周一 22:00 至 11月24日 周二 10:00')
  })

  it('时间缺失时显示「时间待定」，不给假的 00:00', () => {
    const view = summarizeActivity(activity({ startsAt: null, endsAt: null }), NOW)
    expect(view.whenLabel).toBe('时间待定')
    expect(formatActivityWhen(activity({ startsAt: null, endsAt: null }), NOW)).toBe('时间待定')
  })
})

describe('报名截止：只有原文时保留原文，不补 23:59', () => {
  it('有确定时刻时显示具体时刻与剩余紧迫度', () => {
    const view = registrationDeadlineView(activity(), NOW)
    expect(view?.label).toBe('报名截止 11月23日 周一 00:00（24 小时内）')
    expect(view?.known).toBe(true)
    expect(view?.urgent).toBe(true)
    expect(view?.passed).toBe(false)
  })

  it('无法确定时刻时只展示原文并注明「原文未给出具体时刻」', () => {
    const view = registrationDeadlineView(
      activity({ registrationDeadlineAt: null, registrationDeadlineRaw: '11月24日 17:00 前' }),
      NOW,
    )
    expect(view?.label).toBe('报名截止 11月24日 17:00 前（原文未给出具体时刻）')
    expect(view?.known).toBe(false)
    expect(view?.label).not.toContain('23:59')
  })

  it('目标已过时标「已截止」，不再报紧迫', () => {
    const view = registrationDeadlineView(
      activity({ registrationDeadlineAt: '2026-11-22T02:00:00.000Z' }),
      NOW,
    )
    expect(view?.passed).toBe(true)
    expect(view?.urgent).toBe(false)
  })

  it('没有截止信息时返回 null（页面不画这一行）', () => {
    expect(
      registrationDeadlineView(
        activity({ registrationDeadlineAt: null, registrationDeadlineRaw: null }),
        NOW,
      ),
    ).toBeNull()
  })
})

describe('列表分组与来源筛选', () => {
  const today = activity({
    id: 'today',
    startsAt: '2026-11-22T10:00:00.000Z',
    status: 'confirmed',
  })
  const thisWeek = activity({
    id: 'week',
    startsAt: '2026-11-18T02:00:00.000Z',
    status: 'confirmed',
    source: 'wechat-mp',
  })
  const nextWeek = activity({
    id: 'later',
    startsAt: '2026-11-30T02:00:00.000Z',
    status: 'confirmed',
  })
  const pendingLater = activity({
    id: 'pending-later',
    startsAt: '2026-12-01T02:00:00.000Z',
  })
  const dismissed = activity({ id: 'dismissed', status: 'dismissed' })

  const items = [today, thisWeek, nextWeek, pendingLater, dismissed]

  it('待确认只看 candidate；今天 / 本周只看已确认，全部不含已忽略', () => {
    expect(items.filter((item) => activityTabMatches(item, 'pending', NOW)).map((i) => i.id)).toEqual([
      'pending-later',
    ])
    expect(items.filter((item) => activityTabMatches(item, 'today', NOW)).map((i) => i.id)).toEqual([
      'today',
    ])
    expect(items.filter((item) => activityTabMatches(item, 'week', NOW)).map((i) => i.id)).toEqual([
      'today',
      'week',
    ])
    expect(items.filter((item) => activityTabMatches(item, 'all', NOW)).map((i) => i.id)).not.toContain(
      'dismissed',
    )
  })

  it('周日属于本周（周一到周日），下周一才算下周', () => {
    expect(activityTabMatches(thisWeek, 'week', NOW)).toBe(true)
    expect(activityTabMatches(nextWeek, 'week', NOW)).toBe(false)
  })

  it('tab 计数与筛选一致', () => {
    const counts = buildActivityTabCounts(items, NOW)
    expect(counts.pending).toBe(1)
    expect(counts.today).toBe(1)
    expect(counts.week).toBe(2)
    expect(counts.all).toBe(4)
  })

  it('排序：已确认按开始时间升序；待确认按置信度降序；时间未知排最后', () => {
    const confirmed = sortActivities([nextWeek, today, thisWeek], 'all')
    expect(confirmed.map((item) => item.id)).toEqual(['week', 'today', 'later'])

    const pending = sortActivities(
      [
        pendingLater,
        activity({ id: 'low', confidence: 0.3 }),
        activity({ id: 'high', confidence: 0.95, startsAt: null }),
      ],
      'pending',
    )
    expect(pending[0]?.id).toBe('high')
    expect(pending[1]?.id).toBe('pending-later')
    expect(pending[2]?.id).toBe('low')
  })

  it('来源筛选只区分三种来源，不出现第四种', () => {
    expect(Object.keys(ACTIVITY_SOURCE_LABELS).sort()).toEqual([
      'campus-mail',
      'manual',
      'wechat-mp',
    ])
  })
})

describe('默认提醒：报名截止前 24h、开始前 1h', () => {
  it('两个目标都未来且计算时刻未来时，生成两条站内信提醒', () => {
    const plan = defaultReminderPlan(
      activity({
        registrationDeadlineAt: '2026-11-23T06:00:00.000Z',
        startsAt: '2026-11-24T06:00:00.000Z',
      }),
      NOW,
    )

    expect(plan.reminders).toEqual([
      { kind: 'registration', remindAt: '2026-11-22T06:00:00.000Z', channel: 'inapp' },
      { kind: 'start', remindAt: '2026-11-24T05:00:00.000Z', channel: 'inapp' },
    ])
    expect(plan.skipped).toEqual([])
  })

  it('目标已过就不建提醒（不补发一条迟到的「记得报名」）', () => {
    const plan = defaultReminderPlan(
      activity({
        registrationDeadlineAt: '2026-11-22T02:00:00.000Z',
        startsAt: '2026-11-22T03:00:00.000Z',
      }),
      NOW,
    )
    expect(plan.reminders).toEqual([])
    expect(plan.skipped.map((item) => item.reason)).toEqual(['target-passed', 'target-passed'])
  })

  it('计算时刻已过但目标未来：用 now + 5min，而不是丢掉提醒', () => {
    const plan = defaultReminderPlan(
      activity({
        registrationDeadlineAt: '2026-11-22T05:00:00.000Z',
        startsAt: '2026-11-22T04:30:00.000Z',
      }),
      NOW,
    )

    expect(plan.reminders).toEqual([
      { kind: 'registration', remindAt: '2026-11-22T04:05:00.000Z', channel: 'inapp' },
      { kind: 'start', remindAt: '2026-11-22T04:05:00.000Z', channel: 'inapp' },
    ])
  })

  it('目标离 now 不足 5 分钟时提醒不晚于目标本身', () => {
    const plan = defaultReminderPlan(
      activity({
        registrationDeadlineAt: '2026-11-22T04:02:00.000Z',
        startsAt: null,
      }),
      NOW,
    )
    expect(plan.reminders[0]?.remindAt).toBe('2026-11-22T04:02:00.000Z')
  })

  it('只有原文、没有确定时刻时跳过，绝不按 23:59 推算', () => {
    const plan = defaultReminderPlan(
      activity({
        registrationDeadlineAt: null,
        registrationDeadlineRaw: '11月24日 17:00 前',
        startsAt: null,
      }),
      NOW,
    )
    expect(plan.reminders).toEqual([])
    expect(plan.skipped.map((item) => item.reason)).toEqual(['time-unknown', 'time-unknown'])
  })
})

describe('状态机：candidate 必须确认后才能进日程 / 提醒', () => {
  it('只有 candidate 可以确认或忽略', () => {
    expect(canConfirmActivity(activity({ status: 'candidate' }))).toBe(true)
    expect(canConfirmActivity(activity({ status: 'confirmed' }))).toBe(false)
    expect(canDismissActivity(activity({ status: 'candidate' }))).toBe(true)
    expect(canDismissActivity(activity({ status: 'confirmed' }))).toBe(false)
  })
})

describe('公众号单篇导入的客户端校验', () => {
  it('接受单篇 mp.weixin.qq.com 链接', () => {
    expect(wechatImportProblem({ link: 'https://mp.weixin.qq.com/s/AbCdEf123' })).toBeNull()
  })

  it('拒绝非公众号域名 / http / 多链接 / 空输入', () => {
    expect(wechatImportProblem({ link: 'https://example.com/s/a' })).not.toBeNull()
    expect(wechatImportProblem({ link: 'http://mp.weixin.qq.com/s/AbCd' })).not.toBeNull()
    expect(
      wechatImportProblem({
        link: 'https://mp.weixin.qq.com/s/a https://mp.weixin.qq.com/s/b',
      }),
    ).not.toBeNull()
    expect(wechatImportProblem({})).not.toBeNull()
  })

  it('允许粘贴正文，但正文里也不能塞两篇链接', () => {
    expect(
      wechatImportProblem({
        text: '讲座预告：11月24日 19:00 信息学院 1A-200，欢迎参加。',
      }),
    ).toBeNull()

    expect(
      wechatImportProblem({
        text: '参见 https://mp.weixin.qq.com/s/a 和 https://mp.weixin.qq.com/s/b',
      }),
    ).not.toBeNull()
  })
})

describe('自定义提醒：按 Asia/Shanghai 解释用户选择的日期与时刻', () => {
  it('日期 + 时刻转成带 +08:00 的绝对时刻，再存 UTC ISO', () => {
    expect(parseShanghaiDateTime('2026-11-24', '19:30')).toBe('2026-11-24T11:30:00.000Z')
    expect(parseShanghaiDateTime('2026-11-24', '9:05')).toBe('2026-11-24T01:05:00.000Z')
  })

  it('非法日期 / 时刻返回 null，不猜', () => {
    expect(parseShanghaiDateTime('2026-11-24', '25:00')).toBeNull()
    expect(parseShanghaiDateTime('11/24', '19:30')).toBeNull()
    expect(parseShanghaiDateTime('2026-11-24', '')).toBeNull()
  })

  it('日期做往返校验：2026-02-30 不会被 Date.parse 滚到 3 月', () => {
    expect(parseShanghaiDateTime('2026-02-30', '10:00')).toBeNull()
    expect(parseShanghaiDateTime('2026-13-01', '10:00')).toBeNull()
    expect(parseShanghaiDateTime('2026-00-10', '10:00')).toBeNull()
    // 闰年 2 月 29 日仍然合法
    expect(parseShanghaiDateTime('2024-02-29', '10:00')).toBe('2024-02-29T02:00:00.000Z')
  })

  it('日期选择器的下界用上海本地日期，而不是设备时区', () => {
    expect(shanghaiDateInput(NOW)).toBe('2026-11-22')
    expect(shanghaiDateInput(new Date('2026-11-22T17:00:00.000Z'))).toBe('2026-11-23')
  })
})

describe('手动录入与提醒', () => {
  it('证据超过 200 字时截断而不是报错（契约要求只存片段）', () => {
    expect(Array.from(clampEvidence('活'.repeat(250))).length).toBe(EVIDENCE_MAX_LENGTH)
  })

  it('标题为空 / 报名链接非 http(s) 会被拦下', () => {
    expect(manualActivityProblem({ title: '  ', kind: 'other' })).not.toBeNull()
    expect(
      manualActivityProblem({
        title: '社团招新',
        kind: 'club',
        registrationUrl: 'ftp://example.com/a',
      }),
    ).not.toBeNull()
  })

  it('提醒只接受三种 kind 与受支持的渠道', () => {
    expect(
      normalizeActivityReminder({
        id: 'rem-1',
        kind: 'registration',
        remindAt: '2026-11-22T06:00:00.000Z',
        channel: 'inapp',
        status: 'pending',
      }),
    ).not.toBeNull()

    expect(
      normalizeActivityReminder({
        id: 'rem-2',
        kind: 'snooze',
        remindAt: '2026-11-22T06:00:00.000Z',
        channel: 'inapp',
        status: 'pending',
      }),
    ).toBeNull()

    expect(
      normalizeActivityReminder({
        id: 'rem-3',
        kind: 'custom',
        remindAt: 'not-a-time',
        channel: 'inapp',
        status: 'pending',
      }),
    ).toBeNull()
  })
})
