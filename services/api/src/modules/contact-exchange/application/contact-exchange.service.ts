/**
 * 联系方式交换 · 交换申请（用例层）
 *
 * ## 状态机
 *
 * ```
 * PENDING ──approve(仅被申请人)──▶ ACCEPTED ──revoke(任一方)──▶ REVOKED
 *    │                                  │
 *    ├─reject(仅被申请人)──▶ REJECTED     └─ 对方立即可读 shared=true 条目
 *    ├─revoke(任一方)────▶ REVOKED
 *    └─expiresAt 到期────▶ EXPIRED（惰性：任何读写前先落库）
 * ```
 *
 * ## 隐私三原则（在代码里的落点）
 *
 * 1. **交换的是读取权限，不是副本**：`ACCEPTED` 只是允许 `viewContacts`
 *    实时查对方 `shared = true` 的条目；同意 / 审批**不复制**任何联系方式。
 *    因此撤销协议、取消单条授权、删除条目都立即生效。
 * 2. **默认最小暴露**：`PENDING` 详情只有关系元数据，没有任何联系方式字段；
 *    `viewContacts` 在非 `ACCEPTED` 时直接 `CONSENT_REQUIRED`，连脱敏值都不生成。
 * 3. **审计 fail-closed**：先写审计再返回；审计写不进去就不放行读取。
 *    审计只存条目 id / 类型，不存 value（见 `AppendContactAuditInput`）。
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CONTACT_EXCHANGE_DEFAULT_RATE_LIMIT,
  CONTACT_EXCHANGE_PENDING_TTL_MS,
  CONTACT_EXCHANGE_RATE_LIMIT_ENV,
  CONTACT_EXCHANGE_WINDOW_MS,
  type ContactExchangeRequestWire,
  type ContactExchangeStatus,
  type ContactKind,
  type ExchangedContactsWire,
  type Page,
} from '@kedaya/contracts';
import {
  AppError,
  ConflictError,
  InternalError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from '../../../common/errors/app-error';
import { parseTimeCursor } from './parse-cursor';
import {
  CONTACT_EXCHANGE_CIPHER,
  CONTACT_EXCHANGE_REPOSITORY,
  ContactExchangeRepositoryError,
  containsContactInfo,
  counterpartyOf,
  decideApprove,
  decideReject,
  decideRevoke,
  decideView,
  isAllowedContextModule,
  isRateLimited,
  isRequestParty,
  pairKeyOf,
  toAuditLogPayload,
  toContactExchangeRequestWire,
  toExchangedContactWire,
  type ContactCryptoPort,
  type ContactExchangeRepository,
  type ContactExchangeRequestRecord,
  type RequestDecision,
  type RequestDecisionAllowed,
} from '../domain/contact-exchange.domain';

export interface ApplyContactExchangeDto {
  addresseeId: string;
  contextModule: string;
  contextId?: string | null;
  message?: string | null;
}

export interface ListContactExchangeQuery {
  direction: 'incoming' | 'outgoing' | 'all';
  status?: ContactExchangeStatus;
  cursor?: string;
  limit: number;
}

const MAX_MESSAGE_LENGTH = 200;
const MAX_CONTEXT_ID_LENGTH = 64;

@Injectable()
export class ContactExchangeService {
  private readonly logger = new Logger(ContactExchangeService.name);

  constructor(
    @Inject(CONTACT_EXCHANGE_REPOSITORY) private readonly repo: ContactExchangeRepository,
    @Inject(CONTACT_EXCHANGE_CIPHER) private readonly cipher: ContactCryptoPort,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /* ------------------------------------------------------------------ *
   * 发起 / 列表 / 详情
   * ------------------------------------------------------------------ */

  async apply(requesterId: string, input: ApplyContactExchangeDto) {
    const addresseeId = input.addresseeId.trim();
    if (addresseeId === requesterId) {
      throw new ValidationError('不能向自己发起联系方式交换', { field: 'addresseeId' });
    }

    const contextModule = input.contextModule.trim();
    if (!isAllowedContextModule(contextModule)) {
      throw new ValidationError('该模块不允许作为联系方式交换的上下文', {
        field: 'contextModule',
      });
    }

    const contextId = input.contextId?.trim() ?? null;
    if (contextId !== null && contextId.length > MAX_CONTEXT_ID_LENGTH) {
      throw new ValidationError('contextId 不能超过 64 个字符', { field: 'contextId' });
    }

    const message = input.message?.trim() ?? null;
    if (message !== null) {
      if (message.length > MAX_MESSAGE_LENGTH) {
        throw new ValidationError('申请附言不能超过 200 个字符', { field: 'message' });
      }
      // 防绕过：联系方式只能走"双方同意后读取"，不能写进附言。
      if (containsContactInfo(message)) {
        throw new ValidationError(
          '申请附言不得包含手机号/微信号/邮箱/QQ，请在双方同意后通过交换功能查看',
          { field: 'message', reason: 'CONTACT_INFO_IN_MESSAGE' },
        );
      }
    }

    const now = new Date();

    // 过期申请先落库，否则部分唯一索引会继续把它当成"活跃申请"。
    await this.repo.expireStaleRequests(now);

    if (!(await this.repo.userExists(addresseeId))) {
      throw new NotFoundError('对方用户不存在');
    }

    const pairKey = pairKeyOf(requesterId, addresseeId);
    const since = new Date(now.getTime() - CONTACT_EXCHANGE_WINDOW_MS);
    const recentCount = await this.repo.countRecentRequestsByPair(pairKey, since);
    const limit = this.rateLimit();
    if (isRateLimited(recentCount, limit)) {
      throw new RateLimitedError('24 小时内向同一同学发起次数过多，请稍后再试', {
        limit,
        windowMs: CONTACT_EXCHANGE_WINDOW_MS,
      });
    }

    const active = await this.repo.findActiveRequestByPair(pairKey);
    if (active) {
      throw new ConflictError(
        active.status === 'ACCEPTED'
          ? '你们已经建立了联系方式交换，可直接查看'
          : '已有一条待处理的联系方式交换申请，请等待对方回应',
        { requestId: active.id, status: active.status },
      );
    }

    try {
      const row = await this.repo.createRequest({
        requesterId,
        addresseeId,
        pairKey,
        contextModule,
        contextId,
        message,
        expiresAt: new Date(now.getTime() + CONTACT_EXCHANGE_PENDING_TTL_MS),
      });
      return toContactExchangeRequestWire(row);
    } catch (error) {
      if (error instanceof ContactExchangeRepositoryError && error.reason === 'DUPLICATE_ACTIVE_REQUEST') {
        throw new ConflictError('已有一条待处理的联系方式交换申请，请等待对方回应');
      }
      throw error;
    }
  }

  async list(
    userId: string,
    query: ListContactExchangeQuery,
  ): Promise<Page<ContactExchangeRequestWire>> {
    await this.repo.expireStaleRequests(new Date());
    const page = await this.repo.listRequests(userId, {
      direction: query.direction,
      ...(query.status ? { status: query.status } : {}),
      cursor: parseTimeCursor(query.cursor),
      limit: query.limit,
    });

    return {
      items: page.items.map(toContactExchangeRequestWire),
      nextCursor: page.nextCursor,
    };
  }

  async detail(userId: string, id: string) {
    await this.repo.expireStaleRequests(new Date());
    const request = await this.requireParty(userId, id);
    return toContactExchangeRequestWire(request);
  }

  /* ------------------------------------------------------------------ *
   * 同意 / 拒绝 / 撤销
   * ------------------------------------------------------------------ */

  async approve(userId: string, id: string) {
    const now = new Date();
    await this.repo.expireStaleRequests(now);
    const request = await this.requireParty(userId, id);
    const decision = this.decide(() => decideApprove(request, userId, now));

    const updated = await this.repo.updateRequestStatus(id, {
      status: decision.nextStatus,
      respondedAt: decision.respondedAt ?? now,
    });
    return toContactExchangeRequestWire(updated);
  }

  async reject(userId: string, id: string) {
    const now = new Date();
    await this.repo.expireStaleRequests(now);
    const request = await this.requireParty(userId, id);
    const decision = this.decide(() => decideReject(request, userId, now));

    const updated = await this.repo.updateRequestStatus(id, {
      status: decision.nextStatus,
      respondedAt: decision.respondedAt ?? now,
    });
    return toContactExchangeRequestWire(updated);
  }

  async revoke(userId: string, id: string) {
    const now = new Date();
    await this.repo.expireStaleRequests(now);
    const request = await this.requireParty(userId, id);
    const decision = this.decide(() => decideRevoke(request, userId, now));

    const updated = await this.repo.updateRequestStatus(id, {
      status: decision.nextStatus,
      revokedAt: decision.revokedAt ?? now,
      revokedBy: decision.revokedBy ?? userId,
    });
    return toContactExchangeRequestWire(updated);
  }

  /* ------------------------------------------------------------------ *
   * 读取对方联系方式（唯一的"看明文"入口）
   * ------------------------------------------------------------------ */

  async viewContacts(userId: string, id: string): Promise<ExchangedContactsWire> {
    const request = await this.requireParty(userId, id);

    // 未同意 / 已拒绝 / 已撤销 / 已过期 → CONSENT_REQUIRED。
    // 注意：这里**不**构造任何 masked / preview 版本 —— 连脱敏值都不返回。
    this.decide(() => decideView(request, new Date()));

    const counterpartyId = counterpartyOf(request, userId);
    const sharedRows = (await this.repo.listSharedEntries(counterpartyId)).filter((row) => row.shared);

    const entries = sharedRows.map((row) =>
      toExchangedContactWire(row, this.cipher.decrypt(row.valueCipher)),
    );

    // 审计 fail-closed：先写审计，再返回明文。写不进去 → 500，不泄漏联系方式。
    const audit = await this.repo.appendAudit({
      actorId: userId,
      subjectId: counterpartyId,
      requestId: request.id,
      entryIds: sharedRows.map((row) => row.id),
      entryKinds: sharedRows.map((row) => row.kind as ContactKind),
    });

    // 日志同样走允许清单投影（id / 类型 / 数量 / 时间），不含 value / 密文。
    this.logger.debug(JSON.stringify(toAuditLogPayload(audit)));

    return {
      requestId: request.id,
      counterpartyId,
      entries,
      viewedAt: audit.at.toISOString(),
    };
  }

  /* ------------------------------------------------------------------ *
   * 内部
   * ------------------------------------------------------------------ */

  private async requireParty(userId: string, id: string): Promise<ContactExchangeRequestRecord> {
    const request = await this.repo.findRequestById(id);
    // 非当事人 → 404，不泄漏"这条申请存在但与你无关"。
    if (!request || !isRequestParty(request, userId)) {
      throw new NotFoundError('联系方式交换申请不存在');
    }
    return request;
  }

  private decide(build: () => RequestDecision): RequestDecisionAllowed {
    const decision = build();
    if (!decision.allowed) throw new AppError(decision.code, decision.message);
    return decision;
  }

  /**
   * 24h 限流阈值。环境变量可覆盖，缺省 3。
   *
   * 注意：这里**不**因为配置错误而静默使用默认值 —— 配错就启动后第一次
   * 申请时抛 INTERNAL，迫使部署方修正。阈值本身不是密钥，允许默认值。
   */
  private rateLimit(): number {
    const raw = this.config.get<string>(CONTACT_EXCHANGE_RATE_LIMIT_ENV);
    if (raw === undefined || raw === null || raw === '') return CONTACT_EXCHANGE_DEFAULT_RATE_LIMIT;

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new InternalError(`${CONTACT_EXCHANGE_RATE_LIMIT_ENV} 必须是 1–100 的整数`);
    }
    return parsed;
  }
}
