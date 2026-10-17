import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type BuddyGroup, type BuddyMember } from '@prisma/client';
import type { Page } from '@kedaya/contracts';
import { PrismaService } from '../../../prisma/prisma.service';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import type {
  BuddyGroupListQuery,
  BuddyGroupModel,
  BuddyGroupRepository,
  BuddyMemberModel,
  BuddyMemberView,
  BuddyStatus,
  CreateBuddyGroupInput,
} from '../domain/buddy.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 *
 * 小组与成员是两张表：创建小组时用**嵌套写入**把组长塞进 `BuddyMember`，
 * 保证「小组存在但组长缺失」这种中间态不可能出现（Prisma 单条 create 是原子的）。
 *
 * 游标分页沿用契约 §6.1 的 `id` 游标，所有排序都以 `id` 作为第二排序键。
 */
@Injectable()
export class BuddyGroupPrismaRepository implements BuddyGroupRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: BuddyGroupListQuery): Promise<Page<BuddyGroupModel>> {
    const cursorId = decodeCursor(query.cursor);

    const where: Record<string, unknown> = {};
    if (query.activity) where.activity = query.activity;
    if (query.status) where.status = query.status;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.joinedUserId) where.members = { some: { userId: query.joinedUserId } };
    // 「只看未开始」由前端开关控制，服务端默认不筛掉已开始的小组
    if (query.onlyUpcoming) where.startsAt = { gte: new Date() };
    if (query.keyword) {
      where.OR = [
        { title: { contains: query.keyword, mode: 'insensitive' } },
        { description: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }

    const rows = (await this.prisma.buddyGroup.findMany({
      where,
      take: query.limit + 1,
      orderBy: orderByFor(query.sort),
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) as BuddyGroup[];

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const last = visible.at(-1);

    return {
      items: visible.map(toModel),
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  }

  async create(input: CreateBuddyGroupInput & { ownerId: string }): Promise<BuddyGroupModel> {
    const row = await this.prisma.buddyGroup.create({
      data: {
        ownerId: input.ownerId,
        activity: input.activity,
        title: input.title,
        description: input.description ?? null,
        campusSpot: input.campusSpot,
        startsAt: input.startsAt,
        capacity: input.capacity,
        status: 'recruiting',
        // 组长同时是成员：一次写入，避免出现「没有组长的搭子」
        members: { create: { userId: input.ownerId, role: 'owner' } },
      },
    });
    return toModel(row);
  }

  async findById(id: string): Promise<BuddyGroupModel | null> {
    const row = await this.prisma.buddyGroup.findUnique({ where: { id } });
    return row ? toModel(row) : null;
  }

  async applyState(id: string, status: BuddyStatus): Promise<BuddyGroupModel> {
    const row = await this.prisma.buddyGroup.update({ where: { id }, data: { status } });
    return toModel(row);
  }

  async listMembers(groupId: string): Promise<BuddyMemberView[]> {
    const rows = await this.prisma.buddyMember.findMany({
      where: { groupId },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      include: { user: { select: { displayName: true, avatarUrl: true } } },
    });
    return rows.map(toMemberView);
  }

  async findMembership(groupId: string, userId: string): Promise<BuddyMemberModel | null> {
    const row = await this.prisma.buddyMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    return row ? toMemberModel(row) : null;
  }

  async addMember(
    groupId: string,
    userId: string,
    role: string,
  ): Promise<BuddyMemberModel | null> {
    try {
      const row = await this.prisma.buddyMember.create({ data: { groupId, userId, role } });
      return toMemberModel(row);
    } catch (error) {
      // P2002 = 唯一约束冲突（同一人重复加入）。返回 null 让服务层翻成 CONFLICT，
      // 而不是把 Prisma 的错误码泄漏到领域层。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    // deleteMany 对「本来就不在组里」是幂等的，避免竞态下抛 P2025
    await this.prisma.buddyMember.deleteMany({ where: { groupId, userId } });
  }

  countMembers(groupId: string): Promise<number> {
    return this.prisma.buddyMember.count({ where: { groupId } });
  }
}

function orderByFor(sort: BuddyGroupListQuery['sort']): Record<string, 'asc' | 'desc'>[] {
  switch (sort) {
    case 'soon':
      return [{ startsAt: 'asc' }, { id: 'asc' }];
    case 'latest':
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}

function toModel(row: BuddyGroup): BuddyGroupModel {
  return {
    id: row.id,
    ownerId: row.ownerId,
    activity: row.activity,
    title: row.title,
    description: row.description,
    campusSpot: row.campusSpot,
    startsAt: row.startsAt,
    capacity: row.capacity,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMemberModel(row: BuddyMember): BuddyMemberModel {
  return {
    id: row.id,
    groupId: row.groupId,
    userId: row.userId,
    role: row.role,
    joinedAt: row.joinedAt,
  };
}

function toMemberView(row: BuddyMember & { user: { displayName: string; avatarUrl: string | null } }): BuddyMemberView {
  return {
    userId: row.userId,
    role: row.role,
    joinedAt: row.joinedAt,
    displayName: row.user.displayName,
    avatarUrl: row.user.avatarUrl,
  };
}
