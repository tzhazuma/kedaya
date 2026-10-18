import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import {
  FACILITY_STATUS,
  feeProblem,
  facilityNameProblem,
  kindProblem,
  timeRangeProblem,
} from '../../domain/models/facility'
import type { CreateFacilityBookingInput, FacilityBooking } from '../../domain/models/facility'
import type { RepositoryError } from '../../domain/ports/errors'
import type { FacilityRepository } from '../../domain/ports/facilityRepository'

/**
 * 场馆预约 · 内存 mock。
 *
 * **刻意不用 localStorage**：预约是"谁在什么时段占了哪个场馆"的事实，
 * 把 mock 写进本地存储会让不同用户看到彼此的假数据，且清缓存后消失。
 * 内存版每次启动都是干净的演示数据，语义更诚实。
 *
 * 冲突检测**在这里实现了一份**（与服务端同规则：同时段同场馆重叠即冲突），
 * 目的是让 mock 也能演示 409 分支 —— 否则"名额冲突"这条最关键的路径
 * 在 mock 模式下永远走不到。
 */

interface MockOptions {
  readonly now?: () => Date
  readonly seed?: readonly FacilityBooking[]
}

const HOUR = 60 * 60 * 1000

export function createMockFacilityRepository(options: MockOptions = {}): FacilityRepository {
  const now = options.now ?? ((): Date => new Date())
  let seq = 0;
  const rows: FacilityBooking[] = [...(options.seed ?? [])]

  function nextId(): string {
    seq += 1
    return `facility-mock-${seq}`
  }

  function find(id: string): FacilityBooking | undefined {
    return rows.find((row) => row.id === id)
  }

  /** 与服务端 `findOverlapping` 同规则：同场馆 + 时段重叠 + 未取消 */
  function hasConflict(
    kind: string,
    facilityName: string | null,
    startsAt: string,
    endsAt: string,
  ): FacilityBooking | null {
    const start = new Date(startsAt).getTime()
    const end = new Date(endsAt).getTime()
    for (const row of rows) {
      if (row.status !== FACILITY_STATUS.booked) continue
      if (row.kind !== kind) continue
      if ((row.facilityName ?? null) !== (facilityName ?? null)) continue
      const rs = new Date(row.startsAt).getTime()
      const re = new Date(row.endsAt).getTime()
      if (start < re && end > rs) return row
    }
    return null
  }

  return {
    async list({ cursor, limit }): Promise<Result<Page<FacilityBooking>, RepositoryError>> {
      const sorted = [...rows].sort(
        (a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
      )
      const offset = cursor === null ? 0 : Number.parseInt(cursor, 10) || 0
      const slice = sorted.slice(offset, offset + limit)
      const nextOffset = offset + slice.length
      return ok({
        items: slice,
        nextCursor: nextOffset < sorted.length ? String(nextOffset) : null,
      })
    },

    async detail(id): Promise<Result<FacilityBooking, RepositoryError>> {
      const row = find(id)
      if (row === undefined) return err({ code: 'NOT_FOUND', message: '预约不存在' })
      return ok(row)
    },

    async create(input: CreateFacilityBookingInput): Promise<Result<FacilityBooking, RepositoryError>> {
      const problem =
        kindProblem(input.kind) ??
        facilityNameProblem(input.facilityName) ??
        timeRangeProblem(input.startsAt, input.endsAt, now()) ??
        feeProblem(input.feeFen)
      if (problem !== null) return err({ code: 'VALIDATION_FAILED', message: problem })

      const conflict = hasConflict(
        input.kind,
        input.facilityName ?? null,
        input.startsAt,
        input.endsAt,
      )
      if (conflict !== null) {
        return err({ code: 'CONFLICT', message: '该时段已被预约' })
      }

      const at = now().toISOString()
      const row: FacilityBooking = {
        id: nextId(),
        // mock 没有真实登录态时的兜底；容器注入当前用户时会覆盖
        ownerId: 'me',
        kind: input.kind,
        facilityName: input.facilityName ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        status: FACILITY_STATUS.booked,
        feeFen: input.feeFen,
        createdAt: at,
        updatedAt: at,
      }
      rows.push(row)
      return ok(row)
    },

    async cancel(id): Promise<Result<FacilityBooking, RepositoryError>> {
      const row = find(id)
      if (row === undefined) return err({ code: 'NOT_FOUND', message: '预约不存在' })
      if (row.status !== FACILITY_STATUS.booked) {
        return err({ code: 'CONFLICT', message: '该预约当前状态不可取消' })
      }
      const updated: FacilityBooking = {
        ...row,
        status: FACILITY_STATUS.cancelled,
        updatedAt: now().toISOString(),
      }
      const index = rows.findIndex((r) => r.id === id)
      rows[index] = updated
      return ok(updated)
    },
  }
}

/** 演示种子：覆盖"已预约"与"已取消"两种状态，方便看状态徽章 */
export function seedFacilityBookings(now: Date = new Date()): FacilityBooking[] {
  const at = now.toISOString()
  const mk = (
    id: string,
    kind: string,
    facilityName: string,
    startOffsetHours: number,
    status: string,
    feeFen: number,
  ): FacilityBooking => ({
    id,
    ownerId: 'me',
    kind,
    facilityName,
    startsAt: new Date(now.getTime() + startOffsetHours * HOUR).toISOString(),
    endsAt: new Date(now.getTime() + (startOffsetHours + 1) * HOUR).toISOString(),
    status,
    feeFen,
    createdAt: at,
    updatedAt: at,
  })

  return [
    mk('facility-seed-1', '羽毛球馆', '上海科技大学体育馆', 24, FACILITY_STATUS.booked, 2000),
    mk('facility-seed-2', '健身房', '上海科技大学体育馆', 48, FACILITY_STATUS.booked, 0),
    mk('facility-seed-3', '会议室', '学生活动中心 201', -24, FACILITY_STATUS.cancelled, 0),
  ]
}
