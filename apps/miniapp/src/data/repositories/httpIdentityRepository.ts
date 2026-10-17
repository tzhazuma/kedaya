import { modulePath } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { CampusIdentityView, CampusOverview, CampusPlatform } from '../../domain/models/identity'
import type { RepositoryError } from '../../domain/ports/errors'
import type { IdentityRepository } from '../../domain/ports/identityRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端身份仓储。
 *
 * 只做 URL + 类型映射；信封解包、Bearer、trace、401 刷新重试都由 `ApiClient` 负责。
 * `reveal` 用字符串 `'1'` 传（后端按字符串校验查询参数）。
 */
export function createHttpIdentityRepository(client: ApiClient): IdentityRepository {
  const base = modulePath('auth')

  return {
    async overview(): Promise<Result<CampusOverview, RepositoryError>> {
      const result = await client.get<CampusOverview>(`${base}/campus/overview`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async identity(reveal: boolean): Promise<Result<CampusIdentityView, RepositoryError>> {
      const result = await client.get<CampusIdentityView>(`${base}/campus-identity`, {
        reveal: reveal ? '1' : undefined,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async bind(platform: CampusPlatform): Promise<Result<{ platform: CampusPlatform }, RepositoryError>> {
      // 开发/演示环境服务端会签发演示凭据；真实环境这里应带上校园系统回调的 sessionCookie
      const result = await client.post<{ platform: CampusPlatform }, { platform: CampusPlatform }>(
        `${base}/campus-bindings`,
        { platform },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({ platform })
    },

    async unbind(platform: CampusPlatform): Promise<Result<{ platform: CampusPlatform }, RepositoryError>> {
      const result = await client.del<{ platform: CampusPlatform }>(
        `${base}/campus-bindings/${encodeURIComponent(platform)}`,
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({ platform })
    },
  }
}
