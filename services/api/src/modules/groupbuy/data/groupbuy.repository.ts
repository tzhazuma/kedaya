import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../common/errors/app-error';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateGroupbuyOrderInput,
  GroupbuyOrderModel,
  GroupbuyOrderRepository,
  GroupbuyListParams,
  MemberChange,
  UpdateGroupbuyOrderInput,
} from '../domain/groupbuy.domain';

const include = { members: { orderBy: { joinedAt: 'asc' as const } } };
type OrderRow = Prisma.GroupbuyOrderGetPayload<{ include: typeof include }>;

function toModel(row: OrderRow): GroupbuyOrderModel {
  const members = row.members.map((member) => ({
    id: member.id,
    userId: member.userId,
    displayName: member.displayName,
    quantity: member.quantity,
    note: member.note,
    joinedAt: member.joinedAt,
    receivedAt: member.receivedAt,
    selections: parseSelections(member.selectionsJson, row.itemOptions[0] ?? row.itemSpec ?? row.title, member.quantity),
  }));
  return {
    ...row,
    status: row.status as GroupbuyOrderModel['status'],
    kind: row.kind as GroupbuyOrderModel['kind'],
    members,
    joinedQuantity: members.reduce((sum, member) => sum + member.quantity, 0),
    participantCount: members.length,
  };
}

function parseSelections(raw: string, fallbackItem: string, quantity: number): Array<{ item: string; quantity: number }> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as Array<{ item: string; quantity: number }>;
  } catch { /* old/corrupt records use the denormalized quantity */ }
  return [{ item: fallbackItem, quantity }];
}

@Injectable()
export class GroupbuyOrderPrismaRepository implements GroupbuyOrderRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async expireDue(now: Date): Promise<number> {
    const result = await this.prisma.groupbuyOrder.updateMany({
      where: { status: 'open', deadline: { lte: now } },
      data: { status: 'cancelled', cancelReason: 'TIMEOUT_24H' },
    });
    return result.count;
  }

  async list({ cursor, limit, category, keyword, kind }: GroupbuyListParams) {
    const id = decodeCursor(cursor);
    const rows = await this.prisma.groupbuyOrder.findMany({
      include,
      where: {
        ...(category ? { category } : {}),
        ...(kind ? { kind } : {}),
        ...(keyword ? { OR: [
          { title: { contains: keyword, mode: 'insensitive' as const } },
          { description: { contains: keyword, mode: 'insensitive' as const } },
          { pickupSpot: { contains: keyword, mode: 'insensitive' as const } },
        ] } : {}),
      },
      take: limit + 1,
      orderBy: { id: 'asc' },
      ...(id ? { cursor: { id }, skip: 1 } : {}),
    });
    const visible = rows.slice(0, limit);
    const last = visible.at(-1);
    return {
      items: visible.map(toModel),
      nextCursor: rows.length > limit && last ? encodeCursor(last.id) : null,
    };
  }

  async create(input: CreateGroupbuyOrderInput & { ownerId: string; deadline: Date; clientKey?: string }) {
    const existing = input.clientKey ? await this.prisma.groupbuyOrder.findUnique({ where: { clientKey: input.clientKey }, include }) : null;
    if (existing) {
      if (existing.ownerId !== input.ownerId) throw new ConflictError('幂等键已被其他账号使用');
      return toModel(existing);
    }
    try {
      const row = await this.prisma.groupbuyOrder.create({
        data: {
        ownerId: input.ownerId,
        title: input.title,
        description: input.description,
        category: input.category,
        itemSpec: input.itemSpec,
        itemOptions: input.items ?? [],
        targetCount: input.targetCount,
        unitPriceFen: input.unitPriceFen ?? 0,
        pickupSpot: input.pickupSpot,
        kind: input.kind,
        merchantName: input.kind === 'membership' ? input.merchantName?.trim() : null,
        membershipDeclaration: input.kind === 'membership',
        deadline: input.deadline,
        clientKey: input.clientKey,
        },
        include,
      });
      return toModel(row);
    } catch (error) {
      if (input.clientKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const repeated = await this.prisma.groupbuyOrder.findUnique({ where: { clientKey: input.clientKey }, include });
        if (repeated?.ownerId === input.ownerId) return toModel(repeated);
      }
      throw error;
    }
  }

  async findById(id: string) {
    const row = await this.prisma.groupbuyOrder.findUnique({ where: { id }, include });
    return row ? toModel(row) : null;
  }

  private async locked(tx: Prisma.TransactionClient, id: string): Promise<OrderRow> {
    await tx.$queryRaw`SELECT id FROM "GroupbuyOrder" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.groupbuyOrder.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundError('拼单不存在');
    return row;
  }

  private async active(tx: Prisma.TransactionClient, row: OrderRow): Promise<OrderRow> {
    if (row.status !== 'open') throw new ConflictError('该拼单已结束');
    if (row.deadline.getTime() > Date.now()) return row;
    return tx.groupbuyOrder.update({
      where: { id: row.id },
      data: { status: 'cancelled', cancelReason: 'TIMEOUT_24H' },
      include,
    });
  }

  async updateOwned(id: string, ownerId: string, input: UpdateGroupbuyOrderInput) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.locked(tx, id);
      if (row.ownerId !== ownerId) throw new ForbiddenError('只有发起人可以修改拼单');
      const active = await this.active(tx, row);
      if (active.status !== 'open') return toModel(active);
      const joined = active.members.reduce((sum, member) => sum + member.quantity, 0);
      if (input.targetCount !== undefined && input.targetCount < joined) {
        throw new ConflictError('目标份数不能低于已登记份数');
      }
      const updated = await tx.groupbuyOrder.update({ where: { id }, data: input, include });
      if (joined >= updated.targetCount) {
        return toModel(await tx.groupbuyOrder.update({ where: { id }, data: { status: 'grouped' }, include }));
      }
      return toModel(updated);
    });
  }

  async cancelOwned(id: string, ownerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.locked(tx, id);
      if (row.ownerId !== ownerId) throw new ForbiddenError('只有发起人可以取消拼单');
      const active = await this.active(tx, row);
      if (active.status !== 'open') return toModel(active);
      return toModel(await tx.groupbuyOrder.update({
        where: { id }, data: { status: 'cancelled', cancelReason: 'CREATOR_CANCELLED' }, include,
      }));
    });
  }

  async changeMember(id: string, userId: string, input: MemberChange) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.locked(tx, id);
      const active = await this.active(tx, row);
      if (active.status !== 'open') return toModel(active);
      const previous = active.members.find((member) => member.userId === userId);
      if (input.quantity === 0 && !previous) throw new ConflictError('你尚未登记该拼单');
      const selections = input.quantity === 0 ? [] : input.selections ?? [{ item: active.itemOptions[0] ?? active.itemSpec ?? active.title, quantity: input.quantity }];
      const options = active.itemOptions.length > 0 ? active.itemOptions : [active.itemSpec ?? active.title];
      if (input.quantity > 0 && (
        selections.reduce((sum, line) => sum + line.quantity, 0) !== input.quantity ||
        new Set(selections.map((line) => line.item)).size !== selections.length ||
        selections.some((line) => !options.includes(line.item) || !Number.isInteger(line.quantity) || line.quantity < 1)
      )) throw new ValidationError('商品及份数不符合该拼单的商品清单');
      const otherQuantity = active.members.reduce(
        (sum, member) => sum + (member.userId === userId ? 0 : member.quantity), 0,
      );
      if (otherQuantity + input.quantity > active.targetCount) {
        throw new ConflictError(`只剩 ${Math.max(0, active.targetCount - otherQuantity)} 份`);
      }
      if (input.quantity === 0) {
        await tx.groupbuyMember.delete({ where: { orderId_userId: { orderId: id, userId } } });
      } else {
        await tx.groupbuyMember.upsert({
          where: { orderId_userId: { orderId: id, userId } },
          create: { orderId: id, userId, quantity: input.quantity, displayName: input.displayName, note: input.note, selectionsJson: JSON.stringify(selections) },
          update: { quantity: input.quantity, displayName: input.displayName, note: input.note, selectionsJson: JSON.stringify(selections) },
        });
      }
      if (otherQuantity + input.quantity >= active.targetCount) {
        await tx.groupbuyOrder.update({ where: { id }, data: { status: 'grouped' } });
      }
      const updated = await tx.groupbuyOrder.findUniqueOrThrow({ where: { id }, include });
      return toModel(updated);
    });
  }

  async publishPickupNotice(id: string, ownerId: string, notice: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.locked(tx, id);
      if (row.ownerId !== ownerId) throw new ForbiddenError('只有发起人可以发布取货通知');
      if (row.status !== 'grouped') throw new ConflictError('成团后才能发布取货通知');
      return toModel(await tx.groupbuyOrder.update({ where: { id }, data: { pickupNotice: notice }, include }));
    });
  }

  async markReceived(id: string, ownerId: string, userId: string, received: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.locked(tx, id);
      if (row.ownerId !== ownerId) throw new ForbiddenError('只有发起人可以标记领取');
      if (row.status !== 'grouped') throw new ConflictError('成团后才能标记领取');
      if (!row.members.some((member) => member.userId === userId)) throw new NotFoundError('参团成员不存在');
      await tx.groupbuyMember.update({
        where: { orderId_userId: { orderId: id, userId } },
        data: { receivedAt: received ? new Date() : null },
      });
      return toModel(await tx.groupbuyOrder.findUniqueOrThrow({ where: { id }, include }));
    });
  }
}
