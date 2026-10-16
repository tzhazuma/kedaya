import { describe, expect, it } from 'vitest'

import { createBrowseFaqUseCase } from '../browseFaq'
import type { BrowseFaqState, CachedFaqArticleList } from '../browseFaq'
import {
  TEST_NOW_ISO,
  TEST_PROFILE,
  createFakeCache,
  createFakeFaqRepository,
  createFakeSessionStore,
  faqArticle,
  fixedClock,
  upstreamError,
} from '../../__tests__/testDoubles'

/**
 * FAQ 浏览用例测试 —— 契约 §8 + 分类/搜索 + 「有用」幂等。
 */

const CACHE_KEY = 'test:cache:faq:articles'
const VOTES_KEY = 'test:faq:votes'

function createUseCase(
  repository: ReturnType<typeof createFakeFaqRepository>,
  cache = createFakeCache(),
  profile = TEST_PROFILE as typeof TEST_PROFILE | null,
) {
  return {
    cache,
    useCase: createBrowseFaqUseCase({
      repository,
      cache,
      clock: fixedClock(TEST_NOW_ISO),
      cacheKey: CACHE_KEY,
      votesCacheKey: VOTES_KEY,
      session: createFakeSessionStore(profile),
    }),
  }
}

function cachedArticles(overrides: Partial<CachedFaqArticleList> = {}): CachedFaqArticleList {
  return {
    articles: [faqArticle('faq-1', { helpfulCount: 3 })],
    activeCategory: 'all',
    keyword: '',
    nextCursor: null,
    total: 1,
    updatedAt: '2026-10-16T11:00:00.000Z',
    ...overrides,
  }
}

describe('browseFaq · hydrate（契约 §8 第 1 步）', () => {
  it('无缓存保持 idle，且不触发请求', () => {
    const repo = createFakeFaqRepository()
    const { useCase } = createUseCase(repo)

    const state = useCase.hydrate()

    expect(state.status).toBe('idle')
    expect(repo.articlesQueries).toHaveLength(0)
  })

  it('有缓存时同步产出 ready + fromCache，并恢复投票记录', () => {
    const repo = createFakeFaqRepository()
    const cache = createFakeCache({
      [CACHE_KEY]: cachedArticles(),
      [VOTES_KEY]: ['faq-1'],
    })
    const { useCase } = createUseCase(repo, cache)

    const state = useCase.hydrate()

    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(true)
    expect(state.votedArticleIds).toEqual(['faq-1'])
    expect(state.articles[0]?.voted).toBe(true)
    expect(repo.articlesQueries).toHaveLength(0)
  })

  it('只有投票记录没有列表缓存时，仍恢复投票状态', () => {
    const { useCase } = createUseCase(
      createFakeFaqRepository(),
      createFakeCache({ [VOTES_KEY]: ['faq-9'] }),
    )

    const state = useCase.hydrate()

    expect(state.status).toBe('idle')
    expect(state.votedArticleIds).toEqual(['faq-9'])
  })

  it('投票记录形状非法时忽略（防御旧版本写入）', () => {
    const { useCase } = createUseCase(
      createFakeFaqRepository(),
      createFakeCache({ [VOTES_KEY]: [1, 2, 3] }),
    )
    expect(useCase.hydrate().votedArticleIds).toEqual([])
  })

  it('缓存形状非法时视为没有缓存', () => {
    const { useCase } = createUseCase(
      createFakeFaqRepository(),
      createFakeCache({ [CACHE_KEY]: { articles: 'nope' } }),
    )
    expect(useCase.hydrate().status).toBe('idle')
  })
})

describe('browseFaq · load（分类 + 搜索）', () => {
  it('成功：ready，并带上分类清单与筛选状态', async () => {
    const repo = createFakeFaqRepository({
      articles: [
        {
          ok: true,
          value: {
            items: [
              faqArticle('faq-1', { category: '账号与登录' }),
              faqArticle('faq-2', { category: '校园卡' }),
            ],
            nextCursor: null,
            total: 2,
          },
        },
      ],
    })
    const { useCase, cache } = createUseCase(repo)

    const state = await useCase.load({ category: '校园卡', keyword: '余额' })

    expect(state.status).toBe('ready')
    expect(state.categories).toEqual(['账号与登录', '校园卡'])
    expect(state.activeCategory).toBe('校园卡')
    expect(state.keyword).toBe('余额')
    expect(repo.articlesQueries[0]).toMatchObject({ category: '校园卡', keyword: '余额', cursor: null })
    expect(cache.dump()[CACHE_KEY]).toBeDefined()
  })

  it('空结果 → empty；失败无缓存 → error；失败有缓存 → 静默降级', async () => {
    const emptyRepo = createFakeFaqRepository({
      articles: [{ ok: true, value: { items: [], nextCursor: null, total: 0 } }],
    })
    expect((await createUseCase(emptyRepo).useCase.load()).status).toBe('empty')

    const failRepo = createFakeFaqRepository({ articles: [{ ok: false, error: upstreamError('FAQ 挂了') }] })
    const failed = await createUseCase(failRepo).useCase.load()
    expect(failed.status).toBe('error')
    expect(failed.error).toBe('FAQ 挂了')

    const degradedRepo = createFakeFaqRepository({
      articles: [{ ok: false, error: upstreamError('FAQ 挂了') }],
    })
    const degradedCase = createUseCase(degradedRepo, createFakeCache({ [CACHE_KEY]: cachedArticles() }))
    degradedCase.useCase.hydrate()
    const degraded = await degradedCase.useCase.load()
    expect(degraded.status).toBe('ready')
    expect(degraded.fromCache).toBe(true)
    expect(degraded.error).toBe('FAQ 挂了')
  })

  it('loadMore 用游标续页并追加', async () => {
    const repo = createFakeFaqRepository({
      articles: [
        { ok: true, value: { items: [faqArticle('faq-1')], nextCursor: 'faq-1', total: 2 } },
        { ok: true, value: { items: [faqArticle('faq-2')], nextCursor: null, total: 2 } },
      ],
    })
    const { useCase } = createUseCase(repo)

    await useCase.load()
    const state = await useCase.loadMore()

    expect(repo.articlesQueries[1]?.cursor).toBe('faq-1')
    expect(state.articles.map((item) => item.id)).toEqual(['faq-1', 'faq-2'])
    expect(state.nextCursor).toBeNull()
  })

  it('selectCategory 清空列表并切到 idle，等待调用方重新 load', async () => {
    const repo = createFakeFaqRepository({
      articles: [{ ok: true, value: { items: [faqArticle('faq-1')], nextCursor: null, total: 1 } }],
    })
    const { useCase } = createUseCase(repo)
    await useCase.load()

    const state = useCase.selectCategory('校园卡')

    expect(state.activeCategory).toBe('校园卡')
    expect(state.articles).toEqual([])
    expect(state.status).toBe('idle')
  })
})

describe('browseFaq · voteHelpful 幂等（重复点只算一次）', () => {
  it('首次点击发请求、计数更新、投票记录落盘', async () => {
    const repo = createFakeFaqRepository({
      articles: [
        { ok: true, value: { items: [faqArticle('faq-1', { helpfulCount: 3 })], nextCursor: null, total: 1 } },
      ],
      vote: { ok: true, value: { articleId: 'faq-1', helpfulCount: 4, applied: true } },
    })
    const { useCase, cache } = createUseCase(repo)
    await useCase.load()

    const result = await useCase.voteHelpful('faq-1')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ applied: true, helpfulCount: 4 })
    expect(repo.votes).toHaveLength(1)
    expect(repo.votes[0]?.idempotencyKey).toContain('faq:helpful')
    expect(cache.dump()[VOTES_KEY]).toEqual(['faq-1'])

    const state = useCase.getSnapshot()
    expect(state.votedArticleIds).toEqual(['faq-1'])
    expect(state.articles[0]?.voted).toBe(true)
    expect(state.articles[0]?.helpfulCount).toBe(4)
  })

  it('重复点击**不再发请求**，计数不变（本地幂等）', async () => {
    const repo = createFakeFaqRepository({
      articles: [
        { ok: true, value: { items: [faqArticle('faq-1', { helpfulCount: 3 })], nextCursor: null, total: 1 } },
      ],
      vote: { ok: true, value: { articleId: 'faq-1', helpfulCount: 4, applied: true } },
    })
    const { useCase } = createUseCase(repo)
    await useCase.load()

    const first = await useCase.voteHelpful('faq-1')
    const second = await useCase.voteHelpful('faq-1')

    expect(repo.votes).toHaveLength(1)
    expect(first.ok && first.value.applied).toBe(true)
    expect(second.ok && second.value.applied).toBe(false)
    expect(second.ok && second.value.helpfulCount).toBe(4)
    expect(useCase.getSnapshot().articles[0]?.helpfulCount).toBe(4)
  })

  it('hydrate 出来的投票记录同样阻止重复请求（重启小程序后仍幂等）', async () => {
    const repo = createFakeFaqRepository({
      articles: [{ ok: true, value: { items: [faqArticle('faq-1')], nextCursor: null, total: 1 } }],
    })
    const cache = createFakeCache({ [VOTES_KEY]: ['faq-1'] })
    const { useCase } = createUseCase(repo, cache)
    useCase.hydrate()
    await useCase.load()

    const result = await useCase.voteHelpful('faq-1')

    expect(repo.votes).toHaveLength(0)
    expect(result.ok && result.value.applied).toBe(false)
  })

  it('服务端说「已投过」时只标记已投票，不重复计数', async () => {
    const repo = createFakeFaqRepository({
      articles: [
        { ok: true, value: { items: [faqArticle('faq-1', { helpfulCount: 9 })], nextCursor: null, total: 1 } },
      ],
      vote: { ok: true, value: { articleId: 'faq-1', helpfulCount: 9, applied: false } },
    })
    const { useCase } = createUseCase(repo)
    await useCase.load()

    const result = await useCase.voteHelpful('faq-1')

    expect(result.ok && result.value.applied).toBe(false)
    expect(useCase.getSnapshot().articles[0]?.helpfulCount).toBe(9)
    expect(useCase.getSnapshot().articles[0]?.voted).toBe(true)
  })

  it('未登录也能投票（faq 低敏感），userId 退化为 anonymous', async () => {
    const repo = createFakeFaqRepository({
      articles: [{ ok: true, value: { items: [faqArticle('faq-1')], nextCursor: null, total: 1 } }],
    })
    const { useCase } = createUseCase(repo, createFakeCache(), null)
    await useCase.load()

    await useCase.voteHelpful('faq-1')

    expect(repo.votes[0]?.userId).toBe('anonymous')
  })

  it('仓储失败时原样上抛，且不写入投票记录', async () => {
    const repo = createFakeFaqRepository({
      articles: [{ ok: true, value: { items: [faqArticle('faq-1')], nextCursor: null, total: 1 } }],
      vote: { ok: false, error: upstreamError('投票失败') },
    })
    const { useCase, cache } = createUseCase(repo)
    await useCase.load()

    const result = await useCase.voteHelpful('faq-1')

    expect(result.ok).toBe(false)
    expect(cache.dump()[VOTES_KEY]).toBeUndefined()
    expect(useCase.getSnapshot().votedArticleIds).toEqual([])
  })
})

describe('browseFaq · 快照稳定性', () => {
  it('未变更时返回同一引用；变更后替换引用', async () => {
    const repo = createFakeFaqRepository({
      articles: [{ ok: true, value: { items: [faqArticle('faq-1')], nextCursor: null, total: 1 } }],
    })
    const { useCase } = createUseCase(repo)

    const before: BrowseFaqState = useCase.getSnapshot()
    expect(useCase.getSnapshot()).toBe(before)

    await useCase.load()
    expect(useCase.getSnapshot()).not.toBe(before)
  })
})
