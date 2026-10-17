import { CONSENT_MODULES } from '@kedaya/contracts'
import { ok, type Result } from '@kedaya/shared'

import type { ConsentView, PrivacySettings, ProfileExport } from '../../domain/models/privacy'
import type { CachePort } from '../../domain/ports/cachePort'
import type { PrivacyRepository } from '../../domain/ports/privacyRepository'
import { StorageKeys } from '../storage/keys'

/**
 * 隐私与数据的 **Mock 实现**。
 *
 * 为什么这个 mock 特别值得写：隐私开关是**默认全关**的（契约 §9），
 * 如果 mock 里默认全开，页面就会呈现一个"真实环境绝不会出现"的状态，
 * 测不出「关闭后模块不可用」这条最关键的用户路径。
 *
 * 同意记录同样从契约 `CONSENT_MODULES` 生成 —— 与真后端一样，
 * 页面能看到"还有哪些敏感模块我没授权"，而不是一个空列表。
 */

export interface MockPrivacyOptions {
  cache: CachePort
  viewerId: () => string | null
  latencyMs: number
  now: () => Date
}

const DEFAULT_SETTINGS: PrivacySettings = {
  showRealName: false,
  allowAiPortrait: false,
  allowWellbeing: false,
  allowDormHarmony: false,
  themeMode: 'system',
}

export function createMockPrivacyRepository(options: MockPrivacyOptions): PrivacyRepository {
  const { cache, viewerId, latencyMs, now } = options

  const delay = async (): Promise<void> => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs))
  }

  const owner = (): string => viewerId() ?? 'demo-device'
  const settingsKey = `${StorageKeys.privacySettingsCache}:${owner()}`
  const consentKey = `${StorageKeys.consent}:${owner()}`

  const readSettings = (): PrivacySettings => cache.read<PrivacySettings>(settingsKey) ?? DEFAULT_SETTINGS
  const readGranted = (): string[] => cache.read<string[]>(consentKey) ?? []

  const toConsentViews = (): ConsentView[] => {
    const granted = new Set(readGranted())
    const moduleIds = new Set<string>([...CONSENT_MODULES.map((module) => module.id), ...granted])

    return [...moduleIds]
      .map((moduleId) => {
        const meta = CONSENT_MODULES.find((module) => module.id === moduleId)
        const active = granted.has(moduleId)
        return {
          module: moduleId,
          nameZh: meta?.nameZh ?? moduleId,
          summary: meta?.summary ?? '',
          sensitivity: meta?.sensitivity ?? 'unknown',
          gated: true,
          active,
          version: active ? '1.0.0' : null,
          grantedAt: active ? new Date(now().getTime() - 86400000).toISOString() : null,
          revokedAt: null,
        }
      })
      .sort((left, right) => left.module.localeCompare(right.module))
  }

  return {
    async settings(): Promise<Result<PrivacySettings, never>> {
      await delay()
      return ok(readSettings())
    },

    async updateSettings(patch: Partial<PrivacySettings>): Promise<Result<PrivacySettings, never>> {
      await delay()
      const next: PrivacySettings = { ...readSettings(), ...patch }
      cache.write(settingsKey, next)
      return ok(next)
    },

    async consents(): Promise<Result<ConsentView[], never>> {
      await delay()
      return ok(toConsentViews())
    },

    async grantConsent(module: string): Promise<Result<ConsentView, never>> {
      await delay()
      const granted = new Set(readGranted())
      granted.add(module)
      cache.write(consentKey, [...granted])
      const view = toConsentViews().find((item) => item.module === module)
      return ok(view ?? { module, nameZh: module, summary: '', sensitivity: 'unknown', gated: true, active: true, version: '1.0.0', grantedAt: now().toISOString(), revokedAt: null })
    },

    async revokeConsent(module: string): Promise<Result<ConsentView, never>> {
      await delay()
      cache.write(consentKey, readGranted().filter((item) => item !== module))
      const view = toConsentViews().find((item) => item.module === module)
      return ok(view ?? { module, nameZh: module, summary: '', sensitivity: 'unknown', gated: true, active: false, version: null, grantedAt: null, revokedAt: now().toISOString() })
    },

    async exportData(): Promise<Result<ProfileExport, never>> {
      await delay()
      return ok({
        generatedAt: now().toISOString(),
        account: {
          id: owner(),
          displayName: '演示账号',
          hasAvatar: false,
          anonEnabled: true,
          department: '信息科学与技术学院',
          createdAt: new Date(now().getTime() - 90 * 86400000).toISOString(),
          hasPassword: true,
          identities: [{ provider: 'LOCAL_EMAIL', email: 'demo@kedaya.dev', realName: null, linkedAt: now().toISOString() }],
          campusBindings: [],
        },
        settings: readSettings(),
        consents: toConsentViews()
          .filter((item) => item.active)
          .map((item) => ({ module: item.module, nameZh: item.nameZh, version: item.version ?? '1.0.0', grantedAt: item.grantedAt ?? '', revokedAt: item.revokedAt })),
        audit: { total: 0, recent: [] },
        content: [
          { module: 'flea-market', nameZh: '跳蚤市场', count: 0 },
          { module: 'errand', nameZh: '跑腿', count: 0 },
        ],
        note: '本地演示环境导出的是模拟数据；真实环境导出的范围见服务端响应。',
      })
    },
  }
}
