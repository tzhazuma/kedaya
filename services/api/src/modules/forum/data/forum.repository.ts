/**
 * 论坛 · forum —— data 层（唯一允许碰 IO 的地方，契约 §7 依赖方向 domain ← data）
 *
 * ⚠️ 本文件**手写**（不在 scaffold SPEC 表里，理由见 domain/forum.domain.ts 顶部）。
 *
 * 一个类实现四个端口（主题 / 版块 / 举报 / 作者昵称目录）：它们共享同一个
 * Prisma 客户端，拆开只会多几份构造样板。模块里用 `useExisting` 把 token
 * 指到同一个实例上（见 forum.module.ts）。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import type { ForumBoard, ForumPost, ForumReply, ForumReport } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import type { ListParams } from '../../../common/crud/resource';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateForumBoardInput,
  CreateForumPostInput,
  CreateForumReplyInput,
  CreateForumReportInput,
  ForumBoardModel,
  ForumBoardRepository,
  ForumPostListFilter,
  ForumPostModel,
  ForumPostRepository,
  ForumReportListFilter,
  ForumReportModel,
  ForumReportRepository,
  ForumReportStatus,
  ForumReplyModel,
  ForumUserDirectoryPort,
  UpdateForumPostInput,
  UpdateForumReplyInput,
} from '../domain/forum.domain';

@Injectable()
export class ForumPrismaRepository
  extends PrismaCursorRepository<ForumPost, ForumPostModel, CreateForumPostInput, UpdateForumPostInput>
  implements ForumPostRepository, ForumBoardRepository, ForumReportRepository, ForumUserDirectoryPort
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.forumPost);
  }

  /* ================= 主题（posts） ================= */

  /**
   * 带过滤的游标分页。
   *
   * 分页协议与 `PrismaCursorRepository` 完全一致（orderBy id asc + take limit+1
   * + cursor/skip 1），只是多了 where。刻意不改成 offset：契约 §6.1 冻结游标。
   */
  async listFiltered(filter: ForumPostListFilter): Promise<Page<ForumPostModel>> {
    const cursorId = decodeCursor(filter.cursor);
    const keyword = filter.keyword?.trim();

    const rows = (await this.prisma.forumPost.findMany({
      where: {
        ...(filter.boardId ? { boardId: filter.boardId } : {}),
        ...(filter.status
          ? { status: Array.isArray(filter.status) ? { in: filter.status } : filter.status }
          : {}),
        ...(keyword
          ? {
              OR: [
                { title: { contains: keyword, mode: 'insensitive' as const } },
                { body: { contains: keyword, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      take: filter.limit + 1,
      orderBy: { id: 'asc' },
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) as ForumPost[];

    return toPage(rows, filter.limit, (row) => row as unknown as ForumPostModel);
  }

  async addReply(input: CreateForumReplyInput): Promise<ForumReplyModel> {
    // 回复落库与冗余计数自增放在同一个事务里，避免"回复成功但计数没涨"
    const [reply] = await this.prisma.$transaction([
      this.prisma.forumReply.create({
        data: {
          id: input.id,
          postId: input.postId,
          parentReplyId: input.parentReplyId,
          authorId: input.authorId,
          anonHandle: input.anonHandle,
          body: input.body,
          status: input.status,
        },
      }),
      this.prisma.forumPost.update({
        where: { id: input.postId },
        data: { replyCount: { increment: 1 } },
      }),
    ]);
    return reply as unknown as ForumReplyModel;
  }

  async listReplies(
    filter: { postId: string; includeHidden?: boolean } & ListParams,
  ): Promise<Page<ForumReplyModel>> {
    const cursorId = decodeCursor(filter.cursor);
    const rows = (await this.prisma.forumReply.findMany({
      where: {
        postId: filter.postId,
        ...(filter.includeHidden ? {} : { status: 'PUBLISHED' }),
      },
      take: filter.limit + 1,
      orderBy: { id: 'asc' },
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) as ForumReply[];
    return toPage(rows, filter.limit, (row) => row as unknown as ForumReplyModel);
  }

  async findReplyById(id: string): Promise<ForumReplyModel | null> {
    const row = await this.prisma.forumReply.findUnique({ where: { id } });
    return row ? (row as unknown as ForumReplyModel) : null;
  }

  async updateReply(id: string, input: UpdateForumReplyInput): Promise<ForumReplyModel> {
    const row = await this.prisma.forumReply.update({ where: { id }, data: input });
    return row as unknown as ForumReplyModel;
  }

  /**
   * 维护主题的回复数冗余计数。
   * 递减时加 `replyCount > 0` 守卫，避免并发下把计数减成负数。
   */
  async adjustReplyCount(postId: string, delta: number): Promise<void> {
    if (delta >= 0) {
      await this.prisma.forumPost.update({ where: { id: postId }, data: { replyCount: { increment: delta } } });
      return;
    }
    await this.prisma.forumPost.updateMany({
      where: { id: postId, replyCount: { gt: 0 } },
      data: { replyCount: { decrement: Math.abs(delta) } },
    });
  }

  /* ================= 版块（boards） ================= */

  async listBoards(params: ListParams): Promise<Page<ForumBoardModel>> {
    const cursorId = decodeCursor(params.cursor);
    const rows = (await this.prisma.forumBoard.findMany({
      take: params.limit + 1,
      orderBy: { id: 'asc' },
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) as ForumBoard[];
    return toPage(rows, params.limit, (row) => row as unknown as ForumBoardModel);
  }

  async findBoardByIdOrSlug(value: string): Promise<ForumBoardModel | null> {
    const row = await this.prisma.forumBoard.findFirst({
      where: { OR: [{ id: value }, { slug: value }] },
    });
    return row ? (row as unknown as ForumBoardModel) : null;
  }

  async createBoard(input: CreateForumBoardInput & { slug: string }): Promise<ForumBoardModel> {
    const row = await this.prisma.forumBoard.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        visibility: input.visibility ?? 'public',
      },
    });
    return row as unknown as ForumBoardModel;
  }

  async adjustBoardPostCount(boardId: string, delta: number): Promise<void> {
    if (delta >= 0) {
      await this.prisma.forumBoard.update({ where: { id: boardId }, data: { postCount: { increment: delta } } });
      return;
    }
    await this.prisma.forumBoard.updateMany({
      where: { id: boardId, postCount: { gt: 0 } },
      data: { postCount: { decrement: Math.abs(delta) } },
    });
  }

  /** 每个版块的最新主题时间（一次 groupBy，避免 N+1） */
  async latestPostAtByBoard(): Promise<Map<string, Date>> {
    const grouped = await this.prisma.forumPost.groupBy({
      by: ['boardId'],
      _max: { updatedAt: true },
    });
    const result = new Map<string, Date>();
    for (const row of grouped as Array<{ boardId: string; _max: { updatedAt: Date | null } }>) {
      if (row._max.updatedAt) result.set(row.boardId, row._max.updatedAt);
    }
    return result;
  }

  /* ================= 举报（reports） ================= */

  async createReport(input: CreateForumReportInput): Promise<ForumReportModel> {
    const row = await this.prisma.forumReport.create({
      data: {
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        detail: input.detail,
        reporterId: input.reporterId,
        reporterKey: input.reporterKey,
      },
    });
    return row as unknown as ForumReportModel;
  }

  async findReportByReporter(
    targetType: CreateForumReportInput['targetType'],
    targetId: string,
    reporterKey: string,
  ): Promise<ForumReportModel | null> {
    const row = await this.prisma.forumReport.findUnique({
      where: { targetType_targetId_reporterKey: { targetType, targetId, reporterKey } },
    });
    return row ? (row as unknown as ForumReportModel) : null;
  }

  /**
   * 不同举报人数量。
   * `ForumReport` 上的 `@@unique([targetType, targetId, reporterKey])` 保证
   * 同一举报人对同一目标只有一行，因此 `count` 就是**去重后**的人数。
   */
  countDistinctReporters(targetType: CreateForumReportInput['targetType'], targetId: string): Promise<number> {
    return this.prisma.forumReport.count({ where: { targetType, targetId } });
  }

  async listReports(filter: ForumReportListFilter): Promise<Page<ForumReportModel>> {
    const cursorId = decodeCursor(filter.cursor);
    const rows = (await this.prisma.forumReport.findMany({
      where: {
        ...(filter.targetType ? { targetType: filter.targetType } : {}),
        ...(filter.targetId ? { targetId: filter.targetId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      take: filter.limit + 1,
      orderBy: { id: 'asc' },
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) as ForumReport[];
    return toPage(rows, filter.limit, (row) => row as unknown as ForumReportModel);
  }

  async setReportStatus(id: string, status: ForumReportStatus): Promise<ForumReportModel> {
    const row = await this.prisma.forumReport.update({ where: { id }, data: { status } });
    return row as unknown as ForumReportModel;
  }

  /* ================= 作者昵称目录 ================= */

  /**
   * 批量取作者昵称（`User.displayName`）。
   * 只读 `id` + `displayName` 两列 —— 最小采集，不把用户档案带进论坛域。
   */
  async displayNamesFor(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, displayName: true },
    });
    return new Map(rows.map((row) => [row.id, row.displayName]));
  }
}

/** 游标分页的公共收尾：多取一条判断 hasMore，返回 nextCursor */
function toPage<TRow extends { id: string }, TModel>(
  rows: TRow[],
  limit: number,
  toModel: (row: TRow) => TModel,
): Page<TModel> {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible.at(-1);
  return {
    items: visible.map(toModel),
    nextCursor: hasMore && last ? encodeCursor(last.id) : null,
  };
}
