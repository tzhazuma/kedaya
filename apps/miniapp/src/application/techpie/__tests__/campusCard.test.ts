import { describe, expect, it } from 'vitest'
import { err, ok } from '@kedaya/shared'

import { createCampusCardUseCase, isCachedCardTransactions } from '../campusCard'
import {
  TEST_NOW_ISO,
  TEST_PROFILE,
  TEST_TOKENS,
  cardPaymentCode,
  cardTransaction,
  createFakeCache,
  createFakeSessionStore,
  createFakeTechpieRepository,
  fixedClock,
} from '../../__tests__/testDoubles'

/**
 * 校园卡用例（规格 §2.5：独立 OPENID 通道）。
 *
 * 重点：
 * 1. 余额**从流水推导**，不发第二个请求；
 * 2. 三态齐全 + 契约 §8 静默降级；
 * 3. 付款码是**一次性**的，且**不进日志**（只记到期时间）。
 */

const CACHE_KEY = 'test:campus-card:txns'

function setup(options: Parameters<typeof createFakeTechpieRepository>[0] = {}, signedIn = true) {
  const repository = createFakeTechpieRepository(options)
  const cache = createFakeCache()
  const session = createFakeSessionStore(signedIn ? TEST_PROFILE : null, signedIn ? TEST_TOKENS : null)
  const useCase = createCampusCardUseCase({
    repository,
    cache,
    clock: fixedClock(TEST_NOW_ISO),
    cacheKey: CACHE_KEY,
    session,
    paymentCodeRegistered: false,
  })
  return { repository, cache, useCase }
}

describe('application · campus-card（余额 / 流水）', () => {
  it('load 成功 → 余额从**最新一笔**流水的 balanceFen 推导', async () => {
    const { repository, useCase } = setup({
      transactions: [
        ok({
          items: [
            cardTransaction('txn-1', { occurredAt: '2026-10-13T10:05:00.000Z', balanceFen: 12_400 }),
            cardTransaction('txn-5', { occurredAt: '2026-10-17T03:12:00.000Z', balanceFen: 58_750 }),
          ],
          nextCursor: null,
        }),
      ],
    })

    const state = await useCase.load()

    expect(state.status).toBe('ready')
    expect(state.account.balanceFen).toBe(58_750)
    expect(state.account.source).toBe('latest-transaction')
    // ⚠️ 余额不额外发请求：只有一次 cardTransactions 调用
    expect(repository.transactionQueries).toHaveLength(1)
  })

  it('空流水 → empty，余额明确为"暂不可得"（不猜 0）', async () => {
    const { useCase } = setup({ transactions: [ok({ items: [], nextCursor: null })] })
    const state = await useCase.load()
    expect(state.status).toBe('empty')
    expect(state.account.balanceFen).toBeNull()
  })

  it('未登录 → error 且**不发请求**', async () => {
    const { repository, useCase } = setup({}, false)
    const state = await useCase.load()
    expect(state.status).toBe('error')
    expect(state.error).toContain('请先登录')
    expect(repository.totalCalls).toBe(0)
  })

  it('失败且无缓存 → error；失败但有缓存 → ready + fromCache（契约 §8）', async () => {
    const failure = err({ code: 'UPSTREAM_UNAVAILABLE' as const, message: '上游超时' })

    const first = setup({ transactions: [failure] })
    expect((await first.useCase.load()).status).toBe('error')

    const second = setup({ transactions: [failure] })
    second.cache.write(CACHE_KEY, {
      items: [cardTransaction('txn-cached')],
      nextCursor: null,
      updatedAt: TEST_NOW_ISO,
    })
    second.useCase.hydrate()
    const state = await second.useCase.load()
    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(true)
    expect(state.account.balanceFen).toBe(58_750)
  })

  it('loadMore 追加并重新推导余额', async () => {
    const { useCase } = setup({
      transactions: [
        ok({ items: [cardTransaction('txn-5')], nextCursor: 'c1', total: 2 }),
        ok({
          items: [cardTransaction('txn-1', { occurredAt: '2026-10-13T10:05:00.000Z', balanceFen: 12_400 })],
          nextCursor: null,
          total: 2,
        }),
      ],
    })
    await useCase.load()
    const state = await useCase.loadMore()
    expect(state.transactions).toHaveLength(2)
    expect(state.nextCursor).toBeNull()
    // 最新仍是 txn-5
    expect(state.account.balanceFen).toBe(58_750)
  })

  it('缓存含凭证键时 hydrate 拒绝使用它', () => {
    const { cache, useCase } = setup()
    cache.write(CACHE_KEY, {
      items: [{ id: 'x', amountFen: 1, balanceFen: 1, merchant: 'm', occurredAt: '', cookie: 'a' }],
      nextCursor: null,
      updatedAt: TEST_NOW_ISO,
    })
    expect(useCase.hydrate().status).toBe('idle')
    expect(isCachedCardTransactions({ items: [], nextCursor: null, updatedAt: 'x', castgc: 'T' })).toBe(
      false,
    )
  })
})

describe('application · campus-card（付款码）', () => {
  it('生成付款码：带幂等键 + 契约缺口标记透出给 UI', async () => {
    const { repository, useCase } = setup({
      paymentCode: ok(cardPaymentCode({ expiresAt: '2026-10-17T03:01:00.000Z' })),
    })

    const result = await useCase.requestPaymentCode()

    expect(result.ok).toBe(true)
    expect(repository.paymentCodeCalls[0]).toMatch(/^campus-card-pay:/)
    const state = useCase.getSnapshot()
    expect(state.paymentCodeStatus).toBe('ready')
    expect(state.paymentCode?.code).toBe('MOCK0000000001')
    // ⚠️ 契约缺口必须机器可见（付款码端点尚未登记进冻结 OpenAPI）
    expect(state.paymentCodeContractRegistered).toBe(false)
  })

  it('付款码过期判定基于注入时钟（不依赖真实时间）', async () => {
    // 固定时钟 = 2026-10-16T12:00:00Z；这里给一个更晚的到期时间 → 未过期
    const { useCase } = setup({
      paymentCode: ok(cardPaymentCode({ expiresAt: '2026-10-17T03:01:00.000Z' })),
    })
    await useCase.requestPaymentCode()
    expect(useCase.isPaymentCodeExpired()).toBe(false)
  })

  it('未登录时请求付款码 → UNAUTHENTICATED 且不发请求', async () => {
    const { repository, useCase } = setup({}, false)
    const result = await useCase.requestPaymentCode()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(repository.totalCalls).toBe(0)
  })

  it('付款码失败 → paymentCodeStatus = error，且**保留**上一次的码？——不：清空错误态明确', async () => {
    const { useCase } = setup({
      paymentCode: err({ code: 'UPSTREAM_UNAVAILABLE', message: '上游不可用' }),
    })
    const result = await useCase.requestPaymentCode()
    expect(result.ok).toBe(false)
    const state = useCase.getSnapshot()
    expect(state.paymentCodeStatus).toBe('error')
    expect(state.paymentCodeError).toBe('上游不可用')
    expect(state.paymentCode).toBeNull()
  })
})
