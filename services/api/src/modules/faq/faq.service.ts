/**
 * 常见问题 · faq（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import {
  FAQ_ENTRY_REPOSITORY,
  type CreateFaqEntryInput,
  type FaqEntryModel,
  type FaqEntryRepository,
  type UpdateFaqEntryInput,
} from './domain/faq.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class FaqEntryService extends CrudService<FaqEntryModel, CreateFaqEntryInput, UpdateFaqEntryInput> {
  constructor(
    @Inject(FAQ_ENTRY_REPOSITORY) private readonly repo: FaqEntryRepository,
  ) {
    super(repo, 'faq', '常见问题');
  }

  /** 本模块支持匿名，忽略请求主体（契约 §9：匿名与实名解耦） */
  override async create(input: CreateFaqEntryInput, _actorId?: string): Promise<FaqEntryModel> {
    return super.create(input);
  }
  /** 领域动作：标记有用 */
  async markHelpful(id: string): Promise<FaqEntryModel> {
    await this.detail(id);
    return this.repo.markHelpful(id);
  }}
