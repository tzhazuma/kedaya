/**
 * 常见问题 · faq —— data 层（唯一允许碰 IO 的地方，契约 §7）
 *
 * ⚠️ 本文件**手写**（不在 scaffold SPEC 表里，理由见 domain/faq.domain.ts 顶部）。
 *
 * 幂等「有用」的落点在这里：靠 `FaqHelpfulVote` 的唯一约束，
 * 而不是"先查再写"（后者在并发下会双计）。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import type { FaqEntry, FaqTicket } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import type { ListParams } from '../../../common/crud/resource';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CastVoteResult,
  CreateFaqEntryInput,
  CreateFaqTicketInput,
  FaqEntryListFilter,
  FaqEntryModel,
  FaqEntryRepository,
  FaqTicketModel,
  FaqTicketRepository,
  FaqVoteValue,
  UpdateFaqEntryInput,
  UpdateFaqTicketInput,
} from '../domain/faq.domain';

@Injectable()
export class FaqPrismaRepository
  extends PrismaCursorRepository<FaqEntry, FaqEntryModel, CreateFaqEntryInput, UpdateFaqEntryInput>
  implements FaqEntryRepository, FaqTicketRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.faqEntry);
  }

  /* ================= 条目 ================= */

  /**
   * 分类过滤 + 关键词搜索（游标分页，契约 §6.1）。
   * 搜索用 SQL 的 `contains`（大小写不敏感）；语义排序由
   * `rankFaqSuggestions` 在内存里做（只对候选集，不引向量库）。
   */
  async searchEntries(filter: FaqEntryListFilter): Promise<Page<FaqEntryModel>> {
    const cursorId = decodeCursor(filter.cursor);
    const keyword = filter.keyword?.trim();

    const rows = (await this.prisma.faqEntry.findMany({
      where: {
        ...(filter.category ? { category: filter.category } : {}),
        ...(keyword
          ? {
              OR: [
                { question: { contains: keyword, mode: 'insensitive' as const } },
                { answer: { contains: keyword, mode: 'insensitive' as const } },
                { category: { contains: keyword, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      take: filter.limit + 1,
      orderBy: { id: 'asc' },
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) as FaqEntry[];

    return toPage(rows, filter.limit, (row) => row as unknown as FaqEntryModel);
  }

  async findManyByIds(ids: string[]): Promise<FaqEntryModel[]> {
    if (ids.length === 0) return [];
    const rows = (await this.prisma.faqEntry.findMany({ where: { id: { in: ids } } })) as FaqEntry[];
    return rows.map((row) => row as unknown as FaqEntryModel);
  }

  async findEntryByIdOrSlug(value: string): Promise<FaqEntryModel | null> {
    const row = await this.prisma.faqEntry.findFirst({ where: { OR: [{ id: value }, { slug: value }] } });
    return row ? (row as unknown as FaqEntryModel) : null;
  }

  /**
   * 幂等投票（`POST /faq/items/:id/votes`）。
   *
   * 事务里先插投票行 —— 唯一约束冲突（P2002）说明"这个人已经投过了"：
   *   · 同一票种 → 幂等命中，**不改计数**（counted=false）；
   *   · 不同票种 → 改票，旧票计数 -1、新票计数 +1（changed=true）。
   * 并发下两个人同时投，也只有一个能插入成功，计数不会丢也不会多。
   */
  async castVote(entryId: string, voterKey: string, vote: FaqVoteValue): Promise<CastVoteResult> {
    // 显式分支而不是计算属性名：Prisma 的 data 类型不接受索引签名
    const incrementOne =
      vote === 'helpful' ? { helpfulCount: { increment: 1 } } : { unhelpfulCount: { increment: 1 } };
    try {
      const [, entry] = await this.prisma.$transaction([
        this.prisma.faqHelpfulVote.create({ data: { entryId, voterKey, vote } }),
        this.prisma.faqEntry.update({ where: { id: entryId }, data: incrementOne }),
      ]);
      return { entry: entry as unknown as FaqEntryModel, counted: true, changed: false };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }

    // 已存在投票行：读出来决定是"幂等命中"还是"改票"
    const existing = (await this.prisma.faqHelpfulVote.findUnique({
      where: { entryId_voterKey: { entryId, voterKey } },
    })) as { vote: string } | null;
    if (!existing) throw new Error('投票行在冲突后消失，无法判定票种');

    if (existing.vote === vote) {
      const current = (await this.prisma.faqEntry.findUnique({ where: { id: entryId } })) as FaqEntry | null;
      if (!current) throw new Error('条目不存在');
      return { entry: current as unknown as FaqEntryModel, counted: false, changed: false };
    }

    const switchData =
      vote === 'helpful'
        ? { helpfulCount: { increment: 1 }, unhelpfulCount: { decrement: 1 } }
        : { unhelpfulCount: { increment: 1 }, helpfulCount: { decrement: 1 } };
    const [, updated] = await this.prisma.$transaction([
      this.prisma.faqHelpfulVote.update({
        where: { entryId_voterKey: { entryId, voterKey } },
        data: { vote },
      }),
      this.prisma.faqEntry.update({ where: { id: entryId }, data: switchData }),
    ]);
    return { entry: updated as unknown as FaqEntryModel, counted: false, changed: true };
  }

  /* ================= 工单 ================= */

  async createTicket(input: CreateFaqTicketInput): Promise<FaqTicketModel> {
    const row = await this.prisma.faqTicket.create({
      data: {
        userId: input.userId,
        contact: input.contact,
        question: input.question,
        suggestedEntryIds: input.suggestedEntryIds,
        status: 'OPEN',
      },
    });
    return row as unknown as FaqTicketModel;
  }

  async findTicketById(id: string): Promise<FaqTicketModel | null> {
    const row = await this.prisma.faqTicket.findUnique({ where: { id } });
    return row ? (row as unknown as FaqTicketModel) : null;
  }

  async listTickets(filter: { userId?: string } & ListParams): Promise<Page<FaqTicketModel>> {
    const cursorId = decodeCursor(filter.cursor);
    const rows = (await this.prisma.faqTicket.findMany({
      where: { ...(filter.userId ? { userId: filter.userId } : {}) },
      take: filter.limit + 1,
      orderBy: { id: 'asc' },
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) as FaqTicket[];
    return toPage(rows, filter.limit, (row) => row as unknown as FaqTicketModel);
  }

  async updateTicket(id: string, input: UpdateFaqTicketInput): Promise<FaqTicketModel> {
    const row = await this.prisma.faqTicket.update({ where: { id }, data: input });
    return row as unknown as FaqTicketModel;
  }
}

/** Prisma 唯一约束冲突（P2002）。用鸭子类型判定，测试里的假客户端也能触发。 */
export function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
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
