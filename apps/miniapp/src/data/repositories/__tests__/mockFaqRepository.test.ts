import { describe, expect, it } from 'vitest'

import { createFaqUseCases, validateDraft } from '../../../application/faq/faqUseCases'
import {
  FAQ_CATEGORIES,
  FAQ_CATEGORY_LABELS,
  answerPreview,
  categoryLabel,
  formatTagsText,
  isFaqCategory,
  parseTagsText,
  summarize,
} from '../../../domain/models/faq'
import type { FaqEntry } from '../../../domain/models/faq'
import { createMemoryStorage } from '../../storage/memoryStorage'
import { createMockFaqRepository } from '../mockFaqRepository'

/**
 * 常见问题「领域规则 + Mock 仓储 + 用例」的可执行规格。
 *
 * Mock 仓储的价值在于**规则一致**：筛选维度、排序（含 id 兜底）、
 * 游标分页、校验文案、有帮助的 +1 语义都要和后端一样。
 * 所以这里既测纯函数，也测 mock 真的执行了同样的规则（而不是「看起来像」）。
 * 最后一块测「本机不去重发有帮助」这条客户端独有的规则 —— 它没有服务端兜底，
 * 只能靠测试守住。
 */

const NOW = new Date('2026-10-16T12:00:00.000Z')

function entry(overrides: Partial<FaqEntry> = {}): FaqEntry {
  return {
    id: 'faq-a',
    question: '校园卡丢了怎么补办？',
    answer: '先在校园卡页挂失，再带学生证到学生服务中心一卡通窗口补办。',
    category: 'campus-card',
    tags: ['校园卡'],
    helpfulCount: 10,
    createdAt: '2026-10-16T08:00:00.000Z',
    updatedAt: '2026-10-16T08:00:00.000Z',
    ...overrides,
  }
}

function repo(entries: readonly FaqEntry[] = [entry()]) {
  const repository = createMockFaqRepository({ latencyMs: 0, now: () => NOW })
  repository.seed(entries)
  return repository
}

describe('分类白名单（单一真相）', () => {
  it('每个白名单分类都有中文标题', () => {
    expect(FAQ_CATEGORIES.length).toBeGreaterThanOrEqual(5)
    for (const category of FAQ_CATEGORIES) {
      expect(FAQ_CATEGORY_LABELS[category]).toBeTruthy()
    }
  })

  it('白名单外的分类降级显示为「其他」，而不是把内部码怼给用户', () => {
    expect(categoryLabel('campus-card')).toBe('校园卡与支付')
    expect(categoryLabel('legacy-cat')).toBe('其他')
    expect(isFaqCategory('legacy-cat')).toBe(false)
    expect(isFaqCategory('dorm')).toBe(true)
  })
})

describe('派生视图（卡片直接可读，页面不再自己算）', () => {
  it('答案摘要压平换行并按码点截断', () => {
    expect(answerPreview('第一行\n第二行', 100)).toBe('第一行 第二行')
    expect(answerPreview('x'.repeat(90))).toHaveLength(80)
    // 不切坏代理对：截断后不应出现孤立代理项
    expect(answerPreview('🦆'.repeat(90), 3)).toBe('🦆🦆🦆')
  })

  it('summarize 给出分类标题与相对时间', () => {
    const summary = summarize(entry(), NOW)
    expect(summary.categoryLabel).toBe('校园卡与支付')
    expect(summary.helpfulCount).toBe(10)
    expect(summary.createdLabel).toBe('4 小时前')
    expect(summary.tags).toEqual(['校园卡'])
  })
})

describe('标签文本 ↔ 数组', () => {
  it('支持中英文逗号、顿号、分号与空格，并去重', () => {
    expect(parseTagsText('校园卡、补办,挂失， 挂失')).toEqual(['校园卡', '补办', '挂失'])
    expect(parseTagsText('   ')).toEqual([])
    expect(parseTagsText('a;b b')).toEqual(['a', 'b'])
  })

  it('与 formatTagsText 成对，可原样回显', () => {
    const tags = ['校园卡', '补办']
    expect(parseTagsText(formatTagsText(tags))).toEqual(tags)
  })
})

describe('发布前校验（与服务端同一套规则，只做即时提示）', () => {
  it('空表单逐项给出提示', () => {
    const problems = validateDraft({ question: '', answer: '', category: 'auth', tagsText: '' })
    expect(problems).toContain('请把问题写清楚（一句话即可）')
    expect(problems).toContain('请填写答案')
  })

  it('分类必须来自白名单', () => {
    const problems = validateDraft({
      question: '快递在哪取？',
      answer: '生活区快递驿站。',
      category: 'legacy-cat',
      tagsText: '',
    })
    expect(problems).toContain('分类不在支持范围内')
  })

  it('标签超量与超长都会被指出来', () => {
    const tooMany = validateDraft({
      question: 'x',
      answer: 'y',
      category: 'other',
      tagsText: Array.from({ length: 21 }, (_, index) => `tag${String(index)}`).join('、'),
    })
    expect(tooMany).toContain('标签最多 20 个')

    const tooLong = validateDraft({
      question: 'x',
      answer: 'y',
      category: 'other',
      tagsText: 'z'.repeat(65),
    })
    expect(tooLong).toContain('单个标签最多 64 个字')
  })

  it('合法草稿没有任何问题', () => {
    expect(
      validateDraft({
        question: '一卡通丢了怎么补办？',
        answer: '先在校园卡页挂失，再到窗口补办。',
        category: 'campus-card',
        tagsText: '校园卡、补办',
      }),
    ).toEqual([])
  })
})

describe('Mock 仓储 · 筛选与排序', () => {
  const seed: FaqEntry[] = [
    entry({
      id: 'faq-1',
      question: '图书馆几点开门？',
      answer: '工作日 08:00–22:00。',
      category: 'library',
      createdAt: '2026-10-16T09:00:00.000Z',
    }),
    entry({
      id: 'faq-2',
      question: '校园卡丢了怎么办？',
      answer: '先在校园卡页挂失，再补办；补办期间可以用付款码。',
      category: 'campus-card',
      createdAt: '2026-10-16T11:00:00.000Z',
    }),
    entry({
      id: 'faq-3',
      question: '宿舍怎么报修？',
      answer: '到值班室登记，写明楼栋房间与故障。',
      category: 'dorm',
      createdAt: '2026-10-16T10:00:00.000Z',
    }),
  ]

  it('默认最新在前（createdAt desc）', async () => {
    const result = await repo(seed).list({ cursor: null, filters: {} })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items.map((item) => item.id)).toEqual(['faq-2', 'faq-3', 'faq-1'])
  })

  it('createdAt 相同时用 id 兜底倒序（游标分页才不漏读）', async () => {
    const same = '2026-10-16T10:00:00.000Z'
    const result = await repo([
      entry({ id: 'faq-1', createdAt: same }),
      entry({ id: 'faq-2', createdAt: same }),
    ]).list({ cursor: null, filters: {} })
    if (result.ok) expect(result.value.items.map((item) => item.id)).toEqual(['faq-2', 'faq-1'])
  })

  it('category 是精确匹配（不做模糊）', async () => {
    const exact = await repo(seed).list({ cursor: null, filters: { category: 'dorm' } })
    if (exact.ok) expect(exact.value.items.map((item) => item.id)).toEqual(['faq-3'])

    const partial = await repo(seed).list({ cursor: null, filters: { category: 'dor' as never } })
    if (partial.ok) expect(partial.value.items).toHaveLength(0)
  })

  it('关键词同时命中问题与答案（用户记得的往往是答案里那句话）', async () => {
    const byQuestion = await repo(seed).list({ cursor: null, filters: { keyword: '报修' } })
    if (byQuestion.ok) expect(byQuestion.value.items.map((item) => item.id)).toEqual(['faq-3'])

    const byAnswer = await repo(seed).list({ cursor: null, filters: { keyword: '付款码' } })
    if (byAnswer.ok) expect(byAnswer.value.items.map((item) => item.id)).toEqual(['faq-2'])
  })

  it('分类与关键词可以叠加，空白关键词等价于没选', async () => {
    const both = await repo(seed).list({
      cursor: null,
      filters: { category: 'campus-card', keyword: '挂失' },
    })
    if (both.ok) expect(both.value.items.map((item) => item.id)).toEqual(['faq-2'])

    // 分类是白名单字面量联合，"没选"用 undefined 表示（页面在「全部」时正是这么传的）
    const blank = await repo(seed).list({ cursor: null, filters: { keyword: '  ' } })
    if (blank.ok) expect(blank.value.items).toHaveLength(3)
  })

  it('游标分页逐页返回，最后一页 nextCursor 为 null', async () => {
    const first = await repo(seed).list({ cursor: null, limit: 2, filters: {} })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.items.map((item) => item.id)).toEqual(['faq-2', 'faq-3'])
    expect(first.value.nextCursor).toBe('faq-3')
    // 后端不返回 total（Page.total 是可选字段）
    expect(first.value.total).toBeUndefined()

    const second = await repo(seed).list({ cursor: 'faq-3', limit: 2, filters: {} })
    if (second.ok) {
      expect(second.value.items.map((item) => item.id)).toEqual(['faq-1'])
      expect(second.value.nextCursor).toBeNull()
    }
  })
})

describe('Mock 仓储 · 详情 / 新增 / 有帮助', () => {
  it('不存在的条目统一 NOT_FOUND', async () => {
    const results = await Promise.all([
      repo(seedEmpty()).detail('ghost'),
      repo(seedEmpty()).markHelpful('ghost'),
    ])
    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND')
        expect(result.error.message).toBe('常见问题不存在或已被删除')
      }
    }
  })

  it('新增校验：空问题 / 空答案 / 白名单外分类 / 标签超量', async () => {
    const r = repo([])
    const base = { question: '快递在哪取？', answer: '生活区快递驿站。', category: 'dorm' }

    const cases = [
      { ...base, question: '   ' },
      { ...base, answer: '' },
      { ...base, category: 'legacy-cat' },
      { ...base, question: 'x'.repeat(501) },
      { ...base, answer: 'x'.repeat(501) },
      { ...base, tags: Array.from({ length: 21 }, () => 'tag') },
      { ...base, tags: ['x'.repeat(65)] },
    ]

    for (const input of cases) {
      const result = await r.create(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    }
  })

  it('新增成功：字段去空格、计数从 0 起、并排在列表首位', async () => {
    const r = repo([entry({ createdAt: '2026-10-16T08:00:00.000Z' })])
    const created = await r.create({
      question: '  快递在哪取？  ',
      answer: '  生活区快递驿站，08:00–20:00。  ',
      category: 'dorm',
      tags: [' 快递 ', ''],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(created.value.question).toBe('快递在哪取？')
    expect(created.value.answer).toBe('生活区快递驿站，08:00–20:00。')
    expect(created.value.tags).toEqual(['快递'])
    // 计数只能由 markHelpful 增加（与服务端 @default(0) 一致）
    expect(created.value.helpfulCount).toBe(0)

    const listed = await r.list({ cursor: null, filters: {} })
    if (listed.ok) expect(listed.value.items[0]?.id).toBe(created.value.id)
  })

  it('有帮助是「无脑 +1」：连点两次就是两次自增', async () => {
    const r = repo([entry({ id: 'faq-a', helpfulCount: 10 })])

    const first = await r.markHelpful('faq-a')
    if (first.ok) expect(first.value.helpfulCount).toBe(11)

    const second = await r.markHelpful('faq-a')
    if (second.ok) expect(second.value.helpfulCount).toBe(12)

    const detail = await r.detail('faq-a')
    if (detail.ok) expect(detail.value.helpfulCount).toBe(12)
  })
})

describe('Mock 仓储 · 种子与演示控制', () => {
  it('种子至少 8 条，且每条答案真的有信息（不是「请联系相关老师」）', async () => {
    const r = createMockFaqRepository({ latencyMs: 0, now: () => NOW })
    const listed = await r.list({ cursor: null, limit: 50, filters: {} })
    expect(listed.ok).toBe(true)
    if (!listed.ok) return

    expect(listed.value.items.length).toBeGreaterThanOrEqual(8)
    for (const item of listed.value.items) {
      expect(item.question.trim().length).toBeGreaterThan(4)
      // 3–5 句的可执行信息，而不是一句话糊弄
      expect(item.answer.trim().length).toBeGreaterThan(40)
      // 分类必须落在白名单内，否则列表 chip 永远筛不到它
      expect(isFaqCategory(item.category)).toBe(true)
    }

    // 列表首屏能看出「最新在前」
    const stamps = listed.value.items.map((item) => item.createdAt)
    expect([...stamps].sort((a, b) => b.localeCompare(a))).toEqual(stamps)
  })

  it('failNextRequests 只影响接下来 N 次请求', async () => {
    const r = repo([entry()])
    r.failNextRequests(1)
    const failed = await r.list({ cursor: null, filters: {} })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    const ok2 = await r.list({ cursor: null, filters: {} })
    expect(ok2.ok).toBe(true)
  })

  it('clearAll 之后是真的空列表，reset 恢复种子', async () => {
    const r = repo()
    r.clearAll()
    const emptied = await r.list({ cursor: null, filters: {} })
    if (emptied.ok) expect(emptied.value.items).toHaveLength(0)

    r.reset()
    const restored = await r.list({ cursor: null, filters: {} })
    if (restored.ok) expect(restored.value.items.length).toBeGreaterThanOrEqual(8)
  })
})

describe('用例 · 有帮助的本地去重（服务端没有兜底）', () => {
  function useCases(repository = repo([entry({ id: 'faq-a', helpfulCount: 10 })])) {
    return createFaqUseCases({
      repository,
      cache: createMemoryStorage(),
      clock: { now: () => NOW },
      cacheKey: 'kedaya:test:faq:list',
      helpfulMarksKey: 'kedaya:test:faq:helpful',
    })
  }

  it('第一次标记成功并 +1，第二次不发请求直接 CONFLICT', async () => {
    const repository = repo([entry({ id: 'faq-a', helpfulCount: 10 })])
    const faq = useCases(repository)

    expect(faq.isMarkedHelpful('faq-a')).toBe(false)

    const first = await faq.markHelpful('faq-a')
    expect(first.ok).toBe(true)
    if (first.ok) expect(first.value.helpfulCount).toBe(11)
    expect(faq.isMarkedHelpful('faq-a')).toBe(true)

    const second = await faq.markHelpful('faq-a')
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('CONFLICT')

    // 计数没有被第二次点击继续刷高
    const detail = await repository.detail('faq-a')
    if (detail.ok) expect(detail.value.helpfulCount).toBe(11)
  })

  it('请求失败时不记本地标记：用户还能重试', async () => {
    const repository = repo([entry({ id: 'faq-a' })])
    const faq = useCases(repository)

    repository.failNextRequests(1)
    const failed = await faq.markHelpful('faq-a')
    expect(failed.ok).toBe(false)
    expect(faq.isMarkedHelpful('faq-a')).toBe(false)

    const retried = await faq.markHelpful('faq-a')
    expect(retried.ok).toBe(true)
    expect(faq.isMarkedHelpful('faq-a')).toBe(true)
  })

  it('标记记在 CachePort 里：换一个用例实例仍然认（重开小程序不重复计数）', async () => {
    const cache = createMemoryStorage()
    const repository = repo([entry({ id: 'faq-a' })])
    const deps = {
      repository,
      cache,
      clock: { now: () => NOW },
      cacheKey: 'kedaya:test:faq:list',
      helpfulMarksKey: 'kedaya:test:faq:helpful',
    }

    const first = createFaqUseCases(deps)
    await first.markHelpful('faq-a')

    const second = createFaqUseCases(deps)
    expect(second.isMarkedHelpful('faq-a')).toBe(true)
    const again = await second.markHelpful('faq-a')
    expect(again.ok).toBe(false)
  })
})

describe('用例 · 新增条目', () => {
  function useCases(repository = repo([entry()])) {
    return createFaqUseCases({
      repository,
      cache: createMemoryStorage(),
      clock: { now: () => NOW },
      cacheKey: 'kedaya:test:faq:list',
      helpfulMarksKey: 'kedaya:test:faq:helpful',
    })
  }

  it('白名单外的分类被本地拦住，不发请求', async () => {
    const faq = useCases()
    const result = await faq.create({
      question: '快递在哪取？',
      answer: '生活区快递驿站。',
      category: 'legacy-cat',
      tagsText: '',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
  })

  it('新增成功后列表失效：重新 load 就能搜到自己的条目', async () => {
    const faq = useCases()

    const created = await faq.create({
      question: '哪里可以打印成绩单？',
      answer: '教务处自助打印机刷校园卡打印，密封件去学籍科窗口。',
      category: 'schedule',
      tagsText: '成绩单、教务',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    await faq.list.load()
    const state = faq.list.getSnapshot()
    expect(state.items.some((item) => item.id === created.value.id)).toBe(true)
    expect(state.items[0]?.categoryLabel).toBe('选课与教务')

    // 标签按中英文分隔符切分后提交
    const detail = await faq.detail.load(created.value.id)
    expect(detail.data?.tags).toEqual(['成绩单', '教务'])
  })
})

/** 空数据集（用于 NOT_FOUND 断言） */
function seedEmpty(): readonly FaqEntry[] {
  return []
}
