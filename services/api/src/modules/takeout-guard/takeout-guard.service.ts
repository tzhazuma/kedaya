/**
 * 偷外卖 · takeout-guard（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import {
  TAKEOUT_REPORT_REPOSITORY,
  type CreateTakeoutReportInput,
  type TakeoutReportModel,
  type TakeoutReportRepository,
  type UpdateTakeoutReportInput,
} from './domain/takeout-guard.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class TakeoutReportService extends CrudService<TakeoutReportModel, CreateTakeoutReportInput, UpdateTakeoutReportInput> {
  constructor(
    @Inject(TAKEOUT_REPORT_REPOSITORY) private readonly repo: TakeoutReportRepository,
  ) {
    super(repo, 'takeout-guard', '偷外卖');
  }

  /** 本模块支持匿名，忽略请求主体（契约 §9：匿名与实名解耦） */
  override async create(input: CreateTakeoutReportInput, _actorId?: string): Promise<TakeoutReportModel> {
    return super.create(input);
  }
  /** 领域动作：升级为协商中（契约 §6.1 的 POST /items/:id/escalate） */
  async escalate(id: string): Promise<TakeoutReportModel> {
    await this.detail(id);
    return this.repo.update(id, { status: 'escalated' } as UpdateTakeoutReportInput);
  }
}
