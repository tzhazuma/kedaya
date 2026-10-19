import { modulePath } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type {
  DeleteAccountResultDto,
  AccountProfileDto,
  AuthRepository,
  BindEmailInput,
  ChangePasswordInput,
  LoginCodeInput,
  LoginInput,
  LogoutResultDto,
  PasswordStatusDto,
  RegisterInput,
  ResetPasswordInput,
  UpdateProfileInput,
  WechatLoginInput,
} from '../../domain/ports/authRepository'
import type {
  AuthSessionDto,
  CodeReceiptDto,
  PasswordResetResultDto,
  WechatConfigDto,
  WechatStatusDto,
} from '../../domain/models/auth'
import { parseAuthSession } from '../../domain/models/auth'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ApiClient } from '../api'

/**
 * 账号的真实实现（HTTP）—— 直连 NestJS 后端，落 PostgreSQL。
 *
 * 四个刻意为之的点：
 *   1. **登录/注册/找回密码走匿名请求**：这些请求本来就没有 token，带上反而会
 *      触发 401 → 刷新 → 再 401 的无意义链路；
 *   2. 每个会话响应都过一遍 `parseAuthSession` 形状校验，坏数据在边界就被拦下；
 *   3. 传输失败 / 业务失败统一用 `RepositoryError` 表达，页面只需要看 `error.message`；
 *   4. 微信位置（`/auth/wechat`）与账号位置（`/auth/account`）**共用一个仓储**，
 *      因为它们操作的是同一份身份（契约 §5 第一级），分成两个仓储只会让
 *      页面里出现两个互相不知道对方状态的单例。
 */

const AUTH_BASE = modulePath('auth', 'account')
const WECHAT_BASE = `${modulePath('auth')}/wechat`
const ME_PATH = `${modulePath('auth')}/me`
// `DELETE /auth/account` —— 注销账号（与 `me` 同属账号资源，但语义是销毁）
const ACCOUNT_PATH = `${modulePath('auth')}/account`

/** 响应形状不对时统一翻成 INTERNAL（而不是让 undefined 流进 UI） */
function malformed(what: string): RepositoryError {
  return { code: 'UNKNOWN', message: `${what}响应格式不正确，请稍后重试` }
}

export function createHttpAuthRepository(api: ApiClient): AuthRepository {
  async function postSession(
    path: string,
    body: unknown,
  ): Promise<Result<AuthSessionDto, RepositoryError>> {
    const result = await api.post<unknown, unknown>(path, body, { anonymous: true })
    if (!result.ok) return result

    const parsed = parseAuthSession(result.value)
    if (parsed === null) return err(malformed('登录'))
    return ok(parsed)
  }

  /** 带令牌的会话请求（绑定邮箱/微信登录后续操作等） */
  async function authedSession(
    path: string,
    body: unknown,
  ): Promise<Result<AuthSessionDto, RepositoryError>> {
    const result = await api.post<unknown, unknown>(path, body)
    if (!result.ok) return result

    const parsed = parseAuthSession(result.value)
    if (parsed === null) return err(malformed('账号'))
    return ok(parsed)
  }

  return {
    async requestRegisterCode(email) {
      return api.post<CodeReceiptDto, { email: string }>(
        `${AUTH_BASE}/register/code`,
        { email },
        { anonymous: true },
      )
    },

    register(input: RegisterInput) {
      return postSession(`${AUTH_BASE}/register`, input)
    },

    login(input: LoginInput) {
      return postSession(`${AUTH_BASE}/login`, input)
    },

    async requestLoginCode(email) {
      return api.post<CodeReceiptDto, { email: string }>(
        `${AUTH_BASE}/login/code`,
        { email },
        { anonymous: true },
      )
    },

    loginWithCode(input: LoginCodeInput) {
      return postSession(`${AUTH_BASE}/login/code/verify`, input)
    },

    async requestResetCode(email) {
      return api.post<CodeReceiptDto, { email: string }>(
        `${AUTH_BASE}/password/forgot`,
        { email },
        { anonymous: true },
      )
    },

    async resetPassword(input: ResetPasswordInput) {
      return api.post<PasswordResetResultDto, ResetPasswordInput>(
        `${AUTH_BASE}/password/reset`,
        input,
        { anonymous: true },
      )
    },

    changePassword(input: ChangePasswordInput) {
      return postSession(`${AUTH_BASE}/password/change`, input)
    },

    async logout(refreshToken) {
      return api.post<LogoutResultDto, { refreshToken?: string }>(
        `${AUTH_BASE}/logout`,
        refreshToken === null ? {} : { refreshToken },
      )
    },

    async deleteAccount(input) {
      // ⚠️ 这是唯一一个 `DELETE` 会**永久改变账号状态**的调用。
      // 不在客户端做任何"预删除"，把判定权完全交给后端事务 ——
      // 客户端若先本地清缓存再调用，一旦后端回滚，用户会以为已注销。
      return api.del<DeleteAccountResultDto>(ACCOUNT_PATH)
    },

    async passwordStatus() {
      return api.get<PasswordStatusDto>(`${AUTH_BASE}/password/status`)
    },

    /* ---------------- 微信 ---------------- */

    async wechatConfig() {
      // 匿名端点：带上令牌也无害（后端没有 guard），且 GET 不支持 `anonymous` 选项
      return api.get<WechatConfigDto>(`${WECHAT_BASE}/config`)
    },

    async loginWithWechat(input: WechatLoginInput) {
      return postSession(`${WECHAT_BASE}/login`, input)
    },

    async wechatStatus() {
      return api.get<WechatStatusDto>(`${WECHAT_BASE}/binding`)
    },

    async bindWechat(code) {
      return api.post<WechatStatusDto, { code: string }>(`${WECHAT_BASE}/binding`, { code })
    },

    async unbindWechat() {
      return api.del<WechatStatusDto>(`${WECHAT_BASE}/binding`)
    },

    /* ---------------- 资料与账号安全 ---------------- */

    async updateProfile(input: UpdateProfileInput) {
      const result = await api.patch<AccountProfileDto, UpdateProfileInput>(ME_PATH, input)
      if (!result.ok) return result
      const value = result.value
      if (
        typeof value !== 'object' ||
        value === null ||
        typeof value.id !== 'string' ||
        typeof value.displayName !== 'string'
      ) {
        return err(malformed('资料更新'))
      }
      return result
    },

    async requestBindEmailCode(email) {
      return api.post<CodeReceiptDto, { email: string }>(`${AUTH_BASE}/bind-email/code`, { email })
    },

    bindEmail(input: BindEmailInput) {
      return authedSession(`${AUTH_BASE}/bind-email`, input)
    },
  }
}
