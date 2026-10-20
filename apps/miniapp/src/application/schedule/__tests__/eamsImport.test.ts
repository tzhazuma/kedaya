import { describe, expect, it } from 'vitest'

import type { EamsLesson } from '@kedaya/shared'

import { SLOT_TIMES, slotTimeLabel, slotTimeRange } from '../../../domain/models/schedule'
import { eamsLessonsToCourses } from '../eamsImport'

/**
 * 教务 EAMS → 课表视图的映射。
 *
 * 三条"不猜"是这组测试的重点：
 * 1. 节次超范围 → **跳过**并说明原因，不塞假时刻
 * 2. 没有教师/教室 → `null`，不填占位符
 * 3. 周次进 `id` → 同一门课不同周次是不同条目，不互相覆盖
 */
function lesson(over: Partial<EamsLesson> = {}): EamsLesson {
  return {
    id: 'c1:1:1:2:1-16',
    courseId: 'c1',
    title: '高等数学',
    code: 'MATH1001',
    term: '2026-2027-1',
    teacher: '张三',
    location: '教 101',
    weekday: 1,
    first: 1,
    last: 2,
    weeks: [1, 2, 3],
    ...over,
  }
}

describe('作息表（已从 mock 挪进 domain）', () => {
  it('第 1 节是 08:15–09:05', () => {
    expect(slotTimeRange(1)).toEqual({ start: '08:15', end: '09:05' })
  })

  it('10 节课全在表里', () => {
    expect(SLOT_TIMES).toHaveLength(10)
    for (let slot = 1; slot <= 10; slot += 1) {
      expect(slotTimeRange(slot), `第 ${slot} 节`).not.toBeNull()
    }
  })

  it('⚠️ 不在表里的节次返回 null（不猜）', () => {
    expect(slotTimeRange(0)).toBeNull()
    expect(slotTimeRange(11)).toBeNull()
    expect(slotTimeLabel(1, 11)).toBeNull()
  })

  it('timeLabel 是 en dash（与契约一致）', () => {
    expect(slotTimeLabel(1, 2)).toBe('08:15–10:05')
  })
})

describe('eamsLessonsToCourses', () => {
  it('基本映射：节次、时刻、课程名都正确', () => {
    const { courses, skipped } = eamsLessonsToCourses([lesson()])
    expect(skipped).toHaveLength(0)
    expect(courses).toHaveLength(1)
    const c = courses[0]!
    expect(c.courseName).toBe('高等数学（MATH1001）')
    expect(c.weekday).toBe(1)
    expect(c.startSlot).toBe(1)
    expect(c.endSlot).toBe(2)
    expect(c.timeLabel).toBe('08:15–10:05')
    expect(c.slotLabel).toBe('第 1-2 节')
    expect(c.teacher).toBe('张三')
    expect(c.location).toBe('教 101')
  })

  it('⚠️ 节次超过 MAX_SLOT(12) → 进 skipped 并说明原因', () => {
    const { courses, skipped } = eamsLessonsToCourses([
      lesson({ id: 'ok', first: 1, last: 2 }),
      lesson({ id: 'bad', first: 13, last: 14 }),
    ])
    expect(courses).toHaveLength(1)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.reason).toContain('超出学校作息表')
  })

  /**
   * ⚠️ 这是**已知不一致**：`MAX_SLOT = 12` 但作息表只有 10 节。
   * 所以第 11-12 节能通过 MAX_SLOT 检查，却算不出时刻。
   * 行为：进 skipped，理由是"作息表里找不到时刻" —— 仍然不猜。
   */
  it('⚠️ 11-12 节在 MAX_SLOT 内但作息表没有时刻 → 也不猜', () => {
    const { courses, skipped } = eamsLessonsToCourses([
      lesson({ id: 'slot11', first: 11, last: 12 }),
    ])
    expect(courses).toHaveLength(0)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.reason).toContain('找不到')
  })

  it('⚠️ 没有教师/教室 → null，不填占位符', () => {
    const { courses } = eamsLessonsToCourses([
      lesson({ teacher: '', location: '   ' }),
    ])
    expect(courses[0]!.teacher).toBeNull()
    expect(courses[0]!.location).toBeNull()
  })

  it('⚠️ 周次进 id —— 同一门课不同周次不互相覆盖', () => {
    const a = eamsLessonsToCourses([lesson({ id: 'c1:1:1:2:1-8' })]).courses[0]!
    const b = eamsLessonsToCourses([lesson({ id: 'c1:1:1:2:9-16' })]).courses[0]!
    expect(a.id).not.toBe(b.id)
  })

  it('没有课程代码时只用课程名，不加空括号', () => {
    const { courses } = eamsLessonsToCourses([lesson({ code: '' })])
    expect(courses[0]!.courseName).toBe('高等数学')
  })

  it('单节课的 slotLabel 不用区间写法', () => {
    const { courses } = eamsLessonsToCourses([lesson({ first: 3, last: 3 })])
    expect(courses[0]!.slotLabel).toBe('第 3 节')
  })

  it('按星期、再按节次排序（与周视图渲染顺序一致）', () => {
    const { courses } = eamsLessonsToCourses([
      lesson({ id: 'c-fri', weekday: 5, first: 1, last: 2 }),
      lesson({ id: 'c-mon-late', weekday: 1, first: 5, last: 6 }),
      lesson({ id: 'c-mon-early', weekday: 1, first: 1, last: 2 }),
    ])
    expect(courses.map((c) => c.id)).toEqual([
      'eams-c-mon-early',
      'eams-c-mon-late',
      'eams-c-fri',
    ])
  })

  it('空输入不崩', () => {
    expect(eamsLessonsToCourses([])).toEqual({ courses: [], skipped: [] })
  })
})
