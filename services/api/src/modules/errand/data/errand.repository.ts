import { Inject, Injectable } from '@nestjs/common';
import type { ErrandTask } from '@prisma/client';
import type { Page } from '@kedaya/contracts';
import { PrismaService } from '../../../prisma/prisma.service';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import type {
  CreateErrandTaskInput,
  ErrandStatePatch,
  ErrandTaskListQuery,
  ErrandTaskModel,
  ErrandTaskRepository,
  UpdateErrandTaskInput,
} from '../domain/errand.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 *
 * 与脚手架的默认实现（恒等映射 + 无筛选）不同，这里自己拼 `where` / `orderBy`：
 *   · 列表支持状态、关键词、出发地、目的地、发布者、接单者六类筛选；
 *   · 排序在**数据库**里做（内存排序只能对当前页生效，是错的）。
 *
 * 游标分页沿用契约 §6.1 的 `id` 游标。为避免「排序字段非唯一导致翻页跳项」，
 * 所有排序都以 `id` 作为**第二排序键**（tie-breaker）。
 */
@Injectable()
export class ErrandTaskPrismaRepository implements ErrandTaskRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: ErrandTaskListQuery): Promise<Page<ErrandTaskModel>> {
    const cursorId = decodeCursor(query.cursor);

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.requesterId) where.requesterId = query.requesterId;
    if (query.runnerId) where.runnerId = query.runnerId;
    if (query.fromPlace) where.fromPlace = query.fromPlace;
    if (query.toPlace) where.toPlace = query.toPlace;
    if (query.keyword) {
      // 标题或明细命中即可。`mode: insensitive` 让英文大小写不敏感。
      where.OR = [
        { title: { contains: query.keyword, mode: 'insensitive' } },
        { detail: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }

    const rows = (await this.prisma.errandTask.findMany({
      where,
      take: query.limit + 1,
      orderBy: orderByFor(query.sort),
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) as ErrandTask[];

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const last = visible.at(-1);

    return {
      items: visible.map(toModel),
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  }

  async create(input: CreateErrandTaskInput & { requesterId: string }): Promise<ErrandTaskModel> {
    const row = await this.prisma.errandTask.create({
      data: {
        requesterId: input.requesterId,
        title: input.title,
        detail: input.detail ?? null,
        rewardFen: input.rewardFen,
        fromPlace: input.fromPlace,
        toPlace: input.toPlace,
        deadline: input.deadline,
        status: 'open',
      },
    });
    return toModel(row);
  }

  async findById(id: string): Promise<ErrandTaskModel | null> {
    const row = await this.prisma.errandTask.findUnique({ where: { id } });
    return row ? toModel(row) : null;
  }

  async update(id: string, input: UpdateErrandTaskInput): Promise<ErrandTaskModel> {
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.detail !== undefined) data.detail = input.detail;
    if (input.rewardFen !== undefined) data.rewardFen = input.rewardFen;
    if (input.fromPlace !== undefined) data.fromPlace = input.fromPlace;
    if (input.toPlace !== undefined) data.toPlace = input.toPlace;
    if (input.deadline !== undefined) data.deadline = input.deadline;

    const row = await this.prisma.errandTask.update({ where: { id }, data });
    return toModel(row);
  }

  async applyState(id: string, patch: ErrandStatePatch): Promise<ErrandTaskModel> {
    const data: Record<string, unknown> = { status: patch.status };
    if (patch.runnerId !== undefined) data.runnerId = patch.runnerId;
    if (patch.acceptedAt !== undefined) data.acceptedAt = patch.acceptedAt;
    if (patch.deliveredAt !== undefined) data.deliveredAt = patch.deliveredAt;
    if (patch.settledAt !== undefined) data.settledAt = patch.settledAt;

    const row = await this.prisma.errandTask.update({ where: { id }, data });
    return toModel(row);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.errandTask.delete({ where: { id } });
  }
}

function orderByFor(sort: ErrandTaskListQuery['sort']): Record<string, 'asc' | 'desc'>[] {
  switch (sort) {
    case 'reward-desc':
      return [{ rewardFen: 'desc' }, { id: 'desc' }];
    case 'deadline':
      return [{ deadline: 'asc' }, { id: 'asc' }];
    case 'latest':
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}

function toModel(row: ErrandTask): ErrandTaskModel {
  return {
    id: row.id,
    requesterId: row.requesterId,
    runnerId: row.runnerId,
    title: row.title,
    detail: row.detail,
    rewardFen: row.rewardFen,
    fromPlace: row.fromPlace,
    toPlace: row.toPlace,
    deadline: row.deadline,
    status: row.status,
    acceptedAt: row.acceptedAt,
    deliveredAt: row.deliveredAt,
    settledAt: row.settledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
