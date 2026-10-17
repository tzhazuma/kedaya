import type { Result } from '@kedaya/shared'

import type {
  CampusIdentityView,
  CampusOverview,
  CampusPlatform,
} from '../models/identity'
import type { RepositoryError } from './errors'

/**
 * 身份（校园第二级）仓储端口。
 *
 * 端点（与后端 `CampusIdentityController` / `AuthController` 一一对应）：
 * ```
 * GET    /auth/campus/overview              四个校园系统各自的可用状态（一次拉齐）
 * GET    /auth/campus-identity?reveal=1     实名信息（默认脱敏；reveal 会写审计）
 * GET    /auth/campus-bindings              绑定状态摘要（`{platform, bound, expiresAt?}`）
 * POST   /auth/campus-bindings              绑定：`{provider, authCode}`（Phase 0 只有 `ecard`）
 * DELETE /auth/campus-bindings/:provider    解绑（路径参数是 §11.20-C 的小写枚举）
 * ```
 *
 * ⚠️ 绑定唯一的通道是 **OPENID + 一次性 `authCode`**（契约 §11.19-B）：
 * 没有"带上 sessionCookie 就能绑"的路径，Phase 0 也只有 `ecard` 能绑
 * （其余平台由服务端以 403 `PHASE_BLOCKED` 拒绝，U7）。
 * 「登录」与「绑定」是两件事：写操作都属"第二级"，
 * 未登录时后端返回 UNAUTHENTICATED —— 页面据此引导登录，不当成错误处理。
 */
export interface IdentityRepository {
  /** 绑定总览（页面首屏只需要这一个请求） */
  overview(): Promise<Result<CampusOverview, RepositoryError>>
  /** 实名信息；`reveal = true` 会返回明文并留下审计记录 */
  identity(reveal: boolean): Promise<Result<CampusIdentityView, RepositoryError>>
  /** 绑定校园系统（Phase 0 = `CARD`/`ecard` 的 OPENID 通道；其余平台被服务端闸门拒绝） */
  bind(platform: CampusPlatform): Promise<Result<{ platform: CampusPlatform }, RepositoryError>>
  /** 解绑校园系统 */
  unbind(platform: CampusPlatform): Promise<Result<{ platform: CampusPlatform }, RepositoryError>>
}
