import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/compliance/audit.service';
import { ConsentService } from '../../common/compliance/consent.service';
import type { ConsentRecord } from '../../common/compliance/compliance.types';
import { NotFoundError } from '../../common/errors/app-error';
import {
  AI_PORTRAIT_MODULE_ID,
  AI_PORTRAIT_PROFILE_REPOSITORY,
  ALLOWED_PORTRAIT_SOURCES,
  FORBIDDEN_PORTRAIT_SOURCES,
  assertAllowedSources,
  type AiPortraitProfileModel,
  type AiPortraitProfileRepository,
} from './domain/ai-portrait.domain';

/**
 * AI 画像用例。
 *
 * 契约 §9 的三条要求：
 *   1. 二次同意（`requireConsent`）；
 *   2. 可解释（`explain` 字段 + `sources` 端点公开数据来源边界）；
 *   3. 可关闭（`enabled` 开关 + `PATCH /me`）；
 *   4. 数据最小化（`assertAllowedSources` 拒绝禁读域）。
 *
 * ⚠️ 未实现：真正的推荐/画像算法。本骨架只做**合规边界**与存储，
 * 不做任何"根据行为推测心理状态"的推断（那正是契约 §9 要禁止的）。
 */
@Injectable()
export class AiPortraitService {
  constructor(
    @Inject(AI_PORTRAIT_PROFILE_REPOSITORY) private readonly repo: AiPortraitProfileRepository,
    @Inject(ConsentService) private readonly consent: ConsentService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** 公开端点：把"画像能读什么、绝对不能读什么"摊开给用户看（可解释性） */
  sources() {
    return {
      module: AI_PORTRAIT_MODULE_ID,
      allowed: ALLOWED_PORTRAIT_SOURCES,
      forbidden: FORBIDDEN_PORTRAIT_SOURCES,
      rule: '契约 §9 数据最小化：心理与宿舍矛盾数据不进入通用画像',
    };
  }

  listConsents(userId: string): Promise<ConsentRecord[]> {
    return this.consent.list(userId);
  }

  async grantConsent(userId: string): Promise<ConsentRecord> {
    const record = await this.consent.grant(userId, AI_PORTRAIT_MODULE_ID);
    await this.audit.record({
      actorId: userId,
      action: 'ai-portrait.consent.grant',
      resource: 'Consent',
      resourceId: record.id,
      module: AI_PORTRAIT_MODULE_ID,
    });
    return record;
  }

  async revokeConsent(userId: string): Promise<ConsentRecord | null> {
    const record = await this.consent.revoke(userId, AI_PORTRAIT_MODULE_ID);
    await this.audit.record({
      actorId: userId,
      action: 'ai-portrait.consent.revoke',
      resource: 'Consent',
      resourceId: record?.id ?? null,
      module: AI_PORTRAIT_MODULE_ID,
    });
    return record;
  }

  async me(userId: string): Promise<AiPortraitProfileModel | null> {
    await this.consent.requireConsent(userId, AI_PORTRAIT_MODULE_ID);
    const profile = await this.repo.findByUserId(userId);
    await this.audit.record({
      actorId: userId,
      action: 'ai-portrait.profile.read',
      resource: 'AiPortraitProfile',
      resourceId: profile?.id ?? null,
      module: AI_PORTRAIT_MODULE_ID,
    });
    return profile;
  }

  /**
   * 写入/更新画像。**先校验来源**，再落库 —— 顺序很重要：
   * 非法来源必须在任何数据被写入之前就被拒绝。
   */
  async upsert(
    userId: string,
    input: {
      sources: string[];
      traits: Record<string, unknown>;
      explain: Record<string, unknown>;
      enabled?: boolean;
    },
  ): Promise<AiPortraitProfileModel> {
    await this.consent.requireConsent(userId, AI_PORTRAIT_MODULE_ID);

    // 契约 §9 护栏：拒绝 wellbeing / dorm-harmony
    assertAllowedSources(input.sources);

    const saved = await this.repo.upsertForUser(userId, {
      traits: input.traits,
      // 把来源一并写进 explain，保证"为什么给我推这个"永远可追溯
      explain: { ...input.explain, sources: input.sources },
      enabled: input.enabled ?? true,
    });

    await this.audit.record({
      actorId: userId,
      action: 'ai-portrait.profile.upsert',
      resource: 'AiPortraitProfile',
      resourceId: saved.id,
      module: AI_PORTRAIT_MODULE_ID,
      metadata: { sources: input.sources, enabled: saved.enabled },
    });
    return saved;
  }

  /** 可关闭（契约 §9）：关闭后不返回 traits */
  async setEnabled(userId: string, enabled: boolean): Promise<AiPortraitProfileModel> {
    await this.consent.requireConsent(userId, AI_PORTRAIT_MODULE_ID);
    const existing = await this.repo.findByUserId(userId);
    if (!existing) throw new NotFoundError('尚未生成画像，无法切换开关');

    const updated = await this.repo.upsertForUser(userId, {
      traits: existing.traits,
      explain: existing.explain,
      enabled,
    });

    await this.audit.record({
      actorId: userId,
      action: enabled ? 'ai-portrait.profile.enable' : 'ai-portrait.profile.disable',
      resource: 'AiPortraitProfile',
      resourceId: updated.id,
      module: AI_PORTRAIT_MODULE_ID,
    });
    return updated;
  }
}
