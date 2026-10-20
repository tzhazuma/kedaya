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

/**
 * 学校作息表：第 N 节 → 起止时刻。
 *
 * ## ⚠️ 这是**真实数据**，不是 mock 数据
 *
 * 它原来只存在于 `data/repositories/mockCampusRepository.ts` 里（一个私有
 * const），但作息表跟"演示数据"完全不是一回事：它决定了课表格子的实际时刻，
 * 也决定了从教务导入的节次能不能换算成 `timeLabel`。
 *
 * 藏在 mock 里的后果是：真实数据流（从 EAMS 导入）反而拿不到它 ——
 * 于是只能猜、或者干脆放弃换算。所以挪到 domain。
 *
 * ## ⚠️ 不完整是可接受的状态
 *
 * 这张表来自学校公开的作息安排，**可能随学期调整**。调用方必须处理
 * "节次不在表里"的情况（`eamsLessonsToCourses` 会把这类课放进 `skipped`
 * 并说明原因，而不是硬塞一个假时刻）。
 */
export const SLOT_TIMES: readonly { slot: number; start: string; end: string }[] = [
  { slot: 1, start: '08:15', end: '09:05' },
  { slot: 2, start: '09:15', end: '10:05' },
  { slot: 3, start: '10:25', end: '11:15' },
  { slot: 4, start: '11:25', end: '12:15' },
  { slot: 5, start: '13:00', end: '13:50' },
  { slot: 6, start: '14:00', end: '14:50' },
  { slot: 7, start: '15:10', end: '16:00' },
  { slot: 8, start: '16:10', end: '17:00' },
  { slot: 9, start: '18:00', end: '18:50' },
  { slot: 10, start: '19:00', end: '19:50' },
]

/**
 * ⚠️ **已知不一致**：`MAX_SLOT = 12` 但 `SLOT_TIMES` 只有 10 节。
 *
 * 后果：加课表单允许选第 11-12 节，但**算不出时刻**（`slotTimeRange` 返回
 * `null`，`timeLabel` 退化成 `--:--`）。从教务导入的课如果落在 11-12 节，
 * 会被放进 `skipped` 并说明原因 —— 不会硬塞一个假时刻。
 *
 * 为什么没直接改 `MAX_SLOT = 10`：那会缩小加课表单的可选范围，
 * 而学校确实有第 11-12 节（晚间）的安排，只是我们**没拿到那两节的准确时刻**。
 * 宁可保留"能选但填不出时间"，也不假装它们不存在。
 */

/** 第 `slot` 节的起止时刻；不在作息表里返回 `null`（**不猜**） */
export function slotTimeRange(slot: number): { start: string; end: string } | null {
  const found = SLOT_TIMES.find((item) => item.slot === slot)
  if (found === undefined) return null
  return { start: found.start, end: found.end }
}

/** 起止节次 → `08:15–10:05`；任一端不在作息表里返回 `null` */
export function slotTimeLabel(startSlot: number, endSlot: number): string | null {
  const start = slotTimeRange(startSlot)
  const end = slotTimeRange(endSlot)
  if (start === null || end === null) return null
  return `${start.start}–${end.end}`
}
