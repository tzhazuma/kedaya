/**
 * 校园卡 · campus-card（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import { CampusBindingRequiredError } from '../../common/errors/app-error';
import { CAMPUS_SESSION_PORT, type CampusSessionPort } from '../techpie/domain/ports/campus-session.port';
import {
  CAMPUS_CARD_TRANSACTION_REPOSITORY,
  type CreateCampusCardTransactionInput,
  type CampusCardTransactionModel,
  type CampusCardTransactionRepository,
  type UpdateCampusCardTransactionInput,
} from './domain/campus-card.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class CampusCardTransactionService extends CrudService<CampusCardTransactionModel, CreateCampusCardTransactionInput, UpdateCampusCardTransactionInput> {
  constructor(
    @Inject(CAMPUS_CARD_TRANSACTION_REPOSITORY) private readonly repo: CampusCardTransactionRepository,
    @Inject(CAMPUS_SESSION_PORT) private readonly campusSession: CampusSessionPort,
  ) {
    super(repo, 'campus-card', '校园卡');
  }

  /**
   * 创建。userId 允许由请求主体补全（未登录时必须在 body 里显式给出）。
   */
  override async create(input: CreateCampusCardTransactionInput, actorId?: string): Promise<CampusCardTransactionModel> {
    const owner = input.userId ?? actorId;
    if (!owner) {
      throw new ValidationError('未登录时必须显式提供 userId', { field: 'userId' });
    }
    return super.create({ ...input, userId: owner });
  }
  /**
   * 契约 §5 硬规则 3 的第二个落点：
   * 校园卡能力属于**第二级**，未绑定 → CAMPUS_BINDING_REQUIRED。
   * 注意本模块虽是 high 敏感，但**不设同意门**（契约 §9）。
   */
  async balanceSummary(userId: string) {
    // 校园卡走**独立的 OPENID 通道**（规格 §2.5），与 CASTGC 完全解耦 ——
    // 因此这里只需要"绑定是否 LINKED"，**不需要**任何校园会话本身。
    const binding = await this.campusSession.getBinding(userId, 'ecard');
    if (!binding || binding.status !== 'LINKED') {
      throw new CampusBindingRequiredError('请先绑定校园卡（ecard · OPENID 通道）后再查看汇总', {
        platform: 'ecard',
        status: binding?.status ?? 'UNLINKED',
      });
    }
    return this.repo.summarize(userId);
  }}
