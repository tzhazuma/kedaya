/**
 * TechPie 整合仓储端口（依赖倒置点 —— 契约 §7）。
 *
 * domain 定义接口，data 层实现（HTTP / mock）；presentation 永远不直接发请求。
 * 错误通道用 `@kedaya/shared` 的 `Result`，错误载荷用契约的 `ApiError`
 * （冻结错误码可一路透传到 UI，尤其是 `CAMPUS_BINDING_REQUIRED`）。
 *
 * 路由形状（规格 §8.1 端点总表 + 契约 §11.2 已冻结的动作名）：
 *   GET    /api/v1/techpie/links                        列出我的全部绑定（**不含凭证**）
 *   POST   /api/v1/techpie/links                        发起绑定
 *   GET    /api/v1/techpie/links/:id                    绑定详情
 *   DELETE /api/v1/techpie/links/:id                    解绑
 *   POST   /api/v1/techpie/links/:id/renew              **已冻结 action**（§11.2）
 *   GET    /api/v1/techpie/capabilities                 能力清单
 *   POST   /api/v1/techpie/webview-session              换取一次性 WebView 票据（§8.4）
 *   POST   /api/v1/techpie/webview-session/:ticket      用票据换一次性打开地址
 *
 * 校园卡（`campus-card` 模块，走独立 OPENID 通道 —— 规格 §2.5）：
 *   GET    /api/v1/campus-card                          我的校园卡（单例资源）
 *   GET    /api/v1/campus-card/transactions             流水（游标分页）
 *   POST   /api/v1/campus-card/payment-code             申请付款码（创建资源，60s TTL）
 *   DELETE /api/v1/campus-card/payment-code/current     作废当前付款码
 *
 * ⚠️ **未决缺口（如实登记，已在并行实现里成为真实冲突）**：
 * `campus-card` 的这 4 条路由与 `GET /techpie/capabilities` 的**响应体形状**
 * 在任何冻结文档里都没有定义（规格 §8.1 只给了端点名与一句话说明）。
 * 本端按契约 §6.1 的统一 CRUD 形状自行定义，并在 `data/schemas/techpie.ts`
 * 里做宽松解析。**三端已经各写了一套**（事实引用，非推测）：
 *
 * | 端 | 校园卡余额 | 流水 | 付款码 |
 * | --- | --- | --- | --- |
 * | Web（本文件） | `GET /campus-card` | `GET /campus-card/transactions` | `POST /campus-card/payment-code` + `DELETE /campus-card/payment-code/current` |
 * | 小程序（`apps/miniapp/src/data/repositories/httpTechpieRepository.ts`） | — | `GET /campus-card/items` | `POST /campus-card/payment-code` |
 * | Flutter（`apps/mobile/lib/data/repositories/remote_campus_card_repository.dart`） | `GET /campus-card/account` | `GET /campus-card/transactions` | `POST /campus-card/payment-code` |
 * | 后端现状（`services/api/src/modules/campus-card/campus-card.controller.ts`） | `GET /campus-card/summary` | `GET /campus-card/items` | **不存在** |
 *
 * **这四条必须由 Lead 冻结进 OpenAPI 后才能端到端联调** —— 现在任何一端
 * 切到真实后端都会 404。本端保留规格派生的形状（单例 + 子资源），
 * **不擅自对齐**，因为三种形状没有任何一个是权威的。
 */
import type { ApiError, Page } from '@kedaya/contracts';
import type { Result } from '@kedaya/shared';

import {
  CAMPUS_PLATFORM_ACCESS_MODE,
  CAMPUS_PLATFORM_PHASE,
  type CampusBindingSummary,
  type CampusCard,
  type CampusPlatform,
  type CardTransaction,
  type PaymentCode,
  type TechpieCapabilitiesResponse,
  type TechpieWebviewLaunch,
  type TechpieWebviewTicket,
} from '../models/techpie';

/** mock 适配器的可控故障模式，用于演示三态 UI（与其余切片共用同一语义） */
export type MockFailureMode = 'none' | 'error';

/* ------------------------------------------------------------------ *
 * 绑定
 * ------------------------------------------------------------------ */

/**
 * 绑定凭证。
 *
 * ⚠️ **Phase 0 只允许 `openid`**（校园卡，规格 §2.5）。
 *
 * `password` 变体**刻意留在类型里但客户端拒绝发送**：
 * - §11.18-D：绑定时接受明文密码**风险极高**，在信息办回复前
 *   Phase 1 的绑定流程**不实现**；
 * - 客户端把"绝不发送明文密码"做成一条可测的不变式
 *   （`assertPhase0Credential`），而不是一句注释。
 */
export type BindCredential =
  | { kind: 'openid'; channel: 'wechat'; openId?: string }
  | { kind: 'password'; studentId: string; password: string };

export interface TechpieLinkListQuery {
  /**
   * 游标分页（契约 §6.1：不用 offset）。
   * ⚠️ 契约 §11.10-E：游标**不透明** —— 只把服务端返回的 `nextCursor` 原样回传。
   */
  cursor?: string;
  limit?: number;
}

export interface CreateTechpieLinkInput {
  platform: CampusPlatform;
  credential: BindCredential;
  /** 契约 §11.3：POST 必须带 Idempotency-Key */
  idempotencyKey?: string;
}

/* ------------------------------------------------------------------ *
 * WebView 一次性票据（规格 §8.4）
 * ------------------------------------------------------------------ */

export interface TechpieWebviewSessionRequest {
  /**
   * 需要哪个平台的已绑定会话。
   *
   * ⚠️ **未决歧义（如实登记，不擅自改契约）**：规格 §8.4 的 body 里
   * `platform` 是必填，其校验表也写着"该平台已绑定且 `status=ACTIVE`"；
   * 但 §9.1 的 Phase 0 WebView 直连是 **W4**（不做 cookie 注入、用户自登录），
   * 逻辑上**不需要任何绑定**。本端按 `CampusPlatform | null` 建模：
   * 能力若不需要绑定就传 `null`（Phase 0 的 W4 路径），
   * 服务端在 Phase 2 的注入模式下应当拒绝 `null`。
   * **请 Lead 裁决后补进 OpenAPI。**
   */
  platform: CampusPlatform | null;
  /**
   * ⚠️ 必须来自服务端白名单（契约 §11.18-B）：
   * 调用方只能把 `TechpieCapability.targetUrl` **原样**传进来，
   * 客户端**不得自行拼接任意 URL**。
   */
  targetUrl: string;
  idempotencyKey?: string;
}

/* ------------------------------------------------------------------ *
 * 端口
 * ------------------------------------------------------------------ */

export interface TechpieRepository {
  /** 列出我的全部绑定 —— 响应**不含凭证**（规格 §8.3） */
  listLinks(query: TechpieLinkListQuery): Promise<Result<Page<CampusBindingSummary>, ApiError>>;
  getLink(id: string): Promise<Result<CampusBindingSummary, ApiError>>;
  /** 发起绑定（Phase 0 只允许 `openid` 凭证） */
  createLink(input: CreateTechpieLinkInput): Promise<Result<CampusBindingSummary, ApiError>>;
  /** 解绑（DELETE 承载契约 §11.2 的 close 语义） */
  deleteLink(id: string): Promise<Result<{ deleted: true }, ApiError>>;
  /** **已冻结 action**：`POST /links/:id/renew`（手动续期） */
  renewLink(id: string): Promise<Result<CampusBindingSummary, ApiError>>;

  listCapabilities(): Promise<Result<TechpieCapabilitiesResponse, ApiError>>;

  /** 换取一次性票据（规格 §8.4；服务端做白名单 + https 校验，客户端不可信） */
  createWebviewSession(
    request: TechpieWebviewSessionRequest,
  ): Promise<Result<TechpieWebviewTicket, ApiError>>;
  /** 用票据换一次性打开地址（**用后即焚**，服务端保证只能兑换一次） */
  redeemWebviewTicket(ticket: string): Promise<Result<TechpieWebviewLaunch, ApiError>>;
}

/**
 * 校园卡端口（走独立 OPENID 通道，**与 CASTGC 完全解耦** —— 规格 §2.5）。
 *
 * 付款码的三条硬规则（`02-domain-model.md:1040` / `06-roadmap.md:133`）：
 * 1. 60 秒 TTL，旧码立即失效；
 * 2. **不进日志、不进审计正文**（审计只记 `ISSUED` / `REVOKED` 动作）；
 * 3. 客户端**不得缓存**（`PaymentCodeHolder` 是唯一持有者）。
 */
export interface CampusCardRepository {
  getCard(): Promise<Result<CampusCard, ApiError>>;
  listTransactions(query: TechpieLinkListQuery): Promise<Result<Page<CardTransaction>, ApiError>>;
  /** 每次调用生成**新码**，旧码立即作废（契约 §3.3 `IssuePaymentCode`） */
  issuePaymentCode(): Promise<Result<PaymentCode, ApiError>>;
  revokePaymentCode(): Promise<Result<{ revoked: true }, ApiError>>;
}

/**
 * Phase 0 凭证闸门（纯函数，可单测）。
 *
 * 返回 `null` = 可以发送；返回中文原因 = **不发请求**，直接把引导给用户。
 *
 * 三条规则：
 * 1. `password` 凭证一律拒绝 —— §11.18-D：**客户端绝不发送明文密码**；
 * 2. 非 Phase 0 平台一律拒绝 —— §11.18-E：Phase 1–3 本轮不实现；
 * 3. `openid` 凭证只允许用在 `access mode = openid` 的平台上（校园卡）。
 */
export function assertPhase0Credential(input: {
  platform: CampusPlatform;
  credential: BindCredential;
}): string | null {
  if (input.credential.kind === 'password') {
    return (
      '可达鸭的 Web 端不会发送明文密码。绑定校园系统需要学校信息办先确认' +
      '「是否允许第三方代持校园会话」以及「能否改用 OAuth / 扫码 / 短信」；' +
      '在拿到书面回复前，这条通道不实现。'
    );
  }
  if (CAMPUS_PLATFORM_PHASE[input.platform] !== 'phase0') {
    return '该平台属于 Phase 1 及以后，本轮不实现绑定流程（阻塞于信息办书面回复）。';
  }
  if (CAMPUS_PLATFORM_ACCESS_MODE[input.platform] !== 'openid') {
    return '该平台的 Phase 0 通道不是 OPENID，本轮不实现。';
  }
  return null;
}
