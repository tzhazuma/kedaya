import { describe, expect, it } from 'vitest'

import { createMyTicketsUseCase } from '../myTickets'
import type { CachedFaqTicketList } from '../myTickets'
import {
  TEST_NOW_ISO,
  TEST_PROFILE,
  createFakeCache,
  createFakeFaqRepository,
  createFakeSessionStore,
  faqTicket,
  fixedClock,
  upstreamError,
} from '../../__tests__/testDoubles'

/**
 * 我的工单用例测试 —— 契约 §8 + 未登录提交（domain-model §2.8）+ 隐私校验。
 */

const CACHE_KEY = 'test:cache:faq:tickets'

function createUseCase(
  repository: ReturnType<typeof createFakeFaqRepository>,
  cache = createFakeCache(),
  profile = TEST_PROFILE as typeof TEST_PROFILE | null,
) {
  return {
    cache,
    useCase: createMyTicketsUseCase({
      repository,
      cache,
      clock: fixedClock(TEST_NOW_ISO),
      cacheKey: CACHE_KEY,
      session: createFakeSessionStore(profile),
    }),
  }
}

function cachedTickets(overrides: Partial<CachedFaqTicketList> = {}): CachedFaqTicketList {
  return {
    tickets: [faqTicket('ft-1')],
    updatedAt: '2026-10-16T11:00:00.000Z',
    ...overrides,
  }
}

describe('myTickets · hydrate / load', () => {
  it('无缓存保持 idle，不触发请求', () => {
    const repo = createFakeFaqRepository()
    const { useCase } = createUseCase(repo)
    expect(useCase.hydrate().status).toBe('idle')
    expect(repo.ticketUserIds).toHaveLength(0)
  })

  it('有缓存时同步 ready + fromCache', () => {
    const { useCase } = createUseCase(
      createFakeFaqRepository(),
      createFakeCache({ [CACHE_KEY]: cachedTickets() }),
    )
    const state = useCase.hydrate()

    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(true)
    expect(state.tickets[0]?.id).toBe('ft-1')
  })

  it('已登录时用 profile.id 拉取自己的工单', async () => {
    const repo = createFakeFaqRepository({ tickets: [{ ok: true, value: [faqTicket('ft-1')] }] })
    const { useCase } = createUseCase(repo)

    const state = await useCase.load()

    expect(repo.ticketUserIds).toEqual([TEST_PROFILE.id])
    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(false)
  })

  it('未登录时 userId 为 null（domain-model §2.8）', async () => {
    const repo = createFakeFaqRepository({ tickets: [{ ok: true, value: [] }] })
    const { useCase } = createUseCase(repo, createFakeCache(), null)

    const state = await useCase.load()

    expect(repo.ticketUserIds).toEqual([null])
    expect(state.status).toBe('empty')
  })

  it('失败无缓存 → error；失败有缓存 → 静默降级', async () => {
    const repo = createFakeFaqRepository({ tickets: [{ ok: false, error: upstreamError('工单服务不可用') }] })
    const failed = await createUseCase(repo).useCase.load()
    expect(failed.status).toBe('error')
    expect(failed.error).toBe('工单服务不可用')

    const repo2 = createFakeFaqRepository({ tickets: [{ ok: false, error: upstreamError('工单服务不可用') }] })
    const degradedCase = createUseCase(repo2, createFakeCache({ [CACHE_KEY]: cachedTickets() }))
    degradedCase.useCase.hydrate()
    const degraded = await degradedCase.useCase.load()
    expect(degraded.status).toBe('ready')
    expect(degraded.fromCache).toBe(true)
    expect(degraded.tickets).toHaveLength(1)
  })
})

describe('myTickets · submit', () => {
  it('校验失败不发请求，并返回字段级 details', async () => {
    const repo = createFakeFaqRepository()
    const result = await createUseCase(repo).useCase.submit({ contact: '13800138000', question: '登录失败' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED')
      expect(result.error.details).toMatchObject({ errors: [{ field: 'contact' }] })
    }
    expect(repo.submitted).toHaveLength(0)
  })

  it('成功：带上 userId 与幂等键，并把新工单插入列表头部 + 写缓存', async () => {
    const repo = createFakeFaqRepository({
      tickets: [{ ok: true, value: [faqTicket('ft-old')] }],
      submit: { ok: true, value: faqTicket('ft-new', { question: '新问题' }) },
    })
    const { useCase, cache } = createUseCase(repo)
    await useCase.load()

    const result = await useCase.submit({ contact: 'wechat: kdy', question: '新问题' })

    expect(result.ok).toBe(true)
    expect(repo.submitted[0]).toMatchObject({
      userId: TEST_PROFILE.id,
      contact: 'wechat: kdy',
      question: '新问题',
    })
    expect(repo.submitted[0]?.idempotencyKey).toContain('faq:ticket')
    expect(useCase.getSnapshot().tickets.map((item) => item.id)).toEqual(['ft-new', 'ft-old'])
    expect(cache.dump()[CACHE_KEY]).toBeDefined()
  })

  it('未登录提交时 userId 为 null，仍可成功（domain-model §2.8）', async () => {
    const repo = createFakeFaqRepository({
      submit: { ok: true, value: faqTicket('ft-anon', { userId: null }) },
    })
    const { useCase } = createUseCase(repo, createFakeCache(), null)

    const result = await useCase.submit({ contact: 'anon@shanghaitech.edu.cn', question: '未登录提问' })

    expect(result.ok).toBe(true)
    expect(repo.submitted[0]?.userId).toBeNull()
    expect(useCase.getSnapshot().tickets[0]?.anonymous).toBe(true)
  })

  it('仓储失败原样上抛，不污染列表', async () => {
    const repo = createFakeFaqRepository({ submit: { ok: false, error: upstreamError('提交过于频繁') } })
    const { useCase } = createUseCase(repo)

    const result = await useCase.submit({ contact: 'wechat: kdy', question: '问题' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe('提交过于频繁')
    expect(useCase.getSnapshot().tickets).toEqual([])
  })
})
