import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../common/errors/app-error';
import { encodeCursor } from '../../common/pagination/cursor';
import { FaqEntryPrismaRepository } from './data/faq.repository';
import { FaqEntryService } from './faq.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { FaqEntryModel, FaqEntryRepository } from './domain/faq.domain';

/**
 * 常见问题（faq）的可执行规格。
 *
 * 这个模块最容易"看起来能用但其实是错的"的地方有三处，所以重点就测这三处：
 *   1. **筛选映射**：`category` 必须精确、`q` 必须同时命中 question 与 answer，
 *      而且**白名单之外的 key 绝不能变成查询条件**（key 来自外部输入）；
 *   2. **排序**：`createdAt desc` + `id desc` —— 少了 id 兜底，同毫秒入库的行
 *      会在游标分页里被跳过或读两次（这是"偶尔少一条"的经典成因）；
 *   3. **有帮助的语义**：它是**无脑 +1**（不是一人一票），条目不存在时 404，
 *      该行为被客户端依赖（客户端因此自己记录"我标记过"，见小程序端 use case）。
 */

const BASE: FaqEntryModel = {
  id: 'faq-1',
  question: '校园卡丢了怎么补办？',
  answer: '先在「校园卡」页挂失，再带学生证到学生服务中心一卡通窗口补办。',
  category: 'campus-card',
  tags: ['校园卡', '补办'],
  helpfulCount: 41,
  createdAt: new Date('2026-10-16T10:00:00.000Z'),
  updatedAt: new Date('2026-10-16T10:00:00.000Z'),
};

interface FakeRepo {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  markHelpful: ReturnType<typeof vi.fn>;
}

function makeRepo(): FakeRepo {
  return {
    list: vi.fn().mockResolvedValue({ items: [BASE], nextCursor: null }),
    create: vi.fn().mockImplementation(async (input: object) => ({ ...BASE, ...input })),
    findById: vi.fn().mockResolvedValue(BASE),
    update: vi.fn().mockImplementation(async (_id: string, patch: object) => ({ ...BASE, ...patch })),
    remove: vi.fn(),
    markHelpful: vi.fn().mockResolvedValue({ ...BASE, helpfulCount: BASE.helpfulCount + 1 }),
  };
}

function makeService(repo: FakeRepo): FaqEntryService {
  return new FaqEntryService(repo as unknown as FaqEntryRepository);
}

describe('FaqEntryService（用例层）', () => {
  let repo: FakeRepo;
  let service: FaqEntryService;

  beforeEach(() => {
    repo = makeRepo();
    service = makeService(repo);
  });

  describe('list', () => {
    it('把 filters 原样透传给仓储（筛选翻译是 data 层的事，用例不改写它）', async () => {
      await service.list({
        limit: 10,
        filters: { category: 'campus-card', q: '补办' },
      });

      expect(repo.list).toHaveBeenCalledWith({
        limit: 10,
        filters: { category: 'campus-card', q: '补办' },
      });
    });

    it('cursor 按原样传递（游标对客户端不透明，用例不做解码）', async () => {
      const cursor = encodeCursor('faq-1');
      await service.list({ cursor, limit: 10 });

      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ cursor }));
    });
  });

  describe('create', () => {
    it('匿名也能提交（本模块低敏感）：不要求登录主体', async () => {
      const created = await service.create({
        question: '快递点在哪？',
        answer: '西门快递驿站 08:00–20:00。',
        category: 'dorm',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'dorm' }),
      );
      expect(created.id).toBe('faq-1');
    });
  });

  describe('markHelpful（有帮助 = 无脑 +1）', () => {
    it('条目存在：调用仓储自增，并返回 +1 之后的最新条目', async () => {
      const result = await service.markHelpful('faq-1');

      expect(repo.findById).toHaveBeenCalledWith('faq-1');
      expect(repo.markHelpful).toHaveBeenCalledWith('faq-1');
      expect(result.helpfulCount).toBe(42);
    });

    it('条目不存在：先 NOT_FOUND，且**不**写计数', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.markHelpful('ghost')).rejects.toThrow(NotFoundError);
      expect(repo.markHelpful).not.toHaveBeenCalled();
    });

    it('不是幂等票：同一个 id 连点两次就是两次自增（客户端必须自己防重复）', async () => {
      await service.markHelpful('faq-1');
      await service.markHelpful('faq-1');

      expect(repo.markHelpful).toHaveBeenCalledTimes(2);
    });
  });
});

/* ------------------------------------------------------------------ *
 * data 层：筛选 / 排序 / 自增语句的真实形状
 * ------------------------------------------------------------------ */

interface FakeDelegate {
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function makeDelegate(rows: readonly FaqEntryModel[] = [BASE]): FakeDelegate {
  return {
    findMany: vi.fn().mockResolvedValue([...rows]),
    findUnique: vi.fn().mockResolvedValue(BASE),
    create: vi.fn().mockResolvedValue(BASE),
    update: vi.fn().mockResolvedValue(BASE),
    delete: vi.fn().mockResolvedValue(BASE),
  };
}

function makeRepository(delegate: FakeDelegate): FaqEntryPrismaRepository {
  return new FaqEntryPrismaRepository({
    faqEntry: delegate,
  } as unknown as PrismaService);
}

/** 取出 findMany 的入参（断言 where / orderBy 的真实形状） */
function findManyArgs(delegate: FakeDelegate): Record<string, unknown> {
  const call = delegate.findMany.mock.calls[0];
  expect(call).toBeDefined();
  return (call?.[0] ?? {}) as Record<string, unknown>;
}

describe('FaqEntryPrismaRepository（筛选与排序白名单）', () => {
  it('默认最新在前，且用 id 兜底保证游标分页不漏读', async () => {
    const delegate = makeDelegate();
    const repository = makeRepository(delegate);

    await repository.list({ limit: 20 });

    expect(findManyArgs(delegate).orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('不带筛选时不传 where（而不是 where: {} —— 空条件在 Prisma 里是另一回事）', async () => {
    const delegate = makeDelegate();
    const repository = makeRepository(delegate);

    await repository.list({ limit: 20 });

    expect(findManyArgs(delegate).where).toBeUndefined();
  });

  it('category 做精确匹配（走索引，不做 contains）', async () => {
    const delegate = makeDelegate();
    const repository = makeRepository(delegate);

    await repository.list({ limit: 20, filters: { category: 'campus-card' } });

    expect(findManyArgs(delegate).where).toEqual({ category: 'campus-card' });
  });

  it('q 同时模糊匹配 question 与 answer，且大小写不敏感', async () => {
    const delegate = makeDelegate();
    const repository = makeRepository(delegate);

    await repository.list({ limit: 20, filters: { q: '校园卡' } });

    expect(findManyArgs(delegate).where).toEqual({
      OR: [
        { question: { contains: '校园卡', mode: 'insensitive' } },
        { answer: { contains: '校园卡', mode: 'insensitive' } },
      ],
    });
  });

  it('category 与 q 可以叠加（AND 语义）', async () => {
    const delegate = makeDelegate();
    const repository = makeRepository(delegate);

    await repository.list({ limit: 20, filters: { category: 'dorm', q: '报修' } });

    expect(findManyArgs(delegate).where).toEqual({
      category: 'dorm',
      OR: [
        { question: { contains: '报修', mode: 'insensitive' } },
        { answer: { contains: '报修', mode: 'insensitive' } },
      ],
    });
  });

  it('白名单之外的 key 一律被忽略（外部 key 绝不进 where）', async () => {
    const delegate = makeDelegate();
    const repository = makeRepository(delegate);

    await repository.list({
      limit: 20,
      // 这些 key 来自 query string，若不显式白名单就会变成任意字段查询
      filters: { helpfulCount: 0, answer: 'x', id: 'faq-9', tags: 'a' } as never,
    });

    expect(findManyArgs(delegate).where).toBeUndefined();

    // 空字符串同样不算筛选条件（避免 ?category= 变成 category = '' 的空结果）
    const second = makeDelegate();
    await makeRepository(second).list({ limit: 20, filters: { category: '', q: '' } });
    expect(findManyArgs(second).where).toBeUndefined();
  });

  it('游标分页：多取一条判断还有没有下一页，skip 掉游标本身', async () => {
    const delegate = makeDelegate([BASE, { ...BASE, id: 'faq-2' }]);
    const repository = makeRepository(delegate);

    const page = await repository.list({ cursor: encodeCursor('faq-1'), limit: 1 });

    expect(findManyArgs(delegate)).toMatchObject({
      take: 2,
      cursor: { id: 'faq-1' },
      skip: 1,
    });
    expect(page.items.map((item) => item.id)).toEqual(['faq-1']);
    // 还有下一页 → nextCursor 指向本页最后一条（base64url，对客户端不透明）
    expect(page.nextCursor).toBe(encodeCursor('faq-1'));
  });

  it('markHelpful 落库语句是原子自增（不是先读再写，也不是幂等票）', async () => {
    const delegate = makeDelegate();
    const repository = makeRepository(delegate);

    await repository.markHelpful('faq-1');

    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: 'faq-1' },
      data: { helpfulCount: { increment: 1 } },
    });
  });
});
