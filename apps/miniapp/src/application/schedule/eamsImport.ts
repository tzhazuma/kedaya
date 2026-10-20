/**
 * 教务 EAMS 课表 → 小程序课表视图
 *
 * ## 为什么需要这一步
 *
 * 合并进来的 `parseEamsTimetable`（来自秦QIN）产出的是 `EamsLesson`：
 * 节次是 `first` / `last`，课程名在 `title`，代码在 `code`。
 *
 * 小程序课表用的是 `ScheduleCourseView`：`startSlot` / `endSlot` / `courseName`，
 * 还要 `timeLabel`（`08:15–10:05`）与 `slotLabel`（`第 1-2 节`）。
 *
 * 这一步就是两边的翻译。**放在 application 层，因为它是有业务含义的映射**，
 * 不是纯粹的字段改名 —— 节次到时刻的换算依赖 `SLOT_OPTIONS` 那张学校作息表。
 *
 * ## ⚠️ 三条不猜
 *
 * 1. **节次超出作息表范围**不猜 —— 那节课会被丢掉，并出现在 `skipped` 里，
 *    而不是硬塞一个假时刻。学校调整作息时会出现这种情况。
 * 2. **没有教师/教室**就留 `null`，不填占位符 —— 页面已经有 `null` 的渲染分支。
 * 3. **周次信息不丢**：`EamsLesson.weeks` 会拼进 `id`，让同一门课的不同周次
 *    成为不同条目（而不是互相覆盖）。
 */

import type { EamsLesson } from '@kedaya/shared'

import { MAX_SLOT, slotTimeLabel, slotTimeRange } from '../../domain/models/schedule'
import type { ScheduleCourseView } from '../../domain/models/schedule'

export interface EamsImportResult {
  /** 可用的课程（已按星期、节次排序） */
  readonly courses: readonly ScheduleCourseView[]
  /** 被跳过的节次（超出作息表范围） */
  readonly skipped: readonly { readonly lesson: EamsLesson; readonly reason: string }[]
}

/**
 * 把 EAMS 的 lesson 列表翻成课表视图。
 *
 * 排序：先按星期，再按起始节次 —— 与周视图的渲染顺序一致，
 * 这样调用方不用再排一次。
 */
export function eamsLessonsToCourses(
  lessons: readonly EamsLesson[],
): EamsImportResult {
  const courses: ScheduleCourseView[] = []
  const skipped: { lesson: EamsLesson; reason: string }[] = []

  for (const lesson of lessons) {
    if (lesson.first < 1 || lesson.last < lesson.first || lesson.last > MAX_SLOT) {
      skipped.push({
        lesson,
        reason: `节次 ${lesson.first}-${lesson.last} 超出学校作息表（1-${MAX_SLOT} 节）`,
      })
      continue
    }

    const label = slotTimeLabel(lesson.first, lesson.last)
    if (label === null) {
      skipped.push({
        lesson,
        reason: `作息表里找不到第 ${lesson.first} 或第 ${lesson.last} 节的时刻`,
      })
      continue
    }

    courses.push({
      // 周次拼进 id：同一门课在不同周次的安排是不同条目
      id: `eams-${lesson.id}`,
      courseName: lesson.code === '' ? lesson.title : `${lesson.title}（${lesson.code}）`,
      // 空串 → null，不填占位符
      teacher: lesson.teacher.trim() === '' ? null : lesson.teacher,
      location: lesson.location.trim() === '' ? null : lesson.location,
      weekday: lesson.weekday,
      startSlot: lesson.first,
      endSlot: lesson.last,
      timeLabel: label,
      slotLabel: lesson.first === lesson.last ? `第 ${lesson.first} 节` : `第 ${lesson.first}-${lesson.last} 节`,
    })
  }

  courses.sort((a, b) => (a.weekday === b.weekday ? a.startSlot - b.startSlot : a.weekday - b.weekday))

  return { courses, skipped }
}
