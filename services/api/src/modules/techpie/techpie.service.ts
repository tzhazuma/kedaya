/**
 * TechPie 整合 · techpie（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import {
  TECHPIE_LINK_REPOSITORY,
  type CreateTechpieLinkInput,
  type TechpieLinkModel,
  type TechpieLinkRepository,
  type UpdateTechpieLinkInput,
} from './domain/techpie.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class TechpieLinkService extends CrudService<TechpieLinkModel, CreateTechpieLinkInput, UpdateTechpieLinkInput> {
  constructor(
    @Inject(TECHPIE_LINK_REPOSITORY) private readonly repo: TechpieLinkRepository,
  ) {
    super(repo, 'techpie', 'TechPie 整合');
  }

  /** 本模块支持匿名，忽略请求主体（契约 §9：匿名与实名解耦） */
  override async create(input: CreateTechpieLinkInput, _actorId?: string): Promise<TechpieLinkModel> {
    return super.create(input);
  }
  /** 领域动作：触发一次同步（契约 §6.1 的 POST /items/:id/sync） */
  async sync(id: string): Promise<TechpieLinkModel> {
    await this.detail(id);
    return this.repo.update(id, { status: 'synced' } as UpdateTechpieLinkInput);
  }
}
