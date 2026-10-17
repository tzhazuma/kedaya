import { err, ok, type Result } from '@kedaya/shared'

import {
  WELLBEING_CONSENT_VERSION,
  WELLBEING_MODULE_ID,
  counselorProblem,
  noteProblem,
  parseSlotAtInput,
  slotAtProblem,
  summarize,
} from '../../domain/models/wellbeing'
import type {
  WellbeingAppointment,
  WellbeingAppointmentFilters,
  WellbeingAppointmentSummary,
  WellbeingCrisisLine,
  WellbeingMode,
} from '../../domain/models/wellbeing'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import { needsConsent } from '../../domain/ports/errors'
import type { RepositoryError } from '../../domain/ports/errors'
import type { WellbeingRepository } from '../../domain/ports/wellbeingRepository'
import { createDetailUseCase } from '../common/detailUseCase'
import type { DetailUseCase } from '../common/detailUseCase'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'

/**
 * 心理支持用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 列表与详情的**机制**（hydrate → load → 静默降级 → 游标续页）来自
 * `application/common/*`，本文件只负责模块特有、且**必须写对**的四件事：
 *
 *   1. **危机出口永不消失**：`crisis` 是一个独立的详情用例，仓储存不到数据时
 *      页面用 `CRISIS_FALLBACK` 兜底（见 `domain/models/wellbeing.ts`）。
 *      它**不进同意门**：断网 / 未登录 / 未同意都必须看得到热线。
 *   2. **二次同意是双轨的**（契约 §9）：
 *      · **本地留痕**（`StorageKeys.consent`）决定"同意门要不要弹"，是即时的、离线的；
 *      · **服务端记录**（`/wellbeing/consents`）才是后端放行的依据。
 *      因此 `acceptConsent()` 在已登录时**先**让服务端留痕成功、再写本地；
 *      `needsConsent()` 会在本地"以为同意了"而服务端没有时清掉本地留痕，
 *      把用户重新带回同意门，而不是让他撞上一串 `CONSENT_REQUIRED`。
 *   3. **发布前客户端校验**：与服务端同一套规则（含时间文本解析与 5 分钟时钟偏差），
 *      不用"发一个注定 400 的请求"来试探；`now` 由容器时钟注入，可复现。
 *   4. **领域动作就地刷新**：取消预约走 `detail.mutate()`，成功后用服务端返回的
 *      实体替换本地详情，页面不写"乐观更新 + 回滚"。
 */

const PAGE_SIZE = 10

/**
 * 本地同意留痕的 key 字面量。
 *
 * 为什么在这里写死而不是 `import { StorageKeys } from '../../data/storage/keys'`：
 * `application/**` 禁止 import `data/**`（契约 §7，ESLint `no-restricted-imports`），
 * 装配层注入给本用例的依赖里也没有 key。所以这里与 `data/storage/keys.ts` 的
 * `StorageKeys.consent` 保持**同一字面量**；keys.ts 是权威来源，
 * 两边的单测会守住这层一致性，防止悄悄漂移。
 */
export const WELLBEING_CONSENT_CACHE_KEY = 'kedaya:v1:consent'

/**
 * 本地同意记录（形状与 `dormHarmony` 一致：`consent` key 是多个敏感模块共用的）。
 *
 * 与**服务端**同意记录（`WellbeingConsentRecord`，带 `id / grantedAt / revokedAt`）
 * 明确区分：本地这份只回答"用户在这台设备上同意过没有、同意的是哪一版文案"。
 */
export interface WellbeingLocalConsent {
  acceptedAt: string
  version: string
}

/** 表单草稿：时间收文本、提交前解析（与服务端/表单保持同一套解析与文案） */
export interface WellbeingDraft {
  counselor: string
  /** 本地时间文本 `YYYY-MM-DD HH:mm` */
  slotAtText: string
  mode: WellbeingMode
  /** 选填的诉求摘要（最小化采集：不填是有意的） */
  note: string
}

/**
 * 客户端校验（与服务端同一套规则，只做即时提示）。
 *
 * `now` 由调用方注入（容器时钟），因此「预约时间不能早于现在」可复现、可测试。
 */
export function validateDraft(draft: WellbeingDraft, now: Date): string[] {
  const problems: string[] = []

  const counselor = counselorProblem(draft.counselor)
  if (counselor !== null) problems.push(counselor)

  if (draft.slotAtText.trim() === '') {
    problems.push('请填写预约时间')
  } else {
    const slotAt = parseSlotAtInput(draft.slotAtText)
    if (slotAt === null) {
      problems.push('请按「YYYY-MM-DD HH:mm」填写预约时间')
    } else {
      const problem = slotAtProblem(slotAt, now)
      if (problem !== null) problems.push(problem)
    }
  }

  const note = noteProblem(draft.note)
  if (note !== null) problems.push(note)

  return problems
}

export interface WellbeingUseCasesDeps {
  repository: WellbeingRepository
  cache: CachePort
  clock: ClockPort
  /** 列表缓存 key 由装配层注入（`StorageKeys.wellbeingListCache`） */
  cacheKey: string
  /** 当前登录用户 id（未登录为 null）—— 在发请求前就挡住注定 401 的动作 */
  viewerId: () => string | null
}

export interface WellbeingUseCases {
  list: ListUseCase<WellbeingAppointmentFilters, WellbeingAppointmentSummary>
  detail: DetailUseCase<WellbeingAppointment>
  /**
   * 危机出口（单例资源）。
   *
   * 用详情用例承载是为了复用 `loading / ready / error` 三态；
   * 页面必须按 `crisis.data ?? CRISIS_FALLBACK` 渲染 —— **接口失败也要看得到号码**。
   */
  crisis: DetailUseCase<WellbeingCrisisLine>

  /** 提交预约：本地校验 + 时间文本解析通过后才发请求；成功后重置列表缓存 */
  create(draft: WellbeingDraft): Promise<Result<WellbeingAppointment, RepositoryError>>
  /** 领域动作：取消预约（成功后用服务端实体刷新详情） */
  cancel(id: string): Promise<Result<WellbeingAppointment, RepositoryError>>

  /* ---- 二次同意（契约 §9）---- */

  /** 本地留痕是否有效（版本对得上）。这是"同意门要不要弹"的即时判断 */
  hasConsented(): boolean
  /**
   * 是否需要（重新）同意 —— 进入数据页面前调用。
   *
   * 与 `hasConsented()` 的区别：它会在**已登录**时找服务端对齐一次
   * （`activeConsent()`）。本地有、服务端没有（换设备 / 服务端记录被撤回）时，
   * 以服务端为准：清掉本地留痕并返回 `true`。
   * 服务端请求失败时保留本地判断 —— 断网不该把已同意的用户挡在门外。
   */
  needsConsent(): Promise<boolean>
  /**
   * 同意。已登录时**先**让服务端留痕成功再写本地（服务端才是放行依据）；
   * 未登录时只写本地（同意门在登录前也要能过，随后数据请求会正常提示登录）。
   */
  acceptConsent(): Promise<Result<WellbeingLocalConsent, RepositoryError>>
  /** 撤回同意：先清本地（本模块立刻不可用），已登录时再同步服务端 */
  revokeConsent(): Promise<Result<void, RepositoryError>>
  /**
   * 服务端明确回了 `CONSENT_REQUIRED` 时调用：清本地留痕 + 重置列表。
   * 这样同意门会重新出现，而不是页面卡在一串同义的失败提示里。
   */
  forgetConsent(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function createWellbeingUseCases(deps: WellbeingUseCasesDeps): WellbeingUseCases {
  const { repository, cache, clock, cacheKey, viewerId } = deps

  const list: ListUseCase<WellbeingAppointmentFilters, WellbeingAppointmentSummary> =
    createListUseCase<WellbeingAppointmentFilters, WellbeingAppointment, WellbeingAppointmentSummary>({
      cache,
      clock,
      cacheKey,
      // 默认不筛状态（后端本来就只返回"我的"，这里没有 mine）
      defaultQuery: {},
      isCachedPage: createCachedPageGuard<WellbeingAppointment>(),
      fetchPage: (filters, cursor) => repository.list({ cursor, limit: PAGE_SIZE, filters }),
      mapItem: (appointment, now) => summarize(appointment, now),
    })

  const detail = createDetailUseCase<WellbeingAppointment>((id) => repository.detail(id))

  /**
   * 危机出口的 `id` 参数没有意义（它是单例资源），传什么都忽略 ——
   * 但保留 `DetailUseCase` 的接口形态，让页面沿用同一套三态渲染。
   */
  const crisis = createDetailUseCase<WellbeingCrisisLine>(() => repository.crisisLine())

  /* ------------------------------ 本地同意 ------------------------------ */

  function readConsentMap(): Record<string, unknown> {
    const raw = cache.read<unknown>(WELLBEING_CONSENT_CACHE_KEY)
    return isRecord(raw) ? { ...raw } : {}
  }

  function readLocalConsent(): WellbeingLocalConsent | null {
    const entry = readConsentMap()[WELLBEING_MODULE_ID]
    if (!isRecord(entry)) return null
    if (typeof entry.acceptedAt !== 'string' || entry.acceptedAt === '') return null
    if (typeof entry.version !== 'string' || entry.version === '') return null
    return { acceptedAt: entry.acceptedAt, version: entry.version }
  }

  /** 合并写回：`consent` key 是多个敏感模块共用的，不能整块覆盖 */
  function writeLocalConsent(record: WellbeingLocalConsent): void {
    cache.write(WELLBEING_CONSENT_CACHE_KEY, {
      ...readConsentMap(),
      [WELLBEING_MODULE_ID]: record,
    })
  }

  function clearLocalConsent(): void {
    const map = readConsentMap()
    if (!(WELLBEING_MODULE_ID in map)) return
    delete map[WELLBEING_MODULE_ID]
    if (Object.keys(map).length === 0) cache.remove(WELLBEING_CONSENT_CACHE_KEY)
    else cache.write(WELLBEING_CONSENT_CACHE_KEY, map)
  }

  function forgetConsent(): void {
    clearLocalConsent()
    // 列表缓存可能来自"已同意"时期，清掉避免同意门之后立刻看到旧数据
    list.reset()
  }

  function hasConsented(): boolean {
    const record = readLocalConsent()
    return record !== null && record.version === WELLBEING_CONSENT_VERSION
  }

  return {
    list,
    detail,
    crisis,

    async create(draft) {
      if (viewerId() === null) {
        return err({ code: 'UNAUTHENTICATED', message: '预约心理支持需要先登录' })
      }

      const problems = validateDraft(draft, clock.now())
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查填写内容' })
      }

      // validateDraft 已保证可解析；这里再判一次只是为了让类型收窄
      const slotAt = parseSlotAtInput(draft.slotAtText)
      if (slotAt === null) {
        return err({ code: 'VALIDATION_FAILED', message: '请按「YYYY-MM-DD HH:mm」填写预约时间' })
      }

      const note = draft.note.trim()
      const result = await repository.create({
        counselor: draft.counselor.trim(),
        slotAt: slotAt.toISOString(),
        mode: draft.mode,
        note: note === '' ? null : note,
      })

      if (result.ok) {
        // 新预约会出现在列表最前面，重置缓存让下次进入列表重新拉取
        list.reset()
      } else if (needsConsent(result.error.code)) {
        forgetConsent()
      }
      return result
    },

    async cancel(id) {
      if (viewerId() === null) {
        return err({ code: 'UNAUTHENTICATED', message: '登录后才能取消预约' })
      }

      const result = await detail.mutate(() => repository.cancel(id))
      if (!result.ok && needsConsent(result.error.code)) forgetConsent()
      return result
    },

    hasConsented,

    async needsConsent(): Promise<boolean> {
      if (!hasConsented()) return true
      // 未登录时无法问服务端；本地留痕即"这台设备上的同意门"，登录由数据请求另行提示
      if (viewerId() === null) return false

      const active = await repository.activeConsent()
      if (!active.ok) {
        // 网络失败：保留本地判断，别让断网把已同意的用户挡在门外
        return false
      }
      if (active.value) return false

      // 本地有、服务端没有：以服务端为准，重新过同意门
      forgetConsent()
      return true
    },

    async acceptConsent() {
      // 已登录：服务端才是后端放行的依据，留痕成功后再写本地
      if (viewerId() !== null) {
        const granted = await repository.grantConsent()
        // 服务端拒绝时原样返回它的错误，但**不**把服务端的记录形状当作本地留痕
        if (!granted.ok) return err(granted.error)
      }

      const record: WellbeingLocalConsent = {
        acceptedAt: clock.now().toISOString(),
        version: WELLBEING_CONSENT_VERSION,
      }
      writeLocalConsent(record)
      return ok(record)
    },

    async revokeConsent() {
      // 先清本地：本模块立刻回到同意门，不需要等网络
      forgetConsent()
      if (viewerId() === null) return ok(undefined)

      const result = await repository.revokeConsent()
      if (!result.ok) return err(result.error)
      return ok(undefined)
    },

    forgetConsent,
  }
}
