import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/compliance/audit.service';
import { ConsentService } from '../../common/compliance/consent.service';
import type { ConsentRecord } from '../../common/compliance/compliance.types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import {
  anonymousHandle,
  generateTrackCode,
  sha256Hex,
} from '../auth/domain/verification-code';
import {
  DORM_HARMONY_CASE_REPOSITORY,
  DORM_HARMONY_EXPECTATIONS,
  DORM_HARMONY_FROM_ROLES,
  DORM_HARMONY_MODULE_ID,
  DORM_HARMONY_STATUS,
  type DormHarmonyCaseDetail,
  type DormHarmonyCaseModel,
  type DormHarmonyCaseRepository,
  type DormHarmonyCaseView,
  type DormHarmonyMessageModel,
  type SubmitDormHarmonyCaseInput,
} from './domain/dorm-harmony.domain';

/**
 * 宿舍矛盾用例。
 *
 * 与"登录 + 二次同意"的普通敏感模块不同，本模块**匿名可用**：
 *   · 案子与实名 `User` 没有任何外键，提交时只生成一次性追踪码；
 *   · 追踪码明文只在提交响应里返回一次，库里只存 `sha256(trackCode)`；
 *   · 详情 / 留言 / 结案都必须出示追踪码，否则 FORBIDDEN —— 且**不区分**
 *     "案子不存在"与"追踪码错误"，避免用追踪码做枚举；
 *   · 审计照记（合规），但匿名操作只落 `anonymous`，不落实名。
 *
 * 依赖用**显式 token** 注入，因此 `new DormHarmonyService(fakeRepo, fakeConsent, fakeAudit)`
 * 可直接在 vitest 里测。
 */
@Injectable()
export class DormHarmonyService {
  constructor(
    @Inject(DORM_HARMONY_CASE_REPOSITORY) private readonly repo: DormHarmonyCaseRepository,
    @Inject(ConsentService) private readonly consent: ConsentService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------------ *
   * 二次同意（合规：仅实名入口使用；匿名案子不经过这里）
   * ------------------------------------------------------------------ */

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

  /* ------------------------------------------------------------------ *
   * 匿名案子（追踪码即能力：无需登录）
   * ------------------------------------------------------------------ */

  /**
   * 提交调解申请。
   *
   * 追踪码明文**只在这里出现一次**：返回给提交者后，服务端再也拿不到它，
   * 库里只有哈希。这是"平台也无法替你找回追踪码"的设计后果，需在客户端明示。
   */
  async submit(
    input: SubmitDormHarmonyCaseInput,
  ): Promise<{ case: DormHarmonyCaseView; trackCode: string }> {
    const building = normalizeBuilding(input.building);
    const topic = normalizeTopic(input.topic);
    const detail = normalizeOptionalText(input.detail, 2000, '补充说明');
    const expectation = normalizeExpectation(input.expectation);

    const trackCode = generateTrackCode();
    // 先生成案子 id：anonHandle 的种子是「案子 id + 随机数」，因此不同案子即便
    // 种子碰撞也拿不到相同 handle，无法用 handle 跨案子关联。
    const id = randomUUID();
    const created = await this.repo.create({
      id,
      anonHandle: anonymousHandle(`${id}:${randomBytes(8).toString('hex')}`),
      trackCodeHash: sha256Hex(trackCode),
      building,
      topic,
      detail,
      expectation,
    });

    await this.audit.record({
      actorId: null,
      actorType: 'anonymous',
      action: 'dorm-harmony.case.create',
      resource: 'DormHarmonyCase',
      resourceId: created.id,
      module: DORM_HARMONY_MODULE_ID,
      metadata: { building: created.building },
    });

    return { case: toView(created), trackCode };
  }

  /** 出示追踪码查看详情（含留言列表）。追踪码错误 / 缺失一律 FORBIDDEN。 */
  async detail(id: string, trackCode?: string): Promise<DormHarmonyCaseDetail> {
    const found = await this.authorize(id, trackCode);
    const messages = await this.repo.listMessages(id);

    await this.audit.record({
      actorId: null,
      actorType: 'anonymous',
      action: 'dorm-harmony.case.read',
      resource: 'DormHarmonyCase',
      resourceId: id,
      module: DORM_HARMONY_MODULE_ID,
    });

    return { ...toView(found), messages };
  }

  /**
   * 学生留言。留言后若案子仍是 `submitted`，顺带推进为 `in-progress`
   * （等价于"双方已开始沟通"），避免状态永远停在提交态。
   */
  async postMessage(
    id: string,
    trackCode: string | undefined,
    body: string,
  ): Promise<{ message: DormHarmonyMessageModel; caseStatus: string }> {
    const found = await this.authorize(id, trackCode);
    if (found.status === DORM_HARMONY_STATUS.closed) {
      throw new ConflictError('该调解申请已经结案，无法继续留言');
    }

    const message = await this.repo.appendMessage({
      caseId: id,
      fromRole: DORM_HARMONY_FROM_ROLES.student,
      anonHandle: found.anonHandle,
      body: normalizeBody(body),
    });
    const caseStatus = await this.advanceIfSubmitted(found);

    await this.audit.record({
      actorId: null,
      actorType: 'anonymous',
      action: 'dorm-harmony.case.message',
      resource: 'DormHarmonyMessage',
      resourceId: message.id,
      module: DORM_HARMONY_MODULE_ID,
    });

    return { message, caseStatus };
  }

  /** 学生自己结案（问题已解决 / 不想再跟进） */
  async closeCase(id: string, trackCode: string | undefined): Promise<DormHarmonyCaseView> {
    const found = await this.authorize(id, trackCode);
    if (found.status === DORM_HARMONY_STATUS.closed) {
      throw new ConflictError('该调解申请已经结案');
    }

    const updated = await this.repo.updateStatus(id, DORM_HARMONY_STATUS.closed);
    await this.audit.record({
      actorId: null,
      actorType: 'anonymous',
      action: 'dorm-harmony.case.close',
      resource: 'DormHarmonyCase',
      resourceId: id,
      module: DORM_HARMONY_MODULE_ID,
    });
    return toView(updated);
  }

  /**
   * 调解员回复（未来调解员入口）。
   *
   * 这是本模块**唯一**需要登录的写接口：调解员是校方工作人员，
   * 用实名身份回复是职责所在。`mediatorId` 来自 JWT，消息本身不带实名 handle。
   */
  async mediatorReply(
    id: string,
    body: string,
    mediatorId: string,
  ): Promise<{ message: DormHarmonyMessageModel; caseStatus: string }> {
    const found = await this.repo.findById(id);
    if (!found) throw new NotFoundError('调解申请不存在或已被删除');
    if (found.status === DORM_HARMONY_STATUS.closed) {
      throw new ConflictError('该调解申请已经结案，无法继续回复');
    }

    const withMediator = await this.repo.setMediator(id, mediatorId);
    const message = await this.repo.appendMessage({
      caseId: id,
      fromRole: DORM_HARMONY_FROM_ROLES.mediator,
      // 调解员身份记在案子（mediatorId）上，留言本身不携带任何 handle
      anonHandle: null,
      body: normalizeBody(body),
    });

    await this.audit.record({
      actorId: mediatorId,
      action: 'dorm-harmony.case.mediator-reply',
      resource: 'DormHarmonyMessage',
      resourceId: message.id,
      module: DORM_HARMONY_MODULE_ID,
      metadata: { caseId: id },
    });

    return { message, caseStatus: withMediator.status };
  }

  /**
   * 追踪码校验。
   *
   * **刻意**把"案子不存在"和"追踪码错误"合并成同一个 FORBIDDEN：
   * 如果分开返回，攻击者就能用错误追踪码探测哪些案子 id 存在。
   * 比较用 `timingSafeEqual`，避免逐字节比较泄漏信息。
   */
  private async authorize(id: string, trackCode?: string): Promise<DormHarmonyCaseModel> {
    const found = await this.repo.findById(id);
    if (!found || !found.trackCodeHash || !trackCode || !trackCodeMatches(trackCode, found.trackCodeHash)) {
      throw new ForbiddenError('追踪码不正确，无法访问该调解申请');
    }
    return found;
  }

  private async advanceIfSubmitted(found: DormHarmonyCaseModel): Promise<string> {
    if (found.status !== DORM_HARMONY_STATUS.submitted) return found.status;
    const updated = await this.repo.updateStatus(found.id, DORM_HARMONY_STATUS.inProgress);
    return updated.status;
  }
}

/* ------------------------------------------------------------------ *
 * 视图与校验（纯函数，便于单测）
 * ------------------------------------------------------------------ */

function toView(row: DormHarmonyCaseModel): DormHarmonyCaseView {
  const { trackCodeHash: _trackCodeHash, ...view } = row;
  return view;
}

/** 追踪码是否匹配存储的 sha256 哈希（常量时间比较） */
function trackCodeMatches(trackCode: string, storedHash: string): boolean {
  const actual = Buffer.from(sha256Hex(trackCode), 'utf8');
  const expected = Buffer.from(storedHash, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeBuilding(value: unknown): string {
  const building = typeof value === 'string' ? value.trim() : '';
  if (building.length === 0) throw new ValidationError('请填写宿舍楼', { field: 'building' });
  if ([...building].length > 20) throw new ValidationError('宿舍楼最多 20 个字', { field: 'building' });
  return building;
}

function normalizeTopic(value: unknown): string {
  const topic = typeof value === 'string' ? value.trim() : '';
  if (topic.length === 0) throw new ValidationError('请简要描述问题', { field: 'topic' });
  if ([...topic].length > 40) throw new ValidationError('问题描述最多 40 个字', { field: 'topic' });
  return topic;
}

function normalizeExpectation(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !(DORM_HARMONY_EXPECTATIONS as readonly string[]).includes(value)) {
    throw new ValidationError('期望的解决方式不在支持范围内', {
      field: 'expectation',
      allowed: DORM_HARMONY_EXPECTATIONS,
    });
  }
  return value;
}

function normalizeBody(value: unknown): string {
  const body = typeof value === 'string' ? value.trim() : '';
  if (body.length === 0) throw new ValidationError('请填写留言内容', { field: 'body' });
  if ([...body].length > 2000) throw new ValidationError('留言最多 2000 个字', { field: 'body' });
  return body;
}

function normalizeOptionalText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${label}格式不正确`);
  const text = value.trim();
  if (text.length === 0) return null;
  if ([...text].length > max) throw new ValidationError(`${label}最多 ${max} 个字`);
  return text;
}
