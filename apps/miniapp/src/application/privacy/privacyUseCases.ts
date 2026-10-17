import type { ConsentView, PrivacySettings, ProfileExport } from '../../domain/models/privacy'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { PrivacyRepository } from '../../domain/ports/privacyRepository'

/**
 * 「我的 → 隐私与数据」用例。
 *
 * 这里有一条**与其他模块相反的**谨慎规则：设置类写入
 * **绝不乐观更新**。其它模块（点赞、参团）可以先改再纠正，
 * 但"以为关掉了 AI 画像、其实没关"是用户无法接受的结果 ——
 * 所以开关一律等后端确认后再改本地状态，失败就回滚并明确提示。
 */

export type PrivacyStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PrivacyState {
  status: PrivacyStatus
  settings: PrivacySettings | null
  consents: ConsentView[]
  /** 正在切换的开关 key / 正在处理的模块 id */
  busyKey: string | null
  error: string | null
  /** 数据导出结果（导出是"按需展开"，默认不请求） */
  exportResult: ProfileExport | null
  exporting: boolean
  exportError: string | null
  fromCache: boolean
}

export interface PrivacyUseCase {
  getSnapshot(): PrivacyState
  subscribe(listener: () => void): () => void
  hydrate(): PrivacyState
  load(): Promise<PrivacyState>
  updateSetting(patch: Partial<PrivacySettings>): Promise<{ ok: boolean; message: string }>
  grant(module: string): Promise<{ ok: boolean; message: string }>
  revoke(module: string): Promise<{ ok: boolean; message: string }>
  exportData(): Promise<{ ok: boolean; message: string }>
  closeExport(): void
  /** 同意状态的时间文案（"刚刚授权 / 3 小时前撤回"），用注入的时钟算 */
  consentLabel(consent: ConsentView): string
  /** 导出结果的生成时间文案 */
  exportLabel(): string
}

export interface PrivacyUseCasesDeps {
  repository: PrivacyRepository
  cache: CachePort
  clock: ClockPort
  viewerId: () => string | null
  /** 缓存 key 由装配层给（application 不得 import `data/**`） */
  cacheKeys: {
    settings(owner: string): string
  }
}

function isSettings(value: unknown): value is PrivacySettings {
  return typeof value === 'object' && value !== null && typeof (value as PrivacySettings).allowAiPortrait === 'boolean'
}

export function createPrivacyUseCase(deps: PrivacyUseCasesDeps): PrivacyUseCase {
  const { repository, cache, clock, viewerId, cacheKeys } = deps
  const settingsKey = (): string => cacheKeys.settings(viewerId() ?? 'anonymous')

  let state: PrivacyState = {
    status: 'idle',
    settings: null,
    consents: [],
    busyKey: null,
    error: null,
    exportResult: null,
    exporting: false,
    exportError: null,
    fromCache: false,
  }
  const listeners = new Set<() => void>()
  let hydrated = false

  function patch(next: Partial<PrivacyState>): PrivacyState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    hydrate(): PrivacyState {
      if (hydrated) return state
      hydrated = true
      const cached = cache.read<unknown>(settingsKey())
      if (!isSettings(cached)) return state
      return patch({ status: 'ready', settings: cached, fromCache: true })
    },
    async load(): Promise<PrivacyState> {
      patch({ status: state.settings === null ? 'loading' : 'ready', error: null })

      const [settingsResult, consentsResult] = await Promise.all([
        repository.settings(),
        repository.consents(),
      ])

      if (!settingsResult.ok) {
        return patch({
          status: state.settings === null ? 'error' : 'ready',
          error: settingsResult.error.message,
        })
      }

      cache.write(settingsKey(), settingsResult.value)
      return patch({
        status: 'ready',
        settings: settingsResult.value,
        consents: consentsResult.ok ? consentsResult.value : state.consents,
        error: consentsResult.ok ? null : consentsResult.error.message,
        fromCache: false,
      })
    },
    async updateSetting(patchInput): Promise<{ ok: boolean; message: string }> {
      const key = Object.keys(patchInput)[0] ?? 'settings'
      patch({ busyKey: key, error: null })

      const result = await repository.updateSettings(patchInput)
      if (!result.ok) {
        // 不回滚本地（本来就没乐观更新），只报错
        patch({ busyKey: null, error: result.error.message })
        return { ok: false, message: result.error.message }
      }

      cache.write(settingsKey(), result.value)
      patch({ busyKey: null, settings: result.value, error: null })
      return { ok: true, message: '已保存' }
    },
    async grant(module: string): Promise<{ ok: boolean; message: string }> {
      patch({ busyKey: module, error: null })
      const result = await repository.grantConsent(module)
      if (!result.ok) {
        patch({ busyKey: null, error: result.error.message })
        return { ok: false, message: result.error.message }
      }
      patch({
        busyKey: null,
        consents: state.consents.map((item) => (item.module === module ? result.value : item)),
      })
      return { ok: true, message: '已授权' }
    },
    async revoke(module: string): Promise<{ ok: boolean; message: string }> {
      patch({ busyKey: module, error: null })
      const result = await repository.revokeConsent(module)
      if (!result.ok) {
        patch({ busyKey: null, error: result.error.message })
        return { ok: false, message: result.error.message }
      }
      patch({
        busyKey: null,
        consents: state.consents.map((item) => (item.module === module ? result.value : item)),
      })
      return { ok: true, message: '已撤回，该模块立即不可用' }
    },
    async exportData(): Promise<{ ok: boolean; message: string }> {
      patch({ exporting: true, exportError: null })
      const result = await repository.exportData()
      if (!result.ok) {
        patch({ exporting: false, exportError: result.error.message })
        return { ok: false, message: result.error.message }
      }
      patch({ exporting: false, exportResult: result.value })
      return { ok: true, message: '已生成导出' }
    },
    closeExport(): void {
      patch({ exportResult: null, exportError: null })
    },
    consentLabel(consent: ConsentView): string {
      return consentTimeLabel(consent, clock.now())
    },
    exportLabel(): string {
      const exported = state.exportResult
      if (exported === null) return ''
      const diffMinutes = Math.round((clock.now().getTime() - new Date(exported.generatedAt).getTime()) / 60000)
      if (diffMinutes < 1) return '刚刚生成'
      if (diffMinutes < 60) return `${diffMinutes} 分钟前生成`
      return `${Math.round(diffMinutes / 60)} 小时前生成`
    },
  }
}

/** 上次操作时间的展示（撤回后用户要能确认"确实撤了"） */
function consentTimeLabel(consent: ConsentView, now: Date): string {
  const stamp = consent.active ? consent.grantedAt : consent.revokedAt
  if (stamp === null) return '—'
  const diffMinutes = Math.round((now.getTime() - new Date(stamp).getTime()) / 60000)
  if (diffMinutes < 1) return consent.active ? '刚刚授权' : '刚刚撤回'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前${consent.active ? '授权' : '撤回'}`
  if (diffMinutes < 60 * 24) return `${Math.round(diffMinutes / 60)} 小时前${consent.active ? '授权' : '撤回'}`
  return `${Math.round(diffMinutes / 1440)} 天前${consent.active ? '授权' : '撤回'}`
}
