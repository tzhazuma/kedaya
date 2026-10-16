import { describe, expect, it } from 'vitest';

import type { ApiError, Page } from '@kedaya/contracts';
import { err, ok } from '@kedaya/shared';

import { createMockFaqRepository } from '@/data/mock/faq.repository';
import { FAQ_ALL_CATEGORY_ID, type FaqArticle, type FaqTicket } from '@/domain/models/faq';
import type { FaqRepository } from '@/domain/ports/faq';

import { deriveViewState } from '../viewState';
import {
  emptyHintFor,
  faqListState,
  loadFaqArticles,
  toFaqArticleVM,
  toFaqCategoryVMs,
} from './listFaqArticles';
import {
  createEmptyTicketDraft,
  faqTicketState,
  loadFaqTickets,
  submitFaqTicket,
  toFaqTicketListVM,
  toFaqTicketVM,
  validateFaqTicketDraft,
} from './listFaqTickets';
import {
  applyVoteToArticleVM,
  applyVoteToItems,
  applyVoteToPages,
  rollbackVote,
  voteFaqHelpful,
  voteRollbackMessage,
} from './voteFaqHelpful';

const NOW = new Date('2026-10-16T10:00:00.000Z');

function makeArticle(overrides: Partial<FaqArticle> = {}): FaqArticle {
  return {
    id: 'faq-1',
    slug: 'login-cas-failed',
    question: '统一身份认证登录失败怎么办？',
    answer: '第一步：确认学校页面能登录。\n\n第二步：允许第三方 Cookie。',
    category: 'account',
    status: 'PUBLISHED',
    helpfulCount: 42,
    unhelpfulCount: 3,
    updatedAt: '2026-10-14T10:00:00.000Z',
    ...overrides,
  };
}

function makeTicket(overrides: Partial<FaqTicket> = {}): FaqTicket {
  return {
    id: 'ft-1',
    userId: 'u_1024',
    contact: 'yaya@shanghaitech.edu.cn',
    question: '课表一直显示需要绑定。',
    status: 'OPEN',
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
    ...overrides,
  };
}

function fakeFaqRepository(overrides: Partial<FaqRepository> = {}): FaqRepository {
  return {
    listArticles: async () => ok<Page<FaqArticle>>({ items: [], nextCursor: null, total: 0 }),
    voteHelpful: async () => err<ApiError>({ code: 'INTERNAL', message: '未实现' }),
    listTickets: async () => ok<Page<FaqTicket>>({ items: [], nextCursor: null, total: 0 }),
    submitTicket: async () => err<ApiError>({ code: 'INTERNAL', message: '未实现' }),
    ...overrides,
  };
}

function mockFaqRepository() {
  return createMockFaqRepository({ now: () => NOW, latencyMs: 0 });
}

describe('FAQ 视图模型', () => {
  it('条目本地化：分类名、有用占比、段落切分、更新时间', () => {
    const vm = toFaqArticleVM(makeArticle(), NOW);
    expect(vm.categoryLabel).toBe('账号与登录');
    expect(vm.statusLabel).toBe('已发布');
    expect(vm.helpfulPercent).toBe(93);
    expect(vm.helpfulLabel).toContain('有用 42');
    expect(vm.updatedLabel).toBe('2 天前');
    expect(vm.answerParagraphs).toEqual([
      '第一步：确认学校页面能登录。',
      '第二步：允许第三方 Cookie。',
    ]);
    expect(vm.vote).toBeNull();
  });

  it('分类导航含「全部」且带计数与激活态', () => {
    const vms = toFaqCategoryVMs(
      [
        makeArticle({ category: 'privacy' }),
        makeArticle({ category: 'privacy' }),
        makeArticle({ category: 'modules' }),
      ],
      'privacy',
    );
    expect(vms[0]?.id).toBe(FAQ_ALL_CATEGORY_ID);
    expect(vms[0]?.countLabel).toBe('3 条');
    expect(vms[0]?.active).toBe(false);
    expect(vms.find((v) => v.id === 'privacy')?.active).toBe(true);
    expect(vms.find((v) => v.id === 'privacy')?.count).toBe(2);
    expect(vms.find((v) => v.id === 'other')?.count).toBe(0);
  });

  it('空态引导文案区分「搜索无结果 / 分类为空 / 全空」', () => {
    expect(emptyHintFor({ keyword: ' 手机号 ', activeCategory: FAQ_ALL_CATEGORY_ID })).toContain(
      '没有匹配「手机号」的条目',
    );
    expect(emptyHintFor({ keyword: '', activeCategory: 'privacy' })).toContain('隐私与数据');
    expect(emptyHintFor({ keyword: '', activeCategory: FAQ_ALL_CATEGORY_ID })).toContain('提交工单');
  });
});

describe('用例：加载条目（分类导航 + 搜索）', () => {
  it('loadFaqArticles 返回条目与全量分类计数', async () => {
    const result = await loadFaqArticles(mockFaqRepository(), {
      query: { keyword: '手机号', limit: 5 },
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items.map((a) => a.slug)).toEqual(['faq-ticket-contact']);
    expect(result.value.keyword).toBe('手机号');
    // 分类计数取"不受关键词影响"的全集（8 条已发布）
    expect(result.value.categories[0]?.count).toBe(8);
    expect(result.value.isEmpty).toBe(false);
    expect(result.value.state).toBe('ready');
  });

  it('搜索无结果时 isEmpty=true 且给出引导文案', async () => {
    const result = await loadFaqArticles(mockFaqRepository(), {
      query: { keyword: 'zzz-不存在', limit: 5 },
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toEqual([]);
    expect(result.value.isEmpty).toBe(true);
    expect(result.value.state).toBe('empty');
    expect(result.value.emptyHint).toContain('没有匹配');
  });

  it('分类过滤生效，投票状态可注入', async () => {
    const result = await loadFaqArticles(mockFaqRepository(), {
      query: { category: 'governance' },
      now: NOW,
      votes: { 'report-and-appeal': 'helpful' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]?.vote).toBe('helpful');
    expect(result.value.activeCategory).toBe('governance');
    expect(result.value.categories.find((c) => c.id === 'governance')?.active).toBe(true);
  });

  it('仓储失败原样透传（不吞错）', async () => {
    const result = await loadFaqArticles(
      fakeFaqRepository({
        listArticles: async () => err({ code: 'UPSTREAM_UNAVAILABLE', message: '知识库挂了' }),
      }),
      { now: NOW },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(result.error.message).toBe('知识库挂了');
    }
  });

  it('faqListState 映射四态', () => {
    expect(faqListState({ isPending: true, isError: false, itemCount: 0 })).toBe('loading');
    expect(faqListState({ isPending: false, isError: true, itemCount: 0 })).toBe('error');
    expect(faqListState({ isPending: false, isError: false, itemCount: 0 })).toBe('empty');
    expect(faqListState({ isPending: false, isError: false, itemCount: 2 })).toBe('ready');
    expect(deriveViewState({ isPending: false, isError: false, isEmpty: false })).toBe('ready');
  });
});

describe('乐观更新 + 失败回滚（纯函数层）', () => {
  it('applyVoteToArticleVM 更新计数、占比与「我的一票」', () => {
    const base = toFaqArticleVM(makeArticle(), NOW);
    const voted = applyVoteToArticleVM(base, 'helpful');
    expect(voted.helpfulCount).toBe(43);
    expect(voted.vote).toBe('helpful');
    expect(voted.helpfulLabel).toContain('有用 43');

    const switched = applyVoteToArticleVM(voted, 'unhelpful');
    expect(switched.helpfulCount).toBe(42);
    expect(switched.unhelpfulCount).toBe(4);
    expect(switched.vote).toBe('unhelpful');

    const retracted = applyVoteToArticleVM(switched, null);
    expect(retracted.unhelpfulCount).toBe(3);
    expect(retracted.vote).toBeNull();
  });

  it('applyVoteToItems 只动目标条目，其余保持同一引用', () => {
    const a = toFaqArticleVM(makeArticle({ slug: 'a' }), NOW);
    const b = toFaqArticleVM(makeArticle({ slug: 'b' }), NOW);
    const next = applyVoteToItems([a, b], 'a', 'helpful');
    expect(next[0]?.helpfulCount).toBe(43);
    expect(next[1]).toBe(b);
  });

  it('applyVoteToPages 跨页更新且不改动原数据（不可变）', () => {
    const data = {
      pages: [
        { items: [toFaqArticleVM(makeArticle({ slug: 'a' }), NOW)] },
        { items: [toFaqArticleVM(makeArticle({ slug: 'b' }), NOW)] },
      ],
      pageParams: [undefined, 'c_1'],
    };
    const next = applyVoteToPages(data, 'b', 'helpful');
    expect(next?.pages[1]?.items[0]?.helpfulCount).toBe(43);
    expect(next?.pages[0]?.items[0]?.helpfulCount).toBe(42);
    // 原对象未被修改
    expect(data.pages[1]?.items[0]?.helpfulCount).toBe(42);
    expect(applyVoteToPages(undefined, 'b', 'helpful')).toBeUndefined();
  });

  it('rollbackVote 用快照还原，无快照时返回 false', () => {
    const snapshot = { pages: [{ items: [toFaqArticleVM(makeArticle(), NOW)] }], pageParams: [] };
    let written: typeof snapshot | undefined;
    expect(rollbackVote(snapshot, (value) => (written = value))).toBe(true);
    expect(written).toBe(snapshot);

    let called = false;
    expect(rollbackVote(undefined, () => (called = true))).toBe(false);
    expect(called).toBe(false);
  });

  it('voteFaqHelpful 成功返回服务端条目，失败透传，缺 slug 直接拒绝', async () => {
    const success = await voteFaqHelpful(mockFaqRepository(), 'login-cas-failed', 'helpful', {
      userId: 'u_1024',
    });
    expect(success.ok).toBe(true);
    if (success.ok) expect(success.value.helpfulCount).toBe(43);

    const failure = await voteFaqHelpful(
      fakeFaqRepository({
        voteHelpful: async () => err({ code: 'RATE_LIMITED', message: '太快了' }),
      }),
      'login-cas-failed',
      'helpful',
    );
    expect(failure.ok).toBe(false);
    if (!failure.ok) expect(failure.error.code).toBe('RATE_LIMITED');

    const blank = await voteFaqHelpful(mockFaqRepository(), '  ', 'helpful');
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.error.code).toBe('VALIDATION_FAILED');
  });

  it('voteRollbackMessage 明确告诉用户票没生效', () => {
    expect(voteRollbackMessage({ code: 'UPSTREAM_UNAVAILABLE', message: '服务不可用' })).toContain(
      '已恢复到投票前的状态',
    );
  });
});

describe('用例：我的工单', () => {
  it('工单视图模型：联系方式脱敏、状态文案、待确认标记', () => {
    const open = toFaqTicketVM(makeTicket(), NOW);
    expect(open.contactMasked).toBe('y***@shanghaitech.edu.cn');
    expect(open.statusLabel).toBe('待回复');
    expect(open.statusTone).toBe('info');
    expect(open.needsReply).toBe(false);
    expect(open.guest).toBe(false);

    const answered = toFaqTicketVM(
      makeTicket({ status: 'ANSWERED', answer: '已修复', answeredAt: '2026-10-15T10:00:00.000Z' }),
      NOW,
    );
    expect(answered.statusLabel).toBe('已回复');
    expect(answered.needsReply).toBe(true);
    expect(answered.answer).toBe('已修复');
    expect(answered.answeredLabel).toBe('1 天前');

    const guest = toFaqTicketVM(makeTicket({ userId: null }), NOW);
    expect(guest.guest).toBe(true);
  });

  it('工单列表视图模型：空态引导 + 待回复计数', () => {
    const empty = toFaqTicketListVM({ items: [], nextCursor: null, total: 0 }, NOW);
    expect(empty.isEmpty).toBe(true);
    expect(empty.state).toBe('empty');
    expect(empty.emptyHint).toContain('不会保存明文手机号');

    const list = toFaqTicketListVM(
      {
        items: [makeTicket({ id: 'ft-1', status: 'OPEN' }), makeTicket({ id: 'ft-2', status: 'CLOSED' })],
        nextCursor: 'c_2',
        total: 5,
      },
      NOW,
    );
    expect(list.openCount).toBe(1);
    expect(list.total).toBe(5);
    expect(list.nextCursor).toBe('c_2');
    expect(list.state).toBe('ready');
  });

  it('loadFaqTickets 返回当前用户工单；失败原样透传', async () => {
    const result = await loadFaqTickets(mockFaqRepository(), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((t) => t.id)).toEqual(['ft-5001', 'ft-5002', 'ft-5003']);

    const failure = await loadFaqTickets(
      fakeFaqRepository({
        listTickets: async () => err({ code: 'FORBIDDEN', message: '没有权限' }),
      }),
      { now: NOW },
    );
    expect(failure.ok).toBe(false);
    if (!failure.ok) expect(failure.error.code).toBe('FORBIDDEN');
  });

  it('submitFaqTicket：校验失败不调用仓储，成功返回脱敏视图模型', async () => {
    let called = 0;
    const invalid = await submitFaqTicket(
      fakeFaqRepository({
        submitTicket: async () => {
          called += 1;
          return err({ code: 'INTERNAL', message: '不该被调用' });
        },
      }),
      { contact: '13800000000', question: '' },
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('VALIDATION_FAILED');
    expect(called).toBe(0);

    const success = await submitFaqTicket(
      mockFaqRepository(),
      { contact: 'yaya@shanghaitech.edu.cn', question: '拼单退团没反应' },
      { userId: 'u_1024', now: NOW },
    );
    expect(success.ok).toBe(true);
    if (success.ok) {
      expect(success.value.statusLabel).toBe('待回复');
      expect(success.value.contactMasked).toBe('y***@shanghaitech.edu.cn');
      expect(success.value.createdLabel).toBe('刚刚');
    }
  });

  it('未登录提交：userId=null 也能建单', async () => {
    const result = await submitFaqTicket(
      mockFaqRepository(),
      { contact: 'wechat: passerby', question: '游客提问' },
      { userId: null, now: NOW },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.guest).toBe(true);
  });

  it('草稿校验与空草稿', () => {
    const draft = createEmptyTicketDraft();
    expect(draft).toEqual({ contact: '', question: '' });
    expect(validateFaqTicketDraft(draft)).toHaveLength(2);
    expect(validateFaqTicketDraft({ contact: 'yaya@shanghaitech.edu.cn', question: '问题' })).toEqual([]);
  });

  it('faqTicketState 映射四态', () => {
    expect(faqTicketState({ isPending: true, isError: false, itemCount: 0 })).toBe('loading');
    expect(faqTicketState({ isPending: false, isError: true, itemCount: 0 })).toBe('error');
    expect(faqTicketState({ isPending: false, isError: false, itemCount: 0 })).toBe('empty');
    expect(faqTicketState({ isPending: false, isError: false, itemCount: 1 })).toBe('ready');
  });
});
