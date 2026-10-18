import { describe, expect, it } from 'vitest'

import { createAuthAccountUseCase } from '../authAccount'
import { EMPTY_SESSION } from '../../../domain/models/session'
import type { Session } from '../../../domain/models/session'
import type { AuthSessionDto, WechatStatusDto } from '../../../domain/models/auth'
import type {
  AuthRepository,
  ChangePasswordInput,
  LoginInput,
  LogoutResultDto,
  PasswordStatusDto,
  RegisterInput,
  ResetPasswordInput,
  UpdateProfileInput,
  WechatLoginInput,
} from '../../../domain/ports/authRepository'
import type { RepositoryError } from '../../../domain/ports/errors'
import type { SessionListener, SessionStorePort } from '../../../domain/ports/sessionPort'
import type { WechatCodePort } from '../../../domain/ports/wechatPort'
import { err, ok } from '@kedaya/shared'

/**
 * 账号用例规格。
 *
 * 这里用**手写假仓储**（记录调用参数）而不是 mock 实现，目的是把「用例自己的职责」
 * 单独钉死：客户端校验是否真的拦住了请求、成功后是否真的把会话落盘、
 * 断网时登出是否仍然有效。数据层的真实行为另有
 * `data/repositories/__tests__/mockAuthRepository.test.ts` 覆盖。
 */

const NOW = new Date('2026-03-01T10:00:00.000Z')
const EMAIL = 'duck@kedaya.dev'

function sessionDto(refreshToken = 'refresh-1'): AuthSessionDto {
  return {
    user: { id: 'u-1', displayName: '黄鸭', avatarUrl: null, department: null },
    accessToken: 'access-1',
    refreshToken,
    expiresIn: 7200,
    email: EMAIL,
  }
}

function wechatStatusDto(bound = true): WechatStatusDto {
  return {
    bound,
    provider: 'WECHAT_MINIPROGRAM',
    boundAt: null,
    lastLoginAt: null,
    simulated: true,
    canUnbind: bound,
  }
}

interface FakeCalls {
  register: RegisterInput[]
  login: LoginInput[]
  resetPassword: ResetPasswordInput[]
  changePassword: ChangePasswordInput[]
  requestRegisterCode: string[]
  requestResetCode: string[]
  requestLoginCode: string[]
  loginWithCode: { email: string; code: string }[]
  logout: (string | null)[]
  loginWithWechat: WechatLoginInput[]
  bindWechat: string[]
  unbindWechat: number
  updateProfile: UpdateProfileInput[]
  bindEmail: { email: string; code: string; password: string }[]
  wechatCodePreferReal: boolean[]
}

function createFakeRepository(overrides: Partial<AuthRepository> = {}): {
  repository: AuthRepository
  calls: FakeCalls
} {
  const calls: FakeCalls = {
    register: [],
    login: [],
    resetPassword: [],
    changePassword: [],
    requestRegisterCode: [],
    requestResetCode: [],
    requestLoginCode: [],
    loginWithCode: [],
    logout: [],
    loginWithWechat: [],
    bindWechat: [],
    unbindWechat: 0,
    updateProfile: [],
    bindEmail: [],
    wechatCodePreferReal: [],
  }

  const repository: AuthRepository = {
    async requestRegisterCode(email) {
      calls.requestRegisterCode.push(email)
      return ok({ sent: true, email, purpose: 'register', expiresInSeconds: 600 })
    },
    async requestLoginCode(email) {
      calls.requestLoginCode.push(email)
      // 与后端一致：**不区分邮箱是否已注册**，形状完全相同（防枚举）
      return ok({ sent: true, email, purpose: 'login', expiresInSeconds: 600 })
    },
    async loginWithCode(input) {
      calls.loginWithCode.push(input)
      return ok(sessionDto())
    },
    async register(input) {
      calls.register.push(input)
      return ok(sessionDto())
    },
    async login(input) {
      calls.login.push(input)
      return ok(sessionDto())
    },
    async requestResetCode(email) {
      calls.requestResetCode.push(email)
      return ok({ sent: true, email, purpose: 'reset-password', expiresInSeconds: 600 })
    },
    async resetPassword(input) {
      calls.resetPassword.push(input)
      return ok({ reset: true, message: '密码已重置，请用新密码登录' })
    },
    async changePassword(input) {
      calls.changePassword.push(input)
      return ok(sessionDto('refresh-2'))
    },
    async logout(refreshToken) {
      calls.logout.push(refreshToken)
      return ok<LogoutResultDto>({ loggedOut: true, revoked: 1 })
    },
    async passwordStatus() {
      return ok<PasswordStatusDto>({ hasPassword: true })
    },
    async wechatConfig() {
      return ok({ provider: 'WECHAT_MINIPROGRAM', configured: false, appIdTail: null })
    },
    async loginWithWechat(input) {
      calls.loginWithWechat.push(input)
      return ok({
        ...sessionDto('refresh-wx-1'),
        account: { hasPassword: false, email: null, wechatBound: true, hasOtherLoginMethod: false },
        isNewUser: true,
        simulated: true,
      })
    },
    async wechatStatus() {
      return ok(wechatStatusDto())
    },
    async bindWechat(code) {
      calls.bindWechat.push(code)
      return ok(wechatStatusDto(true))
    },
    async unbindWechat() {
      calls.unbindWechat += 1
      return ok(wechatStatusDto(false))
    },
    async updateProfile(input) {
      calls.updateProfile.push(input)
      return ok({
        id: 'u-1',
        displayName: input.displayName ?? '黄鸭',
        avatarUrl: input.avatarUrl ?? null,
        department: null,
      })
    },
    async requestBindEmailCode(email) {
      return ok({ sent: true, email, purpose: 'bind-email', expiresInSeconds: 600 })
    },
    async bindEmail(input) {
      calls.bindEmail.push(input)
      return ok(sessionDto('refresh-3'))
    },
    ...overrides,
  }

  return { repository, calls }
}

/** 假微信凭证端口：记录用例是否要求「真实 code」，并返回可预测的凭证 */
function createFakeWechatCode(): { port: WechatCodePort; preferReal: boolean[] } {
  const preferReal: boolean[] = []
  const port: WechatCodePort = {
    async requestCode(options) {
      preferReal.push(options.preferReal)
      return ok({ code: 'dev:test-device', simulated: !options.preferReal })
    },
  }
  return { port, preferReal }
}

function setup(overrides: Partial<AuthRepository> = {}) {
  const { repository, calls } = createFakeRepository(overrides)
  const session = createFakeSessionStore()
  const wechatCode = createFakeWechatCode()
  const useCase = createAuthAccountUseCase({
    repository,
    session,
    wechatCode: wechatCode.port,
    now: () => NOW,
  })
  return { repository, calls, session, useCase, wechatCode }
}

function validateError(message: string): RepositoryError {
  return { code: 'VALIDATION_FAILED', message }
}

/**
 * 假会话存储 —— 刻意**自己写一份**而不是 import `data/storage/sessionStore`。
 *
 * 分层规则（契约 §7）：`application/**` 不得依赖 `data/**` 的具体 adapter，
 * 只能依赖 `domain/ports`。ESLint 的 `no-restricted-imports` 会把这条规则变成硬错误，
 * 这里遵守它，顺便证明「用例只需要端口，不关心存到哪」。
 */
function createFakeSessionStore(): SessionStorePort {
  let snapshot: Session = EMPTY_SESSION
  const listeners = new Set<SessionListener>()

  function commit(next: Session): Session {
    snapshot = next
    for (const listener of listeners) listener()
    return next
  }

  return {
    read: () => snapshot,
    getSnapshot: () => snapshot,
    persist: (next) => {
      commit(next)
    },
    clear: () => {
      commit(EMPTY_SESSION)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setTokens: (tokens) => commit({ ...snapshot, tokens }),
    setProfile: (profile) => commit({ ...snapshot, profile }),
    signOut: () => commit(EMPTY_SESSION),
  }
}

describe('登录', () => {
  it('成功后把令牌与资料写入会话（expiresIn 换算成绝对时间）', async () => {
    const { useCase, session, calls } = setup()

    const result = await useCase.login({ email: ' Duck@KedaYa.dev ', password: 'Kedaya2026' })

    expect(result.ok).toBe(true)
    // 邮箱先被规范化再发给后端
    expect(calls.login).toEqual([{ email: EMAIL, password: 'Kedaya2026' }])

    const snapshot = session.getSnapshot()
    expect(snapshot.tokens?.accessToken).toBe('access-1')
    expect(snapshot.tokens?.expiresAt).toBe('2026-03-01T12:00:00.000Z')
    expect(snapshot.profile?.nickname).toBe('黄鸭')
    expect(snapshot.profile?.email).toBe(EMAIL)
    expect(snapshot.profile?.campusBound).toBe(false)
  })

  it('邮箱非法时不发请求，直接返回校验失败', async () => {
    const { useCase, session, calls } = setup()

    const result = await useCase.login({ email: 'not-an-email', password: 'Kedaya2026' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toEqual(validateError('邮箱格式不正确'))
    }
    expect(calls.login).toHaveLength(0)
    expect(session.getSnapshot().tokens).toBeNull()
  })

  it('密码为空时不发请求', async () => {
    const { useCase, calls } = setup()

    const result = await useCase.login({ email: EMAIL, password: '' })

    expect(result.ok).toBe(false)
    expect(calls.login).toHaveLength(0)
  })

  it('后端拒绝（密码错误）时原样透传错误，且不落盘任何会话', async () => {
    const { useCase, session } = setup({
      async login() {
        return err<RepositoryError>({ code: 'UNAUTHENTICATED', message: '邮箱或密码不正确' })
      },
    })

    const result = await useCase.login({ email: EMAIL, password: 'wrong-pass' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(session.getSnapshot().tokens).toBeNull()
    expect(session.getSnapshot().profile).toBeNull()
  })
})

describe('注册', () => {
  it('弱密码在本地就被拦下（不发请求）', async () => {
    const { useCase, calls } = setup()

    const result = await useCase.register({ email: EMAIL, code: '123456', password: '12345678' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('字母')
    expect(calls.register).toHaveLength(0)
  })

  it('验证码位数不对时被拦下', async () => {
    const { useCase, calls } = setup()

    const result = await useCase.register({ email: EMAIL, code: '12345', password: 'Kedaya2026' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('6 位')
    expect(calls.register).toHaveLength(0)
  })

  it('昵称为空时不向后端发送空字符串字段', async () => {
    const { useCase, calls } = setup()

    await useCase.register({
      email: EMAIL,
      code: '123456',
      password: 'Kedaya2026',
      displayName: '',
    })

    expect(calls.register).toHaveLength(1)
    expect(calls.register[0]).toEqual({ email: EMAIL, code: '123456', password: 'Kedaya2026' })
  })

  it('成功后直接登录（写会话）', async () => {
    const { useCase, session } = setup()

    const result = await useCase.register({
      email: EMAIL,
      code: '123456',
      password: 'Kedaya2026',
      displayName: '可达鸭',
    })

    expect(result.ok).toBe(true)
    expect(session.getSnapshot().tokens).not.toBeNull()
  })
})

describe('找回密码', () => {
  it('重置成功只返回提示文案，不把用户登入（必须用新密码重新登录）', async () => {
    const { useCase, session } = setup()

    const result = await useCase.resetPassword({
      email: EMAIL,
      code: '654321',
      password: 'NewKedaya2026',
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toContain('重置')
    expect(session.getSnapshot().tokens).toBeNull()
  })

  it('邮箱非法时连验证码请求都不发', async () => {
    const { useCase, calls } = setup()

    await useCase.requestResetCode('bad')

    expect(calls.requestResetCode).toHaveLength(0)
  })

  it('验证码位数不对时不发重置请求', async () => {
    const { useCase, calls } = setup()

    await useCase.resetPassword({ email: EMAIL, code: '1', password: 'NewKedaya2026' })

    expect(calls.resetPassword).toHaveLength(0)
  })
})

describe('修改密码', () => {
  it('未登录时直接拒绝，不发请求', async () => {
    const { useCase, calls } = setup()

    const result = await useCase.changePassword({
      currentPassword: 'Kedaya2026',
      newPassword: 'NewKedaya2026',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(calls.changePassword).toHaveLength(0)
  })

  it('新旧密码相同被本地拦下', async () => {
    const { useCase, session, calls } = setup()
    session.setTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: NOW.toISOString() })

    const result = await useCase.changePassword({
      currentPassword: 'Kedaya2026',
      newPassword: 'Kedaya2026',
    })

    expect(result.ok).toBe(false)
    expect(calls.changePassword).toHaveLength(0)
  })

  it('成功后换发的令牌立刻落盘（旧会话作废、当前设备不掉线）', async () => {
    const { useCase, session } = setup()
    session.setTokens({ accessToken: 'old', refreshToken: 'old-refresh', expiresAt: NOW.toISOString() })

    const result = await useCase.changePassword({
      currentPassword: 'Kedaya2026',
      newPassword: 'NewKedaya2026',
    })

    expect(result.ok).toBe(true)
    expect(session.getSnapshot().tokens?.refreshToken).toBe('refresh-2')
  })
})

describe('登出', () => {
  it('即使后端调用失败（断网），本地会话也必须清空', async () => {
    const { useCase, session } = setup({
      async logout() {
        throw new Error('network down')
      },
    })
    session.setTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: NOW.toISOString() })
    session.setProfile({ id: 'u-1', nickname: '黄鸭', campusBound: false })

    const result = await useCase.logout()

    expect(result.ok).toBe(true)
    expect(session.getSnapshot().tokens).toBeNull()
    expect(session.getSnapshot().profile).toBeNull()
  })

  it('把本地 refresh token 交给后端做吊销', async () => {
    const { useCase, session, calls } = setup()
    session.setTokens({ accessToken: 'a', refreshToken: 'refresh-1', expiresAt: NOW.toISOString() })

    await useCase.logout()

    expect(calls.logout).toEqual(['refresh-1'])
  })

  it('未登录时登出把 null 交给后端（吊销该账号全部会话）', async () => {
    const { useCase, calls } = setup()

    await useCase.logout()

    expect(calls.logout).toEqual([null])
  })
})

describe('微信一键登录', () => {
  it('首次登录：建号 → 落盘会话 → 返回 isNewUser=true（页面据此引导完善资料）', async () => {
    const { useCase, session, calls } = setup()

    const result = await useCase.loginWithWechat()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.isNewUser).toBe(true)
      expect(result.value.simulated).toBe(true)
    }
    expect(session.getSnapshot().tokens).not.toBeNull()
    expect(session.getSnapshot().profile?.wechatBound).toBe(true)
    expect(calls.loginWithWechat).toHaveLength(1)
    expect(calls.loginWithWechat[0]?.code).toBe('dev:test-device')
  })

  it('老用户再次登录 isNewUser=false（不重复引导完善资料）', async () => {
    const { useCase } = setup({
      async loginWithWechat() {
        return ok({
          ...sessionDto('refresh-wx-2'),
          account: { hasPassword: true, email: EMAIL, wechatBound: true, hasOtherLoginMethod: true },
          isNewUser: false,
          simulated: false,
        })
      },
    })

    const result = await useCase.loginWithWechat()

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.isNewUser).toBe(false)
  })

  it('昵称按码点截断、头像非法时本地就拦下（不发请求）', async () => {
    const { useCase, calls } = setup()

    const tooLong = await useCase.loginWithWechat({ displayName: '鸭'.repeat(40) })
    expect(tooLong.ok).toBe(true)
    expect([...(calls.loginWithWechat[0]?.displayName ?? '')].length).toBe(24)

    const badAvatar = await useCase.loginWithWechat({ avatarDataUrl: 'data:text/plain;base64,QUJD' })
    expect(badAvatar.ok).toBe(false)
    if (!badAvatar.ok) expect(badAvatar.error.code).toBe('VALIDATION_FAILED')
    expect(calls.loginWithWechat).toHaveLength(1)
  })

  it('服务端配了真实密钥时要求真实 code（preferReal=true）', async () => {
    const { useCase, wechatCode } = setup({
      async wechatConfig() {
        return ok({ provider: 'WECHAT_MINIPROGRAM', configured: true, appIdTail: '***cdef' })
      },
    })

    await useCase.loginWithWechat()

    expect(wechatCode.preferReal).toEqual([true])
  })

  it('配置探测失败时按开发模式继续（不因为一次探测失败就点不动登录）', async () => {
    const { useCase, wechatCode } = setup({
      async wechatConfig() {
        return err<RepositoryError>({ code: 'NETWORK', message: '断网了' })
      },
    })

    await useCase.loginWithWechat()

    expect(wechatCode.preferReal).toEqual([false])
  })

  it('拿不到微信凭证时透传失败，且不写任何会话', async () => {
    const wechatCode: WechatCodePort = {
      async requestCode() {
        return err<RepositoryError>({ code: 'UNKNOWN', message: '微信登录失败：未拿到凭证' })
      },
    }
    const { repository, calls } = createFakeRepository()
    const session = createFakeSessionStore()
    const useCase = createAuthAccountUseCase({ repository, session, wechatCode, now: () => NOW })

    const result = await useCase.loginWithWechat()

    expect(result.ok).toBe(false)
    expect(calls.loginWithWechat).toHaveLength(0)
    expect(session.getSnapshot().tokens).toBeNull()
  })

  it('绑定/解绑微信把凭证与结果如实透传', async () => {
    const { useCase, calls } = setup()

    const bound = await useCase.bindWechat()
    expect(bound.ok).toBe(true)
    expect(calls.bindWechat).toEqual(['dev:test-device'])

    const unbound = await useCase.unbindWechat()
    expect(unbound.ok).toBe(true)
    if (unbound.ok) expect(unbound.value.bound).toBe(false)
    expect(calls.unbindWechat).toBe(1)
  })
})

describe('编辑资料', () => {
  it('昵称为空时本地拦下；成功后立刻更新本地会话（不用重新登录）', async () => {
    const { useCase, session, calls } = setup()
    session.setProfile({ id: 'u-1', nickname: '旧名字', campusBound: false })

    const empty = await useCase.updateProfile({ displayName: '   ' })
    expect(empty.ok).toBe(false)
    expect(calls.updateProfile).toHaveLength(0)

    const result = await useCase.updateProfile({ displayName: '  可达鸭  ' })
    expect(result.ok).toBe(true)
    expect(calls.updateProfile[0]?.displayName).toBe('可达鸭')
    expect(session.getSnapshot().profile?.nickname).toBe('可达鸭')
  })

  it('头像合法时保存 data URL，非法时本地拦下', async () => {
    const { useCase, session, calls } = setup()
    session.setProfile({ id: 'u-1', nickname: '黄鸭', campusBound: false })
    const png = 'data:image/png;base64,iVBORw0KGgo='

    const okResult = await useCase.updateProfile({ avatarUrl: png })
    expect(okResult.ok).toBe(true)
    expect(session.getSnapshot().profile?.avatarUrl).toBe(png)

    const bad = await useCase.updateProfile({ avatarUrl: 'data:text/plain;base64,QUJD' })
    expect(bad.ok).toBe(false)
    expect(calls.updateProfile).toHaveLength(1)
  })

  it('未登录时直接拒绝，不发请求', async () => {
    const { useCase, calls } = setup()

    const result = await useCase.updateProfile({ displayName: '可达鸭' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(calls.updateProfile).toHaveLength(0)
  })
})

describe('绑定邮箱（微信账号补后路）', () => {
  it('校验邮箱与验证码，成功后换发令牌并更新账号概览', async () => {
    const { useCase, session, calls } = setup()
    session.setProfile({ id: 'u-1', nickname: '微信用户0001', campusBound: false })

    const badEmail = await useCase.bindEmail({ email: 'bad', code: '123456', password: 'Kedaya2026' })
    expect(badEmail.ok).toBe(false)
    expect(calls.bindEmail).toHaveLength(0)

    const result = await useCase.bindEmail({ email: EMAIL, code: '246810', password: 'Kedaya2026' })
    expect(result.ok).toBe(true)
    expect(calls.bindEmail[0]).toEqual({ email: EMAIL, code: '246810', password: 'Kedaya2026' })
    expect(session.getSnapshot().tokens?.refreshToken).toBe('refresh-3')
  })

  it('未登录时连验证码都不发', async () => {
    const { useCase } = setup()

    const result = await useCase.requestBindEmailCode(EMAIL)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
  })
})
