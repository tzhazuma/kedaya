/**
 * TechPie 整合 HTTP 仓储 —— 端口 `TechpieRepository` / `CampusCardRepository` 的真实实现。
 *
 * 路由（模块名一律来自 `@kedaya/contracts` 的模块注册表，不硬编码字符串）：
 *   GET    /api/v1/techpie/links
 *   POST   /api/v1/techpie/links
 *   GET    /api/v1/techpie/links/:id
 *   DELETE /api/v1/techpie/links/:id
 *   POST   /api/v1/techpie/links/:id/renew      **已冻结 action**（契约 §11.2）
 *   GET    /api/v1/techpie/capabilities
 *   POST   /api/v1/techpie/webview-session
 *   POST   /api/v1/techpie/webview-session/:ticket
 *   GET    /api/v1/campus-card
 *   GET    /api/v1/campus-card/transactions
 *   POST   /api/v1/campus-card/payment-code
 *   DELETE /api/v1/campus-card/payment-code/current
 *
 * ⚠️ 身份：`userId` 从 `Authorization: Bearer` 取（`ApiClient.getAccessToken`），
 * **不**作为查询参数下发。
 * ⚠️ 明文密码：`credential.kind === 'password'` 在**发请求之前**就被拒绝
 * （§11.18-D）。这条闸门在 HTTP 与 mock 两个适配器里各有一份，
 * 因此"客户端绝不发送明文密码"是可测的不变式，而不是注释。
 * ⚠️ 票据：`ticket` 只出现在请求路径里，**不进日志、不进 URL 历史、不进缓存**。
 */
import { modulePath } from '@kedaya/contracts';
import type { ApiError, Page } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import type {
  CampusBindingSummary,
  CampusCard,
  CardTransaction,
  PaymentCode,
  TechpieCapabilitiesResponse,
  TechpieWebviewLaunch,
  TechpieWebviewTicket,
} from '@/domain/models/techpie';
import {
  assertPhase0Credential,
  type CampusCardRepository,
  type CreateTechpieLinkInput,
  type TechpieLinkListQuery,
  type TechpieRepository,
  type TechpieWebviewSessionRequest,
} from '@/domain/ports/techpie';

import { createTraceId, type ApiClient } from '../api/client';
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

const TECHPIE = `/${modulePath('techpie')}`;
const CAMPUS_CARD = `/${modulePath('campus-card')}`;

const LINKS_PATH = `${TECHPIE}/links`;
const CAPABILITIES_PATH = `${TECHPIE}/capabilities`;
const WEBVIEW_PATH = `${TECHPIE}/webview-session`;
const CARD_PATH = CAMPUS_CARD;
const TRANSACTIONS_PATH = `${CAMPUS_CARD}/transactions`;
const PAYMENT_CODE_PATH = `${CAMPUS_CARD}/payment-code`;

/** ApiClientError → 契约 ApiError（端口只认契约错误载荷） */
function toApiError(cause: {
  code: ApiError['code'];
  message: string;
  details?: unknown;
}): ApiError {
  return cause.details === undefined
    ? { code: cause.code, message: cause.message }
    : { code: cause.code, message: cause.message, details: cause.details };
}

function contractMismatch(what: string, issues: string[]): ApiError {
  return { code: 'INTERNAL', message: `后端返回的${what}不符合冻结契约`, details: { issues } };
}

/** 明文密码闸门（§11.18-D）：返回错误则**一个请求都不发** */
export function rejectNonPhase0Credential(input: CreateTechpieLinkInput): ApiError | null {
  const blocked = assertPhase0Credential({
    platform: input.platform,
    credential: input.credential,
  });
  if (!blocked) return null;
  return {
    code: 'FORBIDDEN',
    message: blocked,
    details: { reason: 'PHASE_1_NOT_IMPLEMENTED' },
  };
}

export function createTechpieHttpRepository(client: ApiClient): TechpieRepository {
  const linkPath = (id: string, ...rest: string[]): string =>
    `${LINKS_PATH}/${encodeURIComponent(id)}${rest.length > 0 ? `/${rest.join('/')}` : ''}`;

  return {
    async listLinks(
      query: TechpieLinkListQuery,
    ): Promise<Result<Page<CampusBindingSummary>, ApiError>> {
      const result = await client.get<unknown>(LINKS_PATH, {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      });
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseTechpieLinkPage(result.value);
      if (!parsed.ok) return err(contractMismatch('绑定列表', parsed.issues));
      return ok(parsed.value);
    },

    async getLink(id: string): Promise<Result<CampusBindingSummary, ApiError>> {
      const result = await client.get<unknown>(linkPath(id));
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseCampusBindingSummary(result.value);
      if (!parsed.ok) return err(contractMismatch('绑定详情', parsed.issues));
      return ok(parsed.value);
    },

    async createLink(
      input: CreateTechpieLinkInput,
    ): Promise<Result<CampusBindingSummary, ApiError>> {
      // 明文密码 / 非 Phase 0 平台：**不发请求**
      const blocked = rejectNonPhase0Credential(input);
      if (blocked) return err(blocked);

      const result = await client.post<unknown>(
        LINKS_PATH,
        { platform: input.platform, credential: input.credential },
        // 契约 §11.3：POST 必须带 Idempotency-Key
        { idempotencyKey: input.idempotencyKey ?? createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseCampusBindingSummary(result.value);
      if (!parsed.ok) return err(contractMismatch('绑定结果', parsed.issues));
      return ok(parsed.value);
    },

    async deleteLink(id: string): Promise<Result<{ deleted: true }, ApiError>> {
      const result = await client.del<unknown>(linkPath(id));
      if (!result.ok) return err(toApiError(result.error));
      return ok({ deleted: true });
    },

    async renewLink(id: string): Promise<Result<CampusBindingSummary, ApiError>> {
      const result = await client.post<unknown>(
        linkPath(id, 'renew'),
        {},
        { idempotencyKey: createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseCampusBindingSummary(result.value);
      if (!parsed.ok) return err(contractMismatch('续期结果', parsed.issues));
      return ok(parsed.value);
    },

    async listCapabilities(): Promise<Result<TechpieCapabilitiesResponse, ApiError>> {
      const result = await client.get<unknown>(CAPABILITIES_PATH);
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseTechpieCapabilitiesResponse(result.value);
      if (!parsed.ok) return err(contractMismatch('能力清单', parsed.issues));
      return ok(parsed.value);
    },

    async createWebviewSession(
      request: TechpieWebviewSessionRequest,
    ): Promise<Result<TechpieWebviewTicket, ApiError>> {
      /**
       * ⚠️ `platform === null` 时**必须整个省略这个键**，不能下发 `null`。
       *
       * 实测（与并行实现的 API 对照）：`services/api` 的
       * `webviewSessionSchema` 里 `platform` 是 `platformEnum.optional()` ——
       * zod 的 `.optional()` 接受 `undefined` 但**不接受 `null`**，
       * 下发 `platform: null` 会被判 `422 VALIDATION_FAILED`。
       * 而 Phase 0 的 W4 直连本来就不需要绑定（§9.1），
       * 因此正确做法是"不需要就不发这个字段"，而不是发一个 null。
       */
      const body: Record<string, unknown> = { targetUrl: request.targetUrl };
      if (request.platform !== null) body.platform = request.platform;

      const result = await client.post<unknown>(WEBVIEW_PATH, body, {
        idempotencyKey: request.idempotencyKey ?? createTraceId(),
      });
      if (!result.ok) return err(toApiError(result.error));

      // 客户端**再校验一次** targetUrl 白名单（fail-closed，§11.18-B）
      const parsed = safeParseTechpieWebviewTicket(result.value);
      if (!parsed.ok) return err(contractMismatch('WebView 票据', parsed.issues));
      return ok(parsed.value);
    },

    async redeemWebviewTicket(ticket: string): Promise<Result<TechpieWebviewLaunch, ApiError>> {
      // 票据只出现在路径里；**不进日志**（调用方不得把它写进任何 trace/console）
      const result = await client.post<unknown>(
        `${WEBVIEW_PATH}/${encodeURIComponent(ticket)}`,
        {},
        { idempotencyKey: createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseTechpieWebviewLaunch(result.value);
      if (!parsed.ok) return err(contractMismatch('WebView 打开地址', parsed.issues));
      return ok(parsed.value);
    },
  };
}

export function createCampusCardHttpRepository(client: ApiClient): CampusCardRepository {
  return {
    async getCard(): Promise<Result<CampusCard, ApiError>> {
      const result = await client.get<unknown>(CARD_PATH);
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseCampusCard(result.value);
      if (!parsed.ok) return err(contractMismatch('校园卡', parsed.issues));
      return ok(parsed.value);
    },

    async listTransactions(
      query: TechpieLinkListQuery,
    ): Promise<Result<Page<CardTransaction>, ApiError>> {
      const result = await client.get<unknown>(TRANSACTIONS_PATH, {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      });
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseCardTransactionPage(result.value);
      if (!parsed.ok) return err(contractMismatch('校园卡流水', parsed.issues));
      return ok(parsed.value);
    },

    async issuePaymentCode(): Promise<Result<PaymentCode, ApiError>> {
      const result = await client.post<unknown>(
        PAYMENT_CODE_PATH,
        {},
        { idempotencyKey: createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParsePaymentCode(result.value);
      if (!parsed.ok) return err(contractMismatch('付款码', parsed.issues));
      return ok(parsed.value);
    },

    async revokePaymentCode(): Promise<Result<{ revoked: true }, ApiError>> {
      const result = await client.del<unknown>(`${PAYMENT_CODE_PATH}/current`);
      if (!result.ok) return err(toApiError(result.error));
      return ok({ revoked: true });
    },
  };
}
