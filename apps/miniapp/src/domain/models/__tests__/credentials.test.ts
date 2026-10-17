import { describe, expect, it } from 'vitest'

import {
  CREDENTIAL_FORBIDDEN_KEYS,
  findForbiddenCredentialKeys,
  hasForbiddenCredentialKeys,
  isForbiddenCredentialKey,
  isLogRedactedKey,
  normalizeKeyName,
  redactCredentialText,
  sanitizeForLog,
} from '../credentials'

/**
 * 凭证边界（契约 §11.4 I1 / 规格 §10.3）。
 *
 * 这些断言是**架构级**的：它们钉住的是「凭证不得越界」这条不变式，
 * 而不是某个函数的行为细节。
 */

describe('domain · credentials（契约 §11.4 I1）', () => {
  it('冻结的禁用键**逐字**等于契约原文的 8 个', () => {
    // 契约 §11.4 I1 原文：cookie / cookies / session / sessionToken / tgc / castgc / ticket / tenant
    expect([...CREDENTIAL_FORBIDDEN_KEYS]).toEqual([
      'cookie',
      'cookies',
      'session',
      'sessionToken',
      'tgc',
      'castgc',
      'ticket',
      'tenant',
    ])
  })

  it('同义键名归一化后仍被识别（session_token / Session-Token / CASTGC）', () => {
    expect(isForbiddenCredentialKey('session_token')).toBe(true)
    expect(isForbiddenCredentialKey('Session-Token')).toBe(true)
    expect(isForbiddenCredentialKey('CASTGC')).toBe(true)
    expect(isForbiddenCredentialKey('  tgc  ')).toBe(true)
    expect(isForbiddenCredentialKey('displayName')).toBe(false)
    expect(isForbiddenCredentialKey('expiresAt')).toBe(false)
    expect(normalizeKeyName('X-Castgc')).toBe('xcastgc')
  })

  it('深度扫描返回**路径**，而不只是一个布尔值', () => {
    const payload = {
      id: 'tpl-1',
      nested: { castgc: 'TGT-1' },
      list: [{ ok: true }, { cookie: 'JSESSIONID=abc' }],
    }
    expect(findForbiddenCredentialKeys(payload)).toEqual([
      'nested.castgc',
      'list[1].cookie',
    ])
    expect(hasForbiddenCredentialKeys(payload)).toBe(true)
  })

  it('干净的对象不被误报', () => {
    const clean = { id: 'tpl-1', provider: 'ecard', status: 'ACTIVE', displayName: null }
    expect(findForbiddenCredentialKeys(clean)).toEqual([])
  })

  it('循环引用不会把扫描拖死', () => {
    const node: Record<string, unknown> = { id: 'x' }
    node.self = node
    expect(findForbiddenCredentialKeys(node)).toEqual([])
  })
})

describe('domain · credentials（内联凭证清洗）', () => {
  it('CASTGC=... / tgc: ... / password=... 都被替换为 [REDACTED]', () => {
    expect(redactCredentialText('CASTGC=TGT-12345')).toBe('CASTGC=[REDACTED]')
    expect(redactCredentialText('tgc: abc.def')).toBe('tgc: [REDACTED]')
    expect(redactCredentialText('password=hunter2')).toBe('password=[REDACTED]')
  })

  it('Bearer <token> 被替换', () => {
    expect(redactCredentialText('Authorization: Bearer eyJhbGciOi.abc.def')).toBe(
      'Authorization: [REDACTED]',
    )
  })

  it('普通文本不受影响', () => {
    expect(redactCredentialText('绑定成功，provider=ecard')).toBe('绑定成功，provider=ecard')
  })
})

describe('domain · credentials（sanitizeForLog，规格 §10.3 白名单外剔除）', () => {
  it('白名单外的字段被**整个丢弃**（不写 [REDACTED]，连存在都不泄漏）', () => {
    const { value, droppedKeys } = sanitizeForLog(
      { provider: 'ecard', credential: { password: 'hunter2' }, summary: 'x' },
      { allowedKeys: ['provider'] },
    )
    expect(value).toEqual({ provider: 'ecard' })
    expect(droppedKeys).toContain('credential')
    expect(droppedKeys).toContain('summary')
    expect(JSON.stringify(value)).not.toContain('hunter2')
  })

  it('脱敏键即使**在白名单里**也被丢弃（白名单不能覆盖脱敏）', () => {
    const { value } = sanitizeForLog(
      { provider: 'ecard', castgc: 'TGT-1' },
      { allowedKeys: ['provider', 'castgc'] },
    )
    expect(value).toEqual({ provider: 'ecard' })
  })

  it('白名单字段的**值**里混进内联凭证时被清洗', () => {
    const { value } = sanitizeForLog(
      { detail: 'redirect=https://x?CASTGC=TGT-9&ticket=wvt_1' },
      { allowedKeys: ['detail'] },
    )
    expect(JSON.stringify(value)).not.toMatch(/TGT-9|wvt_1/)
    expect(JSON.stringify(value)).toContain('[REDACTED]')
  })

  it('超长字符串被截断而不是原样落日志', () => {
    const { value } = sanitizeForLog({ note: 'a'.repeat(1000) }, { allowedKeys: ['note'] })
    expect(JSON.stringify(value).length).toBeLessThan(400)
    expect(JSON.stringify(value)).toContain('[TRUNCATED]')
  })

  it('日志脱敏键集合是 I1 的**超集**（密码 / 密文 / 授权头都在内）', () => {
    for (const key of CREDENTIAL_FORBIDDEN_KEYS) {
      expect(isLogRedactedKey(key)).toBe(true)
    }
    expect(isLogRedactedKey('password')).toBe(true)
    expect(isLogRedactedKey('tokenCipher')).toBe(true)
    expect(isLogRedactedKey('sessionCipher')).toBe(true)
    expect(isLogRedactedKey('authorization')).toBe(true)
    expect(isLogRedactedKey('wechatLoginCode')).toBe(true)
  })
})
