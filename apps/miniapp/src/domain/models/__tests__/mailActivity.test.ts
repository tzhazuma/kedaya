import { describe, expect, it } from 'vitest'

import { EVIDENCE_MAX_LENGTH } from '../activity'
import {
  CAMPUS_IMAP_HOST,
  CAMPUS_IMAP_PORT,
  mailAccountFieldErrors,
  mailAccountFormProblem,
  normalizeMailAccount,
  normalizeMailEvent,
  normalizeMailEvents,
  normalizeMailSyncResult,
} from '../mailActivity'

/**
 * 校园邮箱（复用现成 `/mail` 模块）—— 客户端只做两件事：
 * 表单前置校验（与后端同规则）与响应归一化。
 *
 * 三条不能被 UI 绕过的边界：
 *   · 密码只在提交那一刻存在，任何归一化结果里都不能带 `password` / `cipher`；
 *   · `matchedText` 只是证据片段（≤200 字），不是邮件正文；
 *   · IMAP 主机必须在学校域内（服务端会 SSRF 校验，客户端提前说清楚）。
 */

describe('mailAccountFormProblem', () => {
  it('接受学校邮箱与学校 IMAP 主机', () => {
    expect(
      mailAccountFormProblem({
        email: 'alice@shanghaitech.edu.cn',
        imapHost: CAMPUS_IMAP_HOST,
        imapPort: CAMPUS_IMAP_PORT,
        password: 'client-specific-password',
      }),
    ).toBeNull()

    expect(
      mailAccountFormProblem({
        email: 'bob@stu.shanghaitech.edu.cn',
        imapHost: 'imap.shanghaitech.edu.cn',
        imapPort: 993,
        password: 'x',
      }),
    ).toBeNull()
  })

  it('拒绝非学校邮箱 / 非学校 IMAP / 非法端口 / 空密码', () => {
    expect(
      mailAccountFormProblem({
        email: 'alice@gmail.com',
        imapHost: CAMPUS_IMAP_HOST,
        imapPort: 993,
        password: 'x',
      }),
    ).not.toBeNull()

    expect(
      mailAccountFormProblem({
        email: 'alice@shanghaitech.edu.cn',
        imapHost: '127.0.0.1',
        imapPort: 993,
        password: 'x',
      }),
    ).not.toBeNull()

    expect(
      mailAccountFormProblem({
        email: 'alice@shanghaitech.edu.cn',
        imapHost: CAMPUS_IMAP_HOST,
        imapPort: 0,
        password: 'x',
      }),
    ).not.toBeNull()

    expect(
      mailAccountFormProblem({
        email: 'alice@shanghaitech.edu.cn',
        imapHost: CAMPUS_IMAP_HOST,
        imapPort: 993,
        password: '   ',
      }),
    ).not.toBeNull()
  })
})

describe('mailAccountFieldErrors', () => {
  it('把错误落到具体字段，供 KdyField 显示 error', () => {
    const valid = mailAccountFieldErrors({
      email: 'alice@shanghaitech.edu.cn',
      imapHost: CAMPUS_IMAP_HOST,
      imapPort: CAMPUS_IMAP_PORT,
      password: 'client-specific-password',
    })
    expect(valid).toEqual({})

    const badEmail = mailAccountFieldErrors({
      email: 'alice@gmail.com',
      imapHost: CAMPUS_IMAP_HOST,
      imapPort: CAMPUS_IMAP_PORT,
      password: 'x',
    })
    expect(badEmail.email).toContain('校园邮箱')

    const badPort = mailAccountFieldErrors({
      email: 'alice@shanghaitech.edu.cn',
      imapHost: CAMPUS_IMAP_HOST,
      imapPort: 0,
      password: 'x',
    })
    expect(badPort.imapPort).toContain('端口')

    const missingPassword = mailAccountFieldErrors({
      email: 'alice@shanghaitech.edu.cn',
      imapHost: CAMPUS_IMAP_HOST,
      imapPort: CAMPUS_IMAP_PORT,
      password: ' ',
    })
    expect(missingPassword.password).toContain('密码')
  })
})

describe('normalizeMailEvent', () => {
  const WIRE = {
    id: 'mail-ev-1',
    title: 'Data Systems Seminar',
    startsAt: '2026-11-24T11:00:00.000Z',
    location: '1A-200',
    organizer: 'SIST',
    confidence: 0.78,
    matchedText: '11月24日 19:00，信息学院 1A-200',
    receivedAt: '2026-11-20T03:00:00.000Z',
    stale: false,
    // 下面这些**不该**来自服务端；即使出现也不能进入结果
    password: 'secret',
    passwordCipher: 'cipher',
    cipherKeyId: 'v1',
  }

  it('只挑选活动字段：证据片段 ≤200 字，密码 / 密文一概丢弃', () => {
    const normalized = normalizeMailEvent(WIRE)
    expect(normalized).not.toBeNull()
    expect(normalized?.matchedText).toBe('11月24日 19:00，信息学院 1A-200')
    for (const key of Object.keys(normalized ?? {})) {
      expect(['password', 'passwordCipher', 'cipherKeyId']).not.toContain(key)
    }

    const long = normalizeMailEvent({ ...WIRE, matchedText: '证'.repeat(EVIDENCE_MAX_LENGTH + 80) })
    expect(Array.from(long?.matchedText ?? '').length).toBe(EVIDENCE_MAX_LENGTH)
  })

  it('没有开始时刻 / 没有 title 的条目被拒绝（不猜）', () => {
    expect(normalizeMailEvent({ ...WIRE, startsAt: 'not-a-time' })).toBeNull()
    expect(normalizeMailEvent({ ...WIRE, title: '  ' })).toBeNull()
  })

  it('列表只保留合法条目', () => {
    expect(normalizeMailEvents([WIRE, { ...WIRE, id: 'bad', startsAt: null }])).toHaveLength(1)
  })
})

describe('mailAccount / sync 响应归一化', () => {
  it('账户视图不含密码与密文，lastSyncAt 统一成 UTC ISO', () => {
    const normalized = normalizeMailAccount({
      email: 'alice@shanghaitech.edu.cn',
      imapHost: CAMPUS_IMAP_HOST,
      imapPort: 993,
      status: 'active',
      lastSyncAt: '2026-11-22T04:00:00+08:00',
      password: 'secret',
      passwordCipher: 'cipher',
    })
    expect(normalized?.lastSyncAt).toBe('2026-11-21T20:00:00.000Z')
    expect(normalized).not.toHaveProperty('password')
    expect(normalized).not.toHaveProperty('passwordCipher')
  })

  it('同步结果只保留计数与时间，非法字段回落到安全值', () => {
    const normalized = normalizeMailSyncResult({
      scanned: 12,
      matched: 3,
      stored: 2,
      lastSyncAt: '2026-11-22T04:00:00.000Z',
      stale: false,
    })
    expect(normalized).toEqual({
      scanned: 12,
      matched: 3,
      stored: 2,
      lastSyncAt: '2026-11-22T04:00:00.000Z',
      stale: false,
    })

    expect(
      normalizeMailSyncResult({ scanned: -1, matched: 'x', stored: 1, lastSyncAt: null }),
    ).toEqual({ scanned: 0, matched: 0, stored: 1, lastSyncAt: null, stale: false })
  })
})
