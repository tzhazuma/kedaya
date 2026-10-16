import { describe, expect, it } from 'vitest';

import {
  applyVote,
  canTransitionTicket,
  categoryLabel,
  countByCategory,
  FAQ_ALL_CATEGORY_ID,
  FAQ_CATEGORIES,
  groupArticlesByCategory,
  helpfulPercent,
  isArticlePublished,
  maskContact,
  matchesKeyword,
  nextTicketStatuses,
  searchArticles,
  shouldAutoCloseTicket,
  ticketNeedsReply,
  transitionTicket,
  validateTicketContact,
  validateTicketDraft,
  type FaqArticle,
  type FaqTicket,
} from './faq';

const NOW = new Date('2026-10-16T10:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60_000).toISOString();
}

function makeArticle(overrides: Partial<FaqArticle> = {}): FaqArticle {
  return {
    id: 'faq-1',
    slug: 'slug-1',
    question: '问题',
    answer: '答案',
    category: 'account',
    status: 'PUBLISHED',
    helpfulCount: 0,
    unhelpfulCount: 0,
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function makeTicket(overrides: Partial<FaqTicket> = {}): FaqTicket {
  return {
    id: 'ft-1',
    userId: 'u_1024',
    contact: 'yaya@shanghaitech.edu.cn',
    question: '问题描述',
    status: 'OPEN',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('分类注册表', () => {
  it('5 个分类，label 查得到，未知分类回退为原 id', () => {
    expect(FAQ_CATEGORIES).toHaveLength(5);
    expect(categoryLabel('account')).toBe('账号与登录');
    expect(categoryLabel('privacy')).toBe('隐私与数据');
    expect(categoryLabel('unknown-category')).toBe('unknown-category');
    expect(FAQ_ALL_CATEGORY_ID).toBe('all');
  });

  it('countByCategory 初始化所有分类为 0，未知分类单独计数', () => {
    const counts = countByCategory([
      makeArticle({ category: 'privacy' }),
      makeArticle({ category: 'privacy' }),
      makeArticle({ category: 'account' }),
      makeArticle({ category: 'legacy' }),
    ]);
    expect(counts.privacy).toBe(2);
    expect(counts.account).toBe(1);
    expect(counts.modules).toBe(0);
    expect(counts.legacy).toBe(1);
  });

  it('groupArticlesByCategory 保留空分类（导航要显示 0 条）', () => {
    const groups = groupArticlesByCategory([makeArticle({ category: 'privacy' })]);
    expect(groups).toHaveLength(5);
    expect(groups.find((g) => g.category.id === 'privacy')?.articles).toHaveLength(1);
    expect(groups.find((g) => g.category.id === 'other')?.articles).toHaveLength(0);
  });
});

describe('检索', () => {
  const articles: FaqArticle[] = [
    makeArticle({ id: 'a', slug: 'a', question: '统一身份认证登录失败怎么办？', category: 'account', helpfulCount: 5 }),
    makeArticle({ id: 'b', slug: 'b', question: '拼单怎么参团？', answer: '登录后即可参团', category: 'modules', helpfulCount: 9 }),
    makeArticle({ id: 'c', slug: 'c', question: '匿名发帖别人能查到我吗？', category: 'privacy', helpfulCount: 20 }),
    makeArticle({ id: 'd', slug: 'd', question: '（归档）旧界面', status: 'ARCHIVED', category: 'other' }),
    makeArticle({ id: 'e', slug: 'e', question: '（草稿）通知设置', status: 'DRAFT', category: 'other' }),
  ];

  it('matchesKeyword 匹配问题 / 答案 / 分类名，空关键词恒真', () => {
    expect(matchesKeyword(articles[0]!, '认证')).toBe(true);
    expect(matchesKeyword(articles[1]!, '登录')).toBe(true); // 命中答案
    expect(matchesKeyword(articles[2]!, '隐私')).toBe(true); // 命中分类名
    expect(matchesKeyword(articles[0]!, '不存在的词')).toBe(false);
    expect(matchesKeyword(articles[0]!, '   ')).toBe(true);
  });

  it('默认只返回 PUBLISHED，分类过滤生效', () => {
    expect(searchArticles(articles, '', { status: 'PUBLISHED' })).toHaveLength(3);
    expect(
      searchArticles(articles, '', { status: 'PUBLISHED', category: 'privacy' }).map((a) => a.slug),
    ).toEqual(['c']);
    expect(
      searchArticles(articles, '', { status: 'PUBLISHED', category: FAQ_ALL_CATEGORY_ID }),
    ).toHaveLength(3);
    // 不传 status 时归档/草稿也会出现（管理员视图）
    expect(searchArticles(articles, '')).toHaveLength(5);
  });

  it('问题命中优先于答案命中', () => {
    const list: FaqArticle[] = [
      makeArticle({ id: 'answer-hit', slug: 'answer-hit', question: '无关问题', answer: '包含 zebra 的答案' }),
      makeArticle({ id: 'question-hit', slug: 'question-hit', question: 'zebra 在问题里', answer: '无关答案' }),
    ];
    expect(searchArticles(list, 'zebra', { status: 'PUBLISHED' }).map((a) => a.slug)).toEqual([
      'question-hit',
      'answer-hit',
    ]);
  });

  it('同分时按分类顺序、再按有用数排序', () => {
    const list: FaqArticle[] = [
      makeArticle({ id: 'm1', slug: 'm1', category: 'modules', helpfulCount: 1 }),
      makeArticle({ id: 'a1', slug: 'a1', category: 'account', helpfulCount: 1 }),
      makeArticle({ id: 'a2', slug: 'a2', category: 'account', helpfulCount: 30 }),
    ];
    expect(searchArticles(list, '', { status: 'PUBLISHED' }).map((a) => a.slug)).toEqual([
      'a2',
      'a1',
      'm1',
    ]);
  });

  it('isArticlePublished 只认 PUBLISHED', () => {
    expect(isArticlePublished({ status: 'PUBLISHED' })).toBe(true);
    expect(isArticlePublished({ status: 'ARCHIVED' })).toBe(false);
    expect(isArticlePublished({ status: 'DRAFT' })).toBe(false);
  });
});

describe('有用 / 无用投票（乐观更新的纯逻辑核心）', () => {
  it('helpfulPercent 取整并夹在 0–100', () => {
    expect(helpfulPercent({ helpfulCount: 42, unhelpfulCount: 3 })).toBe(93);
    expect(helpfulPercent({ helpfulCount: 0, unhelpfulCount: 0 })).toBe(0);
    expect(helpfulPercent({ helpfulCount: 1, unhelpfulCount: 1 })).toBe(50);
    expect(helpfulPercent({ helpfulCount: 0, unhelpfulCount: 5 })).toBe(0);
  });

  it('首次投票 +1；重复点同一按钮是幂等的', () => {
    expect(applyVote({ helpfulCount: 5, unhelpfulCount: 2 }, null, 'helpful')).toEqual({
      helpfulCount: 6,
      unhelpfulCount: 2,
    });
    expect(applyVote({ helpfulCount: 6, unhelpfulCount: 2 }, 'helpful', 'helpful')).toEqual({
      helpfulCount: 6,
      unhelpfulCount: 2,
    });
  });

  it('改票：旧侧 -1、新侧 +1', () => {
    expect(applyVote({ helpfulCount: 6, unhelpfulCount: 2 }, 'helpful', 'unhelpful')).toEqual({
      helpfulCount: 5,
      unhelpfulCount: 3,
    });
    expect(applyVote({ helpfulCount: 6, unhelpfulCount: 2 }, 'unhelpful', 'helpful')).toEqual({
      helpfulCount: 7,
      unhelpfulCount: 1,
    });
  });

  it('撤回我的一票，且计数不会降到负数', () => {
    expect(applyVote({ helpfulCount: 6, unhelpfulCount: 2 }, 'helpful', null)).toEqual({
      helpfulCount: 5,
      unhelpfulCount: 2,
    });
    expect(applyVote({ helpfulCount: 0, unhelpfulCount: 0 }, 'helpful', null)).toEqual({
      helpfulCount: 0,
      unhelpfulCount: 0,
    });
    expect(applyVote({ helpfulCount: 3, unhelpfulCount: 3 }, null, null)).toEqual({
      helpfulCount: 3,
      unhelpfulCount: 3,
    });
  });
});

describe('工单状态机（对齐 §2.8 mermaid）', () => {
  it('合法迁移：OPEN→ANSWERED→CLOSED，ANSWERED 可追问回 OPEN', () => {
    expect(canTransitionTicket('OPEN', 'ANSWERED')).toBe(true);
    expect(canTransitionTicket('ANSWERED', 'CLOSED')).toBe(true);
    expect(canTransitionTicket('ANSWERED', 'OPEN')).toBe(true);
    expect(canTransitionTicket('OPEN', 'CLOSED')).toBe(false);
    expect(canTransitionTicket('CLOSED', 'OPEN')).toBe(false);
    expect(nextTicketStatuses('CLOSED')).toEqual([]);
  });

  it('transitionTicket 非法返回 null 且不可变', () => {
    const ticket = makeTicket({ status: 'OPEN' });
    const answered = transitionTicket(ticket, 'ANSWERED');
    expect(answered?.status).toBe('ANSWERED');
    expect(ticket.status).toBe('OPEN');
    expect(transitionTicket(ticket, 'CLOSED')).toBeNull();
  });

  it('ticketNeedsReply 只在 ANSWERED 时为 true', () => {
    expect(ticketNeedsReply({ status: 'ANSWERED' })).toBe(true);
    expect(ticketNeedsReply({ status: 'OPEN' })).toBe(false);
    expect(ticketNeedsReply({ status: 'CLOSED' })).toBe(false);
  });

  it('已回复超 7 天自动关闭（按 answeredAt 计算）', () => {
    expect(
      shouldAutoCloseTicket(makeTicket({ status: 'ANSWERED', answeredAt: daysAgo(8) }), NOW),
    ).toBe(true);
    expect(
      shouldAutoCloseTicket(makeTicket({ status: 'ANSWERED', answeredAt: daysAgo(6) }), NOW),
    ).toBe(false);
    expect(shouldAutoCloseTicket(makeTicket({ status: 'OPEN' }), NOW)).toBe(false);
    expect(
      shouldAutoCloseTicket(makeTicket({ status: 'ANSWERED', answeredAt: 'not-a-date' }), NOW),
    ).toBe(false);
  });
});

describe('联系方式（隐私硬规则：不存明文手机号）', () => {
  it('拒绝纯手机号并说明原因', () => {
    const result = validateTicketContact('13800000000');
    expect(result.ok).toBe(false);
    expect(result.problems.join('')).toContain('不保存明文手机号');
  });

  it('邮箱与微信号通过', () => {
    expect(validateTicketContact('yaya@shanghaitech.edu.cn').ok).toBe(true);
    expect(validateTicketContact('wechat: yaya_duck').ok).toBe(true);
  });

  it('空值与超长会报问题', () => {
    expect(validateTicketContact('  ').ok).toBe(false);
    expect(validateTicketContact('x'.repeat(121)).problems.join('')).toContain('不能超过');
  });

  it('maskContact 脱敏邮箱与微信号', () => {
    expect(maskContact('yaya@shanghaitech.edu.cn')).toBe('y***@shanghaitech.edu.cn');
    expect(maskContact('ab')).toBe('a*');
    const masked = maskContact('wechat: yaya_duck');
    expect(masked.startsWith('w')).toBe(true);
    expect(masked.endsWith('k')).toBe(true);
    expect(masked.includes('yaya')).toBe(false);
  });

  it('validateTicketDraft 汇总联系方式与问题描述的问题', () => {
    expect(validateTicketDraft({ contact: '13800000000', question: '' })).toHaveLength(2);
    expect(validateTicketDraft({ contact: 'yaya@shanghaitech.edu.cn', question: 'ok' })).toEqual([]);
    expect(
      validateTicketDraft({ contact: 'yaya@shanghaitech.edu.cn', question: 'x'.repeat(2001) }).some(
        (p) => p.includes('不能超过'),
      ),
    ).toBe(true);
  });
});
