import { describe, expect, it } from 'vitest';

import { createFaqArticleSeed, createFaqTicketSeed } from './fixtures/faq';
import { createMockFaqRepository, filterFaqArticles } from './faq.repository';

const NOW = new Date('2026-10-16T10:00:00.000Z');

function repo(options: Parameters<typeof createMockFaqRepository>[0] = {}) {
  return createMockFaqRepository({ now: () => NOW, latencyMs: 0, ...options });
}

describe('mock 数据集（无后端可跑）', () => {
  it('条目覆盖 5 个分类与 3 种状态', () => {
    const articles = createFaqArticleSeed(NOW);
    expect(new Set(articles.map((a) => a.status))).toEqual(
      new Set(['PUBLISHED', 'ARCHIVED', 'DRAFT']),
    );
    expect(new Set(articles.map((a) => a.category))).toEqual(
      new Set(['account', 'modules', 'privacy', 'governance', 'other']),
    );
    for (const article of articles) expect(article.updatedAt.endsWith('Z')).toBe(true);
  });

  it('工单覆盖 3 种状态，其中一条带管理员回复', () => {
    const tickets = createFaqTicketSeed(NOW);
    expect(new Set(tickets.map((t) => t.status))).toEqual(
      new Set(['OPEN', 'ANSWERED', 'CLOSED']),
    );
    expect(tickets.filter((t) => t.answer).length).toBeGreaterThanOrEqual(2);
  });

  it('filterFaqArticles 默认只出 PUBLISHED', () => {
    const articles = createFaqArticleSeed(NOW);
    expect(filterFaqArticles(articles, {})).toHaveLength(8);
    expect(filterFaqArticles(articles, { status: 'ARCHIVED' })).toHaveLength(1);
    expect(filterFaqArticles(articles, { category: 'privacy' })).toHaveLength(3);
  });
});

describe('mock FAQ 仓储（契约形状）', () => {
  it('契约 §11.10-E：不透明的复合游标不解析、不抛异常，安全退化为首页', async () => {
    const opaque = 'eyJvIjo0LCJ0IjoiMjAyNi0xMC0xNlQxMDowMDowMFoifQ==';
    const result = await repo().listArticles({ cursor: opaque, limit: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((a) => a.slug)).toEqual([
      'login-cas-failed',
      'campus-binding-required',
      'groupbuy-how-to-join',
    ]);
  });

  it('listArticles 游标分页且按分类/有用数排序', async () => {
    const repository = repo();
    const first = await repository.listArticles({ limit: 3 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.value.items.map((a) => a.slug)).toEqual([
      'login-cas-failed',
      'campus-binding-required',
      'groupbuy-how-to-join',
    ]);
    expect(first.value.total).toBe(8);
    expect(first.value.nextCursor).toBe('c_3');

    const second = await repository.listArticles({ limit: 3, cursor: first.value.nextCursor ?? undefined });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.items).toHaveLength(3);
    expect(second.value.nextCursor).toBe('c_6');

    const third = await repository.listArticles({ limit: 3, cursor: second.value.nextCursor ?? undefined });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value.items).toHaveLength(2);
    expect(third.value.nextCursor).toBeNull();
  });

  it('listArticles 支持分类与关键词过滤，无结果时返回空页', async () => {
    const repository = repo();

    const byCategory = await repository.listArticles({ category: 'governance' });
    expect(byCategory.ok).toBe(true);
    if (byCategory.ok) expect(byCategory.value.items.map((a) => a.slug)).toEqual(['report-and-appeal']);

    const byKeyword = await repository.listArticles({ keyword: '手机号' });
    expect(byKeyword.ok).toBe(true);
    if (byKeyword.ok) {
      expect(byKeyword.value.items.map((a) => a.slug)).toEqual(['faq-ticket-contact']);
    }

    const noMatch = await repository.listArticles({ keyword: '不存在的关键词' });
    expect(noMatch.ok).toBe(true);
    if (noMatch.ok) {
      expect(noMatch.value.items).toEqual([]);
      expect(noMatch.value.total).toBe(0);
    }
  });

  it('voteHelpful：首投 +1、重复幂等、改票、撤回（与 domain applyVote 一致）', async () => {
    const repository = repo();
    const slug = 'login-cas-failed';

    const first = await repository.voteHelpful({ slug, vote: 'helpful', userId: 'u_1024' });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.helpfulCount).toBe(43);
      expect(first.value.unhelpfulCount).toBe(3);
    }
    expect(repository.myVote(slug)).toBe('helpful');

    const again = await repository.voteHelpful({ slug, vote: 'helpful', userId: 'u_1024' });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.helpfulCount).toBe(43);

    const switched = await repository.voteHelpful({ slug, vote: 'unhelpful', userId: 'u_1024' });
    expect(switched.ok).toBe(true);
    if (switched.ok) {
      expect(switched.value.helpfulCount).toBe(42);
      expect(switched.value.unhelpfulCount).toBe(4);
    }

    const retracted = await repository.voteHelpful({ slug, vote: null, userId: 'u_1024' });
    expect(retracted.ok).toBe(true);
    if (retracted.ok) {
      expect(retracted.value.helpfulCount).toBe(42);
      expect(retracted.value.unhelpfulCount).toBe(3);
    }
    expect(repository.myVote(slug)).toBeNull();
  });

  it('voteHelpful：归档条目 CONFLICT，未知 slug NOT_FOUND', async () => {
    const repository = repo();

    const archived = await repository.voteHelpful({
      slug: 'deprecated-campus-card-page',
      vote: 'helpful',
      userId: 'u_1024',
    });
    expect(archived.ok).toBe(false);
    if (!archived.ok) expect(archived.error.code).toBe('CONFLICT');

    const missing = await repository.voteHelpful({
      slug: 'no-such-article',
      vote: 'helpful',
      userId: 'u_1024',
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND');
  });

  it('listTickets 只返回当前用户的工单，按更新时间倒序', async () => {
    const repository = repo();
    const result = await repository.listTickets({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((t) => t.id)).toEqual(['ft-5001', 'ft-5002', 'ft-5003']);

    const open = await repository.listTickets({ status: 'OPEN' });
    expect(open.ok).toBe(true);
    if (open.ok) expect(open.value.items.map((t) => t.id)).toEqual(['ft-5001']);
  });

  it('未登录（currentUserId=null）看不到别人的工单', async () => {
    const repository = repo({ currentUserId: null });
    const result = await repository.listTickets({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items).toEqual([]);
  });

  it('submitTicket：合法提交为 OPEN 且归属当前用户', async () => {
    const repository = repo();
    const result = await repository.submitTicket({
      contact: 'yaya@shanghaitech.edu.cn',
      question: '拼单成团后想退团，点了没有反应。',
      userId: 'u_1024',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('OPEN');
    expect(result.value.userId).toBe('u_1024');
    expect(result.value.createdAt).toBe(NOW.toISOString());

    const list = await repository.listTickets({});
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value.items).toHaveLength(4);
  });

  it('submitTicket：未登录也能提交（userId=null）', async () => {
    const repository = repo({ currentUserId: null });
    const result = await repository.submitTicket({
      contact: 'wechat: passerby',
      question: '游客提问：需要登录才能看课表吗？',
      userId: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.userId).toBeNull();

    const list = await repository.listTickets({});
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value.items).toHaveLength(1);
  });

  it('submitTicket：明文手机号 / 空问题 → VALIDATION_FAILED', async () => {
    const repository = repo();

    const mobile = await repository.submitTicket({
      contact: '13800000000',
      question: '有问题',
      userId: 'u_1024',
    });
    expect(mobile.ok).toBe(false);
    if (!mobile.ok) {
      expect(mobile.error.code).toBe('VALIDATION_FAILED');
      expect(mobile.error.message).toContain('不保存明文手机号');
    }

    const emptyQuestion = await repository.submitTicket({
      contact: 'yaya@shanghaitech.edu.cn',
      question: '   ',
      userId: 'u_1024',
    });
    expect(emptyQuestion.ok).toBe(false);
    if (!emptyQuestion.ok) expect(emptyQuestion.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('故障演练与重置（三态之 error）', () => {
  it('failureMode=error 时四个方法全部返回 UPSTREAM_UNAVAILABLE', async () => {
    const repository = repo();
    expect(repository.getFailureMode()).toBe('none');

    repository.setFailureMode('error');
    const list = await repository.listArticles({});
    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.error.code).toBe('UPSTREAM_UNAVAILABLE');

    const vote = await repository.voteHelpful({
      slug: 'login-cas-failed',
      vote: 'helpful',
      userId: 'u_1024',
    });
    expect(vote.ok).toBe(false);

    const tickets = await repository.listTickets({});
    expect(tickets.ok).toBe(false);

    const submitted = await repository.submitTicket({
      contact: 'yaya@shanghaitech.edu.cn',
      question: '故障期间提交',
      userId: 'u_1024',
    });
    expect(submitted.ok).toBe(false);

    repository.setFailureMode('none');
    const recovered = await repository.listArticles({});
    expect(recovered.ok).toBe(true);
  });

  it('reset 恢复计数与工单，并清空我的投票', async () => {
    const repository = repo();
    await repository.voteHelpful({ slug: 'login-cas-failed', vote: 'helpful', userId: 'u_1024' });
    await repository.submitTicket({
      contact: 'yaya@shanghaitech.edu.cn',
      question: '临时工单',
      userId: 'u_1024',
    });

    repository.reset();

    expect(repository.myVote('login-cas-failed')).toBeNull();
    const articles = await repository.listArticles({ keyword: '登录失败' });
    expect(articles.ok).toBe(true);
    if (articles.ok) expect(articles.value.items[0]?.helpfulCount).toBe(42);

    const tickets = await repository.listTickets({});
    expect(tickets.ok).toBe(true);
    if (tickets.ok) expect(tickets.value.items).toHaveLength(3);
  });
});
