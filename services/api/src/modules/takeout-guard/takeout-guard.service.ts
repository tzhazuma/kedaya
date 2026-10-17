import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import {
  ConflictError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { MEDIA_URL_POLICY } from '../../common/media/media.port';
import { resolveMediaUrlPolicy, type MediaUrlPolicy } from '../../common/media/media-url';
import {
  TAKEOUT_CLOCK_SKEW_MS,
  TAKEOUT_DETAIL_MAX,
  TAKEOUT_ORDER_NO_MAX,
  TAKEOUT_PLACE_MAX,
  TAKEOUT_REPORT_DEFAULT_STATUS,
  TAKEOUT_REPORT_REPOSITORY,
  TAKEOUT_REPORT_STATUS,
  TAKEOUT_REPORT_STATUSES,
  type CreateTakeoutReportInput,
  type TakeoutReportListQuery,
  type TakeoutReportModel,
  type TakeoutReportRepository,
  type TakeoutReportStatus,
  type UpdateTakeoutReportInput,
} from './domain/takeout-guard.domain';

/**
 * 偷外卖用例层（契约 §7：controller → service → repository）。
 *
 * 这个模块的领域规则不是"能增删改查"，而是**不惹祸**：
 *
 *   1. **归属只认 JWT**：`create` 的第一件事是要求登录主体，落库的 `reporterId` 恒为它；
 *      请求体里根本没有归属字段，所以"冒充他人举报"在协议层就不成立。
 *   2. **记录只给本人看**：`list` 强制按主体收窄，`detail/update/remove/escalate/resolve`
 *      全部先过 `findOwned`。非本人不是 403 而是 **NOT_FOUND** —— 403 等于承认
 *      "这条记录存在"，而记录里含有订单号与取餐点。
 *   3. **状态只能走领域动作**：新建恒 `pending`，`escalate` 置 `escalated`，
 *      `resolve` 置 `resolved`；`PATCH` 的输入类型里没有 `status`。
 *
 * 依赖用**显式 token** 注入（不使用 design:paramtypes），
 * 因此 `new TakeoutReportService(fakeRepo)` 就能在 vitest 里直接测。
 * `mediaUrlPolicy` 是 `@Optional()` 的：纯领域单测不提供它时退回默认策略，仍然校验证据图地址。
 */
@Injectable()
export class TakeoutReportService {
  constructor(
    @Inject(TAKEOUT_REPORT_REPOSITORY) private readonly repo: TakeoutReportRepository,
    /** 图片地址白名单策略（只接受本平台上传的地址，防外链与追踪像素） */
    @Optional() @Inject(MEDIA_URL_POLICY) private readonly mediaUrlPolicy?: MediaUrlPolicy,
  ) {}

  /**
   * 列表：**强制**只看当前登录用户自己的记录。
   *
   * 刻意没有 `mine` 开关 —— 这个模块不存在"看别人的举报"这种合法需求。
   * 筛选只有 `status` 一个维度（且是白名单），其余组合查询一概不提供：
   * 订单号 / 取餐点 / 描述任意组合都可能把一条记录与某个人对应起来。
   */
  async list(
    query: Partial<TakeoutReportListQuery> = {},
    actorId?: string,
  ): Promise<Page<TakeoutReportModel>> {
    if (!actorId) throw new UnauthenticatedError('查看外卖被拿错的记录需要先登录');

    const filters: Record<string, string> = { reporterId: actorId };
    if (query.status !== undefined) filters.status = normalizeStatus(query.status);

    return this.repo.list({
      limit: query.limit ?? 20,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      filters,
    });
  }

  async create(input: CreateTakeoutReportInput, actorId?: string): Promise<TakeoutReportModel> {
    if (!actorId) throw new UnauthenticatedError('记录外卖被拿错需要先登录');

    return this.repo.create({
      // 归属与状态都**只**由服务层决定；客户端传了什么（如果强行传）都不会生效
      reporterId: actorId,
      status: TAKEOUT_REPORT_DEFAULT_STATUS,
      orderNo: normalizeRequiredText(input.orderNo, TAKEOUT_ORDER_NO_MAX, '订单号', 'orderNo'),
      place: normalizeRequiredText(input.place, TAKEOUT_PLACE_MAX, '取餐点', 'place'),
      happenedAt: normalizeHappenedAt(input.happenedAt),
      detail: normalizeRequiredText(input.detail, TAKEOUT_DETAIL_MAX, '经过描述', 'detail'),
      evidenceUrl: normalizeEvidenceUrl(
        input.evidenceUrl,
        resolveMediaUrlPolicy(this.mediaUrlPolicy),
      ),
    });
  }

  /** 详情：只有记录人本人能看（非本人返回 NOT_FOUND） */
  async detail(id: string, actorId?: string): Promise<TakeoutReportModel> {
    return this.findOwned(id, actorId);
  }

  /** 修改：只能改"经过"类字段，不能改状态与归属（见 domain 的输入类型） */
  async update(
    id: string,
    input: UpdateTakeoutReportInput,
    actorId?: string,
  ): Promise<TakeoutReportModel> {
    await this.findOwned(id, actorId);

    const patch: UpdateTakeoutReportInput = {};
    if (input.orderNo !== undefined) {
      patch.orderNo = normalizeRequiredText(input.orderNo, TAKEOUT_ORDER_NO_MAX, '订单号', 'orderNo');
    }
    if (input.place !== undefined) {
      patch.place = normalizeRequiredText(input.place, TAKEOUT_PLACE_MAX, '取餐点', 'place');
    }
    if (input.happenedAt !== undefined) patch.happenedAt = normalizeHappenedAt(input.happenedAt);
    if (input.detail !== undefined) {
      patch.detail = normalizeRequiredText(input.detail, TAKEOUT_DETAIL_MAX, '经过描述', 'detail');
    }
    if (input.evidenceUrl !== undefined) {
      patch.evidenceUrl = normalizeEvidenceUrl(
        input.evidenceUrl,
        resolveMediaUrlPolicy(this.mediaUrlPolicy),
      );
    }

    return this.repo.update(id, patch);
  }

  async remove(id: string, actorId?: string): Promise<void> {
    await this.findOwned(id, actorId);
    await this.repo.remove(id);
  }

  /** 领域动作：升级处理（请平台 / 辅导员协助），pending → escalated，单向且幂等冲突可见 */
  async escalate(id: string, actorId?: string): Promise<TakeoutReportModel> {
    const report = await this.findOwned(id, actorId);

    if (report.status === TAKEOUT_REPORT_STATUS.escalated) {
      throw new ConflictError('这条记录已经升级处理，无需重复提交');
    }
    if (report.status === TAKEOUT_REPORT_STATUS.resolved) {
      throw new ConflictError('已解决的记录不能再升级处理');
    }

    return this.repo.applyStatus(id, TAKEOUT_REPORT_STATUS.escalated);
  }

  /**
   * 领域动作：标记已解决（对方归还 / 事情已经说清楚）。
   *
   * 没有这个动作，白名单里的 `resolved` 与列表的"已解决"筛选就是死的，
   * 记录也永远停在进行中 —— 对一个"只帮用户把经过记清楚"的产品来说，
   * 能让用户自己收尾比多一个状态更有价值。
   */
  async resolve(id: string, actorId?: string): Promise<TakeoutReportModel> {
    const report = await this.findOwned(id, actorId);

    if (report.status === TAKEOUT_REPORT_STATUS.resolved) {
      throw new ConflictError('这条记录已经标记为已解决');
    }

    return this.repo.applyStatus(id, TAKEOUT_REPORT_STATUS.resolved);
  }

  /**
   * 取"属于当前主体"的记录，否则视为不存在。
   *
   * 未登录 → 401；存在但不是你的 / 不存在 → 同一句 NOT_FOUND。
   * 这不是过度设计：记录里含订单号与取餐点，能区分出"存在"本身就是信息泄露。
   */
  private async findOwned(id: string, actorId?: string): Promise<TakeoutReportModel> {
    if (!actorId) throw new UnauthenticatedError('请先登录');

    const report = await this.repo.findById(id);
    if (!report || report.reporterId !== actorId) {
      throw new NotFoundError('这条记录不存在，或不属于你');
    }
    return report;
  }
}

/* ------------------------------------------------------------------ *
 * 归一化与校验（纯函数，便于单测；错误文案与客户端提示同源）
 * ------------------------------------------------------------------ */

function normalizeStatus(value: unknown): TakeoutReportStatus {
  if (typeof value !== 'string' || !(TAKEOUT_REPORT_STATUSES as readonly string[]).includes(value)) {
    throw new ValidationError('状态不在支持范围内', {
      field: 'status',
      allowed: TAKEOUT_REPORT_STATUSES,
    });
  }
  return value as TakeoutReportStatus;
}

function normalizeRequiredText(value: unknown, max: number, label: string, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) throw new ValidationError(`请填写${label}`, { field });
  if ([...text].length > max) throw new ValidationError(`${label}最多 ${max} 个字`, { field });
  return text;
}

function normalizeHappenedAt(value: unknown): Date {
  const happenedAt = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(happenedAt.getTime())) {
    throw new ValidationError('发生时间格式不正确', { field: 'happenedAt' });
  }
  // 留 5 分钟时钟偏差：手机时钟略快不该让提交失败，但"未来的被拿错"没有意义
  if (happenedAt.getTime() > Date.now() + TAKEOUT_CLOCK_SKEW_MS) {
    throw new ValidationError('发生时间不能晚于当前时间', { field: 'happenedAt' });
  }
  return happenedAt;
}

/**
 * 证据图地址：最多一张，且必须是本平台上传的地址。
 *
 * 不做"客户端传什么就存什么"：允许任意外链就等于允许把追踪像素塞进记录，
 * 而这条记录是要用来跟对方对质的（见 `common/media/media-url.ts` 的完整理由）。
 */
function normalizeEvidenceUrl(value: unknown, policy: MediaUrlPolicy): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError('证据图地址格式不正确', { field: 'evidenceUrl' });
  }
  const url = value.trim();
  if (url === '') return null;
  return policy.assertAllowed(url);
}
