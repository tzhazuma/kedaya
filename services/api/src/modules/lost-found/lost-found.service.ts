/**
 * 失物招领 · lost-found（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import {
  LOST_FOUND_ITEM_REPOSITORY,
  type CreateLostFoundItemInput,
  type LostFoundItemModel,
  type LostFoundItemRepository,
  type UpdateLostFoundItemInput,
} from './domain/lost-found.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class LostFoundItemService extends CrudService<LostFoundItemModel, CreateLostFoundItemInput, UpdateLostFoundItemInput> {
  constructor(
    @Inject(LOST_FOUND_ITEM_REPOSITORY) private readonly repo: LostFoundItemRepository,
  ) {
    super(repo, 'lost-found', '失物招领');
  }

  /**
   * 创建。reporterId 允许由请求主体补全（未登录时必须在 body 里显式给出）。
   */
  override async create(input: CreateLostFoundItemInput, actorId?: string): Promise<LostFoundItemModel> {
    const owner = input.reporterId ?? actorId;
    if (!owner) {
      throw new ValidationError('未登录时必须显式提供 reporterId', { field: 'reporterId' });
    }
    return super.create({ ...input, reporterId: owner });
  }
  /** 领域动作：标记已匹配（契约 §6.1 的 POST /items/:id/match） */
  async match(id: string): Promise<LostFoundItemModel> {
    await this.detail(id);
    return this.repo.update(id, { status: 'matched' } as UpdateLostFoundItemInput);
  }
}
