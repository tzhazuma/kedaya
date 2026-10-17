import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import {
  GROUPBUY_ORDER_REPOSITORY,
  type CreateGroupbuyOrderInput,
  type GroupbuyOrderRepository,
  type GroupbuyListParams,
  type MemberChange,
  type UpdateGroupbuyOrderInput,
} from './domain/groupbuy.domain';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class GroupbuyOrderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GroupbuyOrderService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(@Inject(GROUPBUY_ORDER_REPOSITORY) private readonly repo: GroupbuyOrderRepository) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.repo.expireDue(new Date()).catch((error: unknown) => {
        this.logger.warn(`拼单超时扫描失败：${String(error)}`);
      });
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async list(params: GroupbuyListParams) {
    await this.repo.expireDue(new Date());
    return this.repo.list(params);
  }

  async detail(id: string) {
    await this.repo.expireDue(new Date());
    const order = await this.repo.findById(id);
    if (!order) throw new NotFoundError('拼单不存在');
    return order;
  }

  create(input: CreateGroupbuyOrderInput, actorId: string, clientKey?: string) {
    if (clientKey !== undefined && (clientKey.length < 8 || clientKey.length > 120)) {
      throw new ValidationError('幂等键长度须为 8 到 120 个字符');
    }
    if (input.kind === 'membership' && (!input.merchantName?.trim() || input.membershipDeclaration !== true)) {
      throw new ValidationError('会员代购需填写商家并确认本人持有该商家会员资格');
    }
    if (input.kind === 'ordinary' && input.membershipDeclaration) {
      throw new ValidationError('普通拼单无需会员声明');
    }
    const items = input.items ?? (input.itemSpec?.trim() ? [input.itemSpec.trim()] : []);
    if (items.length === 0 || new Set(items).size !== items.length) {
      throw new ValidationError('请填写不重复的商品与规格');
    }
    const now = new Date();
    return this.repo.create({
      ...input,
      ownerId: actorId,
      deadline: new Date(now.getTime() + DAY_MS),
      unitPriceFen: input.unitPriceFen ?? 0,
      items,
      itemSpec: input.itemSpec?.trim() || items.join('、'),
      clientKey,
    });
  }

  async update(id: string, actorId: string, input: UpdateGroupbuyOrderInput) {
    if (Object.keys(input).length === 0) throw new ValidationError('没有可修改的内容');
    await this.repo.expireDue(new Date());
    const result = await this.repo.updateOwned(id, actorId, input);
    if (result.status === 'cancelled') throw new ConflictError('该拼单已取消');
    return result;
  }

  async cancel(id: string, actorId: string) {
    await this.repo.expireDue(new Date());
    const result = await this.repo.cancelOwned(id, actorId);
    if (result.cancelReason === 'TIMEOUT_24H') throw new ConflictError('该拼单已超时取消');
    return result;
  }

  async join(id: string, userId: string, input: MemberChange) {
    if (!Number.isInteger(input.quantity) || input.quantity < 1) {
      throw new ValidationError('登记份数必须是正整数');
    }
    if (input.selections && input.selections.reduce((sum, line) => sum + line.quantity, 0) !== input.quantity) {
      throw new ValidationError('各商品份数之和必须等于登记总份数');
    }
    const order = await this.repo.changeMember(id, userId, input);
    if (order.status === 'cancelled') throw new ConflictError('该拼单已取消', { reason: order.cancelReason });
    return order;
  }

  async withdraw(id: string, userId: string) {
    const order = await this.repo.changeMember(id, userId, { quantity: 0, displayName: '' });
    if (order.status === 'cancelled') throw new ConflictError('该拼单已取消', { reason: order.cancelReason });
    return order;
  }

  publishPickupNotice(id: string, actorId: string, notice: string) {
    return this.repo.publishPickupNotice(id, actorId, notice);
  }

  markReceived(id: string, actorId: string, userId: string, received: boolean) {
    return this.repo.markReceived(id, actorId, userId, received);
  }
}
