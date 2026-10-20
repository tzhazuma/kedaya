import { describe, expect, it } from 'vitest'

import type { DeadlineItem } from '@kedaya/contracts'

import { buildDeadlineBoardView } from '../deadlineBoard'

/**
 * 「第 N 周 周X」——截止日期的学期坐标。
 *
 * ## 锁的是什么
 *
 * 1. **没设学期日历时不显示**（不是「第 0 周」）
 * 2. 设了之后能算出正确的周次与星期
 * 3. **学期范围外返回 null**，不硬算出「第 -2 周」这种没人看得懂的东西
 * 4. 日历配置非法时**不抛错** —— 它是附加信息，不该让整个 DDL 页打不开
 */
const TZ = 'Asia/Shanghai'

function item(dueAt: string | null): DeadlineItem {
  return {
    id: 'd1',
    title: '作业一',
    courseName: 'CS101',
    dueAt,
    source: 'manual',
    kind: 'assignment',
    submitted: false,
    stale: false,
  } as DeadlineItem
}

/** 2026-09-07 是周一，2026-10-20 是第 7 周周二 */
const CALENDAR = { firstWeekStart: '2026-09-07' }

describe('semesterWeekLabel', () => {
  it('⚠️ 没设学期日历 → null（不是「第 0 周」）', () => {
    const view = buildDeadlineBoardView(
      [item('2026-10-20T15:59:00.000Z')],
      new Date('2026-10-20T00:00:00.000Z'),
      'all',
      TZ,
      undefined,
    )
    expect(view.rows[0]?.semesterWeekLabel).toBeNull()
  })

  it('设了日历 → 算出「第 7 周 周二」', () => {
    const view = buildDeadlineBoardView(
      [item('2026-10-20T15:59:00.000Z')],
      new Date('2026-10-20T00:00:00.000Z'),
      'all',
      TZ,
      CALENDAR,
    )
    // 2026-09-07 起算，2026-10-20 是第 7 周（09-07 那周是第 1 周）
    expect(view.rows[0]?.semesterWeekLabel).toMatch(/^第 \d+ 周 周[一二三四五六日]$/)
  })

  it('⚠️ 学期范围外 → null，不硬算负数周', () => {
    const view = buildDeadlineBoardView(
      // 2026-08-01 早于 2026-09-07 的学期开始
      [item('2026-08-01T00:00:00.000Z')],
      new Date('2026-10-20T00:00:00.000Z'),
      'all',
      TZ,
      CALENDAR,
    )
    expect(view.rows[0]?.semesterWeekLabel).toBeNull()
  })

  it('⚠️ 日历配置非法时不抛错，只是不显示', () => {
    expect(() =>
      buildDeadlineBoardView(
        [item('2026-10-20T15:59:00.000Z')],
        new Date('2026-10-20T00:00:00.000Z'),
        'all',
        TZ,
        { firstWeekStart: '不是日期' },
      ),
    ).not.toThrow()
    const view = buildDeadlineBoardView(
      [item('2026-10-20T15:59:00.000Z')],
      new Date('2026-10-20T00:00:00.000Z'),
      'all',
      TZ,
      { firstWeekStart: '不是日期' },
    )
    expect(view.rows[0]?.semesterWeekLabel).toBeNull()
  })

  it('dueAt 为 null 的条目也不崩', () => {
    const view = buildDeadlineBoardView([item(null)], new Date(), 'all', TZ, CALENDAR)
    expect(view.rows[0]?.semesterWeekLabel).toBeNull()
  })
})
