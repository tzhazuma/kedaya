/**
 * 跑腿 · errand（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import {
  ERRAND_TASK_REPOSITORY,
  type CreateErrandTaskInput,
  type ErrandTaskModel,
  type ErrandTaskRepository,
  type UpdateErrandTaskInput,
} from './domain/errand.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class ErrandTaskService extends CrudService<ErrandTaskModel, CreateErrandTaskInput, UpdateErrandTaskInput> {
  constructor(
    @Inject(ERRAND_TASK_REPOSITORY) private readonly repo: ErrandTaskRepository,
  ) {
    super(repo, 'errand', '跑腿');
  }

  /**
   * 创建。requesterId 允许由请求主体补全（未登录时必须在 body 里显式给出）。
   */
  override async create(input: CreateErrandTaskInput, actorId?: string): Promise<ErrandTaskModel> {
    const owner = input.requesterId ?? actorId;
    if (!owner) {
      throw new ValidationError('未登录时必须显式提供 requesterId', { field: 'requesterId' });
    }
    return super.create({ ...input, requesterId: owner });
  }
  /** 领域动作：接单（契约 §6.1 的 POST /items/:id/accept） */
  async accept(id: string, actorId?: string): Promise<ErrandTaskModel> {
    await this.detail(id);
    return this.repo.update(id, { status: 'accepted', runnerId: actorId ?? null } as UpdateErrandTaskInput);
  }
}
