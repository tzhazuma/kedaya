import { Inject, Injectable } from '@nestjs/common';
import type { GroupbuyMember, GroupbuyOrder } from '@prisma/client';
import type { Page } from '@kedaya/contracts';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateGroupbuyOrderInput,
  GroupbuyMemberRef,
  GroupbuyOrderListQuery,
  GroupbuyOrderModel,
  GroupbuyOrderRepository,
  GroupbuyOrderView,
  GroupbuyParticipantView,
  UpdateGroupbuyOrderInput,
} from '../domain/groupbuy.domain';
import { deriveGroupbuyStatus } from '../domain/groupbuy-status';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 *
 * 为什么不用脚手架基类的 `list`：它既不支持筛选也不支持排序，
 * 而拼单列表必须能按分类/关键词筛、按"最新/即将截止"排 —— 内存排序只能对
 * 当前页生效，是错的（翻页会重复/跳项）。
 *
 * 视图组装（参与者 + 发起人昵称）刻意用**三次批量查询**而不是 N+1：
 *   1. 取一页订单；
 *   2. 一次取回这些订单的全部成员；
 *   3. 一次取回这些成员的用户昵称。
 * `GroupbuyMember` 表没有指向 `User` 的外键（脚手架生成的形状如此），
 * 所以第 3 步必须单独查；批量查让这一步对任意页大小都是常数次。
 */
@Injectable()
export class GroupbuyOrderPrismaRepository implements GroupbuyOrderRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: GroupbuyOrderListQuery): Promise<Page<GroupbuyOrderView>> {
    const cursorId = decodeCursor(query.cursor);
    const where = buildWhere(query);

    const rows = await this.prisma.groupbuyOrder.findMany({
      where,
      take: query.limit + 1,
      orderBy: orderByFor(query.sort),
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const last = visible.at(-1);

    const views = await this.assemble(visible);

    return {
      items: views,
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  }

  async findById(id: string): Promise<GroupbuyOrderView | null> {
    const row = await this.prisma.groupbuyOrder.findUnique({ where: { id } });
    if (!row) return null;
    const [view] = await this.assemble([row]);
    return view ?? null;
  }

  async create(input: CreateGroupbuyOrderInput & { ownerId: string }): Promise<GroupbuyOrderModel> {
    // 发起人**同时是一条参团记录**（role=owner）。
    // 这样"已凑份数"的口径只有一个：成员表。否则列表要写
    // 「1 + 成员数」，很容易和详情页的算法不一致。
    const row = await this.prisma.groupbuyOrder.create({
      data: {
        ownerId: input.ownerId,
        title: input.title,
        description: input.description ?? null,
        category: input.category,
        targetCount: input.targetCount,
        unitPriceFen: input.unitPriceFen,
        status: 'open',
        deadline: input.deadline,
        pickupSpot: input.pickupSpot ?? null,
        members: {
          create: { userId: input.ownerId, quantity: 1, role: 'owner' },
        },
      },
    });
    return toModel(row);
  }

  async update(id: string, input: UpdateGroupbuyOrderInput): Promise<GroupbuyOrderModel> {
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.category !== undefined) data.category = input.category;
    if (input.targetCount !== undefined) data.targetCount = input.targetCount;
    if (input.unitPriceFen !== undefined) data.unitPriceFen = input.unitPriceFen;
    if (input.deadline !== undefined) data.deadline = input.deadline;
    if (input.pickupSpot !== undefined) data.pickupSpot = input.pickupSpot;

    const row = await this.prisma.groupbuyOrder.update({ where: { id }, data });
    return toModel(row);
  }

  async setStatus(id: string, status: string): Promise<void> {
    await this.prisma.groupbuyOrder.update({ where: { id }, data: { status } });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.groupbuyOrder.delete({ where: { id } });
  }

  async join(
    orderId: string,
    userId: string,
    quantity: number,
  ): Promise<{ memberId: string; quantity: number }> {
    const member = await this.prisma.groupbuyMember.upsert({
      where: { orderId_userId: { orderId, userId } },
      create: { orderId, userId, quantity, role: 'member' },
      update: { quantity },
    });
    return { memberId: member.id, quantity: member.quantity };
  }

  async listMembers(orderId: string): Promise<GroupbuyMemberRef[]> {
    const rows = await this.prisma.groupbuyMember.findMany({
      where: { orderId },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      select: { userId: true, role: true },
    });
    return rows.map((row) => ({ userId: row.userId, role: row.role }));
  }

  /** 订单行 → 对外视图（含参与者与发起人昵称） */
  private async assemble(rows: readonly GroupbuyOrder[]): Promise<GroupbuyOrderView[]> {
    if (rows.length === 0) return [];

    const orderIds = rows.map((row) => row.id);
    const members = await this.prisma.groupbuyMember.findMany({
      where: { orderId: { in: orderIds } },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    });

    const userIds = new Set<string>();
    for (const row of rows) userIds.add(row.ownerId);
    for (const member of members) userIds.add(member.userId);

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, displayName: true },
    });
    const names = new Map(users.map((user) => [user.id, user.displayName]));

    const membersByOrder = new Map<string, GroupbuyMember[]>();
    for (const member of members) {
      const bucket = membersByOrder.get(member.orderId);
      if (bucket) bucket.push(member);
      else membersByOrder.set(member.orderId, [member]);
    }

    const now = new Date();
    return rows.map((row) => {
      const own = membersByOrder.get(row.id) ?? [];
      const participants: GroupbuyParticipantView[] = own.map((member) => ({
        id: member.userId,
        displayName: names.get(member.userId) ?? '同学',
        quantity: member.quantity,
        joinedAt: member.joinedAt,
      }));

      return {
        id: row.id,
        title: row.title,
        description: row.description,
        category: row.category,
        initiatorId: row.ownerId,
        initiatorName: names.get(row.ownerId) ?? '同学',
        priceFen: row.unitPriceFen,
        targetCount: row.targetCount,
        participants,
        deadline: row.deadline,
        pickupPlace: row.pickupSpot,
        status: deriveGroupbuyStatus({
          storedStatus: row.status,
          deadline: row.deadline,
          joinedQuantity: participants.reduce((sum, item) => sum + item.quantity, 0),
          targetCount: row.targetCount,
          now,
        }),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }
}

function buildWhere(query: GroupbuyOrderListQuery): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (query.category) where.category = query.category;

  if (query.keyword) {
    where.OR = [
      { title: { contains: query.keyword, mode: 'insensitive' } },
      { description: { contains: query.keyword, mode: 'insensitive' } },
    ];
  }

  if (query.mine) {
    const { userId, role } = query.mine;
    // 「我参与的」刻意排除自己发起的：否则同一张单会在两个标签页里各出现一次，
    // 用户会以为重复了。
    const mineClause =
      role === 'owner'
        ? { ownerId: userId }
        : { members: { some: { userId, role: { not: 'owner' } } } };
    where.AND = [mineClause];
  }

  return where;
}

function orderByFor(sort: GroupbuyOrderListQuery['sort']): Record<string, 'asc' | 'desc'>[] {
  // 都以 id 作为第二排序键：排序字段非唯一会导致翻页跳项。
  if (sort === 'deadline') return [{ deadline: 'asc' }, { id: 'asc' }];
  return [{ createdAt: 'desc' }, { id: 'desc' }];
}

function toModel(row: GroupbuyOrder): GroupbuyOrderModel {
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    description: row.description,
    category: row.category,
    targetCount: row.targetCount,
    unitPriceFen: row.unitPriceFen,
    status: row.status,
    deadline: row.deadline,
    pickupSpot: row.pickupSpot,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
