import { Inject, Injectable } from '@nestjs/common';
import type { ForumPost, ForumReply, Prisma } from '@prisma/client';
import type { Page } from '@kedaya/contracts';
import { PrismaService } from '../../../prisma/prisma.service';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import type {
  ForumBoardStat,
  ForumPostCreateData,
  ForumPostListQuery,
  ForumPostModel,
  ForumPostPatch,
  ForumPostRepository,
  ForumReplyCreateData,
  ForumReplyListQuery,
  ForumReplyModel,
  ForumReplyPatch,
} from '../domain/forum.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 *
 * 两个要点：
 *   · `boardCounts()` 用**一次** `groupBy` 拿到全部版块的帖子数，
 *     而不是 7 次 `count`（版块会随契约扩展，N 次查询是不可接受的）；
 *   · `addReply()` 在**同一事务**里插入回复并维护帖子的
 *     `replyCount + 1` 与 `lastReplyAt`，保证列表热度与详情回复数始终一致。
 */
@Injectable()
export class ForumPostPrismaRepository implements ForumPostRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: ForumPostListQuery): Promise<Page<ForumPostModel>> {
    const cursorId = decodeCursor(query.cursor);

    const where: Record<string, unknown> = {};
    if (query.board) where.board = query.board;
    if (query.status) where.status = query.status;
    if (query.authorId) where.authorId = query.authorId;
    if (query.keyword) {
      where.OR = [
        { title: { contains: query.keyword, mode: 'insensitive' } },
        { body: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }

    const rows = (await this.prisma.forumPost.findMany({
      where,
      take: query.limit + 1,
      orderBy: orderByFor(query.sort),
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) as ForumPost[];

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const last = visible.at(-1);

    return {
      items: visible.map(toPostModel),
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  }

  async create(data: ForumPostCreateData): Promise<ForumPostModel> {
    const row = await this.prisma.forumPost.create({
      data: {
        board: data.board,
        authorId: data.authorId,
        anonHandle: data.anonHandle,
        title: data.title,
        body: data.body,
        status: 'published',
      },
    });
    return toPostModel(row);
  }

  async findById(id: string): Promise<ForumPostModel | null> {
    const row = await this.prisma.forumPost.findUnique({ where: { id } });
    return row ? toPostModel(row) : null;
  }

  async update(id: string, patch: ForumPostPatch): Promise<ForumPostModel> {
    const data: Record<string, unknown> = {};
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.body !== undefined) data.body = patch.body;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.anonHandle !== undefined) data.anonHandle = patch.anonHandle;

    const row = await this.prisma.forumPost.update({ where: { id }, data });
    return toPostModel(row);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.forumPost.delete({ where: { id } });
  }

  async boardCounts(): Promise<ForumBoardStat[]> {
    const rows = await this.prisma.forumPost.groupBy({
      by: ['board'],
      _count: { _all: true },
    });
    return rows.map((row) => ({ board: row.board, postCount: row._count._all }));
  }

  async listReplies(query: ForumReplyListQuery): Promise<Page<ForumReplyModel>> {
    const cursorId = decodeCursor(query.cursor);

    const rows = (await this.prisma.forumReply.findMany({
      where: { postId: query.postId, status: 'published' },
      take: query.limit + 1,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) as ForumReply[];

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const last = visible.at(-1);

    return {
      items: visible.map(toReplyModel),
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  }

  async addReply(data: ForumReplyCreateData): Promise<ForumReplyModel> {
    const reply = await this.prisma.$transaction(async (tx) => {
      const created = await tx.forumReply.create({
        data: {
          postId: data.postId,
          authorId: data.authorId,
          anonHandle: data.anonHandle,
          body: data.body,
          status: 'published',
        },
      });
      await tx.forumPost.update({
        where: { id: data.postId },
        data: { replyCount: { increment: 1 }, lastReplyAt: created.createdAt },
      });
      return created;
    });
    return toReplyModel(reply);
  }

  async updateReply(id: string, patch: ForumReplyPatch): Promise<ForumReplyModel> {
    const data: Record<string, unknown> = {};
    if (patch.anonHandle !== undefined) data.anonHandle = patch.anonHandle;
    if (patch.status !== undefined) data.status = patch.status;

    const row = await this.prisma.forumReply.update({ where: { id }, data });
    return toReplyModel(row);
  }
}

function orderByFor(sort: ForumPostListQuery['sort']): Prisma.ForumPostOrderByWithRelationInput[] {
  switch (sort) {
    case 'hot':
      // 热度 = 回复数优先，其次最近回复。`nulls: 'last'` 保证还没人回复的帖子排在后面
      return [
        { replyCount: 'desc' },
        { lastReplyAt: { sort: 'desc', nulls: 'last' } },
        { id: 'desc' },
      ];
    case 'latest':
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}

function toPostModel(row: ForumPost): ForumPostModel {
  return {
    id: row.id,
    board: row.board,
    authorId: row.authorId,
    anonHandle: row.anonHandle,
    title: row.title,
    body: row.body,
    status: row.status,
    pinnedRank: row.pinnedRank,
    replyCount: row.replyCount,
    lastReplyAt: row.lastReplyAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toReplyModel(row: ForumReply): ForumReplyModel {
  return {
    id: row.id,
    postId: row.postId,
    authorId: row.authorId,
    anonHandle: row.anonHandle,
    body: row.body,
    status: row.status,
    createdAt: row.createdAt,
  };
}
