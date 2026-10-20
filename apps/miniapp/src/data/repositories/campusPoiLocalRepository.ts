import { OSM_CAMPUS_POIS } from '../../application/campusPoi/campusPoiOsm'
import {
  POI_TIME_SLOT_KINDS,
  validatePoiSupplement,
  type CampusPoiSupplement,
  type PoiTimeSlot,
  type PoiTimeSlotKind,
} from '@kedaya/contracts'

import type { CachePort } from '../../domain/ports/cachePort'
import { STORAGE_PREFIX } from '../storage/keys'
import { createTaroStorage } from '../storage/taroStorage'

/**
 * 校园 POI · 本机存储（`Taro.getStorageSync` / `Taro.setStorageSync`）。
 *
 * ## 这一轮为什么只有本机
 *
 * `services/` 里还没有 POI 接口。演示数据（5 条，名字带「【演示】」）
 * 由 `application/campusPoi` 在首次读取时播种，本文件只负责落盘与读回。
 *
 * ## 读取时逐条过契约校验（这是版权红线的落点）
 *
 * storage 是跨版本共享的：旧字段、用户手改、别的页面误写到同一个 key 的
 * 数据都可能存在。这里把每条候选丢进 `validatePoiSupplement()`：
 *   · 越界坐标 / 非法楼层 / 未知分类 → 丢弃；
 *   · **没有 `photoCredit` 的照片 → 整条丢弃**（任何域名，含 `map.niyiwei.com`）。
 *     2026-10-20 起该域名**已获授权**从 `forbiddenOrigins` 移出，
 *     但「必须有署名」这条要求反而更硬了 —— 授权的前提就是署名。
 *   · 有照片但没 `photoCredit` → 丢弃。
 *
 * 也就是说：即使有人把另一参赛组手拍的照片地址写进了 storage，页面也**不会**
 * 渲染它。本文件不下载、不镜像、不内置任何图片。
 *
 * 校验只保证「能安全渲染」；单条坏数据被丢弃，不会让整页炸掉。
 */

/** POI 点位的存储 key（与 deadlineLocalRepository 一样，前缀在文件内声明） */
export const CAMPUS_POI_LOCAL_STORAGE_KEY = `${STORAGE_PREFIX}campus-poi:pois`
/** 时间安排的存储 key（与点位分开：两者生命周期不同） */
export const CAMPUS_POI_SLOT_STORAGE_KEY = `${STORAGE_PREFIX}campus-poi:slots`

export interface CampusPoiLocalRepository {
  readPois(): CampusPoiSupplement[]
  readSlots(): PoiTimeSlot[]
  writePois(pois: readonly CampusPoiSupplement[]): void
  writeSlots(slots: readonly PoiTimeSlot[]): void
  clear(): void
}

export function createCampusPoiLocalRepository(
  cache: CachePort = createTaroStorage(),
): CampusPoiLocalRepository {
  return {
    readPois(): CampusPoiSupplement[] {
      const value = cache.read<unknown>(CAMPUS_POI_LOCAL_STORAGE_KEY)
      const stored = Array.isArray(value) ? value.filter(isCampusPoiSupplement) : []

      // ⚠️ 本机没有数据时，回退到 **OpenStreetMap 真实数据**（ODbL 1.0），
      // 而不是演示数据。理由：演示数据会让人误以为"这里有真实地点"，
      // 而 OSM 的 7 个具名 POI 是**真的**（虽然不含快递站/车库/菜单）。
      //
      // 用户一旦写入了自己的条目，storage 优先，不再回退 —— 否则
      // "删掉某条 OSM 地点"这个动作会无效（下次读又冒出来）。
      if (stored.length === 0) return [...OSM_CAMPUS_POIS]
      return stored
    },
    readSlots(): PoiTimeSlot[] {
      const value = cache.read<unknown>(CAMPUS_POI_SLOT_STORAGE_KEY)
      if (!Array.isArray(value)) return []
      return value.filter(isPoiTimeSlot)
    },
    writePois(pois: readonly CampusPoiSupplement[]): void {
      cache.write(CAMPUS_POI_LOCAL_STORAGE_KEY, [...pois])
    },
    writeSlots(slots: readonly PoiTimeSlot[]): void {
      cache.write(CAMPUS_POI_SLOT_STORAGE_KEY, [...slots])
    },
    clear(): void {
      cache.remove(CAMPUS_POI_LOCAL_STORAGE_KEY)
      cache.remove(CAMPUS_POI_SLOT_STORAGE_KEY)
    },
  }
}

/**
 * 读取守卫：只有**完全通过**契约校验的条目才算数。
 *
 * `validatePoiSupplement` 只读字段、不抛异常（对缺字段 / 错类型都有分支），
 * 所以可以先做记录形状检查再交给它，不需要把合同校验重写一遍。
 */
export function isCampusPoiSupplement(value: unknown): value is CampusPoiSupplement {
  if (!isRecord(value)) return false
  return validatePoiSupplement(value as unknown as CampusPoiSupplement).length === 0
}

/**
 * slot 的形状守卫。
 *
 * 额外要求时间串**带显式时区偏移**（`Z` / `+08:00`）：契约规定生产方必须带，
 * 否则 `Date.parse('2026-10-19 14:00')` 会按设备时区解释 —— 学生在伦敦
 * 会看到和学校差 8 小时的「下一站」，而且不会报任何错。
 */
export function isPoiTimeSlot(value: unknown): value is PoiTimeSlot {
  if (!isRecord(value)) return false

  return (
    isNonEmptyString(value.poiId) &&
    isAbsoluteIso(value.startsAt) &&
    isAbsoluteIso(value.endsAt) &&
    Date.parse(value.endsAt) > Date.parse(value.startsAt) &&
    isSlotKind(value.kind) &&
    typeof value.title === 'string' &&
    (value.sourceRef === null || typeof value.sourceRef === 'string')
  )
}

function isAbsoluteIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!Number.isFinite(Date.parse(value))) return false
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
}

function isSlotKind(value: unknown): value is PoiTimeSlotKind {
  return typeof value === 'string' && (POI_TIME_SLOT_KINDS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}
