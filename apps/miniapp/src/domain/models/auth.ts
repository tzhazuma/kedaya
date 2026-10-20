import type { AuthTokens, UserProfile } from './session'

/**
 * 自建账号（邮箱 + 密码）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 与 `session.ts` 的分工：
 *   · 本文件描述**登录/注册/改密这些动作的数据形状**（服务端 DTO 的镜像）；
 *   · `session.ts` 描述**登录之后长期存在的会话状态**。
 *
 * 校验规则与后端 `services/api/src/modules/auth/domain/password.ts`、
 * `verification-code.ts` **必须一致**：客户端校验只是为了即时提示，
 * 服务端才是最终裁决（永远不要因为"前端校验过了"就信任请求）。
 */

/* ---------------- 服务端响应形状 ---------------- */

/** 后端 `UserRecord` 的镜像（契约 §5：只有 KedaYa 自有身份，无校园凭据） */
export interface AuthUserDto {
  id: string
  displayName: string
  avatarUrl: string | null
  department: string | null
  /** 登录 ≠ 已绑定校园系统，故这里是恒定的 false（契约 §5 硬规则 3） */
  campusBound?: boolean
}

/**
 * 账号登录方式概览（后端 `domain/account-summary.ts` 的镜像）。
 *
 * 三条登录路径（CAS / 邮箱密码 / 微信）都返回它，「我的」页因此可以
 * 一次性渲染出「还差哪种登录方式」，而不用按登录入口分叉。
 */
export interface AccountSummaryDto {
  /** 是否设置了邮箱密码 */
  hasPassword: boolean
  /** 绑定的邮箱（没有则 null） */
  email: string | null
  /** 是否绑定了微信 */
  wechatBound: boolean
  /** 是否还有除微信之外的登录方式（决定「解绑微信」能否点） */
  hasOtherLoginMethod: boolean
}

/** 登录 / 注册 / 微信一键登录的响应：一对令牌 + 用户资料 + 账号概览 */
export interface AuthSessionDto {
  user: AuthUserDto
  accessToken: string
  refreshToken: string
  /** access token 有效期（秒） */
  expiresIn: number
  /** 可选：部分端点直接给绝对过期时间（ISO-8601） */
  expiresAt?: string
  /** 该账号绑定的邮箱（注册/登录时服务端回带） */
  email?: string
  /** 账号登录方式概览 */
  account?: AccountSummaryDto
  /** 本次调用是否首次建号（仅微信一键登录可能为 true） */
  isNewUser?: boolean
  /** 是否走的开发模拟身份（仅微信登录可能为 true） */
  simulated?: boolean
}

/** 微信绑定状态（后端 `WechatStatus` 的镜像；**不含 openid**） */
export interface WechatStatusDto {
  bound: boolean
  provider: string
  boundAt: string | null
  lastLoginAt: string | null
  /** 是否是开发模拟身份 */
  simulated: boolean
  /** 能否解绑（账号还有别的登录方式吗） */
  canUnbind: boolean
}

/** 服务端是否配置了真实小程序密钥（匿名端点，用于决定走真实还是模拟登录） */
export interface WechatConfigDto {
  provider: string
  configured: boolean
  appIdTail: string | null
}

/** 验证码发送回执 */
export interface CodeReceiptDto {
  sent: true
  email: string
  /**
   * 验证码用途 —— 与后端 `VerificationPurpose` 一一对应。
   *
   * `login` 是**免密登录**（`POST /auth/account/login/code`）：与注册码分开存放，
   * 注册码不能拿来登录，登录码也不能拿来注册（服务端按 purpose 分别校验）。
   */
  purpose:
    | 'register'
    | 'reset-password'
    | 'change-password'
    | 'bind-email'
    | 'login'
    /**
     * 注销确认码。与 `login` 分开存放 —— 一个登录码不能拿来注销账号，
     * 否则「我想登进来」和「我想销毁这个号」会共用同一个凭据。
     */
    | 'delete-account'
  expiresInSeconds: number
  /**
   * **仅开发环境**后端回带的验证码（`AUTH_DEV_EXPOSE_CODES=true`）。
   * 页面会在界面上明确标注「开发模式」，避免误以为是线上行为。
   */
  devCode?: string
}

export interface PasswordResetResultDto {
  reset: true
  message: string
}

/* ---------------- 客户端校验（与后端同规则） ---------------- */

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 64
export const CODE_DIGITS = 6

/** 规范化邮箱：小写 + 去空白（与后端 `normalizeEmail` 一致） */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * 邮箱格式校验（与后端 `isEmailLike` 保持同一套判定）：
 * 拒绝空格、连续点、本地部分以点开头/结尾、缺少 TLD 等。
 */
export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value)
  if (email.length === 0 || email.length > 254) return false
  if (/\s/.test(email)) return false
  if (email.includes('..')) return false

  const atIndex = email.lastIndexOf('@')
  if (atIndex <= 0) return false
  const local = email.slice(0, atIndex)
  const domain = email.slice(atIndex + 1)
  if (local.startsWith('.') || local.endsWith('.')) return false
  if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) return false
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(domain)
}

/** 密码强度问题清单（空数组 = 通过）。用于输入框下方的即时提示。 */
export function passwordIssues(value: string): string[] {
  const issues: string[] = []
  const length = [...value].length
  if (length < PASSWORD_MIN_LENGTH) issues.push(`至少 ${PASSWORD_MIN_LENGTH} 位`)
  if (length > PASSWORD_MAX_LENGTH) issues.push(`最多 ${PASSWORD_MAX_LENGTH} 位`)
  if (!/[A-Za-z]/.test(value)) issues.push('需要包含字母')
  if (!/\d/.test(value)) issues.push('需要包含数字')
  if (/\s/.test(value)) issues.push('不能包含空格')
  return issues
}

export function isValidPassword(value: string): boolean {
  return passwordIssues(value).length === 0
}

/** 验证码必须是 6 位数字 */
export function isValidCode(value: string): boolean {
  return new RegExp(`^\\d{${CODE_DIGITS}}$`).test(value)
}

/* ---------------- 映射（DTO → 会话模型） ---------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 响应形状校验。
 *
 * 为什么不信任服务端返回：契约 §6.1 要求"绝不放行未校验的数据"。
 * 任何字段缺失都返回 null，由仓储层翻成 INTERNAL 失败，
 * 而不是让 `undefined` 一路流到 UI 变成 `NaN` / 空白页。
 */
export function parseAuthSession(value: unknown): AuthSessionDto | null {
  if (!isRecord(value)) return null
  const user = value.user
  if (!isRecord(user)) return null
  if (typeof user.id !== 'string' || user.id.length === 0) return null
  if (typeof user.displayName !== 'string' || user.displayName.length === 0) return null
  if (typeof value.accessToken !== 'string' || value.accessToken.length === 0) return null
  if (typeof value.refreshToken !== 'string' || value.refreshToken.length === 0) return null
  if (typeof value.expiresIn !== 'number' || !Number.isFinite(value.expiresIn)) return null

  const account = parseAccountSummary(value.account)

  return {
    user: {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : null,
      department: typeof user.department === 'string' ? user.department : null,
      ...(typeof user.campusBound === 'boolean' ? { campusBound: user.campusBound } : {}),
    },
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    expiresIn: value.expiresIn,
    ...(typeof value.expiresAt === 'string' ? { expiresAt: value.expiresAt } : {}),
    ...(typeof value.email === 'string' ? { email: value.email } : {}),
    ...(account === undefined ? {} : { account }),
    ...(typeof value.isNewUser === 'boolean' ? { isNewUser: value.isNewUser } : {}),
    ...(typeof value.simulated === 'boolean' ? { simulated: value.simulated } : {}),
  }
}

/** 账号概览：字段不齐就整体弃用（宁可少显示一段，也不要显示 undefined） */
export function parseAccountSummary(value: unknown): AccountSummaryDto | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.hasPassword !== 'boolean') return undefined
  if (typeof value.wechatBound !== 'boolean') return undefined
  if (typeof value.hasOtherLoginMethod !== 'boolean') return undefined
  if (value.email !== null && typeof value.email !== 'string') return undefined

  return {
    hasPassword: value.hasPassword,
    email: typeof value.email === 'string' ? value.email : null,
    wechatBound: value.wechatBound,
    hasOtherLoginMethod: value.hasOtherLoginMethod,
  }
}

/** 令牌：优先用服务端给的绝对过期时间，否则用 `expiresIn` 换算 */
export function toAuthTokens(dto: AuthSessionDto, now: Date): AuthTokens {
  return {
    accessToken: dto.accessToken,
    refreshToken: dto.refreshToken,
    expiresAt: dto.expiresAt ?? new Date(now.getTime() + dto.expiresIn * 1000).toISOString(),
  }
}

/**
 * DTO → 会话资料。
 *
 * 注意 `campusBound`：邮箱注册的账号**没有**绑定校园系统，
 * 因此这里恒为 false —— 校园功能由后端返回 `CAMPUS_BINDING_REQUIRED`。
 */
export function toUserProfile(dto: AuthSessionDto): UserProfile {
  const account = dto.account
  return {
    id: dto.user.id,
    nickname: dto.user.displayName,
    campusBound: dto.user.campusBound ?? false,
    ...(dto.user.avatarUrl === null ? {} : { avatarUrl: dto.user.avatarUrl }),
    ...(dto.user.department === null ? {} : { college: dto.user.department }),
    ...(dto.email === undefined ? {} : { email: dto.email }),
    // 账号概览缺失时（旧后端 / 缓存）不写这两个字段，避免「明明没绑微信却显示已绑」
    ...(account === undefined
      ? {}
      : {
          wechatBound: account.wechatBound,
          hasPassword: account.hasPassword,
          ...(account.email === null ? {} : { email: account.email }),
        }),
  }
}
