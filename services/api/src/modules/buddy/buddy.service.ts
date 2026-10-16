/**
 * 找搭子 · buddy（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import {
  BUDDY_GROUP_REPOSITORY,
  type CreateBuddyGroupInput,
  type BuddyGroupModel,
  type BuddyGroupRepository,
  type UpdateBuddyGroupInput,
} from './domain/buddy.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class BuddyGroupService extends CrudService<BuddyGroupModel, CreateBuddyGroupInput, UpdateBuddyGroupInput> {
  constructor(
    @Inject(BUDDY_GROUP_REPOSITORY) private readonly repo: BuddyGroupRepository,
  ) {
    super(repo, 'buddy', '找搭子');
  }

  /**
   * 创建。ownerId 允许由请求主体补全（未登录时必须在 body 里显式给出）。
   */
  override async create(input: CreateBuddyGroupInput, actorId?: string): Promise<BuddyGroupModel> {
    const owner = input.ownerId ?? actorId;
    if (!owner) {
      throw new ValidationError('未登录时必须显式提供 ownerId', { field: 'ownerId' });
    }
    return super.create({ ...input, ownerId: owner });
  }
  /** 领域动作：结束招募（契约 §6.1 的 POST /items/:id/close） */
  async close(id: string): Promise<BuddyGroupModel> {
    await this.detail(id);
    return this.repo.update(id, { status: 'closed' } as UpdateBuddyGroupInput);
  }
}
