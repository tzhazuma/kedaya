import { describe, expect, it } from 'vitest'

import {
  FAQ_CATEGORY_ALL,
  applyHelpfulVote,
  answerExcerpt,
  articleStatusLabel,
  canFollowUp,
  faqCategories,
  filterArticles,
  groupArticlesByCategory,
  hasVotedHelpful,
  isArticlePublished,
  matchesFaqKeyword,
  summarizeArticle,
  summarizeTicket,
  ticketStatusLabel,
  validateTicketDraft,
  visibleArticles,
} from '../faq'
import type { FaqArticle, FaqTicket } from '../faq'

/**
 * FAQ 领域模型测试 —— 搜索/分类、可见性、工单隐私约束与「有用」幂等。
 */

const NOW = new Date('2026-10-16T12:00:00.000Z')

function article(overrides: Partial<FaqArticle> = {}): FaqArticle {
  return {
    id: 'faq-1',
    slug: 'faq-1',
    question: '如何登录？',
    answer: '在「我的」页点击登录。',
    category: '账号与登录',
    status: 'PUBLISHED',
    helpfulCount: 3,
    unhelpfulCount: 0,
    updatedAt: '2026-10-16T08:00:00.000Z',
    ...overrides,
  }
}

function ticket(overrides: Partial<FaqTicket> = {}): FaqTicket {
  return {
    id: 'ft-1',
    userId: 'u-me',
    contact: 'student@shanghaitech.edu.cn',
    question: '登录不了',
    status: 'OPEN',
    createdAt: '2026-10-16T09:00:00.000Z',
    updatedAt: '2026-10-16T09:00:00.000Z',
    ...overrides,
  }
}

describe('faq · 可见性与标签', () => {
  it('只有 PUBLISHED 对用户可见', () => {
    expect(isArticlePublished(article())).toBe(true)
    expect(isArticlePublished(article({ status: 'DRAFT' }))).toBe(false)
    expect(isArticlePublished(article({ status: 'ARCHIVED' }))).toBe(false)
    expect(visibleArticles([article(), article({ id: 'a2', status: 'DRAFT' })])).toHaveLength(1)
  })

  it('状态标签取自冻结枚举', () => {
    expect(articleStatusLabel('PUBLISHED')).toBe('已发布')
    expect(articleStatusLabel('ARCHIVED')).toBe('已归档')
    expect(ticketStatusLabel('OPEN')).toBe('待处理')
    expect(ticketStatusLabel('ANSWERED')).toBe('已回复')
    expect(ticketStatusLabel('CLOSED')).toBe('已关闭')
  })
})

describe('faq · 搜索与分类（SearchFaq 无需登录）', () => {
  const list = [
    article({ id: 'a1', question: '如何登录？', category: '账号与登录' }),
    article({ id: 'a2', question: '校园卡余额？', answer: '在校园卡模块查看', category: '校园卡' }),
    article({ id: 'a3', question: '草稿', category: '其它', status: 'DRAFT' }),
  ]

  it('空关键词返回全部已发布文章（不含草稿）', () => {
    expect(filterArticles(list).map((item) => item.id)).toEqual(['a1', 'a2'])
  })

  it('关键词匹配问题与答案，大小写不敏感', () => {
    expect(filterArticles(list, { keyword: '登录' }).map((item) => item.id)).toEqual(['a1'])
    expect(filterArticles(list, { keyword: '校园卡模块' }).map((item) => item.id)).toEqual(['a2'])
    expect(matchesFaqKeyword(article({ question: 'Taro 坑' }), 'taro')).toBe(true)
    expect(matchesFaqKeyword(article(), '   ')).toBe(true)
  })

  it('分类筛选支持 all 哨兵值与 null', () => {
    expect(filterArticles(list, { category: '校园卡' }).map((item) => item.id)).toEqual(['a2'])
    expect(filterArticles(list, { category: FAQ_CATEGORY_ALL })).toHaveLength(2)
    expect(filterArticles(list, { category: null })).toHaveLength(2)
  })

  it('分类清单按首次出现顺序去重，且不含草稿分类', () => {
    expect(faqCategories(list)).toEqual(['账号与登录', '校园卡'])
  })

  it('按分类分组保持出现顺序', () => {
    const groups = groupArticlesByCategory(list)
    expect(groups.map((group) => group.category)).toEqual(['账号与登录', '校园卡'])
    expect(groups[0]?.articles.map((item) => item.id)).toEqual(['a1'])
  })

  it('答案摘要压平换行并截断', () => {
    expect(answerExcerpt('a\n\nb', 10)).toBe('a b')
    expect(answerExcerpt('x'.repeat(60), 10).endsWith('…')).toBe(true)
  })

  it('摘要带上「是否已投票」标记', () => {
    const summary = summarizeArticle(article({ helpfulCount: 9 }), true)
    expect(summary.helpfulCount).toBe(9)
    expect(summary.voted).toBe(true)
  })
})

describe('faq · 「有用」投票幂等（重复点只算一次）', () => {
  it('首次投票 applied=true 且计数 +1', () => {
    const outcome = applyHelpfulVote(article({ helpfulCount: 3 }), [], 'faq-1')
    expect(outcome.applied).toBe(true)
    expect(outcome.article.helpfulCount).toBe(4)
  })

  it('重复投票 applied=false 且计数不变', () => {
    const voted = ['faq-1']
    const outcome = applyHelpfulVote(article({ helpfulCount: 4 }), voted, 'faq-1')
    expect(outcome.applied).toBe(false)
    expect(outcome.article.helpfulCount).toBe(4)
  })

  it('连续调用两次的结果与调用一次相同（幂等）', () => {
    const source = article({ helpfulCount: 0 })
    const first = applyHelpfulVote(source, [], 'faq-1')
    const second = applyHelpfulVote(first.article, ['faq-1'], 'faq-1')
    expect(second.article.helpfulCount).toBe(first.article.helpfulCount)
    expect(second.applied).toBe(false)
  })

  it('hasVotedHelpful 是投票记录的唯一判定入口', () => {
    expect(hasVotedHelpful(['a', 'b'], 'b')).toBe(true)
    expect(hasVotedHelpful(['a'], 'b')).toBe(false)
  })
})

describe('faq · 工单校验（不存明文手机号）', () => {
  it('合法工单被去空白后返回', () => {
    const result = validateTicketDraft({
      contact: '  student@shanghaitech.edu.cn ',
      question: '  登录一直失败  ',
    })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.value).toEqual({
        contact: 'student@shanghaitech.edu.cn',
        question: '登录一直失败',
      })
    }
  })

  it('拒绝中国大陆手机号（domain-model §2.8 硬约束）', () => {
    const result = validateTicketDraft({ contact: '13800138000', question: '登录失败' })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors[0]?.field).toBe('contact')
      expect(result.errors[0]?.message).toContain('手机号')
    }
  })

  it('空联系方式与空问题都被拦截', () => {
    const result = validateTicketDraft({ contact: '', question: '   ' })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.map((error) => error.field).sort()).toEqual(['contact', 'question'])
    }
  })

  it('超长问题描述被拦截', () => {
    const result = validateTicketDraft({ contact: 'wechat: kdy', question: 'x'.repeat(2_001) })
    expect(result.valid).toBe(false)
  })

  it('ANSWERED 工单可以追问', () => {
    expect(canFollowUp(ticket({ status: 'ANSWERED' }))).toBe(true)
    expect(canFollowUp(ticket({ status: 'OPEN' }))).toBe(false)
    expect(canFollowUp(ticket({ status: 'CLOSED' }))).toBe(false)
  })
})

describe('faq · 工单摘要', () => {
  it('未登录工单标记为匿名，并给出相对时间', () => {
    const summary = summarizeTicket(
      ticket({ userId: null, createdAt: '2026-10-16T11:00:00.000Z' }),
      NOW,
    )
    expect(summary.anonymous).toBe(true)
    expect(summary.createdAtLabel).toBe('1 小时前')
    expect(summary.answer).toBeNull()
  })

  it('已回复工单带出答案与状态标签', () => {
    const summary = summarizeTicket(ticket({ status: 'ANSWERED', answer: '已修复' }), NOW)
    expect(summary.statusLabel).toBe('已回复')
    expect(summary.answer).toBe('已修复')
  })
})
