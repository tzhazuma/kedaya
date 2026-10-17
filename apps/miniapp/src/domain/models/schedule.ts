/**
 * 课表（`schedule`）领域模型。
 *
 * 与后端 `schedule.service.ts` 的视图逐条对齐。设计要点：
 *   · **时间文案由服务端算好**（`timeLabel` / `minutesUntilNext`），
 *     客户端不重复实现"第几节是几点"——手机时钟不准也不会显示错误的倒计时；
 *   · 冲突 `conflicts` 由服务端给出，页面只负责提示；
 *   · `simulated` 必须如实展示（演示数据 ≠ 我的真实课表）。
 */

export interface ScheduleCourseView {
  id: string
  courseName: string
  teacher: string | null
  location: string | null
  /** 1=周一 … 7=周日 */
  weekday: number
  startSlot: number
  endSlot: number
  /** `"08:15–10:05"` */
  timeLabel: string
  /** `"第 1-2 节"` */
  slotLabel: string
}

export interface ScheduleConflict {
  weekday: number
  a: { id: string; courseName: string; startSlot: number; endSlot: number }
  b: { id: string; courseName: string; startSlot: number; endSlot: number }
}

export interface ScheduleTodayView {
  term: string
  termLabel: string
  date: string
  weekday: number
  weekdayLabel: string
  courses: ScheduleCourseView[]
  ongoing: ScheduleCourseView[]
  next: ScheduleCourseView | null
  minutesUntilNext: number | null
  nextStartsAt: string | null
  finishedForToday: boolean
  conflicts: ScheduleConflict[]
  simulated: boolean
  /** 今天没排课（用来区分"没课"与"课表没同步"） */
  empty: boolean
}

export interface ScheduleDayView {
  weekday: number
  label: string
  relativeLabel: string
  isToday: boolean
  courses: ScheduleCourseView[]
}

export interface ScheduleWeekView {
  term: string
  termLabel: string
  today: number
  days: ScheduleDayView[]
  conflicts: ScheduleConflict[]
  totalCount: number
  terms: string[]
  simulated: boolean
}

export interface ScheduleSyncResult {
  term: string
  termLabel: string
  imported: number
  conflicts: ScheduleConflict[]
  simulated: boolean
  syncedAt: string
}

/** 手动加课（教务数据外的补充，例如临时调课） */
export interface CreateCourseInput {
  term: string
  courseName: string
  teacher: string
  location: string
  weekday: number
  startSlot: number
  endSlot: number
}

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const
export const MAX_SLOT = 12

/** 节次选项（表单用） */
export const SLOT_OPTIONS: readonly { value: number; label: string }[] = Array.from(
  { length: MAX_SLOT },
  (_, index) => ({ value: index + 1, label: `第 ${index + 1} 节` }),
)

/**
 * 倒计时文案。
 *
 * 为什么要在客户端也有一份：agent 的回答用的是服务端算好的分钟数，
 * 但课表页的倒计时会随停留时间变化，需要在**不重新请求**的情况下自增。
 */
export function countdownLabel(minutes: number | null): string {
  if (minutes === null) return ''
  if (minutes <= 0) return '即将开始'
  if (minutes < 60) return `${minutes} 分钟后开始`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} 小时后开始` : `${hours} 小时 ${rest} 分钟后开始`
}

/** 冲突文案（页面直接用，避免各处拼字符串） */
export function conflictLabel(conflict: ScheduleConflict): string {
  return `${WEEKDAY_LABELS[conflict.weekday - 1] ?? ''}：${conflict.a.courseName} 与 ${conflict.b.courseName} 时间重叠`
}

/** 课程卡片副标题：地点 + 教师（缺了就不显示空括号） */
export function courseSubtitle(course: ScheduleCourseView): string {
  return [course.location, course.teacher].filter((item) => item !== null && item !== '').join(' · ')
}
