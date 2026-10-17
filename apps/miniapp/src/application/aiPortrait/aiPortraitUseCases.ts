import { err, ok, type Result } from '@kedaya/shared'

import {
  AI_PORTRAIT_CONSENT_VERSION,
  AI_PORTRAIT_MODULE_ID,
  AI_PORTRAIT_NOT_LOGGED_MESSAGE,
  isAiPortraitConsentRecord,
  toPortraitView,
} from '../../domain/models/aiPortrait'
import type {
  AiPortraitConsentRecord,
  AiPortraitProfilePayload,
  AiPortraitSourcesPayload,
  AiPortraitView,
  PortraitSourceDescriptor,
} from '../../domain/models/aiPortrait'
import type { AiPortraitRepository } from '../../domain/ports/aiPortraitRepository'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import { needsConsent } from '../../domain/ports/errors'
import type { RepositoryError } from '../../domain/ports/errors'
import { createDetailUseCase } from '../common/detailUseCase'
import type { DetailUseCase } from '../common/detailUseCase'

/**
 * AI 校园画像用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 这个模块与其它模块最大的不同：**读画像之前有两道门，且顺序不能换**。
 *
 *   1. **登录门**：画像永远按主体寻址（`GET /me` 用 JWT 找人），
 *      未登录时不发请求、不展示任何内容 —— 页面给登录引导。
 *   2. **同意门**（契约 §9）：高敏感模块必须显式二次同意。
 *      判定发生在**任何仓储调用之前**：本地留痕（`StorageKeys.consent`）说没同意，
 *      就连一次 `GET /me` 都不会发出去。这既是合规要求，也能避免
 *      未同意的用户看到一串 `CONSENT_REQUIRED` 报错。
 *
 * 同意是**双轨**的（与 `wellbeing` 同一套纪律）：
 *   · 本地留痕（`{ acceptedAt, version }`）决定"同意门要不要弹"，即时、离线；
 *   · 服务端记录（`POST /consents`）才是后端放行的依据。
 * 因此 `acceptConsent()` **先**让服务端留痕成功、再写本地；
 * `revokeConsent()` **先**让服务端撤回、再删本地（不做乐观更新）。
 * 本地有、服务端没有时（换设备 / 服务端已撤回），`me()` 会回 `CONSENT_REQUIRED`，
 * 这里据 `needsConsent()` 把本地留痕清掉，让同意门重新出现 —— 自愈，而不是卡死。
 *
 * 另有两条刻意取舍：
 *   · **不缓存画像本体**。画像是服务端对你的聚合结论，不是"我手机里的记录"；
 *     把它写进本机缓存会让换账号后可能读到上一份画像。这里只缓存**公开的来源清单**
 *     （非敏感，断网时仍要说得出"哪类数据用在哪、哪类被排除"）。
 *   · **没有写入画像的入口**。端口里没有 `upsert`：`POST /items` 只供受信的服务端生成流程使用，
 *     客户端不允许编造标签（编一条说不清来源的标签，正是本模块要杜绝的事）。
 */

/**
 * 本地同意留痕的 key 字面量。
 *
 * 为什么在这里写死而不是 `import { StorageKeys } from '../../data/storage/keys'`：
 * `application/**` 禁止 import `data/**`（契约 §7，ESLint `no-restricted-imports`），
 * 而装配层注入的依赖里也没有 key。所以这里与 `data/storage/keys.ts` 的
 * `StorageKeys.consent` 保持**同一字面量**；keys.ts 是权威来源，
 * 单测里有一致性断言防止两边悄悄漂移（与 `dormHarmony` / `wellbeing` 同一约定）。
 */
export const AI_PORTRAIT_CONSENT_CACHE_KEY = 'kedaya:v1:consent'

/**
 * `DetailUseCase.load()` 需要一个 id，但画像/清单都是**单例资源**：
 * 传什么都一样（fetch 会忽略它）。用常量是为了让调用点自解释，而不是随手写 `'me'`。
 */
export const AI_PORTRAIT_VIEW_ID = 'me'
export const AI_PORTRAIT_CATALOG_ID = 'catalog'

/** 同意门的文案：与后端 / Mock 仓储同一句，避免三处各写一份 */
export const AI_PORTRAIT_CONSENT_REQUIRED_MESSAGE = '请先阅读并同意画像说明'

/**
 * 画像快照。
 *
 * 为什么不直接用 `AiPortraitView`：`GET /me` 在**还没有画像行**时返回 `null`
 * （后端目前没有生成逻辑，这是常态），而 `DetailState.data === null` 表示"还没加载"。
 * 两者混在一起就会出现"把没加载当成没有数据"的经典错误，
 * 因此用一个显式的 `hasProfile` 把"还没加载"和"后端就是没有画像"分开。
 */
export interface AiPortraitSnapshot {
  /** 后端是否存在画像行（`false` → 页面走「还没有足够的数据」空态） */
  hasProfile: boolean
  view: AiPortraitView
}

export interface AiPortraitUseCasesDeps {
  repository: AiPortraitRepository
  cache: CachePort
  clock: ClockPort
  /** 公开来源清单的离线缓存 key（装配层注入；画像本体**不**缓存） */
  cacheKey: string
  /** 当前登录用户 id（未登录为 null）—— 在发请求前就挡住注定 401 的读取 */
  viewerId: () => string | null
}

export interface AiPortraitUseCases {
  /** 我的画像（含"还没有画像行"的空态快照） */
  portrait: DetailUseCase<AiPortraitSnapshot>
  /** 公开的来源清单（不依赖登录与同意：排除声明必须永远显示得出来） */
  sources: DetailUseCase<AiPortraitSourcesPayload>

  /* ---- 二次同意（契约 §9）---- */

  /** 本地留痕是否有效（版本对得上）。这是"同意门要不要弹"的即时判断 */
  hasConsented(): boolean
  /** 本地留痕原文（设置页/来源页展示"你同意的是哪一版"用） */
  consentRecord(): AiPortraitConsentRecord | null
  /**
   * 同意。已登录时**先**让服务端留痕成功再写本地（服务端才是放行依据）；
   * 未登录时不写服务端（也没有可写的），只写本地 —— 随后读画像会正常提示登录。
   */
  acceptConsent(): Promise<Result<AiPortraitConsentRecord, RepositoryError>>
  /** 撤回同意：先服务端撤回、再删本地（不做乐观更新） */
  revokeConsent(): Promise<Result<void, RepositoryError>>
  /**
   * 丢掉本地留痕 + 清空画像状态。
   * 服务端明确回了 `CONSENT_REQUIRED` 时由本用例自动调用，让同意门重新出现。
   */
  forgetConsent(): void

  /** 开启 / 关闭画像：成功后用服务端返回的实体刷新快照（服务端结果才是真相） */
  setEnabled(enabled: boolean): Promise<Result<AiPortraitSnapshot, RepositoryError>>

  /**
   * 检测登录主体是否变化；变化则清空画像状态。
   * 在每次 `load()` / `setEnabled()` 前自动调用 —— 绝不让上一个账号的画像留在屏幕上。
   */
  syncViewer(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 后端来源清单的形状守卫（旧接口返回坏数据时宁可当作"没有缓存"） */
function isSourcesPayload(value: unknown): value is AiPortraitSourcesPayload {
  if (!isRecord(value)) return false
  return (
    typeof value.module === 'string' &&
    Array.isArray(value.allowed) &&
    Array.isArray(value.forbidden) &&
    Array.isArray(value.catalog) &&
    isRecord(value.generation)
  )
}

export function createAiPortraitUseCases(deps: AiPortraitUseCasesDeps): AiPortraitUseCases {
  const { repository, cache, clock, cacheKey, viewerId } = deps

  /** 还没有画像行时的视图：不编造任何标签，页面据 `hasProfile` 走空态 */
  function emptyView(): AiPortraitView {
    return {
      enabled: true,
      traits: [],
      droppedTraits: 0,
      roundSources: [],
      updatedAt: null,
      updatedLabel: null,
      note: null,
    }
  }

  function snapshotOf(
    payload: AiPortraitProfilePayload | null,
    catalog: readonly PortraitSourceDescriptor[],
    allowedIds: readonly string[],
  ): AiPortraitSnapshot {
    if (payload === null) return { hasProfile: false, view: emptyView() }
    return { hasProfile: true, view: toPortraitView(payload, catalog, allowedIds, clock.now()) }
  }

  /* --------------------------- 公开来源清单（可离线） --------------------------- */

  function readCatalogCache(): AiPortraitSourcesPayload | null {
    const raw = cache.read<unknown>(cacheKey)
    return isSourcesPayload(raw) ? raw : null
  }

  function writeCatalogCache(payload: AiPortraitSourcesPayload): void {
    cache.write(cacheKey, payload)
  }

  /**
   * 取来源清单：先问服务端（成功即回写缓存），失败才退回缓存。
   *
   * 网络彻底不通且没有缓存时才返回错误 —— 那时页面给错误态 + 重试是诚实的，
   * 编一份清单出来才是错的。
   */
  async function fetchCatalog(): Promise<Result<AiPortraitSourcesPayload, RepositoryError>> {
    const result = await repository.sources()
    if (result.ok) {
      writeCatalogCache(result.value)
      return result
    }
    const cached = readCatalogCache()
    if (cached !== null) return ok(cached)
    return err(result.error)
  }

  /* ------------------------------ 本地同意 ------------------------------ */

  function readConsentMap(): Record<string, unknown> {
    const raw = cache.read<unknown>(AI_PORTRAIT_CONSENT_CACHE_KEY)
    return isRecord(raw) ? { ...raw } : {}
  }

  function readLocalConsent(): AiPortraitConsentRecord | null {
    const entry = readConsentMap()[AI_PORTRAIT_MODULE_ID]
    return isAiPortraitConsentRecord(entry) ? entry : null
  }

  /** 合并写回：`consent` key 是多个敏感模块共用的，不能整块覆盖 */
  function writeLocalConsent(record: AiPortraitConsentRecord): void {
    cache.write(AI_PORTRAIT_CONSENT_CACHE_KEY, {
      ...readConsentMap(),
      [AI_PORTRAIT_MODULE_ID]: record,
    })
  }

  function clearLocalConsent(): void {
    const map = readConsentMap()
    if (!(AI_PORTRAIT_MODULE_ID in map)) return
    delete map[AI_PORTRAIT_MODULE_ID]
    if (Object.keys(map).length === 0) cache.remove(AI_PORTRAIT_CONSENT_CACHE_KEY)
    else cache.write(AI_PORTRAIT_CONSENT_CACHE_KEY, map)
  }

  function hasConsented(): boolean {
    const record = readLocalConsent()
    return record !== null && record.version === AI_PORTRAIT_CONSENT_VERSION
  }

  /* ----------------------------- 画像（读） ----------------------------- */

  let loadedViewer: string | null = viewerId()

  function syncViewer(): void {
    const current = viewerId()
    if (current === loadedViewer) return
    // 主体变了：上一份画像绝不能再显示给新主体
    loadedViewer = current
    portraitState.reset()
  }

  function consentProblem(): RepositoryError | null {
    if (hasConsented()) return null
    return { code: 'CONSENT_REQUIRED', message: AI_PORTRAIT_CONSENT_REQUIRED_MESSAGE }
  }

  async function loadView(): Promise<Result<AiPortraitSnapshot, RepositoryError>> {
    syncViewer()

    // 1. 登录门（读画像之前）
    if (viewerId() === null) {
      return err({ code: 'UNAUTHENTICATED', message: AI_PORTRAIT_NOT_LOGGED_MESSAGE })
    }

    // 2. 同意门（同样在仓储调用之前）
    const problem = consentProblem()
    if (problem !== null) return err(problem)

    // 3. 才轮到仓储。来源清单失败不阻断画像本身（标签来源会退化成 id）。
    const catalog = await fetchCatalog()
    const catalogValue = catalog.ok ? catalog.value : null

    const result = await repository.me()
    if (!result.ok) {
      // 服务端说没同意（例如换设备后本地有、服务端没有）：清本地留痕，让同意门重新出现
      if (needsConsent(result.error.code)) forgetConsent()
      return err(result.error)
    }

    return ok(
      snapshotOf(
        result.value,
        catalogValue?.catalog ?? [],
        catalogValue?.allowed ?? [],
      ),
    )
  }

  const portraitState = createDetailUseCase<AiPortraitSnapshot>(() => loadView())
  const sourcesState = createDetailUseCase<AiPortraitSourcesPayload>(() => fetchCatalog())

  function forgetConsent(): void {
    clearLocalConsent()
    // 本地留痕一没，页面上那份画像也不该继续显示
    portraitState.reset()
  }

  return {
    portrait: portraitState,
    sources: sourcesState,

    hasConsented,
    consentRecord: readLocalConsent,

    async acceptConsent(): Promise<Result<AiPortraitConsentRecord, RepositoryError>> {
      // 已登录：服务端才是后端放行的依据，留痕成功后再写本地（不做乐观更新）
      if (viewerId() !== null) {
        const granted = await repository.grantConsent()
        if (!granted.ok) return err(granted.error)
      }

      const record: AiPortraitConsentRecord = {
        acceptedAt: clock.now().toISOString(),
        version: AI_PORTRAIT_CONSENT_VERSION,
      }
      writeLocalConsent(record)
      return ok(record)
    },

    async revokeConsent(): Promise<Result<void, RepositoryError>> {
      // 已登录时先撤回服务端记录；失败就停在原地，不假装撤回成功
      if (viewerId() !== null) {
        const revoked = await repository.revokeConsent()
        if (!revoked.ok) return err(revoked.error)
      }
      forgetConsent()
      return ok(undefined)
    },

    forgetConsent,

    async setEnabled(enabled: boolean): Promise<Result<AiPortraitSnapshot, RepositoryError>> {
      syncViewer()

      if (viewerId() === null) {
        return err({ code: 'UNAUTHENTICATED', message: AI_PORTRAIT_NOT_LOGGED_MESSAGE })
      }
      const problem = consentProblem()
      if (problem !== null) return err(problem)

      const catalog = await fetchCatalog()
      const catalogValue = catalog.ok ? catalog.value : null

      const result = await portraitState.mutate(async () => {
        const toggled = await repository.setEnabled(enabled)
        if (!toggled.ok) return err(toggled.error)
        return ok(
          snapshotOf(toggled.value, catalogValue?.catalog ?? [], catalogValue?.allowed ?? []),
        )
      })

      if (!result.ok && needsConsent(result.error.code)) forgetConsent()
      return result
    },

    syncViewer,
  }
}
