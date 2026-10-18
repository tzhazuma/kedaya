import type { ScheduleConflict, ScheduleCourseView } from '../../domain/models/schedule'

/**
 * 课表页的**纯排版逻辑**（无 React / 无 Taro，可直接单测）。
 *
 * 为什么单独一层：
 *   · 周视图要把「第几节」画成格子里的方块（上下位置 / 高度 / 并排车道）；
 *   · 今日视图要在两节课之间插一行「空 2 小时，可去图书馆」；
 *   · 这两件事都是**纯计算**，如果写进鉴权、请求、交互同一个页面文件里，
 *     边界情况（时间文案畸形 / 三节课互相重叠 / 课程乱序）就没人测得到。
 *
 * ⚠️ 时间**只从服务端下发的 `timeLabel` 里读**（`"08:15–10:05"`）。
 * 客户端不再维护一份「第几节是几点」的作息表 —— 那份表在服务端，手机时间 / 时区
 * 偏了也不会让课表错位。`startSlot` / `endSlot` 只用于**画格子**（节次是离散的），
 * 不用来算"还有几分钟"。
 *
 * WXSS 侧不参与这里的任何数值：页面只拿 `top/height/left/width` 的百分比。
 */

/* ------------------------------------------------------------------ *
 * 时间文案 → 分钟
 * ------------------------------------------------------------------ */

/** 服务端 `timeLabel` 的形如 `08:15–10:05`（en dash；容错 ascii 连字符） */
const TIME_LABEL_PATTERN = /^(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})$/

export interface CourseTimeRange {
  /** 距当天 0 点的分钟数 */
  startMinutes: number
  endMinutes: number
}

/**
 * 解析服务端的时间区间文案。
 *
 * 解析失败返回 `null` 而不是抛错：脏数据 / 未来文案改版都只应该让**这一节课**
 * 少一行空档提示，不能让整页白屏。调用方拿到 `null` 就跳过区间计算。
 */
export function parseTimeLabel(label: string): CourseTimeRange | null {
  const match = TIME_LABEL_PATTERN.exec(label.trim())
  if (match === null) return null

  const [startHour, startMinute, endHour, endMinute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
  ]
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return null

  const startMinutes = startHour * 60 + startMinute
  const endMinutes = endHour * 60 + endMinute
  if (endMinutes < startMinutes) return null

  return { startMinutes, endMinutes }
}

export function courseTimeRange(
  course: Pick<ScheduleCourseView, 'timeLabel'>,
): CourseTimeRange | null {
  return parseTimeLabel(course.timeLabel)
}

/** `90` → `"1 小时 30 分钟"`；用于空档与状态文案 */
export function formatDuration(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes))
  if (rounded < 60) return `${rounded} 分钟`

  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`
}

/* ------------------------------------------------------------------ *
 * 今日时间轴：课程 + 课间空档
 * ------------------------------------------------------------------ */

/**
 * 空档只有 ≥ 30 分钟才值得提示。
 *
 * 学校作息里相邻两节之间本来就有 10–20 分钟（换教室、上厕所），
 * 每节课之间都插一行「空 10 分钟」会把时间轴变成噪声；
 * 30 分钟以上才是用户可以**决定去干点什么**的空闲（午休、晚饭前）。
 */
export const GAP_MIN_MINUTES = 30

/** 空档建议：写"能做什么"，不写"还有多少分钟"（时长已经在上一行） */
export function gapHint(minutes: number): string {
  if (minutes >= 120) return '够去图书馆坐一会儿'
  if (minutes >= 60) return '够吃顿饭，再慢慢走回教室'
  if (minutes >= 40) return '够去食堂吃点东西'
  return '够换栋楼、歇口气'
}

export type ScheduleTimelineItem =
  | { kind: 'course'; course: ScheduleCourseView }
  | {
      kind: 'gap'
      startMinutes: number
      endMinutes: number
      minutes: number
      /** `"空 2 小时"` */
      label: string
      hint: string
      /** 空档前/后课程名，供读屏用户理解"空在哪两节之间" */
      after: string
      before: string
    }

/** 课程排序：先按节次，再按结束节次，最后按名字（同一节课的并列块顺序稳定） */
export function compareCourses(left: ScheduleCourseView, right: ScheduleCourseView): number {
  if (left.startSlot !== right.startSlot) return left.startSlot - right.startSlot
  if (left.endSlot !== right.endSlot) return left.endSlot - right.endSlot
  return left.courseName.localeCompare(right.courseName, 'zh-Hans-CN')
}

/**
 * 把一天的课程排成「课程 / 空档」交替的时间轴。
 *
 * 重叠的课程**不会**被算成空档：`occupiedUntil` 取已占用时间的最大值，
 * 否则「A 8:00–10:00、B 9:00–11:00、C 11:30–12:00」会在 10:00 插一条
 * 实际还在上课的"空档"。
 */
export function buildDayTimeline(
  courses: readonly ScheduleCourseView[],
): ScheduleTimelineItem[] {
  const sorted = courses.slice().sort(compareCourses)
  const items: ScheduleTimelineItem[] = []

  /** 已排到的时间（分钟），`null` = 还没遇到可解析的课 */
  let occupiedUntil: number | null = null
  let previousCourseName = ''

  for (const course of sorted) {
    const range = courseTimeRange(course)

    if (range === null) {
      // 解析不了时间就只画课程本身，不猜测空档
      items.push({ kind: 'course', course })
      previousCourseName = course.courseName
      continue
    }

    if (occupiedUntil !== null) {
      const gap = range.startMinutes - occupiedUntil
      if (gap >= GAP_MIN_MINUTES) {
        items.push({
          kind: 'gap',
          startMinutes: occupiedUntil,
          endMinutes: range.startMinutes,
          minutes: gap,
          label: `空 ${formatDuration(gap)}`,
          hint: gapHint(gap),
          after: previousCourseName,
          before: course.courseName,
        })
      }
    }

    items.push({ kind: 'course', course })
    occupiedUntil = Math.max(occupiedUntil ?? range.endMinutes, range.endMinutes)
    previousCourseName = course.courseName
  }

  return items
}

/* ------------------------------------------------------------------ *
 * 周视图：同一时段多门课 → 并排车道
 * ------------------------------------------------------------------ */

export interface CourseLane {
  course: ScheduleCourseView
  /** 0-based 车道序号 */
  lane: number
  /** 该重叠簇一共几条车道（1 = 独占整列） */
  lanes: number
}

/**
 * 计算一天里每门课的车道。
 *
 * 算法：先按开始节次排序，把「时间上互相连通」的课分成簇（`startSlot > 簇尾` 就断开），
 * 簇内用「取第一条空闲车道」的贪心分区。这样：
 *   · 不重叠的课永远独占整列（`lanes: 1`）；
 *   · 两门课重叠 → 各占一半宽并排，不会互相盖住；
 *   · 三门课 A/B 重叠、C 只与 B 重叠时，三节都按该簇的 3 条车道算，
 *     用户看到的是三列等宽，而不是"C 突然变宽"的错位。
 *
 * 用 `startSlot/endSlot` 而不是分钟：渲染格子本来就是按节次离散排列的。
 */
export function layoutDayLanes(courses: readonly ScheduleCourseView[]): CourseLane[] {
  const sorted = courses.slice().sort(compareCourses)
  const result: CourseLane[] = []

  let cluster: ScheduleCourseView[] = []
  let clusterEnd = -1

  const flush = (): void => {
    if (cluster.length === 0) return

    const laneEnds: number[] = []
    const assignments = new Map<string, number>()

    for (const course of cluster) {
      let lane = laneEnds.findIndex((end) => end < course.startSlot)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(course.endSlot)
      } else {
        laneEnds[lane] = course.endSlot
      }
      assignments.set(course.id, lane)
    }

    const lanes = Math.max(1, laneEnds.length)
    for (const course of cluster) {
      result.push({ course, lane: assignments.get(course.id) ?? 0, lanes })
    }

    cluster = []
  }

  for (const course of sorted) {
    if (cluster.length > 0 && course.startSlot > clusterEnd) {
      flush()
      clusterEnd = -1
    }
    cluster.push(course)
    clusterEnd = Math.max(clusterEnd, course.endSlot)
  }
  flush()

  return result
}

/* ------------------------------------------------------------------ *
 * 冲突 / 文案
 * ------------------------------------------------------------------ */

/** 冲突涉及的课程 id（周视图给方块描红边用） */
export function conflictCourseIds(conflicts: readonly ScheduleConflict[]): Set<string> {
  const ids = new Set<string>()
  for (const conflict of conflicts) {
    ids.add(conflict.a.id)
    ids.add(conflict.b.id)
  }
  return ids
}

/**
 * 倒计时主文案：用户扫一眼要看到的那个数字。
 *
 * 和 `countdownLabel()`（domain 里的完整句子）分开：
 *   完整句子用于副标题，这里只给英雄区的大字（"还有 20 分钟"）。
 */
export function countdownHeadline(minutes: number | null): string {
  if (minutes === null) return ''
  if (minutes <= 0) return '马上开始'
  if (minutes < 60) return `还有 ${minutes} 分钟`

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `还有 ${hours} 小时` : `还有 ${hours} 小时 ${rest} 分钟`
}

/** 周视图表头把「周一」压成「一」：88px 宽的列放不下两个字 + 今天标记 */
export function shortWeekday(label: string): string {
  return label.startsWith('周') ? label.slice(1) : label
}

/**
 * 学期 id → 胶囊上的短标签（`2026-2027-1` → `26–27 第一学期`）。
 *
 * 只在**有多个学期可切换**时使用：直接显示 `2026-2027-1` 是数据库口径，
 * 用户认不出这是哪个学期；而完整的 `2026-2027 学年 第一学期` 在胶囊里会折行。
 * 解析失败时原样返回（未知的学期格式不该被猜成别的学期）。
 */
export function shortTermLabel(term: string): string {
  const match = /^(\d{4})-(\d{4})-([12])$/.exec(term)
  if (match === null) return term

  const startYear = match[1] ?? ''
  const endYear = match[2] ?? ''
  const index = match[3]
  return `${startYear.slice(2)}–${endYear.slice(2)} ${index === '1' ? '第一学期' : '第二学期'}`
}
