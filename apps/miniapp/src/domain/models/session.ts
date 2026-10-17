/**
 * 身份与会话领域模型 —— 纯 TypeScript，零框架依赖（契约 §5 / §7）。
 *
 * 契约 §5 的分层在这里体现为：
 * - 本文件只描述**第一级身份层**（KedaYa 自有 JWT）。
 * - 校园系统 session cookie（第二级能力层）**绝不**出现在这里，
 *   它由独立的 `CampusSessionPort` 承载（本骨架未实现，见 README「未实现」）。
 */

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  /** ISO-8601 UTC */
  expiresAt: string
}

export interface UserProfile {
  id: string
  nickname: string
  /** 学号（可空：登录后未必已绑定校园系统） */
  studentId?: string
  college?: string
  avatarUrl?: string
  /** 自建账号的邮箱（登录/注册时由服务端回带，用于「我的」页展示账号） */
  email?: string
  /** 是否已绑定校园系统（第二级能力层）。false 时校园功能返回 CAMPUS_BINDING_REQUIRED */
  campusBound: boolean
  /** 是否已绑定微信（决定「我的」页显示绑定还是解绑） */
  wechatBound?: boolean
  /** 是否设置了邮箱密码（微信一键注册的账号可能还没有） */
  hasPassword?: boolean
}

export interface Session {
  tokens: AuthTokens | null
  profile: UserProfile | null
}

export const EMPTY_SESSION: Session = { tokens: null, profile: null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isAuthTokens(value: unknown): value is AuthTokens {
  if (!isRecord(value)) return false
  return (
    typeof value.accessToken === 'string' &&
    value.accessToken.length > 0 &&
    typeof value.refreshToken === 'string' &&
    typeof value.expiresAt === 'string'
  )
}

export function isUserProfile(value: unknown): value is UserProfile {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.nickname === 'string' &&
    typeof value.campusBound === 'boolean'
  )
}

/** 缓存反序列化后的形状校验 —— 本地缓存可能被旧版本写入，必须防御 */
export function isSession(value: unknown): value is Session {
  if (!isRecord(value)) return false
  const tokensOk = value.tokens === null || isAuthTokens(value.tokens)
  const profileOk = value.profile === null || isUserProfile(value.profile)
  return tokensOk && profileOk
}

export function isAuthenticated(session: Session): boolean {
  return session.tokens !== null && session.profile !== null
}

/** access token 是否已过期（无法解析的 expiresAt 视为已过期，强制刷新） */
export function isAccessTokenExpired(tokens: AuthTokens, now: Date): boolean {
  const expiresAt = new Date(tokens.expiresAt).getTime()
  if (Number.isNaN(expiresAt)) return true
  return expiresAt <= now.getTime()
}
