import { describe, expect, it } from 'vitest'

import { createMockFaqRepository } from '../mockFaqRepository'
import { MOCK_FAQ_ARTICLES, MOCK_FAQ_TICKETS } from '../../mock/faqFixtures'
import { MOCK_PROFILE } from '../../mock/fixtures'

/**
 * Mock FAQ 仓储测试 —— 分页、搜索、可见性、投票幂等与工单归属。
 */

const NOW = new Date('2026-10-16T12:00:00.000Z')

function createRepo(latencyMs = 0) {
  return createMockFaqRepository({ latencyMs, now: () => NOW })
}

describe('mockFaqRepository · 文章列表', () => {
  it('只返回 PUBLISHED 文章（DRAFT / ARCHIVED 不可见）', async () => {
    const repo = createRepo()
    const result = await repo.listArticles({ limit: 50 })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const ids = result.value.items.map((article) => article.id)
    expect(ids).not.toContain('faq-4008') // DRAFT
    expect(ids).not.toContain('faq-4009') // ARCHIVED
    expect(ids).toContain('faq-4001')
    expect(result.value.total).toBe(7)
  })

  it('分类筛选与 all 哨兵值', async () => {
    const repo = createRepo()

    const campusCard = await repo.listArticles({ category: '校园卡', limit: 50 })
    expect(campusCard.ok && campusCard.value.items.map((a) => a.id)).toEqual(['faq-4003', 'faq-4004'])

    const all = await repo.listArticles({ category: 'all', limit: 50 })
    expect(all.ok && all.value.items).toHaveLength(7)
  })

  it('关键词搜索命中问题与答案', async () => {
    const repo = createRepo()

    const byQuestion = await repo.listArticles({ keyword: '校园卡', limit: 50 })
    expect(byQuestion.ok && byQuestion.value.items.length).toBeGreaterThan(0)

    const byAnswer = await repo.listArticles({ keyword: 'KedaYa JWT', limit: 50 })
    expect(byAnswer.ok && byAnswer.value.items.map((a) => a.id)).toEqual(['faq-4001'])
  })

  it('游标分页不重复、不丢数据', async () => {
    const repo = createRepo()

    const first = await repo.listArticles({ limit: 3 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.nextCursor).not.toBeNull()

    const second = await repo.listArticles({ limit: 3, cursor: first.value.nextCursor })
    expect(second.ok).toBe(true)
    if (!second.ok) return

    const ids = [...first.value.items, ...second.value.items].map((article) => article.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('返回深拷贝（外部改动不污染数据库）', async () => {
    const repo = createRepo()
    const result = await repo.listArticles({ limit: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const article = result.value.items[0]
    if (article !== undefined) article.question = '被改坏了'

    const again = await repo.listArticles({ limit: 1 })
    expect(again.ok && again.value.items[0]?.question).not.toBe('被改坏了')
  })
})

describe('mockFaqRepository · 「有用」投票幂等（服务端侧）', () => {
  it('同一用户重复投票 applied=false 且计数不变', async () => {
    const repo = createRepo()

    const first = await repo.voteHelpful({ articleId: 'faq-4001', userId: 'u-1', idempotencyKey: 'k1' })
    const second = await repo.voteHelpful({ articleId: 'faq-4001', userId: 'u-1', idempotencyKey: 'k2' })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    expect(first.value.applied).toBe(true)
    expect(second.value.applied).toBe(false)
    expect(second.value.helpfulCount).toBe(first.value.helpfulCount)
  })

  it('不同用户各自算一次', async () => {
    const repo = createRepo()
    const seed = MOCK_FAQ_ARTICLES.find((article) => article.id === 'faq-4003')
    const base = seed?.helpfulCount ?? 0

    await repo.voteHelpful({ articleId: 'faq-4003', userId: 'u-1' })
    const second = await repo.voteHelpful({ articleId: 'faq-4003', userId: 'u-2' })

    expect(second.ok && second.value.applied).toBe(true)
    expect(second.ok && second.value.helpfulCount).toBe(base + 2)
  })

  it('投票计数会体现在后续列表里', async () => {
    const repo = createRepo()
    const before = await repo.listArticles({ keyword: '拼单', limit: 5 })
    const base = before.ok ? (before.value.items[0]?.helpfulCount ?? 0) : 0

    await repo.voteHelpful({ articleId: 'faq-4005', userId: 'u-1' })

    const after = await repo.listArticles({ keyword: '拼单', limit: 5 })
    expect(after.ok && after.value.items[0]?.helpfulCount).toBe(base + 1)
  })

  it('投票不存在的文章返回 NOT_FOUND', async () => {
    const repo = createRepo()
    const result = await repo.voteHelpful({ articleId: 'faq-missing', userId: 'u-1' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('reset 会清空投票记录（可重复演示）', async () => {
    const repo = createRepo()
    await repo.voteHelpful({ articleId: 'faq-4001', userId: 'u-1' })
    repo.reset()

    const again = await repo.voteHelpful({ articleId: 'faq-4001', userId: 'u-1' })
    expect(again.ok && again.value.applied).toBe(true)
  })
})

describe('mockFaqRepository · 工单', () => {
  it('只返回属于该 userId 的工单，按时间倒序', async () => {
    const repo = createRepo()
    const result = await repo.listMyTickets(MOCK_PROFILE.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.map((ticket) => ticket.id)).toEqual(['ft-5001', 'ft-5002'])
    expect(result.value.every((ticket) => ticket.userId === MOCK_PROFILE.id)).toBe(true)
  })

  it('未登录（userId = null）拿到的是匿名工单', async () => {
    const repo = createRepo()
    const result = await repo.listMyTickets(null)

    expect(result.ok && result.value.map((ticket) => ticket.id)).toEqual(['ft-5003'])
    expect(result.ok && result.value[0]?.userId).toBeNull()
  })

  it('提交工单后出现在列表首位，状态为 OPEN', async () => {
    const repo = createRepo()

    const created = await repo.submitTicket({
      userId: MOCK_PROFILE.id,
      contact: 'wechat: kdy',
      question: '新问题',
      idempotencyKey: 'k1',
    })

    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.status).toBe('OPEN')
    expect(created.value.createdAt).toBe(NOW.toISOString())

    const list = await repo.listMyTickets(MOCK_PROFILE.id)
    expect(list.ok && list.value[0]?.id).toBe(created.value.id)
  })

  it('种子工单数量与 fixtures 一致（防止测试与种子脱节）', async () => {
    const repo = createRepo()
    const mine = await repo.listMyTickets(MOCK_PROFILE.id)
    const anon = await repo.listMyTickets(null)
    const mineCount = mine.ok ? mine.value.length : 0
    const anonCount = anon.ok ? anon.value.length : 0
    expect(mineCount + anonCount).toBe(MOCK_FAQ_TICKETS.length)
  })
})

describe('mockFaqRepository · 三态控制面', () => {
  it('failNextRequests 只影响接下来的 N 次请求', async () => {
    const repo = createRepo()
    repo.failNextRequests(1)

    const failed = await repo.listArticles()
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    expect((await repo.listArticles()).ok).toBe(true)
  })

  it('clearAll 制造空态，reset 恢复种子', async () => {
    const repo = createRepo()

    repo.clearAll()
    const empty = await repo.listArticles()
    expect(empty.ok && empty.value.items).toEqual([])

    repo.reset()
    const restored = await repo.listArticles({ limit: 50 })
    expect(restored.ok && restored.value.items.length).toBe(7)
  })

  it('投票失败控制面：投票也会被 failNextRequests 拦住', async () => {
    const repo = createRepo()
    repo.failNextRequests(1)
    const failed = await repo.voteHelpful({ articleId: 'faq-4001', userId: 'u-1' })
    expect(failed.ok).toBe(false)
  })
})
