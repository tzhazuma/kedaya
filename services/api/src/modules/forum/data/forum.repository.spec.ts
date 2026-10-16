import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeCursor } from '../../../common/pagination/cursor';
import { PrismaService } from '../../../prisma/prisma.service';
import { ForumPrismaRepository } from './forum.repository';

/**
 * forum 数据层测试（游标分页 + 过滤 + 冗余计数 + 举报去重键）。
 *
 * 用假 Prisma delegate（不连数据库）—— 本机没有 PostgreSQL，
 * 而这里要验证的是**游标分页协议**与 where 组装，与真实数据库无关。
 */

function row(id: string, extra: Record<string, unknown> = {}) {
  return { id, boardId: 'board-1', status: 'PUBLISHED', ...extra };
}

function makePrisma() {
  const delegate = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    delete: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
  });

  const forumPost = delegate();
  const forumReply = delegate();
  const forumBoard = delegate();
  const forumReport = delegate();

  const prisma = {
    forumPost,
    forumReply,
    forumBoard,
    forumReport,
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };

  return {
    prisma: prisma as unknown as PrismaService,
    $transaction: prisma.$transaction,
    forumPost,
    forumReply,
    forumBoard,
    forumReport,
  };
}

describe('ForumPrismaRepository · 游标分页与过滤（契约 §6.1 不用 offset）', () => {
  let ctx: ReturnType<typeof makePrisma>;
  let repo: ForumPrismaRepository;

  beforeEach(() => {
    ctx = makePrisma();
    repo = new ForumPrismaRepository(ctx.prisma);
  });

  it('多取一条判断 hasMore，并返回下一条游标', async () => {
    ctx.forumPost.findMany.mockResolvedValue([row('post-1'), row('post-2'), row('post-3')]);

    const page = await repo.listFiltered({ limit: 2 });

    expect(ctx.forumPost.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3, orderBy: { id: 'asc' } }));
    expect(page.items.map((item) => item.id)).toEqual(['post-1', 'post-2']);
    expect(page.nextCursor).toBe(encodeCursor('post-2'));
  });

  it('正好取满且没有更多时 nextCursor 为 null', async () => {
    ctx.forumPost.findMany.mockResolvedValue([row('post-1'), row('post-2')]);

    const page = await repo.listFiltered({ limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('带 cursor 时用 cursor + skip 1，而不是 offset', async () => {
    ctx.forumPost.findMany.mockResolvedValue([]);

    await repo.listFiltered({ limit: 20, cursor: encodeCursor('post-9') });

    const args = ctx.forumPost.findMany.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.cursor).toEqual({ id: 'post-9' });
    expect(args.skip).toBe(1);
    expect(args).not.toHaveProperty('skip', 20);
  });

  it('board / status 集合 / 关键词都进 where', async () => {
    await repo.listFiltered({ limit: 20, boardId: 'board-1', status: ['PUBLISHED', 'LOCKED'], keyword: '食堂' });

    const args = ctx.forumPost.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where.boardId).toBe('board-1');
    expect(args.where.status).toEqual({ in: ['PUBLISHED', 'LOCKED'] });
    expect(args.where.OR).toEqual([
      { title: { contains: '食堂', mode: 'insensitive' } },
      { body: { contains: '食堂', mode: 'insensitive' } },
    ]);
  });

  it('无过滤条件时不生成 OR / board / status 片段', async () => {
    await repo.listFiltered({ limit: 20 });

    const args = ctx.forumPost.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({});
  });

  it('回复列表默认只查 published，版主可见隐藏回复', async () => {
    await repo.listReplies({ postId: 'post-1', limit: 20 });
    expect((ctx.forumReply.findMany.mock.calls[0]?.[0] as { where: unknown }).where).toEqual({
      postId: 'post-1',
      status: 'PUBLISHED',
    });

    await repo.listReplies({ postId: 'post-1', limit: 20, includeHidden: true });
    expect((ctx.forumReply.findMany.mock.calls[1]?.[0] as { where: unknown }).where).toEqual({ postId: 'post-1' });
  });

  it('版块列表同样是游标分页', async () => {
    ctx.forumBoard.findMany.mockResolvedValue([
      { id: 'board-1', slug: 'a' },
      { id: 'board-2', slug: 'b' },
    ]);

    const page = await repo.listBoards({ limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe(encodeCursor('board-1'));
  });
});

describe('ForumPrismaRepository · 回复与冗余计数', () => {
  let ctx: ReturnType<typeof makePrisma>;
  let repo: ForumPrismaRepository;

  beforeEach(() => {
    ctx = makePrisma();
    repo = new ForumPrismaRepository(ctx.prisma);
  });

  it('addReply 在同一个事务里写回复 + 自增 replyCount', async () => {
    ctx.forumReply.create.mockResolvedValue({ id: 'reply-1', postId: 'post-1', body: 'x' });

    const reply = await repo.addReply({
      id: 'reply-1',
      postId: 'post-1',
      parentReplyId: null,
      authorId: 'user-A',
      anonHandle: null,
      body: 'x',
      status: 'PUBLISHED',
    });

    expect(ctx.$transaction).toHaveBeenCalledTimes(1);
    expect(ctx.forumPost.update).toHaveBeenCalledWith({
      where: { id: 'post-1' },
      data: { replyCount: { increment: 1 } },
    });
    expect(reply).toMatchObject({ id: 'reply-1' });
  });

  it('递减回复数时带 replyCount > 0 守卫（不会减成负数）', async () => {
    await repo.adjustReplyCount('post-1', -1);

    expect(ctx.forumPost.updateMany).toHaveBeenCalledWith({
      where: { id: 'post-1', replyCount: { gt: 0 } },
      data: { replyCount: { decrement: 1 } },
    });
  });

  it('递增版块主题数走 update + increment（按版块 id）', async () => {
    await repo.adjustBoardPostCount('board-1', 1);

    expect(ctx.forumBoard.update).toHaveBeenCalledWith({
      where: { id: 'board-1' },
      data: { postCount: { increment: 1 } },
    });
  });

  it('版块 lastPostAt 用一次 groupBy 取最新主题时间（避免 N+1）', async () => {
    ctx.forumPost.groupBy = vi
      .fn()
      .mockResolvedValue([{ boardId: 'board-1', _max: { updatedAt: new Date('2026-10-05T00:00:00.000Z') } }]);

    const map = await repo.latestPostAtByBoard();

    expect(map.get('board-1')).toEqual(new Date('2026-10-05T00:00:00.000Z'));
  });

  it('作者昵称目录只读 id + displayName 两列（最小采集）', async () => {
    const userFindMany = vi.fn().mockResolvedValue([{ id: 'user-A', displayName: '张三' }]);
    const prismaWithUser = {
      ...(ctx.prisma as unknown as Record<string, unknown>),
      user: { findMany: userFindMany },
    } as unknown as PrismaService;
    const repoWithUser = new ForumPrismaRepository(prismaWithUser);

    const map = await repoWithUser.displayNamesFor(['user-A', 'user-A', '']);

    expect(map.get('user-A')).toBe('张三');
    expect(userFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['user-A'] } },
      select: { id: true, displayName: true },
    });
  });
});

describe('ForumPrismaRepository · 举报去重与计数', () => {
  let ctx: ReturnType<typeof makePrisma>;
  let repo: ForumPrismaRepository;

  beforeEach(() => {
    ctx = makePrisma();
    repo = new ForumPrismaRepository(ctx.prisma);
  });

  it('按 (targetType, targetId, reporterKey) 查已有举报', async () => {
    await repo.findReportByReporter('POST', 'post-1', 'user:user-A');

    expect(ctx.forumReport.findUnique).toHaveBeenCalledWith({
      where: { targetType_targetId_reporterKey: { targetType: 'POST', targetId: 'post-1', reporterKey: 'user:user-A' } },
    });
  });

  it('举报人数用 count（唯一约束保证同一人只有一行，因此 count 即去重人数）', async () => {
    ctx.forumReport.count.mockResolvedValue(3);

    await expect(repo.countDistinctReporters('POST', 'post-1')).resolves.toBe(3);
    expect(ctx.forumReport.count).toHaveBeenCalledWith({ where: { targetType: 'POST', targetId: 'post-1' } });
  });

  it('举报列表支持 status 过滤 + 游标分页', async () => {
    ctx.forumReport.findMany.mockResolvedValue([
      { id: 'r1', status: 'PENDING' },
      { id: 'r2', status: 'PENDING' },
    ]);

    const page = await repo.listReports({ limit: 1, status: 'PENDING' });

    const args = ctx.forumReport.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({ status: 'PENDING' });
    expect(page.nextCursor).toBe(encodeCursor('r1'));
  });
});
