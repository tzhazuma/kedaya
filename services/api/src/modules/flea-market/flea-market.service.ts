/**
 * 跳蚤 · flea-market（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import {
  FLEA_ITEM_REPOSITORY,
  type CreateFleaItemInput,
  type FleaItemModel,
  type FleaItemRepository,
  type UpdateFleaItemInput,
} from './domain/flea-market.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class FleaItemService extends CrudService<FleaItemModel, CreateFleaItemInput, UpdateFleaItemInput> {
  constructor(
    @Inject(FLEA_ITEM_REPOSITORY) private readonly repo: FleaItemRepository,
  ) {
    super(repo, 'flea-market', '跳蚤');
  }

  /**
   * 创建。sellerId 允许由请求主体补全（未登录时必须在 body 里显式给出）。
   */
  override async create(input: CreateFleaItemInput, actorId?: string): Promise<FleaItemModel> {
    const owner = input.sellerId ?? actorId;
    if (!owner) {
      throw new ValidationError('未登录时必须显式提供 sellerId', { field: 'sellerId' });
    }
    return super.create({ ...input, sellerId: owner });
  }
  /** 领域动作：标记已预定（契约 §6.1 的 POST /items/:id/reserve） */
  async reserve(id: string): Promise<FleaItemModel> {
    await this.detail(id);
    return this.repo.update(id, { status: 'reserved' } as UpdateFleaItemInput);
  }
}
