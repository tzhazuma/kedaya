import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RolePort } from '../../common/auth/role.port';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { FaqService } from './faq.service';
import type {
  CreateFaqEntryInput,
  FaqEntryModel,
  FaqEntryRepository,
  FaqTicketModel,
  FaqTicketRepository,
} from './domain/faq.domain';

/**
 * faq 用例层测试。
 * 重点：**幂等 helpful**（同一用户重复点只算一次）、工单建议、工单状态流转。
 */

const ACTOR = 'user-A';
const STRANGER = 'user-B';
const STAFF = 'user-staff';

function makeEntry(overrides: Partial<FaqEntryModel> = {}): FaqEntryModel {
  return {
    id: 'faq-1',
    slug: 'faq-card-topup',
    question: '校园卡如何充值？',
    answer: '在一卡通 App 里充值。',
    category: '校园卡',
    tags: ['校园卡', '充值'],
    status: 'PUBLISHED',
    helpfulCount: 0,
    unhelpfulCount: 0,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeTicket(overrides: Partial<FaqTicketModel> = {}): FaqTicketModel {
  return {
    id: 'ticket-1',
    userId: ACTOR,
    contact: 'a@shanghaitech.edu.cn',
    question: '校园卡丢了怎么办',
    status: 'OPEN',
    answer: null,
    answeredAt: null,
    closedAt: null,
    suggestedEntryIds: [],
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

type MockFn = ReturnType<typeof vi.fn>;

interface Fakes {
  entries: {
    list: MockFn;
    create: MockFn;
    findById: MockFn;
    update: MockFn;
    remove: MockFn;
    searchEntries: MockFn;
    findManyByIds: MockFn;
    castVote: MockFn;
    findEntryByIdOrSlug: MockFn;
  };
  tickets: {
    createTicket: MockFn;
    findTicketById: MockFn;
    listTickets: MockFn;
    updateTicket: MockFn;
  };
  roles: { hasRole: MockFn };
}

function makeFakes(): Fakes {
  return {
    entries: {
      list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      create: vi.fn().mockImplementation(async (input: CreateFaqEntryInput) => makeEntry(input)),
      findById: vi.fn().mockResolvedValue(makeEntry()),
      update: vi.fn().mockImplementation(async (id: string, data: Partial<FaqEntryModel>) =>
        makeEntry({ id, ...data }),
      ),
      remove: vi.fn().mockResolvedValue(undefined),
      searchEntries: vi.fn().mockResolvedValue({ items: [makeEntry()], nextCursor: null }),
      findManyByIds: vi.fn().mockResolvedValue([]),
      castVote: vi
        .fn()
        .mockImplementation(async (_id: string, _voter: string, vote: string) => ({
          entry: makeEntry(vote === 'helpful' ? { helpfulCount: 1 } : { unhelpfulCount: 1 }),
          counted: true,
          changed: false,
        })),
      findEntryByIdOrSlug: vi.fn().mockResolvedValue(makeEntry()),
    },
    tickets: {
      createTicket: vi.fn().mockImplementation(async (input: Partial<FaqTicketModel>) => makeTicket(input)),
      findTicketById: vi.fn().mockResolvedValue(makeTicket()),
      listTickets: vi.fn().mockResolvedValue({ items: [makeTicket()], nextCursor: null }),
      updateTicket: vi.fn().mockImplementation(async (id: string, data: Partial<FaqTicketModel>) =>
        makeTicket({ id, ...data }),
      ),
    },
    roles: { hasRole: vi.fn().mockResolvedValue(false) },
  };
}

function makeService(fakes: Fakes): FaqService {
  const config = { get: vi.fn(() => undefined) } as unknown as ConfigService;
  return new FaqService(
    fakes.entries as unknown as FaqEntryRepository,
    fakes.tickets as unknown as FaqTicketRepository,
    fakes.roles as unknown as RolePort,
    config,
  );
}

describe('FaqService · 幂等投票（同一用户对同一条目只有一票）', () => {
  let fakes: Fakes;
  let service: FaqService;

  beforeEach(() => {
    fakes = makeFakes();
    service = makeService(fakes);
  });

  it('首次投票（value=helpful）：counted=true，返回新计数与 DTO 字段', async () => {
    const result = await service.vote('faq-1', 'helpful', ACTOR);

    expect(result).toMatchObject({ id: 'faq-1', slug: 'faq-card-topup', helpfulCount: 1, counted: true });
    expect(fakes.entries.castVote).toHaveBeenCalledWith('faq-1', 'user:user-A', 'helpful');
  });

  it('重复投同一票：counted=false，计数不变，且**不报错**', async () => {
    fakes.entries.castVote.mockResolvedValue({ entry: makeEntry({ helpfulCount: 1 }), counted: false, changed: false });

    const result = await service.vote('faq-1', 'helpful', ACTOR);

    expect(result).toMatchObject({ helpfulCount: 1, counted: false, changed: false });
  });

  it('unhelpful 票走 unhelpfulCount；改票时 changed=true', async () => {
    fakes.entries.castVote.mockResolvedValue({
      entry: makeEntry({ unhelpfulCount: 2 }),
      counted: false,
      changed: true,
    });

    const result = await service.vote('faq-1', 'unhelpful', ACTOR);

    expect(result).toMatchObject({ unhelpfulCount: 2, counted: false, changed: true });
    expect(fakes.entries.castVote).toHaveBeenCalledWith('faq-1', 'user:user-A', 'unhelpful');
  });

  it('不同用户各自计一次', async () => {
    await service.vote('faq-1', 'helpful', ACTOR);
    await service.vote('faq-1', 'helpful', STRANGER);

    expect(fakes.entries.castVote).toHaveBeenNthCalledWith(1, 'faq-1', 'user:user-A', 'helpful');
    expect(fakes.entries.castVote).toHaveBeenNthCalledWith(2, 'faq-1', 'user:user-B', 'helpful');
  });

  it('未登录不能投票 → UNAUTHENTICATED（幂等键需要稳定主体）', async () => {
    await expect(service.vote('faq-1', 'helpful')).rejects.toThrow(UnauthenticatedError);
    expect(fakes.entries.castVote).not.toHaveBeenCalled();
  });

  it('条目不存在 → NOT_FOUND，不写投票', async () => {
    fakes.entries.findEntryByIdOrSlug.mockResolvedValue(null);

    await expect(service.vote('missing', 'helpful', ACTOR)).rejects.toThrow(NotFoundError);
    expect(fakes.entries.castVote).not.toHaveBeenCalled();
  });
});

describe('FaqService · 条目检索', () => {
  it('category 与 q 都透传到仓储', async () => {
    const fakes = makeFakes();
    const service = makeService(fakes);

    await service.searchEntries({ limit: 20, category: '校园卡', keyword: '充值' });

    expect(fakes.entries.searchEntries).toHaveBeenCalledWith({ limit: 20, category: '校园卡', keyword: '充值' });
  });

  it('条目写操作需要 faq_staff', async () => {
    const fakes = makeFakes();
    const service = makeService(fakes);
    const draft = { slug: 'faq-draft', question: 'q', answer: 'a', category: 'c' };

    await expect(service.create(draft, ACTOR)).rejects.toThrow(ForbiddenError);

    fakes.roles.hasRole.mockResolvedValue(true);
    await service.create(draft, STAFF);

    // 计数一律从 0 起（DTO 里不会出现客户端传入的计数）
    expect(fakes.entries.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'faq-draft', status: 'PUBLISHED' }),
    );
    expect(fakes.entries.create.mock.calls[0]?.[0]).not.toHaveProperty('helpfulCount');
  });

  it('slug 缺失时用 slugify(question) 生成；中文问题退化为 ULID', async () => {
    const fakes = makeFakes();
    const service = makeService(fakes);
    fakes.roles.hasRole.mockResolvedValue(true);

    await service.create({ question: 'How to top up?', answer: 'a', category: 'c' }, STAFF);
    expect(fakes.entries.create).toHaveBeenCalledWith(expect.objectContaining({ slug: 'how-to-top-up' }));

    await service.create({ question: '校园卡怎么充值', answer: 'a', category: 'c' }, STAFF);
    const slug = (fakes.entries.create.mock.calls[1]?.[0] as { slug: string }).slug;
    expect(slug).toMatch(/^[0-9a-z]{26}$/);
  });

  it('PATCH 不接受直接改写计数（只能走投票）', async () => {
    const fakes = makeFakes();
    const service = makeService(fakes);
    fakes.roles.hasRole.mockResolvedValue(true);

    // 计数不在 UpdateFaqEntryInput 里 —— 传进来只会被忽略，不会落库
    await service.update('faq-1', { status: 'ARCHIVED' }, STAFF);
    expect(fakes.entries.update).toHaveBeenCalledWith('faq-1', { status: 'ARCHIVED' });
  });
});

describe('FaqService · 工单式自助答疑', () => {
  let fakes: Fakes;
  let service: FaqService;

  beforeEach(() => {
    fakes = makeFakes();
    service = makeService(fakes);
  });

  it('提交工单返回相关 FAQ 建议，并把建议 id 落库', async () => {
    const result = await service.submitTicket({ contact: 'a@shanghaitech.edu.cn', question: '校园卡怎么充值' }, ACTOR);

    expect(result.suggestions[0]?.id).toBe('faq-1');
    expect(fakes.tickets.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ACTOR, suggestedEntryIds: ['faq-1'] }),
    );
  });

  it('未登录也能提交（userId=null），但同样给出建议', async () => {
    const result = await service.submitTicket({ contact: 'wechat: kedaya', question: '校园卡怎么充值' });

    expect(fakes.tickets.createTicket).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('问题里疑似含 PII → piiWarning=true（提示而非拦截）', async () => {
    const result = await service.submitTicket(
      { contact: 'a@shanghaitech.edu.cn', question: '我的学号 20261234 登不上' },
      ACTOR,
    );

    expect(result.piiWarning).toBe(true);
  });

  it('联系方式是明文手机号 → VALIDATION_FAILED（数据最小化）', async () => {
    await expect(service.submitTicket({ contact: '13800138000', question: '问题' }, ACTOR)).rejects.toThrow(
      ValidationError,
    );
    expect(fakes.tickets.createTicket).not.toHaveBeenCalled();
  });

  it('空问题 → VALIDATION_FAILED', async () => {
    await expect(service.submitTicket({ contact: 'a@b.com', question: '   ' }, ACTOR)).rejects.toThrow(
      ValidationError,
    );
  });

  it('我的工单只查自己的，且必须登录', async () => {
    await service.listMyTickets({ limit: 20 }, ACTOR);

    expect(fakes.tickets.listTickets).toHaveBeenCalledWith({ limit: 20, userId: ACTOR });
    await expect(service.listMyTickets({ limit: 20 })).rejects.toThrow(UnauthenticatedError);
  });

  it('工单详情：本人可见，陌生人得到 NOT_FOUND（不确认存在），staff 可见', async () => {
    await expect(service.ticketDetail('ticket-1', ACTOR)).resolves.toMatchObject({ id: 'ticket-1' });
    await expect(service.ticketDetail('ticket-1', STRANGER)).rejects.toThrow(NotFoundError);

    fakes.roles.hasRole.mockResolvedValue(true);
    await expect(service.ticketDetail('ticket-1', STAFF)).resolves.toMatchObject({ id: 'ticket-1' });
  });

  it('staff 回复 → ANSWERED + answeredAt', async () => {
    fakes.roles.hasRole.mockResolvedValue(true);

    await service.patchTicket('ticket-1', { answer: '请到一卡通中心补办' }, STAFF);

    expect(fakes.tickets.updateTicket).toHaveBeenCalledWith(
      'ticket-1',
      expect.objectContaining({ status: 'ANSWERED', answer: '请到一卡通中心补办', answeredAt: expect.any(Date) }),
    );
  });

  it('非 staff 回复 → FORBIDDEN', async () => {
    await expect(service.patchTicket('ticket-1', { answer: '我来答' }, ACTOR)).rejects.toThrow(ForbiddenError);
  });

  it('提问者确认关闭 → CLOSED + closedAt', async () => {
    fakes.tickets.findTicketById.mockResolvedValue(makeTicket({ status: 'ANSWERED', answer: '已答复' }));

    await service.patchTicket('ticket-1', { status: 'CLOSED' }, ACTOR);

    expect(fakes.tickets.updateTicket).toHaveBeenCalledWith(
      'ticket-1',
      expect.objectContaining({ status: 'CLOSED', closedAt: expect.any(Date) }),
    );
  });

  it('OPEN 不能直接 CLOSED → CONFLICT', async () => {
    await expect(service.patchTicket('ticket-1', { status: 'CLOSED' }, ACTOR)).rejects.toThrow(ConflictError);
  });

  it('追问（ANSWERED → OPEN）清掉关闭时间', async () => {
    fakes.tickets.findTicketById.mockResolvedValue(
      makeTicket({ status: 'ANSWERED', answer: '已答复', closedAt: new Date('2026-10-02T00:00:00.000Z') }),
    );

    await service.patchTicket('ticket-1', { status: 'OPEN' }, ACTOR);

    expect(fakes.tickets.updateTicket).toHaveBeenCalledWith(
      'ticket-1',
      expect.objectContaining({ status: 'OPEN', closedAt: null }),
    );
  });

  it('空 PATCH → VALIDATION_FAILED', async () => {
    await expect(service.patchTicket('ticket-1', {}, ACTOR)).rejects.toThrow(ValidationError);
  });

  it('suggest：空查询返回空数组，不查库', async () => {
    await expect(service.suggest('')).resolves.toEqual([]);
    expect(fakes.entries.searchEntries).not.toHaveBeenCalled();
  });
});
