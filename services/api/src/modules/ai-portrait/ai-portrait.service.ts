import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/compliance/audit.service';
import { ConsentService } from '../../common/compliance/consent.service';
import type { ConsentRecord } from '../../common/compliance/compliance.types';
import { NotFoundError, UnauthenticatedError } from '../../common/errors/app-error';
import {
  AI_PORTRAIT_EXPLAINABILITY_RULE,
  AI_PORTRAIT_GENERATION,
  AI_PORTRAIT_MODULE_ID,
  AI_PORTRAIT_PROFILE_REPOSITORY,
  ALLOWED_PORTRAIT_SOURCES,
  FORBIDDEN_PORTRAIT_SOURCES,
  PORTRAIT_SOURCE_CATALOG,
  assertAllowedSources,
  type AiPortraitProfileModel,
  type AiPortraitProfileRepository,
} from './domain/ai-portrait.domain';

/**
 * AI 画像用例。
 *
 * 契约 §9 的四条要求（与 `domain/ai-portrait.domain.ts` 的护栏一一对应）：
 *   1. 二次同意（`requireConsent`）；
 *   2. 可解释（`explain` 里带 `sources` + `sources` 端点公开数据来源边界）；
 *   3. 可关闭（`enabled` 开关 + `PATCH /me`）；
 *   4. 数据最小化（`assertAllowedSources` 拒绝禁读域）。
 *
 * 归属规则（与 `takeout-guard` 同一套写法）：**主体只从 JWT 取**。
 * 每个方法都先要求登录主体，缺失即 401；仓储只提供"按主体寻址"的方法
 * （`findByUserId` / `upsertForUser`），因此"读/写别人的画像"在协议层不成立，
 * 也不存在"404 还是 403"的取舍 —— 别人根本不是一个可寻址的资源。
 *
 * ⚠️ 后端**尚未实现**真正的画像生成逻辑（见 `AI_PORTRAIT_GENERATION`）：
 * 这里只做合规边界与存储。没有画像行时 `me()` 返回 `null`，
 * 客户端据此显示空态、**不编造标签**。这是刻意的：宁可空，也不假。
 */
@Injectable()
export class AiPortraitService {
  constructor(
    @Inject(AI_PORTRAIT_PROFILE_REPOSITORY) private readonly repo: AiPortraitProfileRepository,
    @Inject(ConsentService) private readonly consent: ConsentService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * 公开端点：把"画像能读什么、绝对不能读什么、现在到底读没读"摊开给用户看（可解释性）。
   *
   * 刻意把 `generation.implemented = false` 也返回出去：客户端因此能如实显示
   * "还没有足够数据生成画像"，而不是把"接口通但没数据"当成故障。
   */
  sources() {
    return {
      module: AI_PORTRAIT_MODULE_ID,
      allowed: ALLOWED_PORTRAIT_SOURCES,
      forbidden: FORBIDDEN_PORTRAIT_SOURCES,
      rule: '契约 §9 数据最小化：心理支持（wellbeing）与宿舍矛盾（dorm-harmony）的数据不参与画像',
      /** 每类数据的中文名 + 可以用来说明什么（含禁止来源的排除原因） */
      catalog: PORTRAIT_SOURCE_CATALOG,
      /** 现状：尚未接入任何数据来源、也没有生成逻辑 —— 不假装有 */
      generation: AI_PORTRAIT_GENERATION,
      explainability: AI_PORTRAIT_EXPLAINABILITY_RULE,
    };
  }

  /* ------------------------------------------------------------------ *
   * 同意（契约 §9：独立同意、可随时撤回）
   * ------------------------------------------------------------------ */

  /**
   * 我的同意记录。
   *
   * 返回 `ConsentRecord[]`：**只含本模块**的同意，且包含已撤回的历史条目
   * （`revokedAt` 非空）—— 用户有权看到"我什么时候同意过、什么时候撤回的"。
   * 同意门本身由契约决定（`ConsentService.isGated` 查 `requiresConsent()`），
   * 不在本模块硬编码。
   */
  listConsents(actorId?: string): Promise<ConsentRecord[]> {
    return this.consent.list(this.requireActor(actorId));
  }

  /**
   * 二次同意（用户在小程序里读完说明并点「我已阅读并同意」时写入）。
   *
   * 谁写的：`ConsentService.grant()`，落 `Consent` 表，含版本号与 ip/ua，
   * 由审计服务记录 `ai-portrait.consent.grant`。版本号不在本模块写死 ——
   * 契约里模块自身的版本是真相来源，本模块只管"这个模块被授权了"。
   */
  async grantConsent(actorId?: string): Promise<ConsentRecord> {
    const userId = this.requireActor(actorId);

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

  /**
   * 撤回同意（幂等）。
   *
   * 撤回后发生什么：
   *   · `requireConsent` 立刻开始拒绝 —— `GET /me`、`POST /items`、`PATCH /me`
   *     一律返回 `CONSENT_REQUIRED`，画像不再被读取、也不再被刷新；
   *   · 已生成的画像行**不删除**（撤回不该等价于销毁数据），但重新同意前不可读；
   *   · 记录 `ai-portrait.consent.revoke` 审计；重复撤回不报错（`revoke` 幂等），
   *     但审计会再落一条，便于用户看到"我确实撤回过"。
   */
  async revokeConsent(actorId?: string): Promise<ConsentRecord | null> {
    const userId = this.requireActor(actorId);

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

  /* ------------------------------------------------------------------ *
   * 画像（按主体寻址，只读自己的）
   * ------------------------------------------------------------------ */

  /**
   * 我的画像。
   *
   * 返回 `AiPortraitProfileModel | null`：
   *   · `null` = **还没有画像**（后端尚无生成逻辑，这也是当前的常态）；
   *     客户端必须显示空态，不能拿它当"加载失败"。
   *   · `enabled: false` = 用户关闭了画像。数据仍在，但客户端**不再展示**
   *     标签（"以为关掉了其实没关"不可接受，因此关闭态以 `enabled` 为准）。
   *
   * 读画像属于高敏感读取：调 `requireConsent` 之外还会写审计（fail-closed，
   * 审计写不进去就不放行）。审计只记布尔值与 id，不记标签内容。
   */
  async me(actorId?: string): Promise<AiPortraitProfileModel | null> {
    const userId = this.requireActor(actorId);

    await this.consent.requireConsent(userId, AI_PORTRAIT_MODULE_ID);
    const profile = await this.repo.findByUserId(userId);
    await this.audit.record({
      actorId: userId,
      action: 'ai-portrait.profile.read',
      resource: 'AiPortraitProfile',
      resourceId: profile?.id ?? null,
      module: AI_PORTRAIT_MODULE_ID,
      metadata: { exists: profile !== null, enabled: profile?.enabled ?? null },
    });
    return profile;
  }

  /**
   * 写入/更新画像。**先校验来源**，再落库 —— 顺序很重要：
   * 非法来源必须在任何数据被写入之前就被拒绝。
   *
   * 归属恒为登录主体（`input` 里根本没有 `userId`，也没有画像 id）。
   * 说明：本端点是给**受信的内部生成流程**用的（将来接入行为数据后由服务端调用），
   * 小程序端只读、不写 —— 客户端永远不会拿它去编造标签。
   */
  async upsert(
    actorId: string | undefined,
    input: {
      sources: string[];
      traits: Record<string, unknown>;
      explain: Record<string, unknown>;
      enabled?: boolean;
    },
  ): Promise<AiPortraitProfileModel> {
    const userId = this.requireActor(actorId);

    await this.consent.requireConsent(userId, AI_PORTRAIT_MODULE_ID);

    // 契约 §9 护栏：拒绝 wellbeing / dorm-harmony（以及白名单外的未知模块）
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

  /**
   * 可关闭（契约 §9）。
   *
   * 关闭只改 `enabled`，不删数据：重新开启时画像还在，用户不会因为"试了一下关掉"
   * 而永久损失已有内容。尚不存在画像行时返回 `NOT_FOUND`
   * ——"给一个不存在的画像关开关"是客户端状态错乱，应当报错而不是凭空建一行。
   */
  async setEnabled(actorId: string | undefined, enabled: boolean): Promise<AiPortraitProfileModel> {
    const userId = this.requireActor(actorId);

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

  /**
   * 取登录主体。
   *
   * 用 `@OptionalCurrentUser()` + 这里统一抛 401（而不是控制器上的 `AuthGuard`）：
   * "未登录"的文案与错误码因此由服务层给出，与其它模块一致，也能被单测直接断言。
   */
  private requireActor(actorId?: string): string {
    if (!actorId) throw new UnauthenticatedError('查看或管理校园画像需要先登录');
    return actorId;
  }
}
