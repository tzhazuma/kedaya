import { err, ok, type Result } from '@kedaya/shared'
import type { Page } from '@kedaya/contracts'

import {
  CRISIS_FALLBACK,
  WELLBEING_DEFAULT_MODE,
  WELLBEING_MODES,
  WELLBEING_STATUS,
  counselorProblem,
  isWellbeingStatus,
  noteProblem,
  slotAtProblem,
} from '../../domain/models/wellbeing'
import type {
  CreateWellbeingAppointmentInput,
  WellbeingAppointment,
  WellbeingAppointmentFilters,
  WellbeingCrisisLine,
} from '../../domain/models/wellbeing'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ListWellbeingAppointmentsQuery,
  WellbeingConsentRecord,
  WellbeingRepository,
} from '../../domain/ports/wellbeingRepository'

/**
 * Mock 心理支持仓储（`TARO_APP_USE_MOCK !== 'false'` 时启用）。
 *
 * 与"假列表"不同，它**复刻了后端 `WellbeingService` 的领域规则**，
 * 尤其是两条前端最容易演示不出来的：
 *   · **同意门在服务端也存在**：没有 `grantConsent()` 之前，列表 / 详情 / 创建 / 取消
 *     一律 `CONSENT_REQUIRED` —— 这样"本地同意 + 服务端留痕"这条双轨在离线时也能被走通；
 *   · **归属只认当前登录主体**：别人的预约连"存在"都看不到（统一 NOT_FOUND），
 *     列表强制只看自己。
 *
 * 数据集刻意放在**内存**里（`options.seed` 可注入，默认是确定性种子）：
 * 这份演示数据代表"我手机里的预约"，不该跟账号一起被持久化到本机存储，
 * 而且刷新页面后能回到一份干净的演示数据，比留着一堆测试残留更好演示。
 * 需要"刷新不丢"时替换成本模块自己的 `CachePort` 实现即可，页面与用例不用改。
 *
 * 当前用户通过 `viewerId()` 注入 —— 用户从「我的」登录后切换，
 * mock 才能正确判定"这是我约的吗"。
 */

/** 种子的归属占位：无论用哪个账号登录，演示数据都算"我的预约"（否则登录后一屏空白） */
const MOCK_SELF_ID = 'mock-self'

export interface MockWellbeingRepositoryOptions {
  viewerId: () => string | null
  /** 仅供测试 / 演示：替换数据集，保证用例确定可复现 */
  seed?: readonly WellbeingAppointment[]
  latencyMs?: number
  now?: () => Date
}

export interface MockWellbeingRepository extends WellbeingRepository {
  readonly kind: 'mock'
  /** 恢复确定性种子、清空失败注入、并把"服务端同意"重置为未同意 */
  reset(): void
  /** 让接下来 N 次请求失败（页面用它演示错误态，而不是硬编码假状态） */
  failNextRequests(times: number): void
  /** 清空数据集（演示空态）；`reset()` 之后仍能恢复种子 */
  clearAll(): void
  /** 仅供测试 / 演示：直接替换数据集 */
  seedData(items: readonly WellbeingAppointment[]): void
  /**
   * 仅供演示：把**服务端**同意抹掉，而本地留痕保持不动。
   *
   * 用来走通"本地以为同意了、服务端其实没有 → 立刻清空缓存并重新过同意门"
   * 这条对齐路径（`wellbeingUseCases` 里的 `needsConsent` 分支）。
   */
  revokeServerConsent(): void
}

const MINUTE = 60 * 1000

/**
 * 确定性种子：4 条"我的"预约，覆盖四种状态。
 *
 * 内容刻意**克制、不猎奇**：演示数据里不写自伤细节，也不写具体人名与院系 ——
 * 万一被截图传播，它就是一条普通的校园咨询预约。
 * 摘要全部一句大白话，不做任何"标签化"的描述。
 */
function defaultSeed(now: Date): WellbeingAppointment[] {
  const at = (minutesFromNow: number): string =>
    new Date(now.getTime() + minutesFromNow * MINUTE).toISOString()
  const ago = (minutes: number): string => at(-minutes)

  const base: ReadonlyArray<{
    id: string
    counselor: string
    slotOffset: number
    mode: string
    status: string
    note: string | null
    createdOffset: number
    crisisFlag: boolean
  }> = [
    {
      id: 'wb-demo-1',
      counselor: '李老师',
      slotOffset: 2 * 24 * 60,
      mode: 'onsite',
      status: WELLBEING_STATUS.confirmed,
      note: '这学期课程排得比较满，想找人一起把作息和优先级理一理。',
      createdOffset: -4 * 24 * 60,
      crisisFlag: false,
    },
    {
      id: 'wb-demo-2',
      counselor: '中心值班老师（不限）',
      slotOffset: 5 * 24 * 60,
      mode: 'online',
      status: WELLBEING_STATUS.requested,
      note: '最近有点提不起劲，想聊一次看看是不是我想多了。',
      createdOffset: -6 * 60,
      crisisFlag: false,
    },
    {
      id: 'wb-demo-3',
      counselor: '王老师',
      slotOffset: -21 * 24 * 60,
      mode: 'onsite',
      status: WELLBEING_STATUS.completed,
      note: '上次聊完之后心里松快了不少，记一笔。',
      createdOffset: -24 * 24 * 60,
      crisisFlag: false,
    },
    {
      id: 'wb-demo-4',
      counselor: '中心值班老师（不限）',
      slotOffset: -3 * 24 * 60,
      mode: 'onsite',
      status: WELLBEING_STATUS.cancelled,
      note: null,
      createdOffset: -5 * 24 * 60,
      crisisFlag: false,
    },
  ]

  return base.map((item) => ({
    id: item.id,
    userId: MOCK_SELF_ID,
    counselor: item.counselor,
    slotAt: at(item.slotOffset),
    mode: item.mode,
    status: item.status,
    note: item.note,
    crisisFlag: item.crisisFlag,
    createdAt: item.createdOffset < 0 ? ago(-item.createdOffset) : at(item.createdOffset),
    updatedAt: item.createdOffset < 0 ? ago(-item.createdOffset) : at(item.createdOffset),
  }))
}

/**
 * 模拟服务端的危机出口（与后端 `WELLBEING_CRISIS_CONFIG` 同形状）。
 *
 * 直接以 `CRISIS_FALLBACK` 为底再补一条热线：兜底数据与接口数据本来就是同源的一份，
 * 演示时不该出现"mock 里的号码和断网时的号码不一样"。
 */
function mockCrisisLine(): WellbeingCrisisLine {
  return {
    ...CRISIS_FALLBACK,
    hotlines: [
      ...CRISIS_FALLBACK.hotlines.map((hotline) => ({ ...hotline })),
      { name: '希望 24 热线（全国）', number: '400-161-9995' },
    ],
    channels: CRISIS_FALLBACK.channels.map((channel) => ({ ...channel })),
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** 与后端 `normalizeNote` 一致：空串 / 未填都归一成 null */
function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = value.trim()
  return text.length === 0 ? null : text
}

export function createMockWellbeingRepository(
  options: MockWellbeingRepositoryOptions,
): MockWellbeingRepository {
  const { viewerId } = options
  const now = options.now ?? (() => new Date())
  const latencyMs = options.latencyMs ?? 180

  const seedSource = (): WellbeingAppointment[] =>
    options.seed === undefined ? defaultSeed(now()) : [...options.seed]

  let rows: WellbeingAppointment[] = seedSource()
  let remainingFailures = 0
  /**
   * "服务端"同意状态。
   *
   * 刻意**不**跟着本地留痕走：本地同意（`StorageKeys.consent`）由用例层管，
   * 这里代表后端 `Consent` 表。两者分开才能在 mock 里演示出
   * "本地有、服务端没有 → 重新过同意门"的真实分支。
   */
  let serverConsent: WellbeingConsentRecord | null = null

  async function guard<T>(work: () => Result<T, RepositoryError>): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  /**
   * 数据类请求的统一前置检查：先登录、再同意。
   *
   * 顺序刻意与后端一致（`AuthGuard` 在前，`requireConsent` 在后）：
   * 未登录得到 `UNAUTHENTICATED`（页面引导登录），已登录但没同意得到
   * `CONSENT_REQUIRED`（页面弹同意门）。两者混在一起会让用户看到错误的下一步。
   */
  function gate(): RepositoryError | null {
    if (viewerId() === null) {
      return { code: 'UNAUTHENTICATED', message: '请先登录后再查看预约' }
    }
    if (serverConsent === null || serverConsent.revokedAt !== null) {
      return {
        code: 'CONSENT_REQUIRED',
        message: '使用心理支持模块前需要你先明确同意',
        details: { module: 'wellbeing' },
      }
    }
    return null
  }

  /** 种子记录永远算"我"的，其余按建记录时的主体判定归属 */
  function isOwned(row: WellbeingAppointment): boolean {
    return row.userId === MOCK_SELF_ID || row.userId === viewerId()
  }

  /** 返回给上层前把种子的占位归属换成当前主体，页面的"是不是我的"判断才成立 */
  function materialize(row: WellbeingAppointment): WellbeingAppointment {
    const viewer = viewerId()
    return viewer === null ? row : { ...row, userId: viewer }
  }

  function findOwned(id: string): WellbeingAppointment | null {
    return rows.find((row) => row.id === id && isOwned(row)) ?? null
  }

  function write(next: WellbeingAppointment): WellbeingAppointment {
    rows = rows.map((row) => (row.id === next.id ? next : row))
    return next
  }

  function validateCreate(input: CreateWellbeingAppointmentInput): RepositoryError | null {
    const counselor = counselorProblem(input.counselor)
    if (counselor !== null) {
      return { code: 'VALIDATION_FAILED', message: counselor, details: { field: 'counselor' } }
    }

    if (input.mode !== undefined && !(WELLBEING_MODES as readonly string[]).includes(input.mode)) {
      return { code: 'VALIDATION_FAILED', message: '预约方式不在支持范围内', details: { field: 'mode' } }
    }

    const note = noteProblem(input.note ?? '')
    if (note !== null) {
      return { code: 'VALIDATION_FAILED', message: note, details: { field: 'note' } }
    }

    const slotAt = new Date(input.slotAt)
    const slot = slotAtProblem(slotAt, now())
    if (slot !== null) {
      return { code: 'VALIDATION_FAILED', message: slot, details: { field: 'slotAt' } }
    }
    return null
  }

  return {
    kind: 'mock',

    /** 危机出口不受任何门槛限制：未登录、未同意都必须拿得到 */
    crisisLine(): Promise<Result<WellbeingCrisisLine, RepositoryError>> {
      return guard(() => ok(mockCrisisLine()))
    },

    list(
      query: ListWellbeingAppointmentsQuery,
    ): Promise<Result<Page<WellbeingAppointment>, RepositoryError>> {
      return guard(() => {
        const blocked = gate()
        if (blocked !== null) return err(blocked)

        const filters: WellbeingAppointmentFilters = query.filters
        if (filters.status !== undefined && !isWellbeingStatus(filters.status)) {
          return err({ code: 'VALIDATION_FAILED', message: '状态不在支持范围内' })
        }

        // 强制只看自己：这里没有 mine 开关，和后端一样不提供看别人的路径
        let items = rows.filter(isOwned)
        if (filters.status !== undefined) {
          items = items.filter((row) => row.status === filters.status)
        }

        // 与后端 buildOrderBy 一致：预约时间新 → 旧，id 兜底防翻页跳项
        items = [...items].sort((a, b) => b.slotAt.localeCompare(a.slotAt) || b.id.localeCompare(a.id))

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

    detail(id: string): Promise<Result<WellbeingAppointment, RepositoryError>> {
      return guard(() => {
        const blocked = gate()
        if (blocked !== null) return err(blocked)

        const found = findOwned(id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '这条预约不存在，或不属于你' })
        return ok(materialize(found))
      })
    },

    create(
      input: CreateWellbeingAppointmentInput,
    ): Promise<Result<WellbeingAppointment, RepositoryError>> {
      return guard(() => {
        const blocked = gate()
        if (blocked !== null) return err(blocked)

        const problem = validateCreate(input)
        if (problem !== null) return err(problem)

        const timestamp = now().toISOString()
        const viewer = viewerId() ?? MOCK_SELF_ID
        const appointment: WellbeingAppointment = {
          id: `wb-local-${String(now().getTime())}-${Math.random().toString(36).slice(2, 7)}`,
          // 归属永远是登录主体（服务端同一规则；请求体里也没有这个字段）
          userId: viewer,
          counselor: input.counselor.trim(),
          slotAt: new Date(input.slotAt).toISOString(),
          mode: input.mode ?? WELLBEING_DEFAULT_MODE,
          status: WELLBEING_STATUS.requested,
          note: normalizeOptionalText(input.note),
          crisisFlag: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        rows = [appointment, ...rows]
        return ok(appointment)
      })
    },

    cancel(id: string): Promise<Result<WellbeingAppointment, RepositoryError>> {
      return guard(() => {
        const blocked = gate()
        if (blocked !== null) return err(blocked)

        const found = findOwned(id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '这条预约不存在，或不属于你' })

        if (found.status === WELLBEING_STATUS.cancelled) {
          return err({ code: 'CONFLICT', message: '这条预约已经取消，无需重复操作' })
        }
        if (found.status === WELLBEING_STATUS.completed) {
          return err({ code: 'CONFLICT', message: '已完成的预约不能取消' })
        }
        if (found.status !== WELLBEING_STATUS.requested && found.status !== WELLBEING_STATUS.confirmed) {
          return err({ code: 'CONFLICT', message: '当前状态不能取消' })
        }

        return ok(
          write({ ...found, status: WELLBEING_STATUS.cancelled, updatedAt: now().toISOString() }),
        )
      })
    },

    grantConsent(): Promise<Result<WellbeingConsentRecord, RepositoryError>> {
      return guard(() => {
        if (viewerId() === null) {
          return err({ code: 'UNAUTHENTICATED', message: '同意需要先登录（否则无法留下合规记录）' })
        }
        serverConsent = {
          id: 'mock-consent-wellbeing',
          module: 'wellbeing',
          version: 'v1',
          grantedAt: now().toISOString(),
          revokedAt: null,
        }
        return ok(serverConsent)
      })
    },

    revokeConsent(): Promise<Result<WellbeingConsentRecord | null, RepositoryError>> {
      return guard(() => {
        if (viewerId() === null) {
          return err({ code: 'UNAUTHENTICATED', message: '撤回同意需要先登录' })
        }
        if (serverConsent === null) return ok(null)
        serverConsent = { ...serverConsent, revokedAt: now().toISOString() }
        return ok(serverConsent)
      })
    },

    activeConsent(): Promise<Result<boolean, RepositoryError>> {
      return guard(() => {
        if (viewerId() === null) {
          return err({ code: 'UNAUTHENTICATED', message: '请先登录' })
        }
        return ok(serverConsent !== null && serverConsent.revokedAt === null)
      })
    },

    reset(): void {
      rows = seedSource()
      remainingFailures = 0
      serverConsent = null
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    clearAll(): void {
      rows = []
    },

    seedData(items: readonly WellbeingAppointment[]): void {
      rows = [...items]
    },

    revokeServerConsent(): void {
      serverConsent = null
    },
  }
}
