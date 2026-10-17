import type { Result } from '@kedaya/shared'

import type { ConsentView, PrivacySettings, ProfileExport } from '../models/privacy'
import type { RepositoryError } from './errors'

/**
 * 隐私与数据仓储端口（「我的 → 隐私与数据」）。
 *
 * 端点（后端 `ProfileController`）：
 * ```
 * GET    /profile/me               隐私开关（不存在则按默认值建档）
 * PATCH  /profile/me               更新开关
 * GET    /profile/consents         同意状态（含**未授权**的同意门模块）
 * POST   /profile/consents/:module 授权（幂等）
 * DELETE /profile/consents/:module 撤回（幂等，撤回后该模块立即不可用）
 * GET    /profile/export           数据导出（账号 + 开关 + 同意 + 内容条数）
 * ```
 */
export interface PrivacyRepository {
  settings(): Promise<Result<PrivacySettings, RepositoryError>>
  updateSettings(patch: Partial<PrivacySettings>): Promise<Result<PrivacySettings, RepositoryError>>
  consents(): Promise<Result<ConsentView[], RepositoryError>>
  grantConsent(module: string): Promise<Result<ConsentView, RepositoryError>>
  revokeConsent(module: string): Promise<Result<ConsentView, RepositoryError>>
  exportData(): Promise<Result<ProfileExport, RepositoryError>>
}
