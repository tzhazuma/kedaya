import { err, ok, type Result } from '@kedaya/shared'

import type {
  AccountSummaryDto,
  AuthSessionDto,
  CodeReceiptDto,
  PasswordResetResultDto,
  WechatConfigDto,
  WechatStatusDto,
} from '../../domain/models/auth'
import { isValidCode, normalizeEmail } from '../../domain/models/auth'
import { sanitizeNickname } from '../../domain/models/profile'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  AccountProfileDto,
  AuthRepository,
  BindEmailInput,
  ChangePasswordInput,
  LoginCodeInput,
  LogoutResultDto,
  PasswordStatusDto,
  UpdateProfileInput,
  WechatLoginInput,
} from '../../domain/ports/authRepository'

/**
 * 账号的 **Mock 实现**（`TARO_APP_USE_MOCK !== 'false'` 时启用）。
 *
 * 为什么还要保留一份 mock：
 *   契约 §7 硬规则 4 要求「无后端也能开发」。但这里的 mock 与旧骨架不同 ——
 *   它**完整复刻了真实后端的规则**（验证码一次性、密码错误文案统一、
 *   改密后旧令牌失效、微信 openid 与邮箱账号是同一份身份），
 *   因此页面行为在 mock 与真实后端下是一致的，
 *   不会出现「mock 下能过、接后端就崩」。
 *
 * 演示账号（登录页会提示）：`demo@kedaya.dev` / `Kedaya2026`
 * 微信演示：任意设备标识都会映射成稳定的 openid，可反复演示
 * 「首次注册 → 完善资料 → 再次登录 → 绑定邮箱 → 解绑微信」。
 */

export interface MockAuthOptions {
  latencyMs?: number
  now?: () => Date
}

type MockPurpose = 'register' | 'reset-password' | 'bind-email' | 'login'

interface MockAccount {
  id: string
  /** 邮箱（微信一键注册时还没有，为 null） */
  email: string | null
  displayName: string
  avatarUrl: string | null
  /** 空字符串 = 还没有邮箱密码 */
  password: string
  /** 绑定的微信 openid（null = 未绑定） */
  wechatOpenid: string | null
  /** 已发出的验证码（模拟"邮件已送达"） */
  codes: Partial<Record<MockPurpose, { code: string; expiresAt: number }>>
  /** 已签发的 refresh token（用于登出后失效） */
  sessions: Set<string>
}

const DEMO_EMAIL = 'demo@kedaya.dev'
const DEMO_PASSWORD = 'Kedaya2026'
const CODE_TTL_MS = 10 * 60 * 1000
const ACCESS_TTL_SECONDS = 2 * 3600

/** 与后端 `devOpenidFromCode` 一致：`dev:<设备标识>` → `dev_openid_<设备标识>` */
function openidFromCode(code: string): string {
  const trimmed = code.trim()
  if (trimmed.startsWith('dev:')) return `dev_openid_${trimmed.slice(4)}`
  return `mock_openid_${trimmed}`
}

function deriveNameFromOpenid(openid: string): string {
  const tail = openid.replace(/[^0-9A-Za-z]/g, '').slice(-4)
  return tail.length === 0 ? '微信同学' : `微信用户${tail}`
}

export function createMockAuthRepository(options: MockAuthOptions = {}): AuthRepository {
  const { latencyMs = 220, now = () => new Date() } = options

  /** 主存储：id → 账号。邮箱与 openid 是**同一份身份**的两个索引（对应后端的 User + AuthIdentity） */
  const accounts = new Map<string, MockAccount>()
  const emailIndex = new Map<string, string>()
  const openidIndex = new Map<string, string>()
  let sequence = 0

  function byEmail(email: string): MockAccount | undefined {
    const id = emailIndex.get(email)
    return id === undefined ? undefined : accounts.get(id)
  }

  function byOpenid(openid: string): MockAccount | undefined {
    const id = openidIndex.get(openid)
    return id === undefined ? undefined : accounts.get(id)
  }

  /** 当前登录账号（mock 里以"存在未吊销会话"近似） */
  function current(): MockAccount | undefined {
    return [...accounts.values()].find((account) => account.sessions.size > 0)
  }

  function createAccount(init: Partial<MockAccount> & { id: string }): MockAccount {
    const account: MockAccount = {
      id: init.id,
      email: init.email ?? null,
      displayName: init.displayName ?? '可达鸭同学',
      avatarUrl: init.avatarUrl ?? null,
      password: init.password ?? '',
      wechatOpenid: init.wechatOpenid ?? null,
      // 注意：这里必须带上初始验证码 —— 注册流程是「先发码（此刻建占位账号）→ 再用码」，
      // 丢掉它会让 register 永远报「请先获取验证码」。
      codes: init.codes ?? {},
      sessions: new Set(),
    }
    accounts.set(account.id, account)
    if (account.email !== null) emailIndex.set(account.email, account.id)
    if (account.wechatOpenid !== null) openidIndex.set(account.wechatOpenid, account.id)
    return account
  }

  // 预置演示账号：第一次打开就有一条能走通的登录路径
  createAccount({
    id: 'mock-user-demo',
    email: DEMO_EMAIL,
    displayName: '可达鸭演示号',
    password: DEMO_PASSWORD,
  })

  function delay<T>(value: T): Promise<T> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(value), latencyMs)
    })
  }

  function summarize(account: MockAccount): AccountSummaryDto {
    return {
      hasPassword: account.password !== '',
      email: account.email,
      wechatBound: account.wechatOpenid !== null,
      hasOtherLoginMethod: account.password !== '',
    }
  }

  function issueTokens(
    account: MockAccount,
    extra: { isNewUser?: boolean; simulated?: boolean } = {},
  ): AuthSessionDto {
    sequence += 1
    const refreshToken = `mock-refresh-${account.id}-${sequence}`
    account.sessions.add(refreshToken)

    return {
      user: {
        id: account.id,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        department: null,
        campusBound: false,
      },
      accessToken: `mock-access-${account.id}-${sequence}`,
      refreshToken,
      expiresIn: ACCESS_TTL_SECONDS,
      expiresAt: new Date(now().getTime() + ACCESS_TTL_SECONDS * 1000).toISOString(),
      ...(account.email === null ? {} : { email: account.email }),
      account: summarize(account),
      ...(extra.isNewUser === undefined ? {} : { isNewUser: extra.isNewUser }),
      ...(extra.simulated === undefined ? {} : { simulated: extra.simulated }),
    }
  }

  function validateCode(
    account: MockAccount,
    purpose: MockPurpose,
    code: string,
  ): Result<true, RepositoryError> {
    if (!isValidCode(code)) {
      return err({ code: 'VALIDATION_FAILED', message: '验证码是 6 位数字' })
    }
    const issued = account.codes[purpose]
    if (!issued) {
      return err({ code: 'VALIDATION_FAILED', message: '请先获取验证码' })
    }
    if (issued.expiresAt <= now().getTime()) {
      return err({ code: 'VALIDATION_FAILED', message: '验证码已过期，请重新获取' })
    }
    if (issued.code !== code) {
      return err({ code: 'VALIDATION_FAILED', message: '验证码不正确' })
    }
    delete account.codes[purpose] // 一次性：消费后立即作废
    return ok(true)
  }

  function receipts(
    email: string,
    purpose: CodeReceiptDto['purpose'],
    code: string,
  ): CodeReceiptDto {
    return {
      sent: true,
      email,
      purpose,
      expiresInSeconds: Math.floor(CODE_TTL_MS / 1000),
      devCode: code,
    }
  }

  function requireCurrent(): Result<MockAccount, RepositoryError> {
    const account = current()
    if (!account) {
      return err({ code: 'UNAUTHENTICATED', message: '请先登录' })
    }
    return ok(account)
  }

  function wechatStatusOf(account: MockAccount): WechatStatusDto {
    const bound = account.wechatOpenid !== null
    return {
      bound,
      provider: 'WECHAT_MINIPROGRAM',
      boundAt: bound ? now().toISOString() : null,
      lastLoginAt: bound ? now().toISOString() : null,
      simulated: account.wechatOpenid?.startsWith('dev_openid_') ?? false,
      canUnbind: bound && summarize(account).hasOtherLoginMethod,
    }
  }

  return {
    async requestRegisterCode(email) {
      const target = normalizeEmail(email)
      if (byEmail(target)) {
        return delay(
          err<RepositoryError>({ code: 'CONFLICT', message: '该邮箱已注册，请直接登录或使用找回密码' }),
        )
      }
      const code = '123456'
      createAccount({
        id: `mock-user-${target}`,
        email: target,
        displayName: target.split('@')[0] ?? '新同学',
        password: '',
        codes: { register: { code, expiresAt: now().getTime() + CODE_TTL_MS } },
      })
      return delay(ok(receipts(target, 'register', code)))
    },

    async register(input) {
      const target = normalizeEmail(input.email)
      const account = byEmail(target)
      if (!account) {
        return delay(err<RepositoryError>({ code: 'VALIDATION_FAILED', message: '请先获取验证码' }))
      }
      if (account.password !== '') {
        return delay(err<RepositoryError>({ code: 'CONFLICT', message: '该邮箱已注册，请直接登录' }))
      }
      const checked = validateCode(account, 'register', input.code)
      if (!checked.ok) return delay(checked)

      account.password = input.password
      const nickname = sanitizeNickname(input.displayName ?? '')
      if (nickname !== '') account.displayName = nickname
      return delay(ok(issueTokens(account, { isNewUser: true })))
    },

    async login(input) {
      const target = normalizeEmail(input.email)
      const account = byEmail(target)
      const wrong: RepositoryError = { code: 'UNAUTHENTICATED', message: '邮箱或密码不正确' }
      if (!account || account.password === '' || account.password !== input.password) {
        return delay(err(wrong))
      }
      return delay(ok(issueTokens(account)))
    },

    /**
     * 发送**登录用**验证码（免密登录）。
     *
     * 与后端一致：未注册的邮箱同样返回 `sent: true`（防账号枚举）。
     * 首次验证码登录会建号，因此这里先建一个**免密占位账号**
     * （`password === ''`，与 `requestRegisterCode` 的占位思路相同），
     * 验证码消费成功后才签发会话。
     */
    async requestLoginCode(email) {
      const target = normalizeEmail(email)
      const code = '135790'
      const existing = byEmail(target)
      const account =
        existing ??
        createAccount({
          id: `mock-user-${target}`,
          email: target,
          displayName: target.split('@')[0] ?? '新同学',
          password: '',
        })
      account.codes.login = { code, expiresAt: now().getTime() + CODE_TTL_MS }
      return delay(ok(receipts(target, 'login', code)))
    },

    async loginWithCode(input: LoginCodeInput) {
      const target = normalizeEmail(input.email)
      const account = byEmail(target)
      if (!account || !account.codes.login) {
        return delay(err<RepositoryError>({ code: 'VALIDATION_FAILED', message: '请先获取验证码' }))
      }
      const checked = validateCode(account, 'login', input.code)
      if (!checked.ok) return delay(checked)

      // 免密账号（从未设置密码）第一次用验证码登录 = 首次建号
      const isNewUser = account.password === '' && account.sessions.size === 0
      return delay(ok(issueTokens(account, { isNewUser })))
    },

    async requestResetCode(email) {
      const target = normalizeEmail(email)
      const account = byEmail(target)
      // 与后端一致：不存在的邮箱也返回 sent=true，避免枚举
      if (!account) return delay(ok(receipts(target, 'reset-password', '')))

      const code = '654321'
      account.codes['reset-password'] = { code, expiresAt: now().getTime() + CODE_TTL_MS }
      return delay(ok(receipts(target, 'reset-password', code)))
    },

    async resetPassword(input) {
      const target = normalizeEmail(input.email)
      const account = byEmail(target)
      if (!account) {
        return delay(err<RepositoryError>({ code: 'NOT_FOUND', message: '重置失败，请重新获取验证码' }))
      }
      const checked = validateCode(account, 'reset-password', input.code)
      if (!checked.ok) return delay(checked)

      account.password = input.password
      account.sessions.clear() // 所有设备下线
      return delay(ok<PasswordResetResultDto>({ reset: true, message: '密码已重置，请用新密码登录' }))
    },

    async changePassword(input: ChangePasswordInput) {
      const found = requireCurrent()
      if (!found.ok) return delay(found)
      const account = found.value

      if (account.password !== input.currentPassword) {
        return delay(err<RepositoryError>({ code: 'UNAUTHENTICATED', message: '当前密码不正确' }))
      }
      if (input.currentPassword === input.newPassword) {
        return delay(err<RepositoryError>({ code: 'VALIDATION_FAILED', message: '新密码不能与当前密码相同' }))
      }
      account.password = input.newPassword
      account.sessions.clear()
      return delay(ok(issueTokens(account)))
    },

    async logout(refreshToken) {
      let revoked = 0
      for (const account of accounts.values()) {
        if (refreshToken !== null && account.sessions.has(refreshToken)) {
          account.sessions.delete(refreshToken)
          revoked += 1
        } else if (refreshToken === null && account.sessions.size > 0) {
          revoked += account.sessions.size
          account.sessions.clear()
        }
      }
      return delay(ok<LogoutResultDto>({ loggedOut: true, revoked }))
    },

    async passwordStatus() {
      const account = current()
      return delay(ok<PasswordStatusDto>({ hasPassword: account !== undefined && account.password !== '' }))
    },
    async deleteAccount(input) {
      // mock 也要如实模拟后端的防误触：confirm 不对时**什么都不做**。
      if (input.confirm !== 'DELETE') {
        return err({ code: 'VALIDATION_FAILED', message: '确认字段必须是 DELETE' })
      }
      return ok({ deletedAt: new Date().toISOString() })
    },

    /* ---------------- 微信 ---------------- */

    async wechatConfig() {
      // mock 不走网络，自然也没有真实的小程序密钥 —— 诚实地报 false，
      // 让用例走「开发模拟凭证」分支（与真机上未配密钥的表现一致）。
      return delay(ok<WechatConfigDto>({ provider: 'WECHAT_MINIPROGRAM', configured: false, appIdTail: null }))
    },

    async loginWithWechat(input: WechatLoginInput) {
      if (input.code.trim() === '') {
        return delay(err<RepositoryError>({ code: 'VALIDATION_FAILED', message: '缺少微信登录凭证' }))
      }
      const openid = openidFromCode(input.code)

      const existing = byOpenid(openid)
      if (existing) {
        // 老用户：只更新这次真的给了的字段（不要把用户改过的昵称重置回微信名）
        const nickname = sanitizeNickname(input.displayName ?? '')
        if (nickname !== '') existing.displayName = nickname
        if (input.avatarDataUrl !== undefined) existing.avatarUrl = input.avatarDataUrl
        return delay(ok(issueTokens(existing, { isNewUser: false, simulated: true })))
      }

      const nickname = sanitizeNickname(input.displayName ?? '')
      const account = createAccount({
        id: `mock-wx-${openid}`,
        email: null,
        displayName: nickname === '' ? deriveNameFromOpenid(openid) : nickname,
        avatarUrl: input.avatarDataUrl ?? null,
        wechatOpenid: openid,
      })
      return delay(ok(issueTokens(account, { isNewUser: true, simulated: true })))
    },

    async wechatStatus() {
      const found = requireCurrent()
      if (!found.ok) return delay(found)
      return delay(ok(wechatStatusOf(found.value)))
    },

    async bindWechat(code) {
      const found = requireCurrent()
      if (!found.ok) return delay(found)
      const account = found.value

      if (code.trim() === '') {
        return delay(err<RepositoryError>({ code: 'VALIDATION_FAILED', message: '缺少微信登录凭证' }))
      }
      const openid = openidFromCode(code)
      const owner = byOpenid(openid)
      if (owner && owner.id !== account.id) {
        return delay(
          err<RepositoryError>({
            code: 'CONFLICT',
            message: '该微信已绑定到另一个可达鸭账号，请先用那个账号登录并解绑',
          }),
        )
      }
      account.wechatOpenid = openid
      openidIndex.set(openid, account.id)
      return delay(ok(wechatStatusOf(account)))
    },

    async unbindWechat() {
      const found = requireCurrent()
      if (!found.ok) return delay(found)
      const account = found.value

      if (account.wechatOpenid === null) {
        return delay(err<RepositoryError>({ code: 'NOT_FOUND', message: '当前账号未绑定微信' }))
      }
      if (account.password === '') {
        return delay(
          err<RepositoryError>({
            code: 'FORBIDDEN',
            message: '解绑微信后你将无法登录：请先设置邮箱密码，再解绑微信',
          }),
        )
      }
      openidIndex.delete(account.wechatOpenid)
      account.wechatOpenid = null
      return delay(ok(wechatStatusOf(account)))
    },

    /* ---------------- 资料与账号安全 ---------------- */

    async updateProfile(input: UpdateProfileInput) {
      const found = requireCurrent()
      if (!found.ok) return delay(found)
      const account = found.value

      const nickname = input.displayName === undefined ? '' : sanitizeNickname(input.displayName)
      if (input.displayName !== undefined && nickname === '') {
        return delay(err<RepositoryError>({ code: 'VALIDATION_FAILED', message: '昵称不能为空' }))
      }
      if (nickname !== '') account.displayName = nickname
      if (input.avatarUrl === null) account.avatarUrl = null
      else if (typeof input.avatarUrl === 'string') account.avatarUrl = input.avatarUrl

      return delay(
        ok<AccountProfileDto>({
          id: account.id,
          displayName: account.displayName,
          avatarUrl: account.avatarUrl,
          department: null,
        }),
      )
    },

    async requestBindEmailCode(email) {
      const found = requireCurrent()
      if (!found.ok) return delay(found)
      const account = found.value
      const target = normalizeEmail(email)

      if (account.password !== '') {
        return delay(
          err<RepositoryError>({ code: 'CONFLICT', message: '当前账号已设置邮箱密码，请使用「修改密码」' }),
        )
      }
      if (byEmail(target)) {
        return delay(err<RepositoryError>({ code: 'CONFLICT', message: '该邮箱已被其他账号使用，请换一个邮箱' }))
      }

      const code = '246810'
      account.codes['bind-email'] = { code, expiresAt: now().getTime() + CODE_TTL_MS }
      return delay(ok(receipts(target, 'bind-email', code)))
    },

    async bindEmail(input: BindEmailInput) {
      const found = requireCurrent()
      if (!found.ok) return delay(found)
      const account = found.value
      const target = normalizeEmail(input.email)

      if (account.password !== '') {
        return delay(err<RepositoryError>({ code: 'CONFLICT', message: '当前账号已设置邮箱密码' }))
      }
      if (byEmail(target)) {
        return delay(err<RepositoryError>({ code: 'CONFLICT', message: '该邮箱已被其他账号使用，请换一个邮箱' }))
      }
      const checked = validateCode(account, 'bind-email', input.code)
      if (!checked.ok) return delay(checked)

      account.email = target
      account.password = input.password
      emailIndex.set(target, account.id)
      return delay(ok(issueTokens(account)))
    },
  }
}
