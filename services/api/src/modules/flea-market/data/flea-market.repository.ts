import { Inject, Injectable } from '@nestjs/common';
import type { FleaItem } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import type { Page } from '@kedaya/contracts';
import type {
  CreateFleaItemInput,
  FleaItemListQuery,
  FleaItemModel,
  FleaItemRepository,
  FleaStatus,
  UpdateFleaItemInput,
} from '../domain/flea-market.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 *
 * 与脚手架的默认实现（恒等映射 + 无筛选）不同，这里自己拼 `where` / `orderBy`：
 *   · 列表必须支持分类、成色、状态、关键词、发布者五类筛选 —— 这是"真实可用"的底线；
 *   · 排序要在**数据库**里做（内存排序只能对当前页生效，是错的）。
 *
 * 游标分页沿用契约 §6.1 的 `id` 游标。为避免"排序字段非唯一导致翻页跳项"，
 * 所有排序都以 `id` 作为**第二排序键**（tie-breaker）。
 */
@Injectable()
export class FleaItemPrismaRepository implements FleaItemRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: FleaItemListQuery): Promise<Page<FleaItemModel>> {
    const cursorId = decodeCursor(query.cursor);

    const where: Record<string, unknown> = {};
    if (query.category) where.category = query.category;
    if (query.condition) where.condition = query.condition;
    if (query.status) where.status = query.status;
    if (query.sellerId) where.sellerId = query.sellerId;
    if (query.keyword) {
      // 标题或描述命中即可。`mode: insensitive` 让英文大小写不敏感。
      where.OR = [
        { title: { contains: query.keyword, mode: 'insensitive' } },
        { description: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }

    const rows = (await this.prisma.fleaItem.findMany({
      where,
      take: query.limit + 1,
      orderBy: orderByFor(query.sort),
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) as FleaItem[];

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const last = visible.at(-1);

    return {
      items: visible.map(toModel),
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  }

  async create(input: CreateFleaItemInput & { sellerId: string }): Promise<FleaItemModel> {
    const row = await this.prisma.fleaItem.create({
      data: {
        sellerId: input.sellerId,
        title: input.title,
        description: input.description ?? null,
        priceFen: input.priceFen,
        category: input.category,
        condition: input.condition ?? 'good',
        campusSpot: input.campusSpot ?? null,
        status: 'on-sale',
      },
    });
    return toModel(row);
  }

  async findById(id: string): Promise<FleaItemModel | null> {
    const row = await this.prisma.fleaItem.findUnique({ where: { id } });
    return row ? toModel(row) : null;
  }

  async update(id: string, input: UpdateFleaItemInput): Promise<FleaItemModel> {
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.priceFen !== undefined) data.priceFen = input.priceFen;
    if (input.category !== undefined) data.category = input.category;
    if (input.condition !== undefined) data.condition = input.condition;
    if (input.campusSpot !== undefined) data.campusSpot = input.campusSpot;

    const row = await this.prisma.fleaItem.update({ where: { id }, data });
    return toModel(row);
  }

  async applyState(
    id: string,
    patch: { status: FleaStatus; reservedById?: string | null; soldAt?: Date | null },
  ): Promise<FleaItemModel> {
    const data: Record<string, unknown> = { status: patch.status };
    if (patch.reservedById !== undefined) data.reservedById = patch.reservedById;
    if (patch.soldAt !== undefined) data.soldAt = patch.soldAt;

    const row = await this.prisma.fleaItem.update({ where: { id }, data });
    return toModel(row);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.fleaItem.delete({ where: { id } });
  }
}

function orderByFor(sort: FleaItemListQuery['sort']): Record<string, 'asc' | 'desc'>[] {
  switch (sort) {
    case 'price-asc':
      return [{ priceFen: 'asc' }, { id: 'asc' }];
    case 'price-desc':
      return [{ priceFen: 'desc' }, { id: 'desc' }];
    case 'latest':
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}

function toModel(row: FleaItem): FleaItemModel {
  return {
    id: row.id,
    sellerId: row.sellerId,
    title: row.title,
    description: row.description,
    priceFen: row.priceFen,
    category: row.category,
    condition: row.condition,
    campusSpot: row.campusSpot,
    status: row.status,
    reservedById: row.reservedById,
    soldAt: row.soldAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
