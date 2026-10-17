/**
 * TechPie 整合 mock 适配器（契约 §7 硬规则 4：必须有 mock，UI 才能脱离后端开发）。
 *
 * 行为对齐真实后端的**契约形状**：返回 `Result<..., ApiError>`，
 * 错误码只用冻结的 `ApiErrorCode`，`details.reason` 只用规格 §8.4 / §8.5 的冻结值。
 * 所有出站数据都过一遍 zod schema —— mock 也不能绕过契约校验。
 *
 * 本文件同时是**服务端替身**，因此承担了客户端不该做的事：
 * - `targetUrl` 白名单校验（fail-closed，§11.18-B）——真实实现里这**必须在服务端**，
 *   mock 里做一遍是为了让 P0-7 的客户端路径有东西可测；
 * - 一次性票据的签发 / 兑换 / 作废（30 秒、用后即焚，§8.4）；
 * - 限流（`webview-session` 10 次/分钟，§8.4）；
 * - `Idempotency-Key` 去重（契约 §11.3）。
 *
 * ⚠️ 本 mock **不产生任何 CASTGC / 校园会话数据**：Phase 0 不需要，
 * 而 §11.18-D 明确"在拿到书面回复前不实现任何 CASTGC 落库路径"。
 * ⚠️ 付款码的 `payload` 只在内存里活 60 秒，**不进任何日志**（`02-domain-model.md:1040`）。
 */
import type { ApiError, ApiErrorCode, Page } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import {
  checkCampusTargetUrl,
  PAYMENT_CODE_TTL_SEC,
  type CampusBindingSummary,
  type CampusCard,
  type CampusPlatform,
  type CardTransaction,
  type PaymentCode,
  type TechpieCapabilitiesResponse,
  type TechpieCapability,
  type TechpieCapabilityStatus,
  type TechpieWebviewLaunch,
  type TechpieWebviewTicket,
} from '@/domain/models/techpie';
import {
  assertPhase0Credential,
  type CampusCardRepository,
  type CreateTechpieLinkInput,
  type MockFailureMode,
  type TechpieLinkListQuery,
  type TechpieRepository,
  type TechpieWebviewSessionRequest,
} from '@/domain/ports/techpie';

import {
  safeParseCampusBindingSummary,
  safeParseCampusCard,
  safeParseCardTransactionPage,
  safeParsePaymentCode,
  safeParseTechpieCapabilitiesResponse,
  safeParseTechpieLinkPage,
  safeParseTechpieWebviewLaunch,
  safeParseTechpieWebviewTicket,
} from '../schemas/techpie';
import { slicePage } from './cursor';
import {
  campusCardFixture,
  cardTransactionFixtures,
  DEMO_TECHPIE_USER_ID,
  TECHPIE_CAPABILITY_FIXTURES,
  techpieLinkFixtures,
} from './fixtures/techpie';

/** 票据 TTL（规格 §8.4：30 秒，只需覆盖"换取 → 打开 WebView"） */
export const WEBVIEW_TICKET_TTL_SEC = 30;

/** 限流：10 次/分钟（规格 §8.4） */
export const WEBVIEW_SESSION_RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

export interface MockTechpieOptions {
  /** 人为延迟（默认 0：测试确定性优先；页面演示可传 260） */
  latencyMs?: number;
  /** 故障演练：'error' 时所有请求返回 UPSTREAM_UNAVAILABLE */
  failureMode?: MockFailureMode;
  /** 当前用户（真实 API 从 Bearer token 取；mock 需要它来扮演服务端） */
  viewerId?: string;
  /** 时间源（测试注入固定 now） */
  now?: () => Date;
  /** 覆盖绑定数据集 */
  seedLinks?: CampusBindingSummary[];
  /** 默认页大小 */
  pageSize?: number;
}

export interface MockTechpieRepository extends TechpieRepository, CampusCardRepository {
  setFailureMode(mode: MockFailureMode): void;
  getFailureMode(): MockFailureMode;
  /** 恢复到初始数据集（含票据 / 限流计数 / 幂等表） */
  reset(): void;

  /* ---- mock 专用控制（真实后端没有这些） ---- */

  /**
   * 模拟"用户已在校园卡侧完成 OPENID 授权"。
   *
   * 真实流程里这一步发生在**学校/微信侧**：Web 端发起绑定后只能到 `LINKING`，
   * 服务端轮询到授权完成才置为 `LINKED`。mock 用一个显式按钮代替轮询，
   * 避免"看不见的自动完成"——那会让演示与测试都无法确定性地控制状态。
   */
  completeOpenIdBinding(linkId: string): void;
  /**
   * 一键把校园卡置为已绑定（mock 演示用）。
   *
   * 真实流程：发起绑定 → 学校/微信侧完成 OPENID 授权 → 服务端置为 `LINKED`。
   * 演示时不想点三次，于是给一个显式入口 —— 它**只存在于 mock**。
   */
  linkEcardForDemo(): void;
  /** 直接写入一份绑定（测试用，绕过发起流程） */
  seedLink(link: CampusBindingSummary): void;
  /** 读取内部绑定快照（测试断言用） */
  linksSnapshot(): CampusBindingSummary[];
  /** 已签发但未兑换的票据数（测试断言"用后即焚"） */
  pendingTicketCount(): number;
}

function apiError(code: ApiErrorCode, message: string, details?: unknown): ApiError {
  return details === undefined ? { code, message } : { code, message, details };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createMockTechpieRepository(
  options: MockTechpieOptions = {},
): MockTechpieRepository {
  const now = options.now ?? (() => new Date());
  const latencyMs = options.latencyMs ?? 0;
  const pageSize = options.pageSize ?? 20;
  const viewerId = options.viewerId ?? DEMO_TECHPIE_USER_ID;

  let failureMode: MockFailureMode = options.failureMode ?? 'none';
  /** 单调计数器（每个仓储实例独立，保证测试确定性） */
  let seq = 0;

  const initialLinks = (): CampusBindingSummary[] =>
    clone(options.seedLinks ?? techpieLinkFixtures(now()));

  let links: CampusBindingSummary[] = initialLinks();
  /** 幂等键 → linkId（契约 §11.3） */
  const idempotency = new Map<string, string>();
  /** ticket → 记录（一次性，用后即焚） */
  let tickets = new Map<string, { targetUrl: string; expiresAt: number; used: boolean }>();
  /** 限流窗口 */
  let sessionCalls: number[] = [];

  const wait = async (): Promise<void> => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
  };

  const failIfNeeded = (): ApiError | null =>
    failureMode === 'error'
      ? apiError('UPSTREAM_UNAVAILABLE', 'TechPie 服务暂时不可用（mock 故障演练）')
      : null;

  const findLink = (id: string): CampusBindingSummary | undefined =>
    links.find((link) => link.id === id);

  const ecardLink = (): CampusBindingSummary | undefined =>
    links.find((link) => link.platform === 'ecard' && link.status === 'LINKED');

  /** 校园卡未绑定 → `CAMPUS_BINDING_REQUIRED`（**合法状态**，不是 401） */
  const requireEcard = (): ApiError | null =>
    ecardLink()
      ? null
      : apiError(
          'CAMPUS_BINDING_REQUIRED',
          '校园卡尚未绑定。绑定走 OPENID 通道，与校园会话（CASTGC）完全无关。',
          { reason: 'CAMPUS_BINDING_REQUIRED', platform: 'ecard' },
        );

  /**
   * 能力状态 = 绑定状态 + 阶段（**服务端判定**，客户端不自己推导）。
   * Phase 1/2 一律 `PHASE_BLOCKED` —— 不给"未绑定"的错觉。
   */
  const withCapabilityStatus = (capability: TechpieCapability): TechpieCapability => {
    if (capability.phase !== 'phase0') {
      return { ...capability, status: 'PHASE_BLOCKED' };
    }
    if (capability.access === 'webview' || capability.platform === null) {
      return { ...capability, status: 'AVAILABLE' };
    }
    const link = links.find((item) => item.platform === capability.platform);
    let status: TechpieCapabilityStatus = 'CAMPUS_BINDING_REQUIRED';
    if (link?.status === 'LINKED') status = 'AVAILABLE';
    else if (link?.status === 'EXPIRED') status = 'EXPIRED';
    else if (link?.status === 'LINKING') status = 'CAMPUS_BINDING_REQUIRED';
    return { ...capability, status };
  };

  return {
    /* ---------------- 绑定 ---------------- */

    async listLinks(query: TechpieLinkListQuery): Promise<Result<Page<CampusBindingSummary>, ApiError>> {
      await wait();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const page = slicePage(links, query.cursor, query.limit, pageSize);
      const parsed = safeParseTechpieLinkPage(page);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 生成的绑定列表不符合契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async getLink(id: string): Promise<Result<CampusBindingSummary, ApiError>> {
      await wait();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const link = findLink(id);
      if (!link) return err(apiError('NOT_FOUND', '绑定不存在或不属于当前用户'));

      const parsed = safeParseCampusBindingSummary(link);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 生成的绑定详情不符合契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async createLink(
      input: CreateTechpieLinkInput,
    ): Promise<Result<CampusBindingSummary, ApiError>> {
      await wait();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      // 幂等：同一 Idempotency-Key 重复提交返回同一资源（契约 §11.3）
      if (input.idempotencyKey) {
        const existingId = idempotency.get(input.idempotencyKey);
        if (existingId) {
          const existing = findLink(existingId);
          if (existing) return ok(clone(existing));
        }
      }

      // Phase 0 凭证闸门（§11.18-D）：**绝不接受明文密码**，非 Phase 0 平台一律拒绝
      const blocked = assertPhase0Credential({
        platform: input.platform,
        credential: input.credential,
      });
      if (blocked) {
        return err(apiError('FORBIDDEN', blocked, { reason: 'PHASE_1_NOT_IMPLEMENTED' }));
      }

      if (links.some((link) => link.platform === input.platform && link.status === 'LINKED')) {
        return err(apiError('CONFLICT', '该平台已经绑定过了', { reason: 'ALREADY_LINKED' }));
      }

      // OPENID 通道在 Web 端只能到 `LINKING`：授权发生在学校/微信侧。
      // （§8.5 的 password 通道是"同步校验凭证 → LINKED"，Phase 0 不实现那条路。）
      const created: CampusBindingSummary = {
        id: `lk_${input.platform}_${String(++seq).padStart(4, '0')}`,
        platform: input.platform,
        status: 'LINKING',
        externalUserId: null,
        expiresAt: null,
        lastSyncAt: null,
      };
      // 重新绑定：把同平台的旧行替换掉（`REVOKED → UNLINKED → LINKING`）
      links = [...links.filter((link) => link.platform !== input.platform), created];
      if (input.idempotencyKey) idempotency.set(input.idempotencyKey, created.id);

      const parsed = safeParseCampusBindingSummary(created);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 生成的绑定不符合契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async deleteLink(id: string): Promise<Result<{ deleted: true }, ApiError>> {
      await wait();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const link = findLink(id);
      if (!link) return err(apiError('NOT_FOUND', '绑定不存在或不属于当前用户'));

      // DELETE = 资源删除（契约 §11.2 的 close 语义由 DELETE 承载）。
      // 审计与保留期策略在服务端，客户端只看到"它不在列表里了"。
      links = links.filter((item) => item.id !== id);
      return ok({ deleted: true });
    },

    async renewLink(id: string): Promise<Result<CampusBindingSummary, ApiError>> {
      await wait();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const link = findLink(id);
      if (!link) return err(apiError('NOT_FOUND', '绑定不存在或不属于当前用户'));

      // F3 / R4：上游没有续期能力时**明确报不支持**，绝不谎称"已续期"。
      // Phase 0 只有校园卡（OPENID 通道）能续期；其余平台的续期依赖上游能力（U8，未确认）。
      if (link.platform !== 'ecard') {
        return err(
          apiError(
            'CONFLICT',
            '该平台的续期能力尚未确认（上游是否提供续期接口仍待 GeekPie 书面确认），可达鸭不会假装续期成功。',
            { reason: 'RENEW_NOT_SUPPORTED' },
          ),
        );
      }

      const renewed: CampusBindingSummary = {
        ...link,
        status: 'LINKED',
        lastSyncAt: now().toISOString(),
      };
      links = links.map((item) => (item.id === id ? renewed : item));

      const parsed = safeParseCampusBindingSummary(renewed);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 生成的绑定不符合契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    /* ---------------- 能力清单 ---------------- */

    async listCapabilities(): Promise<Result<TechpieCapabilitiesResponse, ApiError>> {
      await wait();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const response: TechpieCapabilitiesResponse = {
        items: TECHPIE_CAPABILITY_FIXTURES.map((capability) =>
          withCapabilityStatus(clone(capability)),
        ),
        // §11.18-B 第 2 条：白名单内容为占位，必须机器可见
        allowlistPlaceholder: true,
      };

      const parsed = safeParseTechpieCapabilitiesResponse(response);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 生成的能力清单不符合契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    /* ---------------- WebView 一次性票据（§8.4） ---------------- */

    async createWebviewSession(
      request: TechpieWebviewSessionRequest,
    ): Promise<Result<TechpieWebviewTicket, ApiError>> {
      await wait();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      // 限流：10 次/分钟（§8.4）
      const current = now().getTime();
      sessionCalls = sessionCalls.filter((at) => current - at < RATE_WINDOW_MS);
      if (sessionCalls.length >= WEBVIEW_SESSION_RATE_LIMIT) {
        return err(
          apiError('RATE_LIMITED', '换取 WebView 票据过于频繁，请稍后再试', {
            reason: 'RATE_LIMITED',
            limitPerMinute: WEBVIEW_SESSION_RATE_LIMIT,
          }),
        );
      }

      // https 校验（§8.4：非 https → 422 VALIDATION_FAILED）
      if (!request.targetUrl.startsWith('https://')) {
        return err(
          apiError('VALIDATION_FAILED', 'targetUrl 必须是 https', {
            reason: 'TARGET_URL_NOT_HTTPS',
          }),
        );
      }

      // 白名单校验（§8.4：不在名单 → 403 FORBIDDEN / TARGET_URL_NOT_ALLOWED）
      const check = checkCampusTargetUrl(request.targetUrl);
      if (!check.allowed) {
        return err(
          apiError('FORBIDDEN', 'targetUrl 不在校园域名白名单内（fail-closed）', {
            reason: 'TARGET_URL_NOT_ALLOWED',
            detail: check.reason,
          }),
        );
      }

      // 已绑定校验（§8.4 的表格）。Phase 0 的 W4 直连不注入 cookie，
      // 因此 `platform = null` 时跳过；服务端在 Phase 2 的注入模式下会拒绝 null。
      if (request.platform !== null) {
        const link = links.find((item) => item.platform === request.platform);
        if (!link || link.status !== 'LINKED') {
          return err(
            apiError(
              'CAMPUS_BINDING_REQUIRED',
              '该平台尚未绑定。这是合法状态，不是登录过期。',
              { reason: 'CAMPUS_BINDING_REQUIRED', platform: request.platform },
            ),
          );
        }
      }

      sessionCalls.push(current);
      const ticket = `wvt_${String(++seq).padStart(6, '0')}`;
      tickets.set(ticket, {
        targetUrl: request.targetUrl,
        expiresAt: current + WEBVIEW_TICKET_TTL_SEC * 1000,
        used: false,
      });

      const payload: TechpieWebviewTicket = {
        ticket,
        expiresInSec: WEBVIEW_TICKET_TTL_SEC,
        targetUrl: request.targetUrl,
      };
      const parsed = safeParseTechpieWebviewTicket(payload);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 生成的票据不符合契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async redeemWebviewTicket(ticket: string): Promise<Result<TechpieWebviewLaunch, ApiError>> {
      await wait();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const record = tickets.get(ticket);
      if (!record || record.used || record.expiresAt <= now().getTime()) {
        // 不区分"不存在 / 已用 / 已过期"——票据是一次性的，客户端不需要知道细节
        return err(
          apiError('NOT_FOUND', '票据无效、已过期或已被使用（票据是一次性的）', {
            reason: 'TICKET_NOT_FOUND',
          }),
        );
      }

      // 用后即焚：立刻标记 + 从表里删除
      record.used = true;
      tickets.delete(ticket);

      const launch: TechpieWebviewLaunch = {
        url: record.targetUrl,
        targetUrl: record.targetUrl,
        // Phase 0 = W4：**不做 cookie 注入**，用户在学校页面自己登录（§8.4 方案表）
        mode: 'direct',
        expiresAt: null,
      };
      const parsed = safeParseTechpieWebviewLaunch(launch);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 生成的打开地址不符合契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    /* ---------------- 校园卡（OPENID 通道） ---------------- */

    async getCard(): Promise<Result<CampusCard, ApiError>> {
      await wait();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const needsBinding = requireEcard();
      if (needsBinding) return err(needsBinding);

      const parsed = safeParseCampusCard(campusCardFixture(now()));
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 生成的校园卡不符合契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async listTransactions(
      query: TechpieLinkListQuery,
    ): Promise<Result<Page<CardTransaction>, ApiError>> {
      await wait();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const needsBinding = requireEcard();
      if (needsBinding) return err(needsBinding);

      const page = slicePage(cardTransactionFixtures(now()), query.cursor, query.limit, pageSize);
      const parsed = safeParseCardTransactionPage(page);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 生成的流水不符合契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async issuePaymentCode(): Promise<Result<PaymentCode, ApiError>> {
      await wait();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const needsBinding = requireEcard();
      if (needsBinding) return err(needsBinding);

      const issuedAt = now();
      // 每次调用生成**新码**，旧码立即失效（契约 §3.3 `IssuePaymentCode`）。
      // mock 只保留"当前码"这一份，因此旧的天然不存在了。
      const code: PaymentCode = {
        payload: `KEDAYA-ECARD-${String(++seq).padStart(6, '0')}-${issuedAt.getTime()}`,
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + PAYMENT_CODE_TTL_SEC * 1000).toISOString(),
        ttlSec: PAYMENT_CODE_TTL_SEC,
      };
      const parsed = safeParsePaymentCode(code);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 生成的付款码不符合契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async revokePaymentCode(): Promise<Result<{ revoked: true }, ApiError>> {
      await wait();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      // 审计只记 `PAYMENT_CODE_REVOKE` 动作，**不记码值**（`05-security-privacy.md:404`）
      return ok({ revoked: true });
    },

    /* ---------------- mock 控制 ---------------- */

    setFailureMode(mode: MockFailureMode): void {
      failureMode = mode;
    },

    getFailureMode(): MockFailureMode {
      return failureMode;
    },

    reset(): void {
      links = initialLinks();
      idempotency.clear();
      tickets = new Map();
      sessionCalls = [];
      seq = 0;
      failureMode = 'none';
    },

    completeOpenIdBinding(linkId: string): void {
      links = links.map((link) =>
        link.id === linkId
          ? {
              ...link,
              status: 'LINKED',
              externalUserId: viewerId,
              lastSyncAt: now().toISOString(),
            }
          : link,
      );
    },

    linkEcardForDemo(): void {
      links = [
        ...links.filter((link) => link.platform !== 'ecard'),
        {
          id: 'lk_ecard_demo',
          platform: 'ecard',
          status: 'LINKED',
          externalUserId: viewerId,
          expiresAt: null,
          lastSyncAt: now().toISOString(),
        },
      ];
    },

    seedLink(link: CampusBindingSummary): void {
      links = [...links.filter((item) => item.platform !== link.platform), clone(link)];
    },

    linksSnapshot(): CampusBindingSummary[] {
      return clone(links);
    },

    pendingTicketCount(): number {
      return tickets.size;
    },
  };
}
