import { describe, expect, it } from 'vitest'

import {
  CAMPUS_CARD_CHANNEL,
  CAMPUS_CARD_OPENID_NOTICE,
  CAMPUS_CARD_PAYMENT_CODE_REGISTERED,
  EMPTY_CARD_ACCOUNT,
  deriveCardAccount,
  formatBalance,
  formatTransactionAmount,
  isPaymentCodeExpired,
  latestTransaction,
  normalizeCampusCardPaymentCode,
  normalizeCampusCardTransaction,
  normalizeCampusCardTransactions,
  type CampusCardTransaction,
} from '../campusCard'

/**
 * 校园卡领域模型（规格 §2.5：独立 OPENID 通道，与 CASTGC 完全解耦）。
 *
 * 重点验证两件事：
 * 1. 余额**从流水推导**（冻结契约没有独立余额端点），推导规则必须确定；
 * 2. 归一化仍然拒绝任何凭证键 —— 校园卡是 `high` 敏感模块。
 */

function txn(overrides: Partial<CampusCardTransaction> = {}): CampusCardTransaction {
  return {
    id: 'txn-1',
    amountFen: -1250,
    balanceFen: 58_750,
    merchant: '一食堂',
    occurredAt: '2026-10-17T03:12:00.000Z',
    ...overrides,
  }
}

describe('domain · campusCard（独立 OPENID 通道）', () => {
  it('通道标识就是 wechat-openid —— **不是** CASTGC', () => {
    expect(CAMPUS_CARD_CHANNEL).toBe('wechat-openid')
    expect(CAMPUS_CARD_OPENID_NOTICE).toContain('OPENID')
    expect(CAMPUS_CARD_OPENID_NOTICE).toContain('不会接触你的校园系统登录凭证')
  })
})

describe('domain · campusCard（余额从流水推导）', () => {
  it('余额取**最新一笔**的 balanceFen（交易后余额）', () => {
    const account = deriveCardAccount([
      txn({ id: 'txn-1', occurredAt: '2026-10-13T10:05:00.000Z', balanceFen: 12_400 }),
      txn({ id: 'txn-5', occurredAt: '2026-10-17T03:12:00.000Z', balanceFen: 58_750 }),
      txn({ id: 'txn-3', occurredAt: '2026-10-15T12:00:00.000Z', balanceFen: 60_600 }),
    ])
    expect(account.balanceFen).toBe(58_750)
    expect(account.asOf).toBe('2026-10-17T03:12:00.000Z')
    expect(account.source).toBe('latest-transaction')
  })

  it('没有流水 / 最新一笔没有余额 → 明确返回"暂不可得"，不猜 0', () => {
    expect(deriveCardAccount([])).toEqual(EMPTY_CARD_ACCOUNT)
    expect(deriveCardAccount([txn({ balanceFen: null })])).toEqual(EMPTY_CARD_ACCOUNT)
  })

  it('latestTransaction 的并列打破是**确定性**的（按 id），不依赖数组顺序', () => {
    const a = txn({ id: 'txn-a', occurredAt: '2026-10-17T03:12:00.000Z' })
    const b = txn({ id: 'txn-b', occurredAt: '2026-10-17T03:12:00.000Z' })
    expect(latestTransaction([a, b])?.id).toBe('txn-b')
    expect(latestTransaction([b, a])?.id).toBe('txn-b')
  })

  it('展示格式：分 → 元，带符号', () => {
    expect(formatBalance({ balanceFen: 58_750, asOf: null, source: 'latest-transaction' })).toBe(
      '¥587.50',
    )
    expect(formatBalance(EMPTY_CARD_ACCOUNT)).toBe('—')
    expect(formatTransactionAmount(txn({ amountFen: -1250 }))).toBe('¥-12.50')
    expect(formatTransactionAmount(txn({ amountFen: 50_000 }))).toBe('¥+500.00')
  })
})

describe('domain · campusCard（流水归一化：high 敏感模块，仍拒绝凭证键）', () => {
  it('合法流水被保留', () => {
    const parsed = normalizeCampusCardTransaction({
      id: 'txn-1',
      amountFen: -1250,
      balanceFen: 58_750,
      merchant: '一食堂',
      occurredAt: '2026-10-17T03:12:00.000Z',
    })
    expect(parsed?.amountFen).toBe(-1250)
  })

  it('金额必须是整数分；非整数 / 缺失一律拒绝', () => {
    expect(normalizeCampusCardTransaction({ id: 'x', amountFen: 12.5 })).toBeNull()
    expect(normalizeCampusCardTransaction({ id: 'x' })).toBeNull()
  })

  it('夹带 cookie / castgc 的流水条目被拒绝', () => {
    expect(
      normalizeCampusCardTransaction({ id: 'x', amountFen: 100, cookie: 'JSESSIONID=1' }),
    ).toBeNull()
    expect(normalizeCampusCardTransactions([{ id: 'x', amountFen: 100, castgc: 'T' }])).toEqual([])
  })
})

describe('domain · campusCard（付款码：一次性 + 契约缺口必须机器可见）', () => {
  const now = new Date('2026-10-17T03:00:30.000Z')

  it('未到期 / 已到期判定', () => {
    expect(
      isPaymentCodeExpired(
        { code: 'C', issuedAt: '2026-10-17T03:00:00.000Z', expiresAt: '2026-10-17T03:01:00.000Z' },
        now,
      ),
    ).toBe(false)
    expect(
      isPaymentCodeExpired(
        { code: 'C', issuedAt: '2026-10-17T02:00:00.000Z', expiresAt: '2026-10-17T02:01:00.000Z' },
        now,
      ),
    ).toBe(true)
  })

  it('无法解析的 expiresAt 视为已过期（保守）', () => {
    expect(isPaymentCodeExpired({ code: 'C', issuedAt: '', expiresAt: 'nope' }, now)).toBe(true)
  })

  it('⚠️ 付款码端点**尚未登记**进冻结契约 —— 这个事实必须能被代码断言', () => {
    expect(CAMPUS_CARD_PAYMENT_CODE_REGISTERED).toBe(false)
  })

  it('付款码归一化拒绝凭证键与不完整形状', () => {
    expect(normalizeCampusCardPaymentCode({ code: 'C', issuedAt: 'a', expiresAt: 'b' })).toEqual({
      code: 'C',
      issuedAt: 'a',
      expiresAt: 'b',
    })
    expect(normalizeCampusCardPaymentCode({ code: 'C', issuedAt: 'a' })).toBeNull()
    expect(
      normalizeCampusCardPaymentCode({ code: 'C', issuedAt: 'a', expiresAt: 'b', ticket: 'wvt_1' }),
    ).toBeNull()
  })
})
