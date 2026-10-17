import type { CampusIdentityView, CampusOverview, CampusPlatform } from '../../domain/models/identity'
import type { CardLostReport, CardOverview } from '../../domain/models/campusCard'
import type { CreateCourseInput, ScheduleSyncResult, ScheduleTodayView, ScheduleWeekView } from '../../domain/models/schedule'
import type { CachePort } from '../../domain/ports/cachePort'
import type { CampusCardRepository } from '../../domain/ports/campusCardRepository'
import type { ClockPort } from '../../domain/ports/clockPort'
import { needsCampusBinding } from '../../domain/ports/errors'
import type { IdentityRepository } from '../../domain/ports/identityRepository'
import type { ScheduleRepository } from '../../domain/ports/scheduleRepository'

/**
 * 身份 / 课表 / 校园卡 三个用例（合在一个文件里，因为它们共享同一套「校园第二级」语义）。
 *
 * 三者都是**读多写少、上游随时会挂**的数据，所以统一采用契约 §8 的时序：
 *   1. `hydrate()` 同步读缓存 → 页面立刻有内容（不闪骨架、不显示空白）；
 *   2. `load()` 后台请求 → 成功替换；失败**保留缓存**并标注时间与原因；
 *   3. 上游/绑定类错误单独归类（`needsBinding`），页面据此给"去绑定"而不是"重试"。
 *
 * 一条硬规则：**任何失败都不会把已有数据清成空**。
 * 用户宁可看到"3 小时前的余额"，也不要看到一个 0.00 或空列表。
 */

export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

/* ================================================================== *
 * 身份
 * ================================================================== */

export interface IdentityState {
  status: AsyncStatus
  overview: CampusOverview | null
  /** 实名信息（默认是脱敏视图） */
  identity: CampusIdentityView | null
  /** 正在展开明文（请求中） */
  revealing: boolean
  /** 正在绑定/解绑的平台 */
  busyPlatform: CampusPlatform | null
  error: string | null
  /** 错误原因需要用户先绑定校园系统（而不是重试） */
  needsBinding: boolean
  fromCache: boolean
  updatedAt: string | null
}

export interface IdentityUseCase {
  getSnapshot(): IdentityState
  subscribe(listener: () => void): () => void
  hydrate(): IdentityState
  load(): Promise<IdentityState>
  /** 展开/收起实名明文（展开会写服务端审计）；再次调用 `reveal=false` 收起 */
  reveal(reveal: boolean): Promise<IdentityState>
  bind(platform: CampusPlatform): Promise<IdentityState>
  unbind(platform: CampusPlatform): Promise<IdentityState>
}

/* ================================================================== *
 * 课表
 * ================================================================== */

export interface ScheduleState {
  status: AsyncStatus
  today: ScheduleTodayView | null
  week: ScheduleWeekView | null
  /** 正在同步教务系统 */
  syncing: boolean
  /** 当前查看的学期（null = 本学期） */
  term: string | null
  error: string | null
  needsBinding: boolean
  fromCache: boolean
  updatedAt: string | null
  /** 上次同步成功的结果（用于 toast 文案） */
  lastSync: ScheduleSyncResult | null
}

export interface ScheduleUseCase {
  getSnapshot(): ScheduleState
  subscribe(listener: () => void): () => void
  hydrate(): ScheduleState
  /** 今日 + 本周一起拉（页面首屏） */
  load(term?: string): Promise<ScheduleState>
  /** 只刷新今日（下拉刷新更快） */
  loadToday(term?: string): Promise<ScheduleState>
  switchTerm(term: string | null): Promise<ScheduleState>
  sync(): Promise<ScheduleState>
  addCourse(input: Omit<CreateCourseInput, 'term'> & { term?: string }): Promise<{ ok: boolean; message: string }>
}

/* ================================================================== *
 * 校园卡
 * ================================================================== */

export interface CampusCardState {
  status: AsyncStatus
  overview: CardOverview | null
  lostReport: CardLostReport | null
  loadingLost: boolean
  error: string | null
  needsBinding: boolean
  fromCache: boolean
  /** 缓存数据的时间（断网兜底时展示，避免用户误以为是实时余额） */
  updatedAt: string | null
}

export interface CampusCardUseCase {
  getSnapshot(): CampusCardState
  subscribe(listener: () => void): () => void
  hydrate(): CampusCardState
  load(): Promise<CampusCardState>
  reportLost(reason?: string): Promise<CampusCardState>
  closeLostReport(): void
}

export interface CampusUseCasesDeps {
  identityRepository: IdentityRepository
  scheduleRepository: ScheduleRepository
  campusCardRepository: CampusCardRepository
  cache: CachePort
  clock: ClockPort
  viewerId: () => string | null
  /**
   * 缓存 key 由**装配层**提供（契约 §7：application 不得 import `data/**`）。
   * `identity` 是函数：缓存按用户分开，多账号切换时不会串味。
   */
  cacheKeys: {
    identity(owner: string): string
    scheduleToday: string
    scheduleWeek: string
    campusCard: string
  }
}

export interface CampusUseCases {
  identity: IdentityUseCase
  schedule: ScheduleUseCase
  campusCard: CampusCardUseCase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function store<T>(initial: T) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: (): T => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    patch(next: Partial<T>): T {
      state = { ...state, ...next }
      for (const listener of listeners) listener()
      return state
    },
    replace(next: T): T {
      state = next
      for (const listener of listeners) listener()
      return state
    },
  }
}

/** 缓存形状校验：缓存可能由旧版本写入，宁可丢弃也不要喂给页面 */
function isOverview(value: unknown): value is CampusOverview {
  return isRecord(value) && Array.isArray(value.platforms)
}

function isTodayView(value: unknown): value is ScheduleTodayView {
  return isRecord(value) && typeof value.term === 'string' && Array.isArray(value.courses)
}

function isWeekView(value: unknown): value is ScheduleWeekView {
  return isRecord(value) && typeof value.term === 'string' && Array.isArray(value.days)
}

function isCardOverview(value: unknown): value is CardOverview {
  return isRecord(value) && typeof value.balanceFen === 'number' && Array.isArray(value.transactions)
}

export function createCampusUseCases(deps: CampusUseCasesDeps): CampusUseCases {
  const { identityRepository, scheduleRepository, campusCardRepository, cache, clock, viewerId, cacheKeys } = deps
  const owner = (): string => viewerId() ?? 'anonymous'

  /* ---------------- 身份 ---------------- */

  const identityKey = (): string => cacheKeys.identity(owner())
  const identityStore = store<IdentityState>({
    status: 'idle',
    overview: null,
    identity: null,
    revealing: false,
    busyPlatform: null,
    error: null,
    needsBinding: false,
    fromCache: false,
    updatedAt: null,
  })

  let identityHydrated = false

  const identity: IdentityUseCase = {
    ...identityStore,
    hydrate(): IdentityState {
      if (identityHydrated) return identityStore.getSnapshot()
      identityHydrated = true
      const cached = cache.read<unknown>(identityKey())
      if (!isOverview(cached)) return identityStore.getSnapshot()
      return identityStore.patch({
        status: cached.platforms.some((item) => item.available) ? 'ready' : 'empty',
        overview: cached,
        fromCache: true,
        updatedAt: null,
      })
    },
    async load(): Promise<IdentityState> {
      const current = identityStore.getSnapshot()
      identityStore.patch({ status: current.overview === null ? 'loading' : 'ready', error: null, needsBinding: false })

      const result = await identityRepository.overview()
      if (!result.ok) {
        return identityStore.patch({
          status: current.overview === null ? 'error' : 'ready',
          error: result.error.message,
          needsBinding: needsCampusBinding(result.error.code),
        })
      }

      cache.write(identityKey(), result.value)
      return identityStore.patch({
        status: result.value.platforms.some((item) => item.available) ? 'ready' : 'empty',
        overview: result.value,
        error: null,
        needsBinding: false,
        fromCache: false,
        updatedAt: clock.now().toISOString(),
      })
    },
    async reveal(reveal: boolean): Promise<IdentityState> {
      const current = identityStore.getSnapshot()
      identityStore.patch({ revealing: true, error: null })

      const result = await identityRepository.identity(reveal)
      if (!result.ok) {
        return identityStore.patch({
          revealing: false,
          error: result.error.message,
          needsBinding: needsCampusBinding(result.error.code),
          identity: current.identity,
        })
      }
      return identityStore.patch({ revealing: false, identity: result.value, error: null, needsBinding: false })
    },
    async bind(platform: CampusPlatform): Promise<IdentityState> {
      identityStore.patch({ busyPlatform: platform, error: null })
      const result = await identityRepository.bind(platform)
      if (!result.ok) {
        return identityStore.patch({
          busyPlatform: null,
          error: result.error.message,
          needsBinding: needsCampusBinding(result.error.code),
        })
      }
      identityStore.patch({ busyPlatform: null })
      return identity.load()
    },
    async unbind(platform: CampusPlatform): Promise<IdentityState> {
      identityStore.patch({ busyPlatform: platform, error: null })
      const result = await identityRepository.unbind(platform)
      if (!result.ok) {
        return identityStore.patch({ busyPlatform: null, error: result.error.message })
      }
      // 解绑后实名信息立即失效，不能留在页面上
      identityStore.patch({ busyPlatform: null, identity: null })
      return identity.load()
    },
  } as IdentityUseCase

  /* ---------------- 课表 ---------------- */

  const scheduleStore = store<ScheduleState>({
    status: 'idle',
    today: null,
    week: null,
    syncing: false,
    term: null,
    error: null,
    needsBinding: false,
    fromCache: false,
    updatedAt: null,
    lastSync: null,
  })

  let scheduleHydrated = false

  const schedule: ScheduleUseCase = {
    ...scheduleStore,
    hydrate(): ScheduleState {
      if (scheduleHydrated) return scheduleStore.getSnapshot()
      scheduleHydrated = true
      const cachedToday = cache.read<unknown>(cacheKeys.scheduleToday)
      const cachedWeek = cache.read<unknown>(cacheKeys.scheduleWeek)
      const today = isTodayView(cachedToday) ? cachedToday : null
      const week = isWeekView(cachedWeek) ? cachedWeek : null
      if (today === null && week === null) return scheduleStore.getSnapshot()
      return scheduleStore.patch({
        status: today !== null && today.courses.length > 0 ? 'ready' : 'empty',
        today,
        week,
        fromCache: true,
      })
    },
    async load(term?: string): Promise<ScheduleState> {
      const current = scheduleStore.getSnapshot()
      scheduleStore.patch({
        status: current.today === null ? 'loading' : 'ready',
        error: null,
        needsBinding: false,
        ...(term === undefined ? {} : { term }),
      })

      const [todayResult, weekResult] = await Promise.all([
        scheduleRepository.today(term),
        scheduleRepository.week(term),
      ])

      if (!todayResult.ok) {
        // 失败绝不清空：保留上一次看到的课表
        return scheduleStore.patch({
          status: current.today === null ? 'error' : 'ready',
          error: todayResult.error.message,
          needsBinding: needsCampusBinding(todayResult.error.code),
        })
      }

      cache.write(cacheKeys.scheduleToday, todayResult.value)
      if (weekResult.ok) cache.write(cacheKeys.scheduleWeek, weekResult.value)

      return scheduleStore.patch({
        status: todayResult.value.empty && (weekResult.ok ? weekResult.value.totalCount === 0 : true) ? 'empty' : 'ready',
        today: todayResult.value,
        week: weekResult.ok ? weekResult.value : current.week,
        error: weekResult.ok ? null : weekResult.error.message,
        needsBinding: false,
        fromCache: false,
        updatedAt: clock.now().toISOString(),
      })
    },
    async loadToday(term?: string): Promise<ScheduleState> {
      const result = await scheduleRepository.today(term)
      if (!result.ok) {
        return scheduleStore.patch({
          error: result.error.message,
          needsBinding: needsCampusBinding(result.error.code),
        })
      }
      cache.write(cacheKeys.scheduleToday, result.value)
      return scheduleStore.patch({
        status: result.value.empty ? 'empty' : 'ready',
        today: result.value,
        error: null,
        fromCache: false,
        updatedAt: clock.now().toISOString(),
      })
    },
    async switchTerm(term: string | null): Promise<ScheduleState> {
      scheduleStore.patch({ term })
      return schedule.load(term ?? undefined)
    },
    async sync(): Promise<ScheduleState> {
      scheduleStore.patch({ syncing: true, error: null, needsBinding: false })
      const result = await scheduleRepository.sync()
      if (!result.ok) {
        return scheduleStore.patch({
          syncing: false,
          error: result.error.message,
          needsBinding: needsCampusBinding(result.error.code),
        })
      }
      scheduleStore.patch({ syncing: false, lastSync: result.value })
      return schedule.load(scheduleStore.getSnapshot().term ?? undefined)
    },
    async addCourse(input) {
      const term = input.term ?? scheduleStore.getSnapshot().today?.term
      if (term === undefined) {
        return { ok: false, message: '还不知道当前学期，请先刷新课表后再添加' }
      }
      const { term: _ignored, ...rest } = input
      const result = await scheduleRepository.createCourse({ ...rest, term })
      if (!result.ok) return { ok: false, message: result.error.message }
      await schedule.loadToday(term)
      return { ok: true, message: '已加入课表' }
    },
  } as ScheduleUseCase

  /* ---------------- 校园卡 ---------------- */

  const cardStore = store<CampusCardState>({
    status: 'idle',
    overview: null,
    lostReport: null,
    loadingLost: false,
    error: null,
    needsBinding: false,
    fromCache: false,
    updatedAt: null,
  })

  let cardHydrated = false

  const campusCard: CampusCardUseCase = {
    ...cardStore,
    hydrate(): CampusCardState {
      if (cardHydrated) return cardStore.getSnapshot()
      cardHydrated = true
      const cached = cache.read<unknown>(cacheKeys.campusCard)
      if (!isCardOverview(cached)) return cardStore.getSnapshot()
      return cardStore.patch({
        status: 'ready',
        overview: cached,
        fromCache: true,
        updatedAt: clock.now().toISOString(),
      })
    },
    async load(): Promise<CampusCardState> {
      const current = cardStore.getSnapshot()
      cardStore.patch({ status: current.overview === null ? 'loading' : 'ready', error: null, needsBinding: false })

      const result = await campusCardRepository.overview()
      if (!result.ok) {
        return cardStore.patch({
          status: current.overview === null ? 'error' : 'ready',
          error: result.error.message,
          needsBinding: needsCampusBinding(result.error.code),
        })
      }

      cache.write(cacheKeys.campusCard, result.value)
      return cardStore.patch({
        status: 'ready',
        overview: result.value,
        error: null,
        needsBinding: false,
        fromCache: false,
        updatedAt: clock.now().toISOString(),
      })
    },
    async reportLost(reason?: string): Promise<CampusCardState> {
      cardStore.patch({ loadingLost: true, error: null })
      const result = await campusCardRepository.lostReport(reason)
      if (!result.ok) {
        return cardStore.patch({ loadingLost: false, error: result.error.message })
      }
      return cardStore.patch({ loadingLost: false, lostReport: result.value })
    },
    closeLostReport(): void {
      cardStore.patch({ lostReport: null })
    },
  } as CampusCardUseCase

  return { identity, schedule, campusCard }
}
