/**
 * 拼单 · groupbuy（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { GroupbuyOrder } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateGroupbuyOrderInput,
  GroupbuyOrderModel,
  GroupbuyOrderRepository,
  UpdateGroupbuyOrderInput,
} from '../domain/groupbuy.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 * 输入字段名与 Prisma 字段一一对应，因此直接复用基类的恒等映射。
 */
@Injectable()
export class GroupbuyOrderPrismaRepository
  extends PrismaCursorRepository<GroupbuyOrder, GroupbuyOrderModel, CreateGroupbuyOrderInput, UpdateGroupbuyOrderInput>
  implements GroupbuyOrderRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.groupbuyOrder);
  }

  /** 参团：幂等 upsert 到 GroupbuyMember 关联表 */
  async join(orderId: string, userId: string, quantity: number): Promise<{ memberId: string; quantity: number }> {
    const member = await this.prisma.groupbuyMember.upsert({
      where: { orderId_userId: { orderId, userId } },
      create: { orderId, userId, quantity },
      update: { quantity },
      select: { id: true, quantity: true },
    });
    return { memberId: member.id, quantity: member.quantity };
  }

  /** 当前参团人数（用于成团判定） */
  memberCount(orderId: string): Promise<number> {
    return this.prisma.groupbuyMember.count({ where: { orderId } });
  }}
