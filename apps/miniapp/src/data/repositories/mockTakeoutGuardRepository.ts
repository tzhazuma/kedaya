import { err, ok, type Result } from '@kedaya/shared'
import type { Page } from '@kedaya/contracts'

import {
  TAKEOUT_GUARD_STATUS,
  detailProblem,
  happenedAtProblem,
  isTakeoutGuardStatus,
  orderNoProblem,
  placeProblem,
} from '../../domain/models/takeoutGuard'
import type {
  CreateTakeoutGuardReportInput,
  TakeoutGuardReport,
  TakeoutGuardReportFilters,
} from '../../domain/models/takeoutGuard'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ListTakeoutGuardReportsQuery,
  TakeoutGuardRepository,
} from '../../domain/ports/takeoutGuardRepository'

/**
 * Mock 偷外卖仓储（`TARO_APP_USE_MOCK !== 'false'` 时启用）。
 *
 * 与"假列表"不同，它**复刻了后端 `TakeoutReportService` 的领域规则**：
 *   · 未登录一律 UNAUTHENTICATED（这个模块没有"游客可读"的路径）；
 *   · 归属：新建的 `reporterId` 恒为当前登录主体，请求体里的归属无从生效；
 *   · 隔离：别人的记录连"存在"都看不到（统一 NOT_FOUND）；
 *   · 状态机：pending → escalated → resolved，非法跃迁返回 CONFLICT；
 *   · 校验：订单号 / 取餐点 / 经过必填限长，发生时间 5 分钟时钟偏差；
 *   · 列表：强制只看自己，只支持 status 精确筛选，新记录在前（createdAt desc + id desc）。
 *
 * 数据集刻意放在**内存**里（`options.seed` 可注入，默认是确定性种子）：
 * 这份演示数据代表"我手机里的记录"，不该跟账号一起被持久化到本机存储；
 * 而且刷新页面后能回到一份干净的演示数据，比留着一堆测试残留更好演示。
 * 需要"刷新不丢"时替换成本模块自己的 `CachePort` 实现即可，页面与用例不用改。
 *
 * 当前用户通过 `viewerId()` 注入 —— 用户从「我的」登录后切换，
 * mock 才能正确判定"这是我记录的吗"。
 */

/** 种子的归属占位：无论用哪个账号登录，演示数据都算"我的记录"（否则登录后一屏空白） */
const MOCK_SELF_ID = 'mock-self'

export interface MockTakeoutGuardRepositoryOptions {
  viewerId: () => string | null
  /** 仅供测试 / 演示：替换数据集，保证用例确定可复现 */
  seed?: readonly TakeoutGuardReport[]
  latencyMs?: number
  now?: () => Date
}

export interface MockTakeoutGuardRepository extends TakeoutGuardRepository {
  readonly kind: 'mock'
  /** 恢复确定性种子并清空失败注入 */
  reset(): void
  /** 让接下来 N 次请求失败（页面用它演示错误态，而不是硬编码假状态） */
  failNextRequests(times: number): void
  /** 清空数据集（演示空态）；`reset()` 之后仍能恢复种子 */
  clearAll(): void
  /** 仅供测试 / 演示：直接替换数据集 */
  seedData(items: readonly TakeoutGuardReport[]): void
}

const MINUTE = 60 * 1000

/**
 * 确定性种子：≥4 条"我的"记录，覆盖三种状态，取餐点 / 时间 / 订单号各不相同。
 *
 * `evidenceUrl` 一律为 null：演示数据里放一个并不存在的图片地址，
 * 只会在详情页显示一张坏图，反而让人以为功能坏了（与 mock 失物招领同一处说明）。
 */
function defaultSeed(now: Date): TakeoutGuardReport[] {
  const iso = (minutesAgo: number): string => new Date(now.getTime() - minutesAgo * MINUTE).toISOString()

  const base: ReadonlyArray<{
    id: string
    orderNo: string
    place: string
    minutesAgo: number
    detail: string
    status: string
    /** 状态变更时间（相对现在多少分钟前；是『已升级/已解决』时间线的依据） */
    updatedAgo: number
  }> = [
    {
      id: 'tg-demo-1',
      orderNo: 'KD2026101501',
      place: '生活区 5 号楼一层外卖架',
      minutesAgo: 130,
      detail: '取餐时发现袋子被拆开，主食和饮料都不见了，旁边只剩下拆开的包装。',
      status: TAKEOUT_GUARD_STATUS.pending,
      updatedAgo: 130,
    },
    {
      id: 'tg-demo-2',
      orderNo: 'KD2026101502',
      place: '二食堂一层外卖柜（北侧窗口）',
      minutesAgo: 20 * 60,
      detail: '按取餐码打开柜门时里面是空的，后来发现同一格被别人的餐盒占着。',
      status: TAKEOUT_GUARD_STATUS.pending,
      updatedAgo: 20 * 60,
    },
    {
      id: 'tg-demo-3',
      orderNo: 'KD2026101503',
      place: '图书馆北门外卖柜',
      minutesAgo: 3 * 24 * 60,
      detail: '连续两次在同一时段丢餐，第二次取餐码还没用就显示已被取走。',
      status: TAKEOUT_GUARD_STATUS.escalated,
      updatedAgo: 2 * 24 * 60,
    },
    {
      id: 'tg-demo-4',
      orderNo: 'KD2026101504',
      place: '生活区 7 号楼外卖架',
      minutesAgo: 5 * 24 * 60,
      detail: '同层同学误拿了我的餐，在群里问过后已经还回来了。',
      status: TAKEOUT_GUARD_STATUS.resolved,
      updatedAgo: 4 * 24 * 60,
    },
    {
      id: 'tg-demo-5',
      orderNo: 'KD2026101505',
      place: '教学楼 A 座一楼外卖架',
      minutesAgo: 8 * 24 * 60,
      detail: '餐放错了架子，我去取的时候已经不在了，后来在隔壁架上找到。',
      status: TAKEOUT_GUARD_STATUS.resolved,
      updatedAgo: 8 * 24 * 60 - 40,
    },
  ]

  return base.map((item) => {
    const happenedAt = iso(item.minutesAgo)
    return {
      id: item.id,
      reporterId: MOCK_SELF_ID,
      orderNo: item.orderNo,
      place: item.place,
      happenedAt,
      detail: item.detail,
      evidenceUrl: null,
      status: item.status,
      // 记录时间略晚于发生时间（先发生、后记录），更接近真实情况
      createdAt: iso(item.minutesAgo - 10),
      updatedAt: iso(item.updatedAgo),
    }
  })
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** 与后端 `normalizeText` 一致：空串 / 未填都归一成 null */
function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = value.trim()
  return text.length === 0 ? null : text
}

export function createMockTakeoutGuardRepository(
  options: MockTakeoutGuardRepositoryOptions,
): MockTakeoutGuardRepository {
  const { viewerId } = options
  const now = options.now ?? (() => new Date())
  const latencyMs = options.latencyMs ?? 180

  const seedSource = (): TakeoutGuardReport[] =>
    options.seed === undefined ? defaultSeed(now()) : [...options.seed]

  let rows: TakeoutGuardReport[] = seedSource()
  let remainingFailures = 0

  async function guard<T>(work: () => Result<T, RepositoryError>): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  /** 种子记录永远算"我"的，其余按建记录时的主体判定归属 */
  function isOwned(row: TakeoutGuardReport): boolean {
    return row.reporterId === MOCK_SELF_ID || row.reporterId === viewerId()
  }

  /** 返回给上层前把种子的占位归属换成当前主体，页面的"是不是我的"判断才成立 */
  function materialize(row: TakeoutGuardReport): TakeoutGuardReport {
    const viewer = viewerId()
    return viewer === null ? row : { ...row, reporterId: viewer }
  }

  function findOwned(id: string): TakeoutGuardReport | null {
    return rows.find((row) => row.id === id && isOwned(row)) ?? null
  }

  function write(next: TakeoutGuardReport): TakeoutGuardReport {
    rows = rows.map((row) => (row.id === next.id ? next : row))
    return next
  }

  function validateCreate(input: CreateTakeoutGuardReportInput): RepositoryError | null {
    const orderNo = orderNoProblem(input.orderNo)
    if (orderNo !== null) {
      return { code: 'VALIDATION_FAILED', message: orderNo, details: { field: 'orderNo' } }
    }

    const place = placeProblem(input.place)
    if (place !== null) {
      return { code: 'VALIDATION_FAILED', message: place, details: { field: 'place' } }
    }

    const detail = detailProblem(input.detail)
    if (detail !== null) {
      return { code: 'VALIDATION_FAILED', message: detail, details: { field: 'detail' } }
    }

    const happenedAt = happenedAtProblem(new Date(input.happenedAt), now())
    if (happenedAt !== null) {
      return { code: 'VALIDATION_FAILED', message: happenedAt, details: { field: 'happenedAt' } }
    }
    return null
  }

  return {
    kind: 'mock',

    list(query: ListTakeoutGuardReportsQuery): Promise<Result<Page<TakeoutGuardReport>, RepositoryError>> {
      return guard(() => {
        const viewer = viewerId()
        if (viewer === null) {
          return err({ code: 'UNAUTHENTICATED', message: '请先登录后再查看记录' })
        }

        const filters: TakeoutGuardReportFilters = query.filters
        if (filters.status !== undefined && !isTakeoutGuardStatus(filters.status)) {
          return err({ code: 'VALIDATION_FAILED', message: '状态不在支持范围内' })
        }

        // 强制只看自己：这里没有 mine 开关，和后端一样不提供看别人的路径
        let items = rows.filter(isOwned)
        if (filters.status !== undefined) {
          items = items.filter((row) => row.status === filters.status)
        }

        // 与后端 buildOrderBy 一致：createdAt desc + id desc（id 兜底防翻页跳项）
        items = [...items].sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        )

        const limit = query.limit ?? 20
        const start =
          query.cursor === null
            ? 0
            : Math.max(0, items.findIndex((row) => row.id === query.cursor) + 1)
        const visible = items.slice(start, start + limit)
        const hasMore = start + limit < items.length

        return ok({
          items: visible.map(materialize),
          nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
        })
      })
    },

    detail(id: string): Promise<Result<TakeoutGuardReport, RepositoryError>> {
      return guard(() => {
        if (viewerId() === null) {
          return err({ code: 'UNAUTHENTICATED', message: '请先登录后再查看记录' })
        }
        const found = findOwned(id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '这条记录不存在，或不属于你' })
        return ok(materialize(found))
      })
    },

    create(input: CreateTakeoutGuardReportInput): Promise<Result<TakeoutGuardReport, RepositoryError>> {
      return guard(() => {
        const viewer = viewerId()
        if (viewer === null) {
          return err({ code: 'UNAUTHENTICATED', message: '记录外卖被拿错需要先登录' })
        }

        const problem = validateCreate(input)
        if (problem !== null) return err(problem)

        const timestamp = now().toISOString()
        const report: TakeoutGuardReport = {
          id: `tg-local-${String(now().getTime())}-${Math.random().toString(36).slice(2, 7)}`,
          // 记录人永远是登录主体，请求体里也没有这个字段（与后端同一规则）
          reporterId: viewer,
          orderNo: input.orderNo.trim(),
          place: input.place.trim(),
          happenedAt: new Date(input.happenedAt).toISOString(),
          detail: normalizeOptionalText(input.detail),
          evidenceUrl: normalizeOptionalText(input.evidenceUrl),
          status: TAKEOUT_GUARD_STATUS.pending,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        rows = [report, ...rows]
        return ok(report)
      })
    },

    escalate(id: string): Promise<Result<TakeoutGuardReport, RepositoryError>> {
      return guard(() => {
        if (viewerId() === null) {
          return err({ code: 'UNAUTHENTICATED', message: '请先登录' })
        }
        const found = findOwned(id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '这条记录不存在，或不属于你' })

        if (found.status === TAKEOUT_GUARD_STATUS.escalated) {
          return err({ code: 'CONFLICT', message: '这条记录已经升级处理，无需重复提交' })
        }
        if (found.status === TAKEOUT_GUARD_STATUS.resolved) {
          return err({ code: 'CONFLICT', message: '已解决的记录不能再升级处理' })
        }

        return ok(
          write({ ...found, status: TAKEOUT_GUARD_STATUS.escalated, updatedAt: now().toISOString() }),
        )
      })
    },

    resolve(id: string): Promise<Result<TakeoutGuardReport, RepositoryError>> {
      return guard(() => {
        if (viewerId() === null) {
          return err({ code: 'UNAUTHENTICATED', message: '请先登录' })
        }
        const found = findOwned(id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '这条记录不存在，或不属于你' })

        if (found.status === TAKEOUT_GUARD_STATUS.resolved) {
          return err({ code: 'CONFLICT', message: '这条记录已经标记为已解决' })
        }

        return ok(
          write({ ...found, status: TAKEOUT_GUARD_STATUS.resolved, updatedAt: now().toISOString() }),
        )
      })
    },

    reset(): void {
      rows = seedSource()
      remainingFailures = 0
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    clearAll(): void {
      rows = []
    },

    seedData(items: readonly TakeoutGuardReport[]): void {
      rows = [...items]
    },
  }
}
