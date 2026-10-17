import { modulePath } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { ConsentView, PrivacySettings, ProfileExport } from '../../domain/models/privacy'
import type { RepositoryError } from '../../domain/ports/errors'
import type { PrivacyRepository } from '../../domain/ports/privacyRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/** 真后端隐私与数据仓储 */
export function createHttpPrivacyRepository(client: ApiClient): PrivacyRepository {
  const base = modulePath('profile')

  return {
    async settings(): Promise<Result<PrivacySettings, RepositoryError>> {
      const result = await client.get<PrivacySettings>(`${base}/me`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async updateSettings(patch: Partial<PrivacySettings>): Promise<Result<PrivacySettings, RepositoryError>> {
      const result = await client.patch<PrivacySettings, Partial<PrivacySettings>>(`${base}/me`, patch)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async consents(): Promise<Result<ConsentView[], RepositoryError>> {
      const result = await client.get<ConsentView[]>(`${base}/consents`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async grantConsent(module: string): Promise<Result<ConsentView, RepositoryError>> {
      const result = await client.post<ConsentView, Record<string, never>>(
        `${base}/consents/${encodeURIComponent(module)}`,
        {},
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async revokeConsent(module: string): Promise<Result<ConsentView, RepositoryError>> {
      const result = await client.del<ConsentView>(`${base}/consents/${encodeURIComponent(module)}`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async exportData(): Promise<Result<ProfileExport, RepositoryError>> {
      const result = await client.get<ProfileExport>(`${base}/export`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
