/**
 * WebView 一次性票据服务 —— 契约 §11.4 **I3 的唯一出口**
 *
 * 规格 `docs/features/techpie-integration.md` §8.4；
 * 裁决 `00-FROZEN-CONTRACT.md` §11.10-F（U4：小程序 `web-view` **不能**注入 cookie）、
 * §11.18-A（接受 `POST /webview-session` 的创建式形状）、§11.18-B（白名单 fail-closed）。
 *
 * ## 本目录是 I3 的唯一出口 —— 为什么这很重要
 *
 * 契约 §11.4 I3：校园系统 cookie 的**唯一出口**是一个受限方法，**仅供 WebView 注入**。
 * ADR 0004 §2.2 的教训是「一个只有文档保护的边界，在一次紧急修 bug 时就会消失」，
 * 所以这里把它做成**静态扫描能钉死**的东西：
 * 全仓 `cookieHeaderFor(` 的调用点**必须**落在 `webview-session/` 内
 * （`test/techpie-arch.spec.ts` 扫描全仓 `.ts`）。
 * 也就是说：**除了这个文件，没有任何地方能拿到校园 cookie 串**。
 *
 * ## Phase 0 的真实行为（不粉饰）
 *
 * Phase 0 采用规格 §8.4 的 **W4**：让用户在校园系统页面**自己登录**，
 * 我们**不接触** cookie。原因是 W1/W2 不可行（跨域设不了 cookie），
 * W3（表单 POST）取决于校园系统且**必须在信息办确认后**才做（Phase 2）。
 *
 * 因此 `redeem()` 在 Phase 0 返回的是 `mode: 'direct'` 的一次性打开地址，
 * **不含**任何 cookie。`cookieHeaderFor(` 这条路径由 `CookieDeliveryPort` 把关：
 * Phase 0 的实现 `enabled === false`，闸门在**读取凭证之前**就短路 ——
 * 于是 Phase 0 下 `cookieHeaderFor` **根本不会被执行**，
 * 但它是全仓唯一的调用点，I3 的扫描因此**非空且可审计**。
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  CampusBindingRequiredError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from '../../../../common/errors/app-error';
import {
  CAMPUS_SESSION_PORT,
  isCampusPlatform,
  type CampusPlatform,
  type CampusSessionPort,
} from '../../domain/ports/campus-session.port';
import type { WebviewAllowlistPort } from '../../domain/ports/webview-allowlist.port';
import { WebviewTicketStore, type WebviewTicketRecord } from './ticket.store';
import {
  CAMPUS_TARGET_ALLOWLIST,
  CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER,
  CAMPUS_TARGET_ALLOWLIST_NOTE,
  checkCampusTargetUrl,
  statusForRejection,
} from './target-url';

/** 限流（规格 §8.4：10 次/分钟） */
export const WEBVIEW_SESSION_RATE_LIMIT = { windowMs: 60_000, max: 10 } as const;

/** 换票请求（三端形状的并集，见 `techpie.controller.ts` 的说明） */
export interface IssueWebviewSessionInput {
  platform?: unknown;
  provider?: unknown;
  linkId?: unknown;
  targetUrl: unknown;
}

/** `POST /webview-session` 的响应（规格 §8.4 + OpenAPI 形状的并集） */
export interface WebviewTicketResult {
  ticket: string;
  /** 规格 §8.4 冻结为 30 秒 */
  expiresInSec: number;
  targetUrl: string;
  /** OpenAPI 形状的别名 */
  expiresAt: string;
  /** OpenAPI 形状的别名：恒为 `true`（用后即焚） */
  singleUse: true;
  /** 票据绑定到的 host（防票据被用于其它域名） */
  targetHost: string;
}

/** 用票据换到的**一次性打开地址**（规格 §8.4「换取方式」行） */
export interface WebviewLaunch {
  /** 最终要打开的地址（服务端签发；客户端不得改写） */
  url: string;
  targetUrl: string;
  /** `direct` = 用户自登录（Phase 0 / W4）；`injected` = 服务端注入 cookie（Phase 2，未实现） */
  mode: 'direct' | 'injected';
  /** 打开地址自身的有效期（Phase 0 的 `direct` 模式没有额外时效） */
  expiresAt: string | null;
  /** 本次打开是否携带了注入的 cookie。**Phase 0 恒为 false** */
  cookieInjected: boolean;
  /** 机器可读的原因（Phase 0 恒为 `W4_PHASE_0`） */
  reason: 'W4_PHASE_0' | 'COOKIE_INJECTED';
}

/**
 * cookie 投递端口。
 *
 * ⚠️ 这是**把"能不能注入 cookie"从实现细节提升为显式策略**的地方。
 * Phase 0 只有 `DisabledCookieDelivery` 一个实现（`enabled === false`），
 * 因此没有任何客户端能通过 HTTP 拿到 cookie。
 * Phase 2 若信息办确认可行（规格 §8.4 的 W3），只需换一个实现 ——
 * 而 `cookieHeaderFor(` 的调用点**仍然只有一个**（就在本文件里）。
 */
export interface CookieDeliveryPort {
  /** 是否已启用 cookie 注入 */
  readonly enabled: boolean;
  /** 把 cookie header 投递给 WebView（Phase 0 的实现直接拒绝） */
  deliver(cookieHeader: string, record: WebviewTicketRecord): Promise<WebviewLaunch>;
}

export const WEBVIEW_COOKIE_DELIVERY = Symbol('KEDAYA_WEBVIEW_COOKIE_DELIVERY');

/**
 * Phase 0 的投递实现：**拒绝**。
 *
 * 拒绝的理由必须是**诚实且机器可见**的（不是"暂不支持"）：
 *   1. 微信小程序 `web-view` **无法**自定义请求头、也无法跨域设 cookie（裁决 §11.10-F，U4 已关闭）；
 *   2. 302 无法携带自定义 cookie 到第三方域名（规格 §8.4 的 W1/W2 不可行）；
 *   3. W3（表单 POST）取决于校园系统，**必须在信息办确认后**才做（Phase 2）。
 *
 * 于是 Phase 0 的结论是 W4：**用户在校园系统页面自己登录，我们不接触 cookie**。
 */
@Injectable()
export class DisabledCookieDelivery implements CookieDeliveryPort {
  readonly enabled = false;

  async deliver(): Promise<WebviewLaunch> {
    throw new ForbiddenError(
      'Phase 0 不启用 cookie 注入：微信小程序 web-view 无法注入 cookie（契约 §11.10-F），' +
        '且跨域 302 无法携带 cookie（规格 §8.4 的 W1/W2 不可行）。' +
        'Phase 0 采用 W4 —— 请让用户在校园系统页面自己登录。',
      {
        reason: 'COOKIE_INJECTION_NOT_ENABLED_PHASE_0',
        blockedBy: ['U4', 'W3'],
        recommended: 'W4',
      },
    );
  }
}

@Injectable()
export class WebviewSessionService implements WebviewAllowlistPort {
  /**
   * 限流窗口（进程内）。
   *
   * ⚠️ 与 `IdempotencyStore` 同一取舍：单实例可用，多实例需换 Redis。
   * 如实声明，不假装它是分布式限流。
   */
  private readonly hits = new Map<string, number[]>();

  constructor(
    @Inject(CAMPUS_SESSION_PORT) private readonly campusSession: CampusSessionPort,
    @Inject(WebviewTicketStore) private readonly tickets: WebviewTicketStore,
    @Inject(WEBVIEW_COOKIE_DELIVERY) private readonly cookieDelivery: CookieDeliveryPort,
  ) {}

  /* ---------------- 白名单只读视图（`WebviewAllowlistPort`） ---------------- */

  /**
   * 白名单是否为占位内容（§11.18-B 第 2 条：必须**机器可见**）。
   *
   * ⚠️ 这里直接暴露三个 getter（而不是只给一个 `allowlist` 对象），
   * 因为 `WEBVIEW_ALLOWLIST_PORT` 用的是 Nest 的 `useExisting` —— 它**不做类型检查**，
   * 形状对不上时只会在运行时变成 `undefined`。
   * 这个坑真实发生过（`GET /techpie/capabilities` 的 `allowlistPlaceholder`
   * 一度是 `undefined`），因此 `techpie.module.ts` 里加了一条**编译期**断言。
   */
  get allowlistPlaceholder(): boolean {
    return CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER;
  }

  get allowlistNote(): string {
    return CAMPUS_TARGET_ALLOWLIST_NOTE;
  }

  get allowlistSize(): number {
    return CAMPUS_TARGET_ALLOWLIST.length;
  }

  /** 三个 getter 的聚合视图（便于一次性读取；不是端口的一部分） */
  get allowlist(): {
    allowlistPlaceholder: boolean;
    allowlistNote: string;
    allowlistSize: number;
  } {
    return {
      allowlistPlaceholder: this.allowlistPlaceholder,
      allowlistNote: this.allowlistNote,
      allowlistSize: this.allowlistSize,
    };
  }

  /**
   * 换取一次性票据。
   *
   * 校验顺序（规格 §8.4 的校验表 + §11.18-B）：
   *   1. 限流（10 次/分钟/用户）→ 429 `RATE_LIMITED`；
   *   2. `targetUrl` 白名单 / https / 无 userinfo / 443 / 非 IP —— **fail-closed**；
   *   3. 若指定了平台，该平台必须**已绑定且 LINKED** → 否则 409 `CAMPUS_BINDING_REQUIRED`。
   *
   * ⚠️ 第 2 步在**服务端**做。客户端传入的 `targetUrl` 一律不可信
   * （§11.18-B 第 4 条）—— 三端各自的客户端白名单只是纵深防御。
   */
  async issue(userId: string, input: IssueWebviewSessionInput): Promise<WebviewTicketResult> {
    this.assertWithinRateLimit(userId);

    const check = checkCampusTargetUrl(input.targetUrl);
    if (!check.allowed || check.host === null) {
      const reason = check.reason ?? 'MALFORMED';
      const details = {
        // 规格 §8.4 登记的 details.reason
        reason: 'TARGET_URL_NOT_ALLOWED',
        // 更细的机器可读原因（便于客户端给出可读提示）
        check: reason,
        allowlistPlaceholder: CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER,
        allowlistNote: CAMPUS_TARGET_ALLOWLIST_NOTE,
      };
      if (statusForRejection(reason) === 422) {
        throw new ValidationError('targetUrl 必须是白名单内的 https 地址', details, 422);
      }
      throw new ForbiddenError('targetUrl 不在校园域名白名单内（fail-closed，不做后缀通配）', details);
    }

    const platform = await this.resolvePlatform(userId, input);

    // 需要绑定的入口：必须是 LINKED（否则 409 —— **不是** 401，契约不变式 I4）
    if (platform !== null) {
      const binding = await this.campusSession.getBinding(userId, platform);
      if (!binding || binding.status !== 'LINKED') {
        throw new CampusBindingRequiredError(`该入口需要先绑定校园系统（${platform}）`, {
          platform,
          status: binding?.status ?? 'UNLINKED',
        });
      }
    }

    const { ticket, expiresAt } = this.tickets.issue({
      userId,
      platform,
      targetUrl: String(input.targetUrl),
      host: check.host,
    });

    return {
      ticket,
      expiresInSec: Math.round((expiresAt.getTime() - Date.now()) / 1000),
      targetUrl: String(input.targetUrl),
      expiresAt: expiresAt.toISOString(),
      singleUse: true,
      targetHost: check.host,
    };
  }

  /**
   * 用票据换一次性打开地址（**用后即焚**）。
   *
   * Phase 0 返回 `mode: 'direct'`（W4：用户自登录，我们不接触 cookie）。
   */
  async redeem(userId: string, ticket: string): Promise<WebviewLaunch> {
    // 先**看**归属再消费。两条理由：
    //   1. 不区分"不存在 / 已用过 / 已过期 / 不是你的" —— 区分它们等于泄漏"这个票据存在过"；
    //   2. "不是你的"这条**不消费**票据，否则别人拿我的票据试一次就能把它烧掉
    //      （一个廉价的拒绝服务）。票据本身有 144 bit 熵，不消费不会带来爆破风险。
    const peeked = this.tickets.peek(ticket);
    if (!peeked || peeked.userId !== userId) {
      throw new NotFoundError('票据无效、已使用或已过期');
    }
    // `consume` 才是原子闸门：并发兑换时只有一个能拿到记录。
    const record = this.tickets.consume(ticket);
    if (!record || record.userId !== userId) {
      throw new NotFoundError('票据无效、已使用或已过期');
    }

    // ⚠️ 闸门在**读取凭证之前**：Phase 0 下 `cookieHeaderFor` 根本不会被执行。
    if (!this.cookieDelivery.enabled) {
      return {
        url: record.targetUrl,
        targetUrl: record.targetUrl,
        mode: 'direct',
        expiresAt: null,
        cookieInjected: false,
        reason: 'W4_PHASE_0',
      };
    }

    if (record.platform === null) {
      throw new ConflictError('该入口没有可注入的校园会话', { reason: 'NO_BINDABLE_PLATFORM' });
    }

    // ================================================================
    // 契约 §11.4 I3：全仓**唯一**的 `cookieHeaderFor(` 调用点。
    // `test/techpie-arch.spec.ts` 扫描全仓，任何别处的调用都会让 CI 失败。
    // ================================================================
    const cookieHeader = await this.campusSession.cookieHeaderFor(record.userId, record.platform);
    return this.cookieDelivery.deliver(cookieHeader, record);
  }

  /* ---------------- 内部 ---------------- */

  /**
   * 解析请求里的平台。
   *
   * 接受三种写法（三端形状的并集，见 `techpie.controller.ts` 的说明）：
   *   · `platform`（规格 §8.4 / Web / 移动端）；
   *   · `provider`（冻结 OpenAPI 的写法，与小程序的 `provider` 对齐）；
   *   · `linkId`（冻结 OpenAPI 的写法）→ 反查该绑定的平台（**必须是自己的**）。
   *
   * 都不给 → `null`，表示 W4 公开入口（不需要绑定）。
   */
  private async resolvePlatform(userId: string, input: IssueWebviewSessionInput): Promise<CampusPlatform | null> {
    const raw = input.platform ?? input.provider;
    if (raw !== undefined && raw !== null) {
      if (!isCampusPlatform(raw)) {
        throw new ValidationError('platform 不是受支持的校园平台', { reason: 'UNKNOWN_PLATFORM' });
      }
      return raw;
    }

    if (input.linkId !== undefined && input.linkId !== null) {
      if (typeof input.linkId !== 'string' || input.linkId.trim().length === 0) {
        throw new ValidationError('linkId 必须是非空字符串', { reason: 'UNKNOWN_PLATFORM' });
      }
      const bindings = await this.campusSession.listBindings(userId);
      const found = bindings.find((item) => item.id === input.linkId);
      if (!found) throw new NotFoundError('绑定不存在或非本人');
      return found.platform;
    }

    return null;
  }

  /**
   * 固定窗口限流（10 次/分钟/用户）→ 429 `RATE_LIMITED`。
   *
   * 键是 `userId`（不是 IP）：本端点的滥用形态是"反复换票"，
   * 换票必须已登录，所以按主体限流更准，也不会误伤同一 NAT 后的同学。
   */
  private assertWithinRateLimit(userId: string): void {
    const now = Date.now();
    const windowStart = now - WEBVIEW_SESSION_RATE_LIMIT.windowMs;
    const recent = (this.hits.get(userId) ?? []).filter((at) => at > windowStart);

    if (recent.length >= WEBVIEW_SESSION_RATE_LIMIT.max) {
      this.hits.set(userId, recent);
      throw new RateLimitedError('换取 WebView 票据过于频繁，请稍后再试', {
        limit: WEBVIEW_SESSION_RATE_LIMIT.max,
        windowSec: WEBVIEW_SESSION_RATE_LIMIT.windowMs / 1000,
      });
    }

    recent.push(now);
    this.hits.set(userId, recent);
  }
}
