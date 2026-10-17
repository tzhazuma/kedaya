/**
 * 常见问题 · faq（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import { CrudService } from '../../common/crud/crud.service';
import type { ListParams } from '../../common/crud/resource';
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

  /**
   * 列表：`cursor` / `limit` / `filters` 原样透传给仓储。
   *
   * 这里刻意**不**做任何"归一化"（比如把空串换成 undefined、把分类小写化）：
   * controller 已经用 Zod 收敛过一遍，中途改写会让「接口声明接受的查询」
   * 与「实际执行的查询」两处漂移，排障时最难查的就是这种静默差异。
   * 真正的字段白名单在 data 层（`PrismaCursorRepository.buildWhere`），
   * 因为只有那里知道能翻译成哪些 Prisma 字段。
   */
  override list(params: ListParams): Promise<Page<FaqEntryModel>> {
    return super.list(params);
  }

  /** 本模块支持匿名，忽略请求主体（契约 §9：匿名与实名解耦） */
  override async create(input: CreateFaqEntryInput, _actorId?: string): Promise<FaqEntryModel> {
    return super.create(input);
  }

  /**
   * 领域动作：标记有用 —— **无脑 +1**（详见 controller 上的语义说明）。
   *
   * 先 `detail(id)` 再自增，是为了让「条目不存在」表现为 404 而不是
   * Prisma 的 P2025 内部错误；同时保证计数不会挂到一个不存在的 id 上。
   */
  async markHelpful(id: string): Promise<FaqEntryModel> {
    await this.detail(id);
    return this.repo.markHelpful(id);
  }
}

