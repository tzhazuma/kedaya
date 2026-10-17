import { modulePath } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { CampusIdentityView, CampusOverview, CampusPlatform } from '../../domain/models/identity'
import type { RepositoryError } from '../../domain/ports/errors'
import type { IdentityRepository } from '../../domain/ports/identityRepository'
import type { ApiClient } from '../api/request'
import { requestWechatLoginCode } from '../../platform/wechatLogin'
import { toRepositoryError } from './toRepositoryError'

/**
 * 模型平台（大写，auth 旧实现的拼法）→ 契约 §11.20-C 的**统一枚举**（小写）。
 *
 * ⚠️ 这是一座**显式**的桥，不是"顺便兼容一下"：
 *   · §11.20-C/D 把两套枚举收敛成一套小写枚举，并**删除全部加法兼容别名** ——
 *     服务端**不会**接受 `CARD` 这种写法（那正是别名要消灭的东西）；
 *   · 客户端模型仍是大写（`domain/models/identity.ts`，本轮不重命名，避免
 *     大面积 diff 与既有缓存/键名迁移）；
 *   · 于是翻译必须发生在一个**显式、可搜索**的地方（这里），而不是
 *     散落在 URL 拼接里（`toLowerCase()` 会把 `CPDAILY` 变成 `cpdaily` 碰巧对，
 *     但 `CARD` 会变成 `card` —— 那是**错的**，而且错得静默）。
 *
 * 待身份模型本身收敛到统一枚举后，这张表随之删除。
 */
const WIRE_PROVIDER: Readonly<Record<CampusPlatform, string>> = {
  EGATE: 'egate',
  JWC: 'jwc',
  CPDAILY: 'cpdaily',
  CARD: 'ecard',
}

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
      // 绑定链路只有一条：OPENID 通道 + 一次性 `authCode`（契约 §11.19-B / §11.20）。
      //
      //   · `authCode` 由 `wx.login` **现场**取，不缓存、不进日志、不复用
      //     （它是一次性凭证，5 分钟有效，用后即焚）；
      //   · Phase 0 只有 `ecard` 能绑，其余 provider 由**服务端**的闸门拒绝
      //     （403 `PHASE_BLOCKED`）。阶段表只在服务端有一份 ——
      //     客户端如果复刻它，会出现"服务端已开放、客户端还挡着"的漂移。
      const login = await requestWechatLoginCode()
      if (!login.ok) {
        // 平台失败（H5 没有微信登录 / 用户取消 / 调用出错）不属于 API 错误码体系，
        // 统一归到 `UNKNOWN`，但**保留平台自己写的中文文案**（它已说清是哪一种）。
        return err({ code: 'UNKNOWN', message: login.error.message })
      }

      const result = await client.post<{ platform: string }, { provider: string; authCode: string }>(
        `${base}/campus-bindings`,
        { provider: WIRE_PROVIDER[platform], authCode: login.value.code },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({ platform })
    },

    async unbind(platform: CampusPlatform): Promise<Result<{ platform: CampusPlatform }, RepositoryError>> {
      // 路径参数用 §11.20-C 的统一枚举（小写）—— 大写拼法（`CARD`）不在枚举里，
      // 服务端会以 `VALIDATION_FAILED` 明确拒绝，而不是猜我们要解绑谁。
      const result = await client.del<{ platform: string }>(
        `${base}/campus-bindings/${encodeURIComponent(WIRE_PROVIDER[platform])}`,
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({ platform })
    },
  }
}
