import { describe, expect, it } from 'vitest'

import {
  isValidCode,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  parseAuthSession,
  passwordIssues,
  toAuthTokens,
  toUserProfile,
} from '../auth'

/**
 * 账号领域模型的**可执行规格**。
 *
 * 重点是两组边界：
 *   1. 邮箱/密码判定必须与后端 `services/api/.../domain/password.ts` 同规则 ——
 *      否则会出现「前端放过、后端 400」的割裂体验；
 *   2. `parseAuthSession` 必须**严格**：任何字段缺失都返回 null，
 *      让坏数据在边界被拦下，而不是变成 UI 上的 `undefined` / `NaN`。
 */

describe('邮箱校验', () => {
  it('规范化：去空白 + 转小写', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com')
  })

  it('接受常见的合法邮箱', () => {
    for (const email of [
      'a@b.cn',
      'first.last+tag@mail.example.com',
      'user_name-1@sub.domain.edu.cn',
    ]) {
      expect(isValidEmail(email), email).toBe(true)
    }
  })

  it('拒绝明显非法的输入（含巧妙的边界）', () => {
    for (const email of [
      '',
      'plain',
      '@example.com',
      'no-tld@example',
      'a b@example.com',
      '.lead@example.com',
      'trail.@example.com',
      'double..dot@example.com',
      'two@at@example.com',
      'no-domain@',
    ]) {
      expect(isValidEmail(email), email).toBe(false)
    }
  })
})

describe('密码强度（与后端同规则：8–64 位、含字母与数字）', () => {
  it('合格密码没有问题项', () => {
    expect(passwordIssues('Kedaya2026')).toEqual([])
    expect(isValidPassword('Kedaya2026')).toBe(true)
  })

  it('逐条给出问题（用于输入框下方的即时提示）', () => {
    expect(passwordIssues('abc')).toContain('至少 8 位')
    expect(passwordIssues('12345678')).toContain('需要包含字母')
    expect(passwordIssues('abcdefgh')).toContain('需要包含数字')
    expect(passwordIssues('abc 12345')).toContain('不能包含空格')
    expect(passwordIssues('a1'.repeat(40))).toContain('最多 64 位')
  })

  it('边界：正好 8 位 / 正好 64 位都合格', () => {
    expect(isValidPassword('abc12345')).toBe(true)
    expect(isValidPassword(`${'a'.repeat(63)}1`)).toBe(true)
  })
})

describe('验证码', () => {
  it('只接受 6 位数字', () => {
    expect(isValidCode('123456')).toBe(true)
    expect(isValidCode('12345')).toBe(false)
    expect(isValidCode('1234567')).toBe(false)
    expect(isValidCode('abcdef')).toBe(false)
    expect(isValidCode(' 12345')).toBe(false)
  })
})

describe('parseAuthSession', () => {
  const valid = {
    user: { id: 'u1', displayName: '黄鸭', avatarUrl: null, department: '信息学院' },
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresIn: 7200,
    email: 'a@b.cn',
  }

  it('完整响应被正确解析', () => {
    const parsed = parseAuthSession(valid)
    expect(parsed).not.toBeNull()
    expect(parsed?.user.id).toBe('u1')
    expect(parsed?.email).toBe('a@b.cn')
  })

  it('缺少关键字段一律返回 null（不让 undefined 流进 UI）', () => {
    expect(parseAuthSession(null)).toBeNull()
    expect(parseAuthSession('字符串不是对象')).toBeNull()
    expect(parseAuthSession({ ...valid, accessToken: '' })).toBeNull()
    expect(parseAuthSession({ ...valid, refreshToken: undefined })).toBeNull()
    expect(parseAuthSession({ ...valid, expiresIn: '7200' })).toBeNull()
    expect(parseAuthSession({ ...valid, user: { id: '', displayName: 'x' } })).toBeNull()
    expect(parseAuthSession({ ...valid, user: { id: 'u1' } })).toBeNull()
  })

  it('可选字段缺失时降级为 null，而不是报错', () => {
    const parsed = parseAuthSession({
      user: { id: 'u1', displayName: '黄鸭' },
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 60,
    })
    expect(parsed?.user.avatarUrl).toBeNull()
    expect(parsed?.user.department).toBeNull()
    expect(parsed?.email).toBeUndefined()
    expect(parsed?.expiresAt).toBeUndefined()
  })
})

describe('映射到会话模型', () => {
  it('令牌优先使用服务端给的绝对过期时间', () => {
    const tokens = toAuthTokens(
      {
        user: { id: 'u1', displayName: 'x', avatarUrl: null, department: null },
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 7200,
        expiresAt: '2026-01-01T08:00:00.000Z',
      },
      new Date('2026-01-01T06:00:00.000Z'),
    )
    expect(tokens.expiresAt).toBe('2026-01-01T08:00:00.000Z')
  })

  it('没有绝对时间时用 expiresIn 换算', () => {
    const tokens = toAuthTokens(
      {
        user: { id: 'u1', displayName: 'x', avatarUrl: null, department: null },
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 3600,
      },
      new Date('2026-01-01T06:00:00.000Z'),
    )
    expect(tokens.expiresAt).toBe('2026-01-01T07:00:00.000Z')
  })

  it('邮箱注册的账号 campusBound 恒为 false（登录 ≠ 绑定校园系统）', () => {
    const profile = toUserProfile({
      user: { id: 'u1', displayName: '黄鸭', avatarUrl: null, department: null },
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 60,
      email: 'duck@kedaya.dev',
    })
    expect(profile.campusBound).toBe(false)
    expect(profile.email).toBe('duck@kedaya.dev')
    expect(profile.nickname).toBe('黄鸭')
  })
})
