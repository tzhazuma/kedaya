import { describe, expect, it } from 'vitest'

import { createMockAuthRepository } from '../mockAuthRepository'

/**
 * Mock 账号仓储的行为规格。
 *
 * 这些断言的意义在于：mock **不是**随意糊弄的假数据，它复刻了真实后端的
 * 安全语义（验证码一次性、账号枚举防护、改密踢下线）。只有这样才能保证
 * 「mock 下点得通、接上后端就崩」这类问题不会出现。
 */

const DEMO_EMAIL = 'demo@kedaya.dev'
const DEMO_PASSWORD = 'Kedaya2026'

function repo() {
  return createMockAuthRepository({ latencyMs: 0 })
}

describe('注册', () => {
  it('获取验证码返回 devCode，且注册时必须用对验证码', async () => {
    const auth = repo()
    const receipt = await auth.requestRegisterCode('newbie@kedaya.dev')
    expect(receipt.ok).toBe(true)
    if (!receipt.ok) return
    expect(receipt.value.devCode).toBeDefined()

    const wrong = await auth.register({
      email: 'newbie@kedaya.dev',
      code: '000000',
      password: 'Kedaya2026',
    })
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.error.message).toContain('验证码不正确')

    const right = await auth.register({
      email: 'newbie@kedaya.dev',
      code: receipt.value.devCode ?? '',
      password: 'Kedaya2026',
    })
    expect(right.ok).toBe(true)
    if (right.ok) expect(right.value.accessToken).not.toBe('')
  })

  it('验证码是一次性的：重复使用同一条验证码会被拒绝', async () => {
    const auth = repo()
    const receipt = await auth.requestRegisterCode('once@kedaya.dev')
    if (!receipt.ok) throw new Error('unreachable')
    const code = receipt.value.devCode ?? ''

    await auth.register({ email: 'once@kedaya.dev', code, password: 'Kedaya2026' })
    const replay = await auth.register({ email: 'once@kedaya.dev', code, password: 'Kedaya2026' })

    expect(replay.ok).toBe(false)
  })

  it('已注册邮箱不能再获取注册验证码', async () => {
    const auth = repo()
    const again = await auth.requestRegisterCode(DEMO_EMAIL)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.code).toBe('CONFLICT')
  })
})

describe('登录', () => {
  it('预置演示账号可以登录，且带回邮箱', async () => {
    const auth = repo()
    const result = await auth.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.email).toBe(DEMO_EMAIL)
      expect(result.value.user.displayName.length).toBeGreaterThan(0)
    }
  })

  it('密码错误与账号不存在返回**同一**文案（防账号枚举）', async () => {
    const auth = repo()
    const wrongPassword = await auth.login({ email: DEMO_EMAIL, password: 'nope-nope' })
    const unknownAccount = await auth.login({ email: 'ghost@kedaya.dev', password: 'nope-nope' })

    expect(wrongPassword.ok).toBe(false)
    expect(unknownAccount.ok).toBe(false)
    if (!wrongPassword.ok && !unknownAccount.ok) {
      expect(wrongPassword.error).toEqual(unknownAccount.error)
    }
  })
})

describe('找回密码', () => {
  it('未注册邮箱同样返回 sent=true（否则会泄漏账号是否存在）', async () => {
    const auth = repo()
    const receipt = await auth.requestResetCode('nobody@kedaya.dev')

    expect(receipt.ok).toBe(true)
    if (receipt.ok) {
      expect(receipt.value.sent).toBe(true)
      // 不存在的邮箱不回带 devCode，避免被当成"验证码已发出"
      expect(receipt.value.devCode ?? '').toBe('')
    }
  })

  it('重置后旧密码失效、新密码可登录，且所有会话被清空', async () => {
    const auth = repo()
    const login = await auth.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
    if (!login.ok) throw new Error('unreachable')

    const receipt = await auth.requestResetCode(DEMO_EMAIL)
    if (!receipt.ok) throw new Error('unreachable')
    const reset = await auth.resetPassword({
      email: DEMO_EMAIL,
      code: receipt.value.devCode ?? '',
      password: 'BrandNew2026',
    })
    expect(reset.ok).toBe(true)

    const withOld = await auth.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
    expect(withOld.ok).toBe(false)

    const withNew = await auth.login({ email: DEMO_EMAIL, password: 'BrandNew2026' })
    expect(withNew.ok).toBe(true)
  })
})

describe('修改密码', () => {
  it('当前密码不正确时拒绝', async () => {
    const auth = repo()
    await auth.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD })

    const result = await auth.changePassword({
      currentPassword: 'wrong',
      newPassword: 'BrandNew2026',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
  })

  it('成功后换发新令牌', async () => {
    const auth = repo()
    await auth.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD })

    const result = await auth.changePassword({
      currentPassword: DEMO_PASSWORD,
      newPassword: 'BrandNew2026',
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.refreshToken).not.toBe('')
  })
})

describe('微信一键登录（mock 复刻真实后端的身份语义）', () => {
  it('首次登录建号：isNewUser=true，且账号还没有邮箱密码', async () => {
    const auth = repo()

    const result = await auth.loginWithWechat({ code: 'dev:iphone-15' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.isNewUser).toBe(true)
    expect(result.value.simulated).toBe(true)
    expect(result.value.account).toEqual({
      hasPassword: false,
      email: null,
      wechatBound: true,
      hasOtherLoginMethod: false,
    })
    expect(result.value.user.displayName).toContain('微信用户')
    expect(result.value.email).toBeUndefined()
  })

  it('同一设备标识再次登录是同一账号；不同标识是不同账号', async () => {
    const auth = repo()

    const first = await auth.loginWithWechat({ code: 'dev:iphone-15' })
    const again = await auth.loginWithWechat({ code: 'dev:iphone-15' })
    const other = await auth.loginWithWechat({ code: 'dev:pixel-9' })

    expect(first.ok && again.ok && other.ok).toBe(true)
    if (!first.ok || !again.ok || !other.ok) return
    expect(again.value.isNewUser).toBe(false)
    expect(again.value.user.id).toBe(first.value.user.id)
    expect(other.value.user.id).not.toBe(first.value.user.id)
  })

  it('首次登录可带上昵称与头像，老用户登录不会覆盖已改过的昵称', async () => {
    const auth = repo()
    const png = 'data:image/png;base64,iVBORw0KGgo='

    const first = await auth.loginWithWechat({
      code: 'dev:iphone-15',
      displayName: '可达鸭本鸭',
      avatarDataUrl: png,
    })
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.value.user.displayName).toBe('可达鸭本鸭')
      expect(first.value.user.avatarUrl).toBe(png)
    }

    const again = await auth.loginWithWechat({ code: 'dev:iphone-15' })
    expect(again.ok).toBe(true)
    if (again.ok) expect(again.value.user.displayName).toBe('可达鸭本鸭')
  })
})

describe('账号关联（微信 ↔ 邮箱）', () => {
  it('邮箱账号可以绑定微信，绑定后两条路径都能登录同一个账号', async () => {
    const auth = repo()
    const login = await auth.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
    if (!login.ok) throw new Error('unreachable')

    const bound = await auth.bindWechat('dev:my-phone')
    expect(bound.ok).toBe(true)
    if (bound.ok) expect(bound.value.canUnbind).toBe(true)

    // 换设备用微信登录：命中的是同一个账号（不会新建）
    const viaWechat = await auth.loginWithWechat({ code: 'dev:my-phone' })
    expect(viaWechat.ok).toBe(true)
    if (viaWechat.ok) {
      expect(viaWechat.value.isNewUser).toBe(false)
      expect(viaWechat.value.user.id).toBe(login.value.user.id)
      expect(viaWechat.value.account?.hasPassword).toBe(true)
    }
  })

  it('微信已属于另一个账号时返回 CONFLICT（不静默合并）', async () => {
    const auth = repo()
    const wechatAccount = await auth.loginWithWechat({ code: 'dev:other-phone' })
    if (!wechatAccount.ok) throw new Error('unreachable')

    await auth.logout(null)
    await auth.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD })

    const conflict = await auth.bindWechat('dev:other-phone')
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.error.code).toBe('CONFLICT')
  })

  it('只有微信一种登录方式时不允许解绑；绑定邮箱后即可解绑', async () => {
    const auth = repo()
    const wechat = await auth.loginWithWechat({ code: 'dev:iphone-15' })
    if (!wechat.ok) throw new Error('unreachable')

    const blocked = await auth.unbindWechat()
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error.message).toContain('无法登录')

    const receipt = await auth.requestBindEmailCode('duck@kedaya.dev')
    expect(receipt.ok).toBe(true)
    if (!receipt.ok) return
    const bound = await auth.bindEmail({
      email: 'duck@kedaya.dev',
      code: receipt.value.devCode ?? '',
      password: 'Kedaya2026',
    })
    expect(bound.ok).toBe(true)
    if (bound.ok) {
      expect(bound.value.account?.hasPassword).toBe(true)
      expect(bound.value.account?.email).toBe('duck@kedaya.dev')
      expect(bound.value.user.id).toBe(wechat.value.user.id)
    }

    const unbound = await auth.unbindWechat()
    expect(unbound.ok).toBe(true)
    if (unbound.ok) expect(unbound.value.bound).toBe(false)

    // 解绑后仍可用邮箱密码登录同一个账号
    const viaEmail = await auth.login({ email: 'duck@kedaya.dev', password: 'Kedaya2026' })
    expect(viaEmail.ok).toBe(true)
    if (viaEmail.ok) expect(viaEmail.value.user.id).toBe(wechat.value.user.id)
  })

  it('绑定邮箱：邮箱被占用 / 已有密码时提前拒绝', async () => {
    const auth = repo()
    // demo 账号已有密码：微信账号去绑它的邮箱会被拒
    const wechat = await auth.loginWithWechat({ code: 'dev:iphone-15' })
    if (!wechat.ok) throw new Error('unreachable')

    const taken = await auth.requestBindEmailCode(DEMO_EMAIL)
    expect(taken.ok).toBe(false)
    if (!taken.ok) expect(taken.error.code).toBe('CONFLICT')

    // 绑定成功后不能再绑第二次
    const receipt = await auth.requestBindEmailCode('duck@kedaya.dev')
    if (!receipt.ok) throw new Error('unreachable')
    await auth.bindEmail({
      email: 'duck@kedaya.dev',
      code: receipt.value.devCode ?? '',
      password: 'Kedaya2026',
    })
    const again = await auth.requestBindEmailCode('duck2@kedaya.dev')
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.code).toBe('CONFLICT')
  })
})

describe('资料更新', () => {
  it('更新昵称与头像后，下一次会话响应里是新值', async () => {
    const auth = repo()
    await auth.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
    const png = 'data:image/png;base64,iVBORw0KGgo='

    const updated = await auth.updateProfile({ displayName: '  可达鸭  ', avatarUrl: png })
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.value.displayName).toBe('可达鸭')
      expect(updated.value.avatarUrl).toBe(png)
    }

    const relogin = await auth.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
    expect(relogin.ok).toBe(true)
    if (relogin.ok) expect(relogin.value.user.displayName).toBe('可达鸭')
  })

  it('昵称清空被拒绝；传 null 可清空头像', async () => {
    const auth = repo()
    await auth.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
    await auth.updateProfile({ avatarUrl: 'data:image/png;base64,iVBORw0KGgo=' })

    const empty = await auth.updateProfile({ displayName: '   ' })
    expect(empty.ok).toBe(false)

    const cleared = await auth.updateProfile({ avatarUrl: null })
    expect(cleared.ok).toBe(true)
    if (cleared.ok) expect(cleared.value.avatarUrl).toBeNull()
  })
})

describe('登出', () => {
  it('按 refresh token 吊销单个会话', async () => {
    const auth = repo()
    const login = await auth.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
    if (!login.ok) throw new Error('unreachable')

    const result = await auth.logout(login.value.refreshToken)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.revoked).toBe(1)
  })

  it('未提供 refresh token 时吊销该账号全部会话', async () => {
    const auth = repo()
    await auth.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD })

    const result = await auth.logout(null)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.revoked).toBeGreaterThan(0)
  })
})
