/**
 * 拼单 · groupbuy（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import { ConflictError } from '../../common/errors/app-error';
import {
  GROUPBUY_ORDER_REPOSITORY,
  type CreateGroupbuyOrderInput,
  type GroupbuyOrderModel,
  type GroupbuyOrderRepository,
  type UpdateGroupbuyOrderInput,
} from './domain/groupbuy.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class GroupbuyOrderService extends CrudService<GroupbuyOrderModel, CreateGroupbuyOrderInput, UpdateGroupbuyOrderInput> {
  constructor(
    @Inject(GROUPBUY_ORDER_REPOSITORY) private readonly repo: GroupbuyOrderRepository,
  ) {
    super(repo, 'groupbuy', '拼单');
  }

  /**
   * 创建。ownerId 允许由请求主体补全（未登录时必须在 body 里显式给出）。
   */
  override async create(input: CreateGroupbuyOrderInput, actorId?: string): Promise<GroupbuyOrderModel> {
    const owner = input.ownerId ?? actorId;
    if (!owner) {
      throw new ValidationError('未登录时必须显式提供 ownerId', { field: 'ownerId' });
    }
    return super.create({ ...input, ownerId: owner });
  }
  /**
   * 领域动作：参团（契约 §6.1 的 POST /items/:id/join）。
   *
   * 真实业务：写入 GroupbuyMember，并按参团人数把订单状态推进到 grouped。
   * 这是 groupbuy 模块的核心用例，单元测试覆盖了它（见 groupbuy.service.spec.ts）。
   */
  async join(id: string, userId: string, quantity: number) {
    const order = await this.detail(id);

    if (order.status !== 'open') {
      throw new ConflictError('该拼单已结束，无法参团', { status: order.status });
    }

    const member = await this.repo.join(id, userId, quantity);
    const totalMembers = await this.repo.memberCount(id);
    const status = totalMembers >= order.targetCount ? 'grouped' : 'open';

    if (status !== order.status) {
      await this.repo.update(id, { status });
    }

    return {
      orderId: id,
      memberId: member.memberId,
      quantity: member.quantity,
      totalMembers,
      targetCount: order.targetCount,
      status,
    };
  }}
