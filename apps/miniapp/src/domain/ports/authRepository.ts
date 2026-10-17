import type { Result } from '@kedaya/shared'

import type { RepositoryError } from './errors'

import type {
  AuthSessionDto,
  CodeReceiptDto,
  PasswordResetResultDto,
  WechatConfigDto,
  WechatStatusDto,
} from '../models/auth'

/**
 * 账号（邮箱 + 密码 + 微信）端口 —— application 只依赖本接口，实现见 data/repositories。
 *
 * 端点清单见下方 `AuthRepository` 的注释。
 */

export interface RegisterInput {
  email: string
  code: string
  password: string
  displayName?: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface ResetPasswordInput {
  email: string
  code: string
  password: string
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export interface PasswordStatusDto {
  hasPassword: boolean
}

export interface LogoutResultDto {
  loggedOut: true
  revoked: number
}

/** 更新展示资料可改的字段（邮箱/学号由凭据决定，不可改） */
export interface UpdateProfileInput {
  displayName?: string
  /** 传 null 表示清空头像 */
  avatarUrl?: string | null
}

/** `PATCH /auth/me` 的响应：更新后的资料（**不含令牌**） */
export interface AccountProfileDto {
  id: string
  displayName: string
  avatarUrl: string | null
  department: string | null
}

/** 微信一键登录的输入（code 由 `WechatCodePort` 提供） */
export interface WechatLoginInput {
  code: string
  displayName?: string
  avatarDataUrl?: string
}

export interface BindEmailInput {
  email: string
  code: string
  password: string
}

/**
 * 账号端口 —— application 只依赖本接口，实现见 data/repositories。
 *
 * 后端端点（`services/api/src/modules/auth/`）：
 *   POST   /auth/account/register/code      POST /auth/account/register
 *   POST   /auth/account/login              POST /auth/account/password/forgot
 *   POST   /auth/account/password/reset     POST /auth/account/password/change （需登录）
 *   POST   /auth/account/logout             GET  /auth/account/password/status （需登录）
 *   POST   /auth/account/bind-email/code    POST /auth/account/bind-email      （需登录）
 *   GET    /auth/wechat/config              POST /auth/wechat/login
 *   GET    /auth/wechat/binding             POST /auth/wechat/binding          （需登录）
 *   DELETE /auth/wechat/binding                                                （需登录）
 *   PATCH  /auth/me                                                            （需登录）
 */

export interface RegisterInput {
  email: string
  code: string
  password: string
  displayName?: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface ResetPasswordInput {
  email: string
  code: string
  password: string
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export interface AuthRepository {
  requestRegisterCode(email: string): Promise<Result<CodeReceiptDto, RepositoryError>>
  register(input: RegisterInput): Promise<Result<AuthSessionDto, RepositoryError>>
  login(input: LoginInput): Promise<Result<AuthSessionDto, RepositoryError>>
  requestResetCode(email: string): Promise<Result<CodeReceiptDto, RepositoryError>>
  resetPassword(input: ResetPasswordInput): Promise<Result<PasswordResetResultDto, RepositoryError>>
  /** 修改密码成功后服务端会**换发一套新令牌**（旧会话全部作废） */
  changePassword(input: ChangePasswordInput): Promise<Result<AuthSessionDto, RepositoryError>>
  logout(refreshToken: string | null): Promise<Result<LogoutResultDto, RepositoryError>>
  passwordStatus(): Promise<Result<PasswordStatusDto, RepositoryError>>

  /* ---------------- 微信（第一级身份层的第三条入口） ---------------- */

  /** 服务端是否配置了真实小程序密钥（匿名；失败时按开发模式处理） */
  wechatConfig(): Promise<Result<WechatConfigDto, RepositoryError>>
  /** 一键登录 / 首次注册（同一 openid 首次调用会建号） */
  loginWithWechat(input: WechatLoginInput): Promise<Result<AuthSessionDto, RepositoryError>>
  /** 当前账号的微信绑定状态 */
  wechatStatus(): Promise<Result<WechatStatusDto, RepositoryError>>
  bindWechat(code: string): Promise<Result<WechatStatusDto, RepositoryError>>
  unbindWechat(): Promise<Result<WechatStatusDto, RepositoryError>>

  /* ---------------- 资料与账号安全 ---------------- */

  /** 改昵称 / 头像（三条登录路径共用） */
  updateProfile(input: UpdateProfileInput): Promise<Result<AccountProfileDto, RepositoryError>>
  /** 给微信账号补邮箱密码（也是「解绑微信」的前置条件） */
  requestBindEmailCode(email: string): Promise<Result<CodeReceiptDto, RepositoryError>>
  bindEmail(input: BindEmailInput): Promise<Result<AuthSessionDto, RepositoryError>>
}
