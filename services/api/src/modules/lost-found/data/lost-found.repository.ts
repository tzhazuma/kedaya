import { Inject, Injectable } from '@nestjs/common';
import type { LostFoundItem } from '@prisma/client';
import type { Page } from '@kedaya/contracts';
import { PrismaService } from '../../../prisma/prisma.service';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import type {
  CreateLostFoundItemInput,
  LostFoundItemListQuery,
  LostFoundItemModel,
  LostFoundItemRepository,
  LostFoundStatePatch,
  UpdateLostFoundItemInput,
} from '../domain/lost-found.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 *
 * 与脚手架的默认实现不同，这里自己拼 `where` / `orderBy`：
 *   · 列表支持类型、状态、关键词、地点、发布者五类筛选；
 *   · 排序在数据库里做，且以 `id` 作为第二排序键避免翻页跳项。
 */
@Injectable()
export class LostFoundItemPrismaRepository implements LostFoundItemRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: LostFoundItemListQuery): Promise<Page<LostFoundItemModel>> {
    const cursorId = decodeCursor(query.cursor);

    const where: Record<string, unknown> = {};
    if (query.kind) where.kind = query.kind;
    if (query.status) where.status = query.status;
    if (query.reporterId) where.reporterId = query.reporterId;
    if (query.place) where.place = { contains: query.place, mode: 'insensitive' };
    if (query.keyword) {
      where.OR = [
        { title: { contains: query.keyword, mode: 'insensitive' } },
        { description: { contains: query.keyword, mode: 'insensitive' } },
        { place: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }

    const rows = (await this.prisma.lostFoundItem.findMany({
      where,
      take: query.limit + 1,
      orderBy: orderByFor(query.sort),
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) as LostFoundItem[];

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const last = visible.at(-1);

    return {
      items: visible.map(toModel),
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  }

  async create(input: CreateLostFoundItemInput & { reporterId: string }): Promise<LostFoundItemModel> {
    const row = await this.prisma.lostFoundItem.create({
      data: {
        reporterId: input.reporterId,
        kind: input.kind,
        title: input.title,
        description: input.description ?? null,
        place: input.place,
        happenedAt: input.happenedAt,
        contactHint: input.contactHint ?? null,
        imageUrls: input.imageUrls ?? [],
        status: 'open',
      },
    });
    return toModel(row);
  }

  async findById(id: string): Promise<LostFoundItemModel | null> {
    const row = await this.prisma.lostFoundItem.findUnique({ where: { id } });
    return row ? toModel(row) : null;
  }

  async update(id: string, input: UpdateLostFoundItemInput): Promise<LostFoundItemModel> {
    const data: Record<string, unknown> = {};
    if (input.kind !== undefined) data.kind = input.kind;
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.place !== undefined) data.place = input.place;
    if (input.happenedAt !== undefined) data.happenedAt = input.happenedAt;
    if (input.contactHint !== undefined) data.contactHint = input.contactHint;
    if (input.imageUrls !== undefined) data.imageUrls = input.imageUrls;

    const row = await this.prisma.lostFoundItem.update({ where: { id }, data });
    return toModel(row);
  }

  async applyStatus(id: string, patch: LostFoundStatePatch): Promise<LostFoundItemModel> {
    const data: Record<string, unknown> = { status: patch.status };
    if (patch.resolvedAt !== undefined) data.resolvedAt = patch.resolvedAt;

    const row = await this.prisma.lostFoundItem.update({ where: { id }, data });
    return toModel(row);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.lostFoundItem.delete({ where: { id } });
  }
}

function orderByFor(sort: LostFoundItemListQuery['sort']): Record<string, 'asc' | 'desc'>[] {
  switch (sort) {
    case 'oldest':
      return [{ happenedAt: 'asc' }, { id: 'asc' }];
    case 'latest':
    default:
      return [{ happenedAt: 'desc' }, { id: 'desc' }];
  }
}

function toModel(row: LostFoundItem): LostFoundItemModel {
  return {
    id: row.id,
    reporterId: row.reporterId,
    kind: row.kind,
    title: row.title,
    description: row.description,
    place: row.place,
    happenedAt: row.happenedAt,
    contactHint: row.contactHint,
    imageUrls: row.imageUrls,
    status: row.status,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
