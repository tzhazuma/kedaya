import { sanitizeSourceUrl, type SemesterWeekCalendar } from '@kedaya/shared'
import {
  DEADLINE_KINDS,
  DEADLINE_SOURCES,
  type DeadlineItem,
  type DeadlineKind,
  type DeadlineSource,
} from '@kedaya/contracts'

import type { CachePort } from '../../domain/ports/cachePort'
import { STORAGE_PREFIX } from '../storage/keys'
import { createTaroStorage } from '../storage/taroStorage'

/**
 * DDL 条目 · 本机存储（`Taro.getStorageSync` / `Taro.setStorageSync`）。
 *
 * ## 为什么这一轮只有本机
 *
 * `services/` 里还没有 DDL 模块，这一版**刻意不建后端接口**：先让用户把
 * 各平台的作业列表粘进来、在这台手机上看到「今天要交什么」。
 * 写入方（粘贴解析页 / 手动添加）与读取方（DDL 聚合页）共用本文件的两个函数，
 * 这样「粘贴完回列表」不需要任何全局状态，storage 就是唯一真相。
 *
 * ## 为什么读的时候要过滤
 *
 * storage 是跨版本共享的：上一版写入的字段、用户手改过的值、被别的页面
 * 误写到同一个 key 的数据都可能存在。这里逐条校验**形状**（字段名与枚举来自
 * `@kedaya/contracts`），坏条目丢弃而不是让整页炸掉 —— 一条脏缓存不应该
 * 变成「DDL 页打不开」。
 *
 * 校验只保证「能安全渲染」：`dueAt` 解析不出来的条目仍然保留，
 * 视图层会显示「时间待定」并按「未知」沉到列表最后（不猜、不丢）。
 */

/** 存储 key（带 schema 版本前缀，与其他本机缓存同一套命名） */
export const DEADLINE_LOCAL_STORAGE_KEY = `${STORAGE_PREFIX}deadlines:items`

/**
 * 学期日历的存储键（第一周从哪天开始）。
 *
 * ⚠️ 这是**独立于条目的一份设置**，不是 deadline 的一部分：
 * 换学期时用户只改这个日期，所有条目的「第 N 周」会自动跟着重算。
 * 存在条目里会导致改一次学期要写全部条目。
 */
export const DEADLINE_LOCAL_SEMESTER_KEY = `${STORAGE_PREFIX}deadlines:semester`

export interface DeadlineLocalRepository {
  read(): DeadlineItem[]
  write(items: readonly DeadlineItem[]): void
  clear(): void
  /**
   * 学期日历（第一周从哪天开始）。
   *
   * ⚠️ **可选方法**：不实现也能用，页面就只是不显示「第 N 周」。
   * 这样不用为了一个附加信息去改所有测试里的假 store。
   */
  readSemesterCalendar?(): SemesterWeekCalendar | null
  writeSemesterCalendar?(calendar: SemesterWeekCalendar | null): void
}

export function createDeadlineLocalRepository(
  cache: CachePort = createTaroStorage(),
): DeadlineLocalRepository {
  return {
    read(): DeadlineItem[] {
      const value = cache.read<unknown>(DEADLINE_LOCAL_STORAGE_KEY)
      if (!Array.isArray(value)) return []
      // 读时再清洗一次：storage 里可能躺着本次改动**之前**写入的带令牌 URL。
      // 这是防御性的第二道，不是冗余 —— 旧数据的清除只能靠读路径。
      return value.filter(isDeadlineItem).map((item) => {
        const sanitized = sanitizeSourceUrl(item.sourceUrl)
        return sanitized === item.sourceUrl ? item : { ...item, sourceUrl: sanitized ?? '' }
      })
    },
    write(items: readonly DeadlineItem[]): void {
      // ⚠️ **落盘前必须清洗 `sourceUrl`**。
      //
      // 回源链接可能是用户从浏览器复制的，形如
      // `https://courses.example.edu/assignments?ticket=ST-…&session=…`。
      // 把这种 URL 存进本机、再渲染到页面上，等于把会话令牌写进了设备存储。
      //
      // `sanitizeSourceUrl`（从 AgenticCampus 合并，见
      // `docs/architecture/12-merged-from-classmates.md`）会剥掉
      // ticket / session / token 等参数，保留可点开的回源地址。
      cache.write(
        DEADLINE_LOCAL_STORAGE_KEY,
        items.map((item) => {
          const sanitized = sanitizeSourceUrl(item.sourceUrl)
          // 清洗后为空（比如整条 URL 只有令牌）→ 存空串，不存原始值。
          return sanitized === item.sourceUrl ? item : { ...item, sourceUrl: sanitized ?? '' }
        }),
      )
    },
    clear(): void {
      cache.remove(DEADLINE_LOCAL_STORAGE_KEY)
    },

    /**
     * 读学期日历。
     *
     * ⚠️ 三条失败路径都返回 `null`，不抛错：
     * 1. 没存过
     * 2. 形状不对（用户手改过 storage，或旧版本遗留）
     * 3. `firstWeekStart` 不是 `YYYY-MM-DD`
     *
     * 理由：「第 N 周」是**附加信息**。为了它让整个 DDL 页面打不开是荒谬的。
     */
    readSemesterCalendar(): { firstWeekStart: string; weekStartsOn?: 1 | 2 | 3 | 4 | 5 | 6 | 7 } | null {
      const raw = cache.read<unknown>(DEADLINE_LOCAL_SEMESTER_KEY)
      if (raw === null || typeof raw !== 'object') return null
      const value = raw as { firstWeekStart?: unknown; weekStartsOn?: unknown }
      if (typeof value.firstWeekStart !== 'string') return null
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value.firstWeekStart)) return null
      const startsOn = value.weekStartsOn
      const valid =
        typeof startsOn === 'number' && startsOn >= 1 && startsOn <= 7
          ? (startsOn as 1 | 2 | 3 | 4 | 5 | 6 | 7)
          : undefined
      return valid === undefined
        ? { firstWeekStart: value.firstWeekStart }
        : { firstWeekStart: value.firstWeekStart, weekStartsOn: valid }
    },

    /** 写学期日历；`null` 表示清除（回到「不显示第 N 周」） */
    writeSemesterCalendar(
      calendar: { firstWeekStart: string; weekStartsOn?: 1 | 2 | 3 | 4 | 5 | 6 | 7 } | null,
    ): void {
      if (calendar === null) {
        cache.remove(DEADLINE_LOCAL_SEMESTER_KEY)
        return
      }
      cache.write(DEADLINE_LOCAL_SEMESTER_KEY, calendar)
    },
  }
}

/** 导出给单测与将来的粘贴页复用（写入前校验，避免把半成品结构写到 storage） */
export function isDeadlineItem(value: unknown): value is DeadlineItem {
  if (!isRecord(value)) return false

  return (
    isNonEmptyString(value.id) &&
    isSource(value.source) &&
    isKind(value.kind) &&
    typeof value.title === 'string' &&
    typeof value.courseId === 'string' &&
    typeof value.courseName === 'string' &&
    isAbsoluteIso(value.dueAt) &&
    typeof value.dueAtRaw === 'string' &&
    typeof value.sourceUrl === 'string' &&
    typeof value.submitted === 'boolean' &&
    (value.weight === null || typeof value.weight === 'number') &&
    (value.stale === undefined || typeof value.stale === 'boolean')
  )
}

/**
 * `dueAt` 必须是**带显式偏移**的 ISO 串（契约：ISO-8601 UTC，如 `...Z`）。
 *
 * 这一条是时区事故的防线：`Date.parse('2026-10-20 23:59')` 在 V8 里是合法的，
 * 但会按**设备时区**解释。这样的值一旦进列表，学生在伦敦会看到比平台早 8 小时的
 * 截止时间，而且不会报任何错。宁可丢弃这条（视图层仍显示「时间待定」的机会
 * 只留给解析失败的绝对时刻），也不渲染一个可能误导的本地时间。
 */
function isAbsoluteIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!Number.isFinite(Date.parse(value))) return false
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isSource(value: unknown): value is DeadlineSource {
  return typeof value === 'string' && (DEADLINE_SOURCES as readonly string[]).includes(value)
}

function isKind(value: unknown): value is DeadlineKind {
  return typeof value === 'string' && (DEADLINE_KINDS as readonly string[]).includes(value)
}
