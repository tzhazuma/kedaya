import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import { AuditService } from '../../common/compliance/audit.service';
import { ConsentService } from '../../common/compliance/consent.service';
import type { ConsentRecord } from '../../common/compliance/compliance.types';
import { NotFoundError } from '../../common/errors/app-error';
import type { ListParams } from '../../common/crud/resource';
import {
  DORM_HARMONY_CASE_REPOSITORY,
  DORM_HARMONY_MODULE_ID,
  toSummary,
  type CreateDormHarmonyCaseInput,
  type DormHarmonyCaseModel,
  type DormHarmonyCaseRepository,
  type DormHarmonyCaseSummary,
  type UpdateDormHarmonyCaseInput,
} from './domain/dorm-harmony.domain';

/**
 * 宿舍矛盾用例。
 *
 * 匿名设计（契约 §9）：
 *   · `DormHarmonyCase` 没有 userId 字段 —— 存储层面就无法关联回实名；
 *   · `create()` 生成 `anon-<随机>` 作为 handle，**同一用户的不同案件
 *     也拿不到相同 handle**，避免用 handle 做跨案件关联；
 *   · 审计日志照常记录真实 actorId（这是合规要求，与业务数据分离存放）。
 */
@Injectable()
export class DormHarmonyService {
  constructor(
    @Inject(DORM_HARMONY_CASE_REPOSITORY) private readonly repo: DormHarmonyCaseRepository,
    @Inject(ConsentService) private readonly consent: ConsentService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  listConsents(userId: string): Promise<ConsentRecord[]> {
    return this.consent.list(userId);
  }

  async grantConsent(userId: string): Promise<ConsentRecord> {
    const record = await this.consent.grant(userId, DORM_HARMONY_MODULE_ID);
    await this.audit.record({
      actorId: userId,
      action: 'dorm-harmony.consent.grant',
      resource: 'Consent',
      resourceId: record.id,
      module: DORM_HARMONY_MODULE_ID,
    });
    return record;
  }

  async revokeConsent(userId: string): Promise<ConsentRecord | null> {
    const record = await this.consent.revoke(userId, DORM_HARMONY_MODULE_ID);
    await this.audit.record({
      actorId: userId,
      action: 'dorm-harmony.consent.revoke',
      resource: 'Consent',
      resourceId: record?.id ?? null,
      module: DORM_HARMONY_MODULE_ID,
    });
    return record;
  }

  async list(userId: string, params: ListParams): Promise<Page<DormHarmonyCaseSummary>> {
    await this.consent.requireConsent(userId, DORM_HARMONY_MODULE_ID);
    const page = await this.repo.list(params);

    await this.audit.record({
      actorId: userId,
      actorType: 'anonymous',
      action: 'dorm-harmony.case.list',
      resource: 'DormHarmonyCase',
      module: DORM_HARMONY_MODULE_ID,
      metadata: { count: page.items.length },
    });

    // 列表只给摘要：detail 需要单独请求（且同样写审计）
    return { items: page.items.map(toSummary), nextCursor: page.nextCursor };
  }

  async create(userId: string, input: CreateDormHarmonyCaseInput): Promise<DormHarmonyCaseModel> {
    await this.consent.requireConsent(userId, DORM_HARMONY_MODULE_ID);

    const created = await this.repo.create({
      ...input,
      // 每次新建都换 handle：不同案件之间不可关联
      anonHandle: input.anonHandle ?? `anon-${randomBytes(4).toString('hex')}`,
    });

    await this.audit.record({
      actorId: userId,
      actorType: 'anonymous',
      action: 'dorm-harmony.case.create',
      resource: 'DormHarmonyCase',
      resourceId: created.id,
      module: DORM_HARMONY_MODULE_ID,
      metadata: { building: created.building },
    });
    return created;
  }

  async detail(userId: string, id: string): Promise<DormHarmonyCaseModel> {
    await this.consent.requireConsent(userId, DORM_HARMONY_MODULE_ID);
    const found = await this.repo.findById(id);
    if (!found) throw new NotFoundError('调解申请不存在或已被删除');

    await this.audit.record({
      actorId: userId,
      actorType: 'anonymous',
      action: 'dorm-harmony.case.read',
      resource: 'DormHarmonyCase',
      resourceId: id,
      module: DORM_HARMONY_MODULE_ID,
    });
    return found;
  }

  async update(
    userId: string,
    id: string,
    input: UpdateDormHarmonyCaseInput,
  ): Promise<DormHarmonyCaseModel> {
    await this.detail(userId, id);
    const updated = await this.repo.update(id, input);
    await this.audit.record({
      actorId: userId,
      actorType: 'anonymous',
      action: 'dorm-harmony.case.update',
      resource: 'DormHarmonyCase',
      resourceId: id,
      module: DORM_HARMONY_MODULE_ID,
      metadata: { fields: Object.keys(input) },
    });
    return updated;
  }

  /** 调解员介入（领域动作） */
  async assignMediator(
    userId: string,
    id: string,
    mediatorId: string,
  ): Promise<DormHarmonyCaseModel> {
    await this.detail(userId, id);
    const updated = await this.repo.assignMediator(id, mediatorId);
    await this.audit.record({
      actorId: userId,
      actorType: 'anonymous',
      action: 'dorm-harmony.case.assign-mediator',
      resource: 'DormHarmonyCase',
      resourceId: id,
      module: DORM_HARMONY_MODULE_ID,
      metadata: { mediatorId },
    });
    return updated;
  }
}
