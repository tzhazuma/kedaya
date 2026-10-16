import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeCursor } from '../../../common/pagination/cursor';
import { PrismaService } from '../../../prisma/prisma.service';
import { FaqPrismaRepository, isUniqueConstraintError } from './faq.repository';

/**
 * faq 数据层测试。
 * 重点：**幂等「有用」**靠 `FaqHelpfulVote` 的唯一约束（P2002）实现，
 * 而不是"先查再写"——后者在并发下会双计。
 */

function makePrisma() {
  const delegate = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    delete: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
  });

  const faqEntry = delegate();
  const faqHelpfulVote = delegate();
  const faqTicket = delegate();

  const prisma = {
    faqEntry,
    faqHelpfulVote,
    faqTicket,
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };

  return { prisma: prisma as unknown as PrismaService, $transaction: prisma.$transaction, faqEntry, faqHelpfulVote, faqTicket };
}

describe('FaqPrismaRepository · 幂等「有用」', () => {
  let ctx: ReturnType<typeof makePrisma>;
  let repo: FaqPrismaRepository;

  beforeEach(() => {
    ctx = makePrisma();
    repo = new FaqPrismaRepository(ctx.prisma);
  });

  it('首次投票：写投票行 + 自增计数，counted=true', async () => {
    ctx.faqEntry.update.mockResolvedValue({ id: 'faq-1', helpfulCount: 1 });

    const result = await repo.castVote('faq-1', 'user:user-A', 'helpful');

    expect(ctx.faqHelpfulVote.create).toHaveBeenCalledWith({
      data: { entryId: 'faq-1', voterKey: 'user:user-A', vote: 'helpful' },
    });
    expect(ctx.faqEntry.update).toHaveBeenCalledWith({
      where: { id: 'faq-1' },
      data: { helpfulCount: { increment: 1 } },
    });
    expect(result).toMatchObject({ counted: true });
    expect(result.entry.helpfulCount).toBe(1);
  });

  it('重复投票（唯一约束 P2002）：counted=false，**回放当前计数而不是 +1**', async () => {
    ctx.faqHelpfulVote.create.mockRejectedValue({ code: 'P2002' });
    ctx.faqHelpfulVote.findUnique.mockResolvedValue({ vote: 'helpful' });
    ctx.faqEntry.findUnique.mockResolvedValue({ id: 'faq-1', helpfulCount: 1 });

    const result = await repo.castVote('faq-1', 'user:user-A', 'helpful');

    expect(ctx.faqHelpfulVote.create).toHaveBeenCalledTimes(1);
    expect(result.counted).toBe(false);
    // 真实数据库里自增语句随事务一起回滚（假客户端表达不了回滚，
    // 所以这里断言"返回值没有多算"，而不是"update 没被调用"）
    expect(result.entry.helpfulCount).toBe(1);
    expect(ctx.faqEntry.findUnique).toHaveBeenCalledWith({ where: { id: 'faq-1' } });
  });

  it('非 P2002 的错误照常抛出（不吞真实故障）', async () => {
    ctx.faqHelpfulVote.create.mockRejectedValue({ code: 'P1001', message: '连不上数据库' });

    await expect(repo.castVote('faq-1', 'user:user-A', 'helpful')).rejects.toMatchObject({ code: 'P1001' });
  });

  it('isUniqueConstraintError 只认 P2002', () => {
    expect(isUniqueConstraintError({ code: 'P2002' })).toBe(true);
    expect(isUniqueConstraintError({ code: 'P2025' })).toBe(false);
    expect(isUniqueConstraintError(new Error('boom'))).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
  });
});

describe('FaqPrismaRepository · 检索与工单分页', () => {
  let ctx: ReturnType<typeof makePrisma>;
  let repo: FaqPrismaRepository;

  beforeEach(() => {
    ctx = makePrisma();
    repo = new FaqPrismaRepository(ctx.prisma);
  });

  it('searchEntries：category + 关键词进 where，游标分页多取一条', async () => {
    ctx.faqEntry.findMany.mockResolvedValue([{ id: 'faq-1' }, { id: 'faq-2' }]);

    const page = await repo.searchEntries({ limit: 1, category: '校园卡', keyword: '充值' });

    const args = ctx.faqEntry.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown>; take: number };
    expect(args.take).toBe(2);
    expect(args.where.category).toBe('校园卡');
    expect(args.where.OR).toHaveLength(3);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe(encodeCursor('faq-1'));
  });

  it('searchEntries 无过滤时不生成 where 片段', async () => {
    await repo.searchEntries({ limit: 20 });

    const args = ctx.faqEntry.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({});
  });

  it('createTicket 固定以 OPEN 状态落库', async () => {
    ctx.faqTicket.create.mockResolvedValue({ id: 'ticket-1', status: 'OPEN' });

    await repo.createTicket({
      userId: null,
      contact: 'a@b.com',
      question: '怎么充值',
      suggestedEntryIds: ['faq-1'],
    });

    expect(ctx.faqTicket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: null, status: 'OPEN', suggestedEntryIds: ['faq-1'] }),
    });
  });

  it('listTickets 只查当前用户的工单', async () => {
    await repo.listTickets({ limit: 20, userId: 'user-A' });

    const args = ctx.faqTicket.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({ userId: 'user-A' });
  });

  it('findManyByIds 空数组时不查库', async () => {
    await expect(repo.findManyByIds([])).resolves.toEqual([]);
    expect(ctx.faqEntry.findMany).not.toHaveBeenCalled();
  });
});
