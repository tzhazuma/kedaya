import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../common/errors/app-error';
import {
  FAQ_TICKET_STATUSES,
  FAQ_TICKET_TRANSITIONS,
  canTransitionFaqTicket,
  extractSearchTerms,
  isFaqTicketStatus,
  matchesSearchTerm,
  normalizeContact,
  rankFaqSuggestions,
  voterKeyFor,
  type FaqEntryModel,
} from './faq.domain';

/**
 * faq 纯领域逻辑测试：工单状态机、联系方式最小化、关键词建议排序。
 */

function entry(overrides: Partial<FaqEntryModel> & { id: string }): FaqEntryModel {
  return {
    slug: overrides.id,
    question: '问题',
    answer: '答案',
    category: 'general',
    tags: [],
    status: 'PUBLISHED',
    helpfulCount: 0,
    unhelpfulCount: 0,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

const ENTRIES: FaqEntryModel[] = [
  entry({
    id: 'faq-card',
    question: '校园卡如何充值？',
    answer: '在一卡通 App 里充值，或到食堂充值机操作。',
    category: '校园卡',
    tags: ['校园卡', '充值'],
  }),
  entry({
    id: 'faq-wifi',
    question: '校园网怎么连接？',
    answer: '连接 SHTU-WiFi，用学号登录。',
    category: '网络',
    tags: ['网络', 'wifi'],
  }),
  entry({
    id: 'faq-dorm',
    question: '宿舍报修怎么提交？',
    answer: '在后勤系统提交报修单。',
    category: '宿舍',
    tags: ['宿舍', '报修'],
  }),
];

describe('faq 领域 · 工单状态机（02-domain-model §2.8）', () => {
  it('状态图里的迁移全部允许', () => {
    for (const [from, to] of FAQ_TICKET_TRANSITIONS) {
      expect(canTransitionFaqTicket(from, to)).toBe(true);
    }
  });

  it('同状态幂等', () => {
    for (const status of FAQ_TICKET_STATUSES) expect(canTransitionFaqTicket(status, status)).toBe(true);
  });

  it('OPEN 不能直接 CLOSED，CLOSED 是终态', () => {
    expect(canTransitionFaqTicket('OPEN', 'CLOSED')).toBe(false);
    expect(canTransitionFaqTicket('CLOSED', 'OPEN')).toBe(false);
    expect(canTransitionFaqTicket('CLOSED', 'ANSWERED')).toBe(false);
  });

  it('isFaqTicketStatus 只接受 3 个冻结状态', () => {
    for (const status of FAQ_TICKET_STATUSES) expect(isFaqTicketStatus(status)).toBe(true);
    expect(isFaqTicketStatus('open')).toBe(false);
    expect(isFaqTicketStatus('PENDING')).toBe(false);
  });
});

describe('faq 领域 · 联系方式最小化（不存明文手机号）', () => {
  it('邮箱与微信号接受', () => {
    expect(normalizeContact('  someone@shanghaitech.edu.cn ')).toBe('someone@shanghaitech.edu.cn');
    expect(normalizeContact('wechat: kedaya_2026')).toBe('wechat: kedaya_2026');
  });

  it('纯手机号拒收', () => {
    expect(() => normalizeContact('13800138000')).toThrow(ValidationError);
  });

  it('混在文本里的手机号同样拒收', () => {
    expect(() => normalizeContact('微信 13800138000')).toThrow(ValidationError);
  });

  it('空值 / 超长拒收', () => {
    expect(() => normalizeContact('')).toThrow(ValidationError);
    expect(() => normalizeContact('x'.repeat(121))).toThrow(ValidationError);
  });
});

describe('faq 领域 · 关键词建议（简单匹配，不引向量库）', () => {
  it('中文按二元组切词，拉丁按整段', () => {
    expect(extractSearchTerms('校园卡充值')).toEqual(['校园', '园卡', '卡充', '充值']);
    expect(extractSearchTerms('wifi 密码')).toEqual(['wifi', '密码']);
    expect(extractSearchTerms('')).toEqual([]);
  });

  it('把最相关的条目排在最前', () => {
    const result = rankFaqSuggestions('校园卡怎么充值', ENTRIES);

    expect(result[0]?.entry.id).toBe('faq-card');
    expect(result[0]?.score).toBeGreaterThan(0);
    expect(result[0]?.matchedTerms).toContain('校园');
  });

  it('不相关的条目不会出现在建议里（score=0 被过滤）', () => {
    const result = rankFaqSuggestions('校园卡充值', ENTRIES);

    expect(result.map((item) => item.entry.id)).not.toContain('faq-dorm');
  });

  it('标签精确命中权重最高', () => {
    const result = rankFaqSuggestions('充值', ENTRIES);
    expect(result[0]?.entry.id).toBe('faq-card');
  });

  it('空查询 / 空候选集返回空数组', () => {
    expect(rankFaqSuggestions('', ENTRIES)).toEqual([]);
    expect(rankFaqSuggestions('   ', ENTRIES)).toEqual([]);
    expect(rankFaqSuggestions('校园卡', [])).toEqual([]);
  });

  it('limit 生效', () => {
    const result = rankFaqSuggestions('校园卡 网络 宿舍 报修 充值 wifi', ENTRIES, 1);
    expect(result).toHaveLength(1);
  });

  it('matchesSearchTerm 与排序共用同一套词', () => {
    expect(matchesSearchTerm(ENTRIES[0]!, '充值')).toBe(true);
    expect(matchesSearchTerm(ENTRIES[0]!, '黑天鹅')).toBe(false);
    expect(matchesSearchTerm(ENTRIES[0]!, '')).toBe(true);
  });
});

describe('faq 领域 · 投票人键', () => {
  it('voterKey 带 user: 前缀，不含裸 id 之外的语义', () => {
    expect(voterKeyFor('user-1')).toBe('user:user-1');
  });
});
