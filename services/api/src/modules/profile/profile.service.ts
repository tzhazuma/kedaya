/**
 * 我的 · profile（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；下面的领域方法（隐私开关 / 同意管理 /
 * 数据导出）是本模块真正的价值 —— 「我的」不是"设置项的堆放处"，
 * 而是用户**掌控自己数据**的地方（契约 §9：同意可撤回、数据可携）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CONSENT_MODULES, getModule } from '@kedaya/contracts';
import { AuditService } from '../../common/compliance/audit.service';
import { ConsentService } from '../../common/compliance/consent.service';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import {
  PROFILE_SETTING_REPOSITORY,
  type CreateProfileSettingInput,
  type ProfileSettingModel,
  type ProfileSettingRepository,
  type UpdateProfileSettingInput,
} from './domain/profile.domain';
import {
  PROFILE_EXPORT_PORT,
  type ProfileExport,
  type ProfileExportPort,
} from './domain/profile-export.domain';

export interface ProfileConsentView {
  module: string;
  nameZh: string;
  summary: string;
  sensitivity: string;
  /** 契约 §4 里这个模块**是否需要**同意门 */
  gated: boolean;
  /** 当前是否处于有效同意状态 */
  active: boolean;
  version: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
}

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class ProfileSettingService extends CrudService<
  ProfileSettingModel,
  CreateProfileSettingInput,
  UpdateProfileSettingInput
> {
  constructor(
    @Inject(PROFILE_SETTING_REPOSITORY) private readonly repo: ProfileSettingRepository,
    @Inject(PROFILE_EXPORT_PORT) private readonly exportPort: ProfileExportPort,
    private readonly consent: ConsentService,
    private readonly audit: AuditService,
  ) {
    super(repo, 'profile', '我的');
  }

  /**
   * 创建。userId 是 readOnly（由账号决定，不接受请求体传入），
   * 因此必须已登录。
   */
  override async create(input: CreateProfileSettingInput, actorId?: string): Promise<ProfileSettingModel> {
    if (!actorId) {
      throw new ValidationError('该资源必须登录后创建', { field: 'userId' });
    }
    return super.create({ ...input, userId: actorId } as CreateProfileSettingInput);
  }

  /** 读取我的设置；不存在则按默认值建档（隐私开关默认全关） */
  me(userId: string): Promise<ProfileSettingModel> {
    return this.repo.ensureForUser(userId);
  }

  patchMine(userId: string, patch: UpdateProfileSettingInput): Promise<ProfileSettingModel> {
    return this.repo.patchForUser(userId, patch);
  }

  /* ---------------- 同意管理（契约 §9：可随时撤回） ---------------- */

  /**
   * 我授过 / 撤过的同意。
   *
   * 返回**全部需要同意门的模块**（而不是只返回已授权的），
   * 这样「我的 → 隐私」页能一眼看到"还有哪些模块我还没开、可以开"。
   * 只回撤回状态，不回 IP/UA（那是内部审计字段，不该出现在用户可见视图里）。
   */
  async listConsents(userId: string): Promise<ProfileConsentView[]> {
    const records = await this.consent.list(userId);
    const byModule = new Map(records.map((record) => [record.module, record]));

    // 契约里的同意门模块 + 用户历史上授过的（防止契约增删后旧记录"消失"）
    const moduleIds = new Set<string>([
      ...records.map((record) => record.module),
      ...CONSENT_MODULE_IDS,
    ]);

    return [...moduleIds]
      .map((moduleId) => {
        const meta = getModule(moduleId);
        const record = byModule.get(moduleId);
        return {
          module: moduleId,
          nameZh: meta?.nameZh ?? moduleId,
          summary: meta?.summary ?? '',
          sensitivity: meta?.sensitivity ?? 'unknown',
          gated: meta?.requiresConsent ?? false,
          active: record !== undefined && record.revokedAt === null,
          version: record?.version ?? null,
          grantedAt: record?.grantedAt.toISOString() ?? null,
          revokedAt: record?.revokedAt?.toISOString() ?? null,
        };
      })
      .sort((left, right) => left.module.localeCompare(right.module));
  }

  async grantConsent(userId: string, moduleId: string): Promise<ProfileConsentView> {
    await this.consent.grant(userId, moduleId);
    await this.audit.recordQuietly({
      actorId: userId,
      action: 'profile.consent.grant',
      resource: 'Consent',
      module: 'profile',
      metadata: { target: moduleId },
    });
    return this.consentView(userId, moduleId);
  }

  async revokeConsent(userId: string, moduleId: string): Promise<ProfileConsentView> {
    await this.consent.revoke(userId, moduleId);
    await this.audit.recordQuietly({
      actorId: userId,
      action: 'profile.consent.revoke',
      resource: 'Consent',
      module: 'profile',
      metadata: { target: moduleId },
    });
    return this.consentView(userId, moduleId);
  }

  private async consentView(userId: string, moduleId: string): Promise<ProfileConsentView> {
    const all = await this.listConsents(userId);
    return (
      all.find((item) => item.module === moduleId) ?? {
        module: moduleId,
        nameZh: getModule(moduleId)?.nameZh ?? moduleId,
        summary: getModule(moduleId)?.summary ?? '',
        sensitivity: getModule(moduleId)?.sensitivity ?? 'unknown',
        gated: getModule(moduleId)?.requiresConsent ?? false,
        active: false,
        version: null,
        grantedAt: null,
        revokedAt: null,
      }
    );
  }

  /* ---------------- 数据导出（契约 §9：数据可携权） ---------------- */

  async exportData(userId: string): Promise<ProfileExport> {
    const [account, settings, consents, content, auditPage] = await Promise.all([
      this.exportPort.account(userId),
      this.repo.ensureForUser(userId),
      this.listConsents(userId),
      this.exportPort.contentCounts(userId),
      this.audit.list({ actorId: userId, limit: 20 }),
    ]);

    // 导出的动作本身也要留痕：用户有权知道"这份导出是什么时候被谁拿走的"
    await this.audit.recordQuietly({
      actorId: userId,
      action: 'profile.export',
      resource: 'User',
      resourceId: userId,
      module: 'profile',
    });

    return {
      generatedAt: new Date().toISOString(),
      account,
      settings,
      consents: consents
        .filter((item) => item.grantedAt !== null || item.revokedAt !== null)
        .map((item) => ({
          module: item.module,
          nameZh: item.nameZh,
          version: item.version ?? 'unknown',
          grantedAt: item.grantedAt ?? '',
          revokedAt: item.revokedAt,
        })),
      audit: {
        total: auditPage.items.length,
        recent: auditPage.items.map((entry) => ({
          action: entry.action,
          module: entry.module ?? null,
          resource: entry.resource,
          at: entry.at.toISOString(),
        })),
      },
      content,
      note:
        '导出内容为你账号的档案、隐私开关、同意记录与各模块内容条数；' +
        '他人的数据、匿名帖映射关系、校园卡逐笔明细正文不在导出范围内（契约 §9）。',
    };
  }
}

/** 契约里所有需要二次同意的模块 id（唯一真相来自 `@kedaya/contracts`） */
const CONSENT_MODULE_IDS: readonly string[] = CONSENT_MODULES.map((module) => module.id);
