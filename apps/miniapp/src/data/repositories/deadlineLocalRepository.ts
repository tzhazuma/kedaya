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

export interface DeadlineLocalRepository {
  read(): DeadlineItem[]
  write(items: readonly DeadlineItem[]): void
  clear(): void
}

export function createDeadlineLocalRepository(
  cache: CachePort = createTaroStorage(),
): DeadlineLocalRepository {
  return {
    read(): DeadlineItem[] {
      const value = cache.read<unknown>(DEADLINE_LOCAL_STORAGE_KEY)
      if (!Array.isArray(value)) return []
      return value.filter(isDeadlineItem)
    },
    write(items: readonly DeadlineItem[]): void {
      cache.write(DEADLINE_LOCAL_STORAGE_KEY, [...items])
    },
    clear(): void {
      cache.remove(DEADLINE_LOCAL_STORAGE_KEY)
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
