import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Page } from '@kedaya/contracts';
import { AuditService } from '../../common/compliance/audit.service';
import { ConsentService } from '../../common/compliance/consent.service';
import type { ConsentRecord } from '../../common/compliance/compliance.types';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import type { ListParams } from '../../common/crud/resource';
import {
  WELLBEING_APPOINTMENT_REPOSITORY,
  WELLBEING_CANCELLABLE_STATUSES,
  WELLBEING_COUNSELOR_MAX,
  WELLBEING_CRISIS_CONFIG,
  WELLBEING_DEFAULT_MODE,
  WELLBEING_DEFAULT_STATUS,
  WELLBEING_MODES,
  WELLBEING_MODULE_ID,
  WELLBEING_NOTE_MAX,
  WELLBEING_SLOT_TOLERANCE_MS,
  WELLBEING_STATUS,
  WELLBEING_STATUSES,
  type CrisisLine,
  type UpdateWellbeingAppointmentInput,
  type WellbeingAppointmentDraft,
  type WellbeingAppointmentModel,
  type WellbeingAppointmentRepository,
  type WellbeingMode,
  type WellbeingStatus,
} from './domain/wellbeing.domain';

/** 列表查询条件：只有 `status` 一个筛选维度（且是白名单） */
export interface WellbeingListQuery {
  cursor?: string;
  limit?: number;
  /** 未传 = 不筛状态 */
  status?: string;
}

/**
 * 心理支持用例（契约 §9 的四个硬约束都落在这个文件里）：
 *
 *   1. **二次同意**：所有涉及预约数据的读写先 `requireConsent()`，
 *      没有同意 → `CONSENT_REQUIRED`（契约 §6.1 错误码）。
 *   2. **审计**：读写全部落审计日志，且用 fail-closed 的 `audit.record()`
 *      （审计写不进去就不放行，见 AuditService 的注释）。
 *   3. **危机干预**：`crisisLine()` 是**公开**端点，不需要登录、不需要同意，
 *      且返回 `prominence: 'primary'` 要求前端首屏可见，不得埋进二级菜单。
 *      热线号码与文案来自 `WELLBEING_CRISIS_CONFIG`（可运营配置，换学校只改一处）。
 *   4. **数据最小化**：本模块的数据不得进入通用画像；
 *      对应地 ai-portrait 模块把 'wellbeing' 列为禁读来源。
 *
 * 在此之上，归属与状态也被收紧到"不可能写错"：
 *   · `userId` 只从入参（= JWT 主体）取，请求体里根本没这个字段；
 *   · `status` / `crisisFlag` 不在 `UpdateWellbeingAppointmentInput` 里，
 *     只能经 `cancel()` / `escalateCrisis()` 两个领域动作跃迁。
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
   *
   * 返回形状（客户端 `WellbeingCrisisLine` 与它逐字段对齐）：
   * ```
   * { module, title, message,
   *   hotlines: [{ name, number }],       // 可直接拨打的号码
   *   channels: [{ name, instruction }],  // 打不了电话时的下一步（辅导员 / 保卫处）
   *   prominence: 'primary', requiresLogin: false, requiresConsent: false }
   * ```
   *
   * ⚠️ 号码可由 `WELLBEING_CRISIS_*` 环境变量覆盖，**上线前必须逐个拨通核实**
   * （见 domain 里 `WELLBEING_CRISIS_VERIFY_NOTE` 的三条）。
   */
  crisisLine(): CrisisLine {
    return {
      module: WELLBEING_MODULE_ID,
      title: WELLBEING_CRISIS_CONFIG.title,
      message: WELLBEING_CRISIS_CONFIG.message,
      hotlines: WELLBEING_CRISIS_CONFIG.hotlines.map((entry) => {
        const configured = this.config.get<string>(entry.envKey);
        const number =
          typeof configured === 'string' && configured.trim() !== ''
            ? configured.trim()
            : entry.defaultNumber;
        return { name: entry.name, number };
      }),
      // 复制一份再返回：调用方（controller / 测试）拿到的对象不该能改到配置常量
      channels: WELLBEING_CRISIS_CONFIG.channels.map((channel) => ({ ...channel })),
      prominence: 'primary',
      requiresLogin: false,
      requiresConsent: false,
    };
  }

  /* ---------------- 二次同意 ---------------- */

  /**
   * 我的同意记录。
   *
   * 语义（刻意保持与 `ConsentService.list` 一致，不额外收窄）：返回该用户的
   * **全部**同意记录（可能含宿舍矛盾 / AI 画像等其它模块），每条带 `module`
   * 与 `revokedAt`。客户端据此判断"哪些还没授权"，也用于本地同意与
   * 服务端记录不一致时的对齐（例如换手机后本机没有留痕）。
   */
  listConsents(userId: string): Promise<ConsentRecord[]> {
    return this.consent.list(userId);
  }

  /**
   * 同意（幂等：已有记录会刷新 `grantedAt` 并清空 `revokedAt`）。
   *
   * 这是**服务端**的合规留痕（`Consent` 表），也是后端 `requireConsent()` 放行的依据；
   * 客户端另有一份本地留痕（`StorageKeys.consent`）用于"同意门"的即时判断，
   * 两者职责不同、缺一不可（详见小程序端 `wellbeingUseCases.ts` 的注释）。
   */
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

  /**
   * 撤回同意（契约 §9：可随时撤回）。撤回后本模块的读写会立刻回到
   * `CONSENT_REQUIRED`；已有预约数据**不删**（用户可能只是一段时间不想用），
   * 「删除数据」是「我的 → 隐私与数据」里的另一条独立权利。
   */
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

  /**
   * 我的预约列表。
   *
   * 强制按登录主体收窄（`listByUser`），筛选只有 `status` 一个维度且过白名单：
   * 关键词 / 时间范围之类的组合查询一旦开放，就可能把"谁在什么时候见过谁"暴露出来。
   */
  async list(
    userId: string,
    query: WellbeingListQuery = {},
  ): Promise<Page<WellbeingAppointmentModel>> {
    await this.consent.requireConsent(userId, WELLBEING_MODULE_ID);

    const status = query.status === undefined ? undefined : normalizeStatus(query.status);
    const params: ListParams = {
      limit: query.limit ?? 20,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(status === undefined ? {} : { filters: { status } }),
    };

    const page = await this.repo.listByUser(userId, params);
    await this.audit.record({
      actorId: userId,
      action: 'wellbeing.appointment.list',
      resource: 'WellbeingAppointment',
      module: WELLBEING_MODULE_ID,
      metadata: { count: page.items.length, ...(status === undefined ? {} : { status }) },
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

  /**
   * 创建预约。
   *
   * `userId` 只从这里（= JWT 主体）进库；请求体里没有这个字段，
   * 连"强行塞一个"的字段都不存在（见 controller 的 `createSchema`）。
   */
  async create(
    userId: string,
    input: WellbeingAppointmentDraft,
  ): Promise<WellbeingAppointmentModel> {
    await this.consent.requireConsent(userId, WELLBEING_MODULE_ID);

    const created = await this.repo.create({
      userId,
      status: WELLBEING_DEFAULT_STATUS,
      crisisFlag: false,
      counselor: normalizeCounselor(input.counselor),
      slotAt: normalizeSlotAt(input.slotAt),
      mode: normalizeMode(input.mode),
      note: normalizeNote(input.note),
    });

    // fail-closed：审计失败会让请求整体失败，避免"敏感数据被写过但没有痕迹"
    await this.audit.record({
      actorId: userId,
      action: 'wellbeing.appointment.create',
      resource: 'WellbeingAppointment',
      resourceId: created.id,
      module: WELLBEING_MODULE_ID,
      // 只记"结构信息"，**不记** note 正文（那是用户的诉求细节）
      metadata: { mode: created.mode, slotAt: created.slotAt, crisisFlag: created.crisisFlag },
    });
    return created;
  }

  /** 修改：只能改时间 / 方式 / 摘要 —— 状态与归属不在输入类型里 */
  async update(
    userId: string,
    id: string,
    input: UpdateWellbeingAppointmentInput,
  ): Promise<WellbeingAppointmentModel> {
    await this.detail(userId, id);

    const patch: UpdateWellbeingAppointmentInput = {};
    if (input.slotAt !== undefined) patch.slotAt = normalizeSlotAt(input.slotAt);
    if (input.mode !== undefined) patch.mode = normalizeMode(input.mode);
    if (input.note !== undefined) patch.note = normalizeNote(input.note);

    const updated = await this.repo.update(id, patch);
    await this.audit.record({
      actorId: userId,
      action: 'wellbeing.appointment.update',
      resource: 'WellbeingAppointment',
      resourceId: id,
      module: WELLBEING_MODULE_ID,
      metadata: { fields: Object.keys(patch) },
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
   * 领域动作：取消预约（本人）。
   *
   * 为什么单开一个动作而不是让 PATCH 写 `status`：状态是**领域事实**，
   * 不是普通字段。放开 PATCH 就等于允许客户端把预约改成"已完成"，
   * 也让"谁能取消"失去唯一定义。
   * `requested` / `confirmed` → `cancelled`；终态与未知状态一律 CONFLICT
   * （幂等冲突可见，而不是静默改写）。
   */
  async cancel(userId: string, id: string): Promise<WellbeingAppointmentModel> {
    const found = await this.detail(userId, id);

    if (found.status === WELLBEING_STATUS.cancelled) {
      throw new ConflictError('这条预约已经取消，无需重复操作');
    }
    if (found.status === WELLBEING_STATUS.completed) {
      throw new ConflictError('已完成的预约不能取消');
    }
    if (!(WELLBEING_CANCELLABLE_STATUSES as readonly string[]).includes(found.status)) {
      throw new ConflictError('当前状态不能取消', { status: found.status });
    }

    const updated = await this.repo.applyStatus(id, WELLBEING_STATUS.cancelled);
    await this.audit.record({
      actorId: userId,
      action: 'wellbeing.appointment.cancel',
      resource: 'WellbeingAppointment',
      resourceId: id,
      module: WELLBEING_MODULE_ID,
      metadata: { from: found.status },
    });
    return updated;
  }

  /**
   * 触发危机干预流程：打标记 + 立刻把热线一并返回。
   *
   * **不改 status**：被给到热线之后，这次预约是否继续由用户自己决定；
   * 把它改成某个终态反而会让用户以为"已经处理完了"。
   * 无论用户当前在哪个页面，客户端都必须能直接展示热线（契约 §9）。
   */
  async escalateCrisis(userId: string, id: string) {
    // 先走 detail：一遍过齐"同意门 + 归属（非本人 404）+ 读审计"
    await this.detail(userId, id);
    const updated = await this.repo.markCrisis(id);
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

/* ------------------------------------------------------------------ *
 * 归一化与校验（纯函数，便于单测；错误文案与客户端提示同源）
 * ------------------------------------------------------------------ */

function normalizeStatus(value: unknown): WellbeingStatus {
  if (typeof value !== 'string' || !(WELLBEING_STATUSES as readonly string[]).includes(value)) {
    throw new ValidationError('状态不在支持范围内', {
      field: 'status',
      allowed: WELLBEING_STATUSES,
    });
  }
  return value as WellbeingStatus;
}

/** 老师 / 咨询师：手填或从学校名单里选，必须非空且限长 */
function normalizeCounselor(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) throw new ValidationError('请填写想约的老师 / 咨询师', { field: 'counselor' });
  if ([...text].length > WELLBEING_COUNSELOR_MAX) {
    throw new ValidationError(`最多 ${WELLBEING_COUNSELOR_MAX} 个字`, { field: 'counselor' });
  }
  return text;
}

/** 方式：白名单（线上的含义是"电话 / 视频"，需要中心有对应安排） */
function normalizeMode(value: unknown): WellbeingMode {
  if (value === undefined || value === null) return WELLBEING_DEFAULT_MODE;
  if (typeof value !== 'string' || !(WELLBEING_MODES as readonly string[]).includes(value)) {
    throw new ValidationError('预约方式不在支持范围内', {
      field: 'mode',
      allowed: WELLBEING_MODES,
    });
  }
  return value as WellbeingMode;
}

/**
 * 摘要：最小化采集 —— 空串归一成 null（"没填"而不是"填了空"）。
 * 太长的文本一律拒绝而不是静默截断：用户写的诉求不该被无声丢掉后半段。
 */
function normalizeNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError('摘要格式不正确', { field: 'note' });
  const text = value.trim();
  if (text.length === 0) return null;
  if ([...text].length > WELLBEING_NOTE_MAX) {
    throw new ValidationError(`摘要最多 ${WELLBEING_NOTE_MAX} 个字`, { field: 'note' });
  }
  return text;
}

/**
 * 预约时间：合法日期 + 不能是已经过去的时间（留 5 分钟时钟偏差）。
 *
 * 服务层直接用 `Date.now()` 而不是注入时钟：与 `takeout-guard` 的
 * `normalizeHappenedAt` 保持一致，单测通过"相对当前时间构造入参"来验证。
 */
function normalizeSlotAt(value: unknown): Date {
  const slotAt = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(slotAt.getTime())) {
    throw new ValidationError('预约时间格式不正确', { field: 'slotAt' });
  }
  if (slotAt.getTime() < Date.now() - WELLBEING_SLOT_TOLERANCE_MS) {
    throw new ValidationError('预约时间需要晚于现在', { field: 'slotAt' });
  }
  return slotAt;
}
