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
 * GET    /auth/campus-bindings              已绑定的记录（不含任何 session）
 * POST   /auth/campus-bindings              绑定（mock 模式可省略 sessionCookie）
 * DELETE /auth/campus-bindings/:platform    解绑
 * ```
 *
 * 注意：绑定/解绑是**写操作**，但这些能力属于"第二级"，
 * 未登录时后端返回 UNAUTHENTICATED —— 页面据此引导登录，不当成错误处理。
 */
export interface IdentityRepository {
  /** 绑定总览（页面首屏只需要这一个请求） */
  overview(): Promise<Result<CampusOverview, RepositoryError>>
  /** 实名信息；`reveal = true` 会返回明文并留下审计记录 */
  identity(reveal: boolean): Promise<Result<CampusIdentityView, RepositoryError>>
  /** 绑定校园系统（本地开发/演示环境下无需真实 session） */
  bind(platform: CampusPlatform): Promise<Result<{ platform: CampusPlatform }, RepositoryError>>
  /** 解绑校园系统 */
  unbind(platform: CampusPlatform): Promise<Result<{ platform: CampusPlatform }, RepositoryError>>
}
