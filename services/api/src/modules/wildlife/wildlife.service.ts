/**
 * 猫鸟黑天鹅 · wildlife（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import {} from '../../common/errors/app-error';
import {
  WILDLIFE_SPOT_REPOSITORY,
  type CreateWildlifeSpotInput,
  type WildlifeSpotModel,
  type WildlifeSpotRepository,
  type UpdateWildlifeSpotInput,
} from './domain/wildlife.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class WildlifeSpotService extends CrudService<WildlifeSpotModel, CreateWildlifeSpotInput, UpdateWildlifeSpotInput> {
  constructor(
    @Inject(WILDLIFE_SPOT_REPOSITORY) private readonly repo: WildlifeSpotRepository,
  ) {
    super(repo, 'wildlife', '猫鸟黑天鹅');
  }

  /** 本模块支持匿名，忽略请求主体（契约 §9：匿名与实名解耦） */
  override async create(input: CreateWildlifeSpotInput, _actorId?: string): Promise<WildlifeSpotModel> {
    return super.create(input);
  }
  /** 领域动作：确认为有效活动点（契约 §6.1 的 POST /items/:id/confirm） */
  async confirm(id: string): Promise<WildlifeSpotModel> {
    await this.detail(id);
    return this.repo.update(id, { status: 'confirmed' } as UpdateWildlifeSpotInput);
  }
}
