/**
 * TechPie 整合传输层校验（zod）—— data 层职责：**校验不可信输入**。
 *
 * domain 模型是类型真相；这里用类型级断言保证 schema 输出与 domain 模型
 * 双向可赋值 —— schema 一旦漂移，`tsc` 立刻报错（与 buddy / forum / wildlife 同一套约定）。
 *
 * 本文件承担两条**负向**职责（契约 §11.4 I1 / §8.3）：
 * 1. 绑定摘要里一旦出现 `cookie` / `session` / `tgc` / `castgc` / `ticket` / `tenant` …
 *    任何凭证键名，**整条响应作废**（返回 `INTERNAL`），不得渲染；
 * 2. `webview-session` 的 `targetUrl` 必须过**客户端 fail-closed 白名单**
 *    （契约 §11.18-B）—— 服务端仍须独立校验，这是纵深防御。
 */
import { z } from 'zod';

import {
  checkCampusTargetUrl,
  findForbiddenCredentialKeys,
  type CampusBindingSummary,
  type CampusCard,
  type CampusPlatform,
  type CardTransaction,
  type PaymentCode,
  type TechpieCapabilitiesResponse,
  type TechpieCapability,
  type TechpieWebviewLaunch,
  type TechpieWebviewTicket,
} from '@/domain/models/techpie';

/** 类型级断言：From 必须可赋值给 To（不产生运行时代码） */
type AssertAssignable<From extends To, To> = true;

/**
 * 契约 §11.10-B 冻结的平台枚举 —— **逐字写出**（不用 `z.enum(CAMPUS_PLATFORMS)`，
 * 那会退化成 `z.enum(string[])` 而丢掉字面量类型）。
 * 下面两条 `AssertAssignable` 断言保证它与 domain 的 `CampusPlatform` 双向一致；
 * `techpie.test.ts` 另有一条断言保证两个清单的**取值集合**相同。
 */
export const campusPlatformSchema = z.enum(['cas', 'egate', 'cpdaily', 'ecard', 'techpie']);

export const techpieLinkStatusSchema = z.enum([
  'UNLINKED',
  'LINKING',
  'LINKED',
  'EXPIRED',
  'REVOKED',
]);

export const techpiePhaseSchema = z.enum(['phase0', 'phase1', 'phase2']);

export const techpieCapabilityAccessSchema = z.enum(['openid', 'webview', 'server_proxy']);

export const techpieCapabilityStatusSchema = z.enum([
  'AVAILABLE',
  'CAMPUS_BINDING_REQUIRED',
  'EXPIRED',
  'PHASE_BLOCKED',
  'UPSTREAM_UNAVAILABLE',
]);

/** 绑定摘要（规格 §8.3）—— **不含凭证** */
export const campusBindingSummarySchema = z.object({
  id: z.string().min(1),
  platform: campusPlatformSchema,
  status: techpieLinkStatusSchema,
  externalUserId: z.string().nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  lastSyncAt: z.iso.datetime({ offset: true }).nullable(),
});

export const techpieLinkPageSchema = z.object({
  items: z.array(campusBindingSummarySchema),
  nextCursor: z.string().nullable(),
  total: z.int().nonnegative().optional(),
});

export const techpieCapabilitySchema = z.object({
  id: z.string().min(1),
  moduleId: z.string().min(1),
  nameZh: z.string().min(1),
  summary: z.string(),
  phase: techpiePhaseSchema,
  access: techpieCapabilityAccessSchema,
  platform: campusPlatformSchema.nullable(),
  targetUrl: z.string().nullable(),
  status: techpieCapabilityStatusSchema,
  guidance: z.string().nullable(),
});

export const techpieCapabilitiesResponseSchema = z.object({
  items: z.array(techpieCapabilitySchema),
  allowlistPlaceholder: z.boolean(),
});

/** `POST /techpie/webview-session` 响应（规格 §8.4 已冻结形状） */
export const techpieWebviewTicketSchema = z.object({
  ticket: z.string().min(1),
  expiresInSec: z.int().positive(),
  targetUrl: z.string().min(1),
});

export const techpieWebviewLaunchSchema = z.object({
  url: z.string().min(1),
  targetUrl: z.string().min(1),
  mode: z.enum(['direct', 'injected']),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
});

/* ---- 校园卡 ---- */

export const campusCardStatusSchema = z.enum(['ACTIVE', 'FROZEN', 'LOST', 'CLOSED']);

export const campusCardSchema = z.object({
  cardNoMasked: z.string().min(1),
  balanceFen: z.int(),
  status: campusCardStatusSchema,
  syncedAt: z.iso.datetime({ offset: true }),
});

export const cardTransactionKindSchema = z.enum(['meal', 'shop', 'recharge', 'refund', 'other']);

export const cardTransactionSchema = z.object({
  id: z.string().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
  amountFen: z.int(),
  merchant: z.string().nullable(),
  kind: cardTransactionKindSchema,
});

export const cardTransactionPageSchema = z.object({
  items: z.array(cardTransactionSchema),
  nextCursor: z.string().nullable(),
  total: z.int().nonnegative().optional(),
});

export const paymentCodeSchema = z.object({
  payload: z.string().min(1),
  issuedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  ttlSec: z.int().positive(),
});

/* ---- 编译期一致性断言（schema ↔ domain） ---- */
export type __PlatformSchemaIsDomain = AssertAssignable<
  z.infer<typeof campusPlatformSchema>,
  CampusPlatform
>;
export type __PlatformDomainIsSchema = AssertAssignable<
  CampusPlatform,
  z.infer<typeof campusPlatformSchema>
>;
export type __SummarySchemaIsDomain = AssertAssignable<
  z.infer<typeof campusBindingSummarySchema>,
  CampusBindingSummary
>;
export type __SummaryDomainIsSchema = AssertAssignable<
  CampusBindingSummary,
  z.infer<typeof campusBindingSummarySchema>
>;
export type __CapabilitySchemaIsDomain = AssertAssignable<
  z.infer<typeof techpieCapabilitySchema>,
  TechpieCapability
>;
export type __CapabilitiesResponseSchemaIsDomain = AssertAssignable<
  z.infer<typeof techpieCapabilitiesResponseSchema>,
  TechpieCapabilitiesResponse
>;
export type __TicketSchemaIsDomain = AssertAssignable<
  z.infer<typeof techpieWebviewTicketSchema>,
  TechpieWebviewTicket
>;
export type __LaunchSchemaIsDomain = AssertAssignable<
  z.infer<typeof techpieWebviewLaunchSchema>,
  TechpieWebviewLaunch
>;
export type __CardSchemaIsDomain = AssertAssignable<
  z.infer<typeof campusCardSchema>,
  CampusCard
>;
export type __TransactionSchemaIsDomain = AssertAssignable<
  z.infer<typeof cardTransactionSchema>,
  CardTransaction
>;
export type __PaymentCodeSchemaIsDomain = AssertAssignable<
  z.infer<typeof paymentCodeSchema>,
  PaymentCode
>;

/* ------------------------------------------------------------------ *
 * 解析助手
 * ------------------------------------------------------------------ */

/** 校验失败时的可读问题清单 */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

export interface ParseOk<T> {
  ok: true;
  value: T;
}
export interface ParseFail {
  ok: false;
  issues: string[];
}

function parseWith<T>(result: z.ZodSafeParseResult<T>): ParseOk<T> | ParseFail {
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: formatZodIssues(result.error) };
}

/**
 * 凭证键名闸门 —— **先于 schema 解析**执行。
 *
 * 一旦响应里出现 8 个禁用键名之一，说明后端把二级凭证泄漏进了一级通道
 * （契约 §11.4 I1 / §8.3 的镜像断言），此时**整条响应作废**。
 */
export function rejectForbiddenCredentialKeys(payload: unknown): ParseFail | null {
  const hits = findForbiddenCredentialKeys(payload);
  if (hits.length === 0) return null;
  return {
    ok: false,
    issues: [
      `响应里出现了契约 §11.4 I1 禁止的凭证键名：${hits.join(', ')}。` +
        '二级校园凭证绝不能出现在绑定摘要或任何业务响应里。',
    ],
  };
}

function guarded<T>(schema: z.ZodType<T>, payload: unknown): ParseOk<T> | ParseFail {
  const rejected = rejectForbiddenCredentialKeys(payload);
  if (rejected) return rejected;
  return parseWith(schema.safeParse(payload));
}

export function safeParseCampusBindingSummary(payload: unknown): ParseOk<CampusBindingSummary> | ParseFail {
  return guarded(campusBindingSummarySchema, payload);
}

export function safeParseTechpieLinkPage(
  payload: unknown,
): ParseOk<z.infer<typeof techpieLinkPageSchema>> | ParseFail {
  return guarded(techpieLinkPageSchema, payload);
}

export function safeParseTechpieCapabilitiesResponse(
  payload: unknown,
): ParseOk<TechpieCapabilitiesResponse> | ParseFail {
  return guarded(techpieCapabilitiesResponseSchema, payload);
}

/**
 * `webview-session` 响应解析 + **白名单二次校验**（fail-closed）。
 *
 * 契约 §11.18-B：`targetUrl` 必须来自服务端白名单。服务端已经校验过一次，
 * 客户端**再校验一次**：万一票据绑定的 host 不是我们认识的那个，宁可报错，
 * 也不能把它塞进 WebView。
 *
 * ⚠️ 这里**刻意不用** `guarded()`（即不做 I1 的禁用键名扫描）：
 * 规格 §8.4 冻结的响应体**本来就含 `ticket` 字段** —— 它是"创建一次性票据资源"
 * 的返回值，不是绑定摘要。I1 的禁用键名断言针对的是**身份层与绑定摘要**
 * （`CampusBindingSummary` / capabilities / campus-card），
 * 在那里出现 `ticket` 才意味着二级凭证泄漏进了一级通道。
 * 而 `ticket` **绝不进日志/缓存/URL** 由 `OneTimeTicketHolder` 与
 * `platform/redact.ts` 保证（见 `webviewTicket.security.test.ts`）。
 */
export function safeParseTechpieWebviewTicket(
  payload: unknown,
): ParseOk<TechpieWebviewTicket> | ParseFail {
  const parsed = parseWith(techpieWebviewTicketSchema.safeParse(payload));
  if (!parsed.ok) return parsed;
  const check = checkCampusTargetUrl(parsed.value.targetUrl);
  if (!check.allowed) {
    return {
      ok: false,
      issues: [
        `webview-session 返回的 targetUrl 未通过客户端白名单校验（${check.reason}）：` +
          `${parsed.value.targetUrl}。契约 §11.18-B 要求 fail-closed。`,
      ],
    };
  }
  return parsed;
}

export function safeParseTechpieWebviewLaunch(
  payload: unknown,
): ParseOk<TechpieWebviewLaunch> | ParseFail {
  return guarded(techpieWebviewLaunchSchema, payload);
}

export function safeParseCampusCard(payload: unknown): ParseOk<CampusCard> | ParseFail {
  return guarded(campusCardSchema, payload);
}

export function safeParseCardTransactionPage(
  payload: unknown,
): ParseOk<z.infer<typeof cardTransactionPageSchema>> | ParseFail {
  return guarded(cardTransactionPageSchema, payload);
}

export function safeParsePaymentCode(payload: unknown): ParseOk<PaymentCode> | ParseFail {
  return guarded(paymentCodeSchema, payload);
}
