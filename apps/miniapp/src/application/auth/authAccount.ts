import { err, isShanghaiTechEmail, ok, type Result } from '@kedaya/shared'

import {
  isValidCode,
  isValidEmail,
  normalizeEmail,
  passwordIssues,
  toAuthTokens,
  toUserProfile,
} from '../../domain/models/auth'
import type {
  AuthSessionDto,
  CodeReceiptDto,
  WechatStatusDto,
} from '../../domain/models/auth'
import { isValidAvatarDataUrl, sanitizeNickname } from '../../domain/models/profile'
import type { Session, UserProfile } from '../../domain/models/session'
import type {
  AuthRepository,
  BindEmailInput,
  ChangePasswordInput,
  LoginCodeInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  UpdateProfileInput,
} from '../../domain/ports/authRepository'
import type { RepositoryError } from '../../domain/ports/errors'
import type { SessionStorePort } from '../../domain/ports/sessionPort'
import type { WechatCodePort } from '../../domain/ports/wechatPort'

/**
 * 账号用例 —— 页面操作身份状态的唯一入口（contract §7：presentation 只调用例）。
 *
 * 职责分工：
 *   · **客户端校验**：先本地拦掉显然非法的输入，即时提示、不发无谓请求；
 *   · **会话落盘**：登录/注册/微信登录/改密成功后把令牌与资料写入 `SessionStorePort`，
 *     页面不需要知道存储细节（`useSyncExternalStore` 会自动重渲染）；
 *   · **登出**：本地会话**无条件**清理 —— 断网也必须能登出；
 *   · **微信凭证**：由 `WechatCodePort` 提供（平台能力不下沉到用例里），
 *     用例只负责「先问服务端有没有真实密钥 → 再取凭证」这段编排。
 */

/** 微信一键登录的结果：会话 + 「是否首次建号」（后者决定要不要引导完善资料） */
export interface WechatLoginOutcome {
  session: Session
  isNewUser: boolean
  /** 是否走的开发模拟身份（UI 必须标注，不能冒充真实微信身份） */
  simulated: boolean
}

export interface AuthAccountUseCase {
  requestRegisterCode(email: string): Promise<Result<CodeReceiptDto, RepositoryError>>
  register(input: RegisterInput): Promise<Result<Session, RepositoryError>>
  login(input: LoginInput): Promise<Result<Session, RepositoryError>>
  requestResetCode(email: string): Promise<Result<CodeReceiptDto, RepositoryError>>
  /**
   * 发送**登录用**验证码（免密登录）。
   *
   * 与注册/找回码分开：服务端按 purpose 分别校验，登录码不能拿去注册。
   * 只有上科大校园邮箱可以走这条路径（见 `parseCampusEmailOrFail`）。
   */
  requestLoginCode(email: string): Promise<Result<CodeReceiptDto, RepositoryError>>
  /** 邮箱 + 验证码登录；首次登录自动建号（免密账号） */
  loginWithCode(input: LoginCodeInput): Promise<Result<Session, RepositoryError>>
  resetPassword(input: ResetPasswordInput): Promise<Result<string, RepositoryError>>
  changePassword(input: ChangePasswordInput): Promise<Result<Session, RepositoryError>>
  logout(): Promise<Result<true, RepositoryError>>

  /** 微信一键登录 / 首次注册 */
  loginWithWechat(input?: {
    displayName?: string
    avatarDataUrl?: string
  }): Promise<Result<WechatLoginOutcome, RepositoryError>>
  wechatStatus(): Promise<Result<WechatStatusDto, RepositoryError>>
  bindWechat(): Promise<Result<WechatStatusDto, RepositoryError>>
  unbindWechat(): Promise<Result<WechatStatusDto, RepositoryError>>

  /** 改昵称 / 头像（三条登录路径共用），成功后立刻更新本地会话资料 */
  updateProfile(input: UpdateProfileInput): Promise<Result<Session, RepositoryError>>
  /** 给微信账号补邮箱密码（也是「解绑微信」的前置条件） */
  requestBindEmailCode(email: string): Promise<Result<CodeReceiptDto, RepositoryError>>
  bindEmail(input: BindEmailInput): Promise<Result<Session, RepositoryError>>
}

export interface AuthAccountOptions {
  repository: AuthRepository
  session: SessionStorePort
  /** 微信登录凭证（平台能力）。测试可注入假实现 */
  wechatCode: WechatCodePort
  now?: () => Date
}

function invalid(message: string): Result<never, RepositoryError> {
  return err({ code: 'VALIDATION_FAILED', message })
}

/** 规范化邮箱；不合法时返回 RepositoryError（复用 `isValidEmail`，与后端同一套判定） */
function parseEmailOrFail(value: string): { email: string } | RepositoryError {
  const email = normalizeEmail(value)
  if (email.length === 0) return { code: 'VALIDATION_FAILED', message: '请输入邮箱' }
  if (!isValidEmail(email)) return { code: 'VALIDATION_FAILED', message: '邮箱格式不正确' }
  return { email }
}

function isRepositoryError(value: { email: string } | RepositoryError): value is RepositoryError {
  return 'code' in value
}

/**
 * 免密登录专用：在格式校验之外再加一道**校园邮箱**拦截。
 *
 * 依据：后端 `local-auth.service.ts` 的 `normalizeTarget()` 对所有验证码路径
 * （注册 / 登录 / 找回 / 绑定）强制 `isCampusEmail()`，只放行
 * `@shanghaitech.edu.cn` 与 `@stu.shanghaitech.edu.cn`。前端复用
 * `@kedaya/shared` 的 `isShanghaiTechEmail`（同一份域名白名单），
 * 只为即时反馈；最终裁决仍在后端。
 */
function parseCampusEmailOrFail(value: string): { email: string } | RepositoryError {
  const parsed = parseEmailOrFail(value)
  if (isRepositoryError(parsed)) return parsed
  if (!isShanghaiTechEmail(parsed.email)) {
    return {
      code: 'VALIDATION_FAILED',
      message:
        '请使用上海科技大学邮箱（@shanghaitech.edu.cn 或 @stu.shanghaitech.edu.cn）登录',
    }
  }
  return parsed
}

export function createAuthAccountUseCase(options: AuthAccountOptions): AuthAccountUseCase {
  const { repository, session, wechatCode, now = () => new Date() } = options

  function persist(dto: AuthSessionDto): Session {
    const tokens = toAuthTokens(dto, now())
    session.setTokens(tokens)
    return session.setProfile(toUserProfile(dto))
  }

  function assertPassword(value: string): Result<true, RepositoryError> {
    const issues = passwordIssues(value)
    if (issues.length > 0) {
      return invalid(`密码${issues.join('、')}`)
    }
    return ok(true)
  }

  /**
   * 取一个微信凭证：先问服务端有没有真实小程序密钥。
   *
   * 探测失败（断网 / 后端未部署该端点）时**按开发模式继续** ——
   * 本地演示不该因为一个探测请求失败就连登录按钮都点不动；
   * 真机上线时配置了密钥，探测自然成功。
   */
  async function nextWechatCode(): Promise<Result<string, RepositoryError>> {
    const config = await repository.wechatConfig()
    const preferReal = config.ok && config.value.configured
    const code = await wechatCode.requestCode({ preferReal })
    if (!code.ok) return code
    return ok(code.value.code)
  }

  return {
    async requestRegisterCode(rawEmail) {
      const email = parseEmailOrFail(rawEmail)
      if (isRepositoryError(email)) return err(email)
      return repository.requestRegisterCode(email.email)
    },

    async register(input) {
      const email = parseEmailOrFail(input.email)
      if (isRepositoryError(email)) return err(email)
      if (!isValidCode(input.code)) return invalid('验证码是 6 位数字')
      const strong = assertPassword(input.password)
      if (!strong.ok) return strong

      const nickname = input.displayName?.trim()
      const result = await repository.register({
        email: email.email,
        code: input.code,
        password: input.password,
        ...(nickname === undefined || nickname === '' ? {} : { displayName: nickname }),
      })
      if (!result.ok) return result
      return ok(persist(result.value))
    },

    async login(input) {
      const email = parseEmailOrFail(input.email)
      if (isRepositoryError(email)) return err(email)
      if (input.password.length === 0) return invalid('请输入密码')

      const result = await repository.login({ email: email.email, password: input.password })
      if (!result.ok) return result
      return ok(persist(result.value))
    },

    async requestLoginCode(rawEmail) {
      const email = parseCampusEmailOrFail(rawEmail)
      if (isRepositoryError(email)) return err(email)
      return repository.requestLoginCode(email.email)
    },

    async loginWithCode(input) {
      const email = parseCampusEmailOrFail(input.email)
      if (isRepositoryError(email)) return err(email)
      if (!isValidCode(input.code)) return invalid('验证码是 6 位数字')

      const result = await repository.loginWithCode({ email: email.email, code: input.code })
      if (!result.ok) return result
      return ok(persist(result.value))
    },

    async requestResetCode(rawEmail) {
      const email = parseEmailOrFail(rawEmail)
      if (isRepositoryError(email)) return err(email)
      return repository.requestResetCode(email.email)
    },

    async resetPassword(input) {
      const email = parseEmailOrFail(input.email)
      if (isRepositoryError(email)) return err(email)
      if (!isValidCode(input.code)) return invalid('验证码是 6 位数字')
      const strong = assertPassword(input.password)
      if (!strong.ok) return strong

      const result = await repository.resetPassword({
        email: email.email,
        code: input.code,
        password: input.password,
      })
      if (!result.ok) return result
      return ok(result.value.message)
    },

    async changePassword(input) {
      if (session.getSnapshot().tokens === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录' })
      }
      if (input.currentPassword.length === 0) return invalid('请输入当前密码')
      const strong = assertPassword(input.newPassword)
      if (!strong.ok) return strong
      if (input.currentPassword === input.newPassword) {
        return invalid('新密码不能与当前密码相同')
      }

      const result = await repository.changePassword(input)
      if (!result.ok) return result
      return ok(persist(result.value))
    },

    async logout() {
      const refreshToken = session.getSnapshot().tokens?.refreshToken ?? null
      try {
        await repository.logout(refreshToken)
      } catch {
        // 网络失败也要让用户登出：本地令牌是唯一的凭据来源
      }
      session.signOut()
      return ok(true)
    },

    /* ---------------- 微信一键登录 ---------------- */

    async loginWithWechat(input = {}) {
      const code = await nextWechatCode()
      if (!code.ok) return code

      const nickname = input.displayName === undefined ? undefined : sanitizeNickname(input.displayName)
      if (input.avatarDataUrl !== undefined && !isValidAvatarDataUrl(input.avatarDataUrl)) {
        return invalid('头像格式不正确或超过 64KB')
      }

      const result = await repository.loginWithWechat({
        code: code.value,
        ...(nickname === undefined || nickname === '' ? {} : { displayName: nickname }),
        ...(input.avatarDataUrl === undefined ? {} : { avatarDataUrl: input.avatarDataUrl }),
      })
      if (!result.ok) return result

      return ok({
        session: persist(result.value),
        isNewUser: result.value.isNewUser === true,
        simulated: result.value.simulated === true,
      })
    },

    async wechatStatus() {
      return repository.wechatStatus()
    },

    async bindWechat() {
      const code = await nextWechatCode()
      if (!code.ok) return code
      return repository.bindWechat(code.value)
    },

    async unbindWechat() {
      return repository.unbindWechat()
    },

    /* ---------------- 资料与账号安全 ---------------- */

    async updateProfile(input) {
      const current = session.getSnapshot().profile
      if (current === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录' })
      }

      let displayName: string | undefined
      if (input.displayName !== undefined) {
        displayName = sanitizeNickname(input.displayName)
        if (displayName === '') return invalid('昵称不能为空')
      }
      if (
        input.avatarUrl !== undefined &&
        input.avatarUrl !== null &&
        !isValidAvatarDataUrl(input.avatarUrl)
      ) {
        return invalid('头像格式不正确或超过 64KB')
      }
      if (displayName === undefined && input.avatarUrl === undefined) {
        return invalid('没有需要更新的内容')
      }

      const result = await repository.updateProfile({
        ...(displayName === undefined ? {} : { displayName }),
        ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
      })
      if (!result.ok) return result

      const next: UserProfile = { ...current, nickname: result.value.displayName }
      if (result.value.avatarUrl === null) delete next.avatarUrl
      else next.avatarUrl = result.value.avatarUrl
      if (result.value.department === null) delete next.college
      else next.college = result.value.department

      return ok(session.setProfile(next))
    },

    async requestBindEmailCode(rawEmail) {
      const email = parseEmailOrFail(rawEmail)
      if (isRepositoryError(email)) return err(email)
      if (session.getSnapshot().profile === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录' })
      }
      return repository.requestBindEmailCode(email.email)
    },

    async bindEmail(input) {
      const email = parseEmailOrFail(input.email)
      if (isRepositoryError(email)) return err(email)
      if (!isValidCode(input.code)) return invalid('验证码是 6 位数字')
      const strong = assertPassword(input.password)
      if (!strong.ok) return strong

      const result = await repository.bindEmail({
        email: email.email,
        code: input.code,
        password: input.password,
      })
      if (!result.ok) return result
      return ok(persist(result.value))
    },
  }
}
