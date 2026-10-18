import { describe, expect, it } from 'vitest'

import type { ScheduleConflict, ScheduleCourseView } from '../../../domain/models/schedule'
import {
  GAP_MIN_MINUTES,
  buildDayTimeline,
  compareCourses,
  conflictCourseIds,
  countdownHeadline,
  courseTimeRange,
  formatDuration,
  gapHint,
  layoutDayLanes,
  parseTimeLabel,
  shortTermLabel,
  shortWeekday,
} from '../timetable'

function course(overrides: Partial<ScheduleCourseView> & { id: string }): ScheduleCourseView {
  return {
    courseName: '课程',
    teacher: null,
    location: null,
    weekday: 1,
    startSlot: 1,
    endSlot: 2,
    timeLabel: '08:15–10:05',
    slotLabel: '第 1-2 节',
    ...overrides,
  }
}

describe('parseTimeLabel', () => {
  it('解析服务端下发的节次区间（en dash）', () => {
    expect(parseTimeLabel('08:15–10:05')).toEqual({ startMinutes: 495, endMinutes: 605 })
  })

  it('容错 ascii 连字符与前后空白', () => {
    expect(parseTimeLabel(' 13:00-13:50 ')).toEqual({ startMinutes: 780, endMinutes: 830 })
  })

  it('文案畸形 / 时间倒挂时返回 null，不抛错', () => {
    expect(parseTimeLabel('')).toBeNull()
    expect(parseTimeLabel('08:15')).toBeNull()
    expect(parseTimeLabel('25:00–26:00')).toBeNull()
    expect(parseTimeLabel('10:05–08:15')).toBeNull()
    expect(parseTimeLabel('08:99–10:05')).toBeNull()
  })

  it('courseTimeRange 只是按 timeLabel 取区间', () => {
    expect(courseTimeRange(course({ id: 'c', timeLabel: '18:00–19:50' }))).toEqual({
      startMinutes: 1080,
      endMinutes: 1190,
    })
  })
})

describe('formatDuration', () => {
  it('小于一小时只给分钟', () => {
    expect(formatDuration(45)).toBe('45 分钟')
  })

  it('整小时不带 0 分钟', () => {
    expect(formatDuration(120)).toBe('2 小时')
  })

  it('小时 + 分钟', () => {
    expect(formatDuration(90)).toBe('1 小时 30 分钟')
  })

  it('负数夹到 0', () => {
    expect(formatDuration(-5)).toBe('0 分钟')
  })
})

describe('gapHint', () => {
  it('空档越长给的建议越"能坐下"', () => {
    expect(gapHint(GAP_MIN_MINUTES)).toBe('够换栋楼、歇口气')
    expect(gapHint(45)).toBe('够去食堂吃点东西')
    expect(gapHint(75)).toBe('够吃顿饭，再慢慢走回教室')
    expect(gapHint(150)).toBe('够去图书馆坐一会儿')
  })
})

describe('buildDayTimeline', () => {
  it('按节次排序，并在午休插入空档', () => {
    const morning = course({ id: 'a', startSlot: 1, endSlot: 2, timeLabel: '08:15–09:05', courseName: '高数' })
    const afternoon = course({
      id: 'b',
      startSlot: 5,
      endSlot: 6,
      timeLabel: '13:00–14:50',
      courseName: '大物',
    })

    const timeline = buildDayTimeline([afternoon, morning])

    expect(timeline.map((item) => (item.kind === 'course' ? item.course.id : item.kind))).toEqual([
      'a',
      'gap',
      'b',
    ])
    const gap = timeline[1]
    expect(gap?.kind).toBe('gap')
    if (gap?.kind === 'gap') {
      expect(gap.minutes).toBe(235)
      expect(gap.label).toBe('空 3 小时 55 分钟')
      expect(gap.after).toBe('高数')
      expect(gap.before).toBe('大物')
    }
  })

  it('相邻两节之间的 10–20 分钟换教室时间不算空档', () => {
    const first = course({ id: 'a', startSlot: 1, endSlot: 1, timeLabel: '08:15–09:05' })
    const second = course({ id: 'b', startSlot: 2, endSlot: 2, timeLabel: '09:15–10:05' })
    const third = course({ id: 'c', startSlot: 3, endSlot: 3, timeLabel: '10:25–11:15' })

    const timeline = buildDayTimeline([first, second, third])

    expect(timeline.every((item) => item.kind === 'course')).toBe(true)
  })

  it('重叠课程之间不留空档（重叠会被当成"还占着"）', () => {
    const a = course({ id: 'a', startSlot: 1, endSlot: 4, timeLabel: '08:15–10:05' })
    const b = course({ id: 'b', startSlot: 3, endSlot: 5, timeLabel: '10:25–13:50' })
    const c = course({ id: 'c', startSlot: 6, endSlot: 6, timeLabel: '14:00–14:50' })

    const timeline = buildDayTimeline([a, b, c])

    // b 在 10:25 开始时 a 已结束（10:05），差 20 分钟 < 30，不插空档；
    // c 在 14:00 开始时 b 已结束（13:50），差 10 分钟，也不插。
    expect(timeline.filter((item) => item.kind === 'gap')).toHaveLength(0)
    expect(timeline).toHaveLength(3)
  })

  it('解析不了时间的课只画自己，不猜测空档', () => {
    const broken = course({ id: 'x', timeLabel: '--:--' })
    const normal = course({ id: 'n', startSlot: 5, endSlot: 6, timeLabel: '13:00–14:50' })

    const timeline = buildDayTimeline([broken, normal])

    expect(timeline).toHaveLength(2)
    expect(timeline.every((item) => item.kind === 'course')).toBe(true)
  })

  it('没有课就是空数组', () => {
    expect(buildDayTimeline([])).toEqual([])
  })
})

describe('compareCourses', () => {
  it('先开始节次，再结束节次', () => {
    const early = course({ id: 'a', startSlot: 1, endSlot: 2 })
    const late = course({ id: 'b', startSlot: 3, endSlot: 4 })
    const short = course({ id: 'c', startSlot: 1, endSlot: 1 })

    expect([late, early, short].sort(compareCourses).map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('layoutDayLanes', () => {
  it('不重叠的课独占整列', () => {
    const first = course({ id: 'a', startSlot: 1, endSlot: 2 })
    const second = course({ id: 'b', startSlot: 3, endSlot: 4 })

    const lanes = layoutDayLanes([first, second])

    expect(lanes).toEqual([
      { course: first, lane: 0, lanes: 1 },
      { course: second, lane: 0, lanes: 1 },
    ])
  })

  it('两门课重叠时并排两列', () => {
    const first = course({ id: 'a', startSlot: 1, endSlot: 3 })
    const second = course({ id: 'b', startSlot: 2, endSlot: 4 })

    const lanes = layoutDayLanes([first, second])

    expect(lanes.map(({ course: item, lane, lanes: count }) => [item.id, lane, count])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
    ])
  })

  it('节次不重叠（下一节从 endSlot+1 开始）时各自独占整列', () => {
    const first = course({ id: 'a', startSlot: 1, endSlot: 2 })
    const second = course({ id: 'b', startSlot: 3, endSlot: 4 })

    const lanes = layoutDayLanes([first, second])

    expect(lanes.every((item) => item.lanes === 1)).toBe(true)
  })

  it('共用同一个节次（a 到第 2 节结束、b 从第 2 节开始）算重叠', () => {
    const first = course({ id: 'a', startSlot: 1, endSlot: 2 })
    const second = course({ id: 'b', startSlot: 2, endSlot: 3 })

    const lanes = layoutDayLanes([first, second])

    expect(lanes.map((item) => item.lanes)).toEqual([2, 2])
  })

  it('三节两两重叠时三列等宽；之后不重叠的课回到整列', () => {
    const a = course({ id: 'a', startSlot: 1, endSlot: 5 })
    const b = course({ id: 'b', startSlot: 2, endSlot: 6 })
    const c = course({ id: 'c', startSlot: 3, endSlot: 7 })
    const d = course({ id: 'd', startSlot: 8, endSlot: 9 })

    const lanes = layoutDayLanes([d, c, b, a])
    const byId = new Map(lanes.map((item) => [item.course.id, item]))

    expect(byId.get('a')).toMatchObject({ lane: 0, lanes: 3 })
    expect(byId.get('b')).toMatchObject({ lane: 1, lanes: 3 })
    expect(byId.get('c')).toMatchObject({ lane: 2, lanes: 3 })
    expect(byId.get('d')).toMatchObject({ lane: 0, lanes: 1 })
  })
})

describe('conflictCourseIds', () => {
  it('两侧课程 id 都收进来', () => {
    const conflicts: ScheduleConflict[] = [
      {
        weekday: 2,
        a: { id: 'a', courseName: 'A', startSlot: 1, endSlot: 2 },
        b: { id: 'b', courseName: 'B', startSlot: 2, endSlot: 3 },
      },
    ]

    expect([...conflictCourseIds(conflicts)].sort()).toEqual(['a', 'b'])
  })
})

describe('countdownHeadline', () => {
  it('不足一小时给分钟', () => {
    expect(countdownHeadline(20)).toBe('还有 20 分钟')
  })

  it('零或负数说马上开始', () => {
    expect(countdownHeadline(0)).toBe('马上开始')
    expect(countdownHeadline(-3)).toBe('马上开始')
  })

  it('超过一小时拆成小时 + 分钟', () => {
    expect(countdownHeadline(60)).toBe('还有 1 小时')
    expect(countdownHeadline(95)).toBe('还有 1 小时 35 分钟')
  })

  it('没有下一节时为空串（调用方自己决定显示什么）', () => {
    expect(countdownHeadline(null)).toBe('')
  })
})

describe('shortWeekday', () => {
  it('去掉「周」前缀，给窄列用', () => {
    expect(shortWeekday('周一')).toBe('一')
    expect(shortWeekday('周日')).toBe('日')
    expect(shortWeekday('今天')).toBe('今天')
  })
})

describe('shortTermLabel', () => {
  it('学期 id 压成胶囊能放下的短标签', () => {
    expect(shortTermLabel('2026-2027-1')).toBe('26–27 第一学期')
    expect(shortTermLabel('2026-2027-2')).toBe('26–27 第二学期')
  })

  it('认不出的格式原样返回，不猜学期', () => {
    expect(shortTermLabel('2026 秋季')).toBe('2026 秋季')
  })
})
