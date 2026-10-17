import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Page } from '@kedaya/contracts';
import { AuditService } from '../../common/compliance/audit.service';
import { ConsentService } from '../../common/compliance/consent.service';
import type { ConsentRecord } from '../../common/compliance/compliance.types';
import { NotFoundError } from '../../common/errors/app-error';
import type { ListParams } from '../../common/crud/resource';
import {
  WELLBEING_APPOINTMENT_REPOSITORY,
  WELLBEING_MODULE_ID,
  type CrisisLine,
  type WellbeingAppointmentDraft,
  type UpdateWellbeingAppointmentInput,
  type WellbeingAppointmentModel,
  type WellbeingAppointmentRepository,
} from './domain/wellbeing.domain';

/**
 * 心理治疗用例（契约 §9 的四个硬约束都落在这个文件里）：
 *
 *   1. **二次同意**：所有涉及预约数据的读写先 `requireConsent()`，
 *      没有同意 → `CONSENT_REQUIRED`（契约 §6.1 错误码）。
 *   2. **审计**：读写全部落审计日志，且用 fail-closed 的 `audit.record()`
 *      （审计写不进去就不放行，见 AuditService 的注释）。
 *   3. **危机干预**：`crisisLine()` 是**公开**端点，不需要登录、不需要同意，
 *      且返回 `prominence: 'primary'` 要求前端首屏可见，不得埋进二级菜单。
 *   4. **数据最小化**：本模块的数据不得进入通用画像；
 *      对应地 ai-portrait 模块把 'wellbeing' 列为禁读来源。
 */
@Injectable()
export class WellbeingService {
  constructor(
    @Inject(WELLBEING_APPOINTMENT_REPOSITORY)
    private readonly repo: WellbeingAppointmentRepository,
    @Inject(ConsentService) private readonly consent: ConsentService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /* ---------------- 危机干预（公开，无门槛） ---------------- */

  /**
   * 危机热线。契约 §9：**不可被埋进二级菜单**，因此：
   *   · 不走 AuthGuard（`requiresLogin: false`）
   *   · 不查 Consent（`requiresConsent: false`）
   *   · 前端按 `prominence: 'primary'` 渲染在首屏
   */
  crisisLine(): CrisisLine {
    return {
      module: WELLBEING_MODULE_ID,
      title: '危机干预 · 立即获取帮助',
      message:
        '如果你或身边的人正处于危机之中，请立刻联系下面的热线。你不需要登录，也不需要同意任何条款。',
      hotlines: [
        {
          name: '全国24小时心理援助热线',
          number: this.config.get<string>('WELLBEING_CRISIS_HOTLINE') ?? '021-12320-5',
        },
        {
          name: '希望24热线（全国）',
          number: this.config.get<string>('WELLBEING_CRISIS_HOTLINE_ALT') ?? '400-161-9995',
        },
        { name: '校园紧急求助', number: '110 / 120' },
      ],
      prominence: 'primary',
      requiresLogin: false,
      requiresConsent: false,
    };
  }

  /* ---------------- 二次同意 ---------------- */

  listConsents(userId: string): Promise<ConsentRecord[]> {
    return this.consent.list(userId);
  }

  async grantConsent(userId: string): Promise<ConsentRecord> {
    const record = await this.consent.grant(userId, WELLBEING_MODULE_ID);
    await this.audit.record({
      actorId: userId,
      action: 'wellbeing.consent.grant',
      resource: 'Consent',
      resourceId: record.id,
      module: WELLBEING_MODULE_ID,
      metadata: { version: record.version },
    });
    return record;
  }

  async revokeConsent(userId: string): Promise<ConsentRecord | null> {
    const record = await this.consent.revoke(userId, WELLBEING_MODULE_ID);
    await this.audit.record({
      actorId: userId,
      action: 'wellbeing.consent.revoke',
      resource: 'Consent',
      resourceId: record?.id ?? null,
      module: WELLBEING_MODULE_ID,
    });
    return record;
  }

  /* ---------------- 预约（同意 + 审计） ---------------- */

  async list(userId: string, params: ListParams): Promise<Page<WellbeingAppointmentModel>> {
    await this.consent.requireConsent(userId, WELLBEING_MODULE_ID);
    const page = await this.repo.listByUser(userId, params);
    await this.audit.record({
      actorId: userId,
      action: 'wellbeing.appointment.list',
      resource: 'WellbeingAppointment',
      module: WELLBEING_MODULE_ID,
      metadata: { count: page.items.length },
    });
    return page;
  }

  async detail(userId: string, id: string): Promise<WellbeingAppointmentModel> {
    await this.consent.requireConsent(userId, WELLBEING_MODULE_ID);
    const found = await this.repo.findById(id);

    // 越权访问返回 NOT_FOUND 而不是 FORBIDDEN：不泄漏"这条记录存在"
    if (!found || found.userId !== userId) {
      throw new NotFoundError('心理预约不存在或已被删除');
    }

    await this.audit.record({
      actorId: userId,
      action: 'wellbeing.appointment.read',
      resource: 'WellbeingAppointment',
      resourceId: id,
      module: WELLBEING_MODULE_ID,
    });
    return found;
  }

  async create(
    userId: string,
    input: WellbeingAppointmentDraft,
  ): Promise<WellbeingAppointmentModel> {
    await this.consent.requireConsent(userId, WELLBEING_MODULE_ID);

    const created = await this.repo.create({ ...input, userId });

    // fail-closed：审计失败会让请求整体失败，避免"敏感数据被读过但没有痕迹"
    await this.audit.record({
      actorId: userId,
      action: 'wellbeing.appointment.create',
      resource: 'WellbeingAppointment',
      resourceId: created.id,
      module: WELLBEING_MODULE_ID,
      metadata: { mode: created.mode, crisisFlag: created.crisisFlag },
    });
    return created;
  }

  async update(
    userId: string,
    id: string,
    input: UpdateWellbeingAppointmentInput,
  ): Promise<WellbeingAppointmentModel> {
    await this.detail(userId, id);
    const updated = await this.repo.update(id, input);
    await this.audit.record({
      actorId: userId,
      action: 'wellbeing.appointment.update',
      resource: 'WellbeingAppointment',
      resourceId: id,
      module: WELLBEING_MODULE_ID,
      metadata: { fields: Object.keys(input) },
    });
    return updated;
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.detail(userId, id);
    await this.repo.remove(id);
    await this.audit.record({
      actorId: userId,
      action: 'wellbeing.appointment.delete',
      resource: 'WellbeingAppointment',
      resourceId: id,
      module: WELLBEING_MODULE_ID,
    });
  }

  /**
   * 触发危机干预流程：标记 + 立刻把热线一并返回。
   * 无论用户当前在哪个页面，客户端都必须能直接展示热线（契约 §9）。
   */
  async escalateCrisis(userId: string, id: string) {
    const updated = await this.update(userId, id, { crisisFlag: true, status: 'crisis-escalated' });
    await this.audit.record({
      actorId: userId,
      action: 'wellbeing.crisis.escalate',
      resource: 'WellbeingAppointment',
      resourceId: id,
      module: WELLBEING_MODULE_ID,
    });
    return { appointment: updated, crisisLine: this.crisisLine() };
  }
}
