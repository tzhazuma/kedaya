/**
 * 用例：WebView 直连与**一次性票据**（契约 §7：application 层）。
 *
 * 规格 §8.4 的四条票据语义（**逐条落地**）：
 * | 属性 | 值 | 本文件怎么保证 |
 * | --- | --- | --- |
 * | 一次性 | 用后即焚 | `OneTimeTicketHolder.consume()` 只能取到一次 |
 * | 短时效 | 30 秒 | 服务端 TTL；客户端**立即**兑换，不做任何排队/延迟 |
 * | 绑定 host | 票据绑定签发时的 `targetUrl` host | 客户端只原样透传服务端下发的地址 |
 * | 不含 cookie | 票据是引用，不是凭证 | 客户端**从未**拿到 cookie（Phase 0 = W4） |
 *
 * 契约 §11.18-B：`targetUrl` 必须来自**服务端白名单**，
 * 「客户端不得自行拼接任意 URL」→ 本文件的 API 只接受**能力对象**，
 * 不接受 URL 字符串；地址由服务端下发，并再经 `checkCampusTargetUrl` fail-closed 校验。
 *
 * ⚠️ **票据绝不进日志 / 埋点 / 缓存 / URL 历史**（规格 §10.3 硬要求）：
 * - 日志：只发 `techpieTraceLogger`，且只发白名单字段（capabilityId / host / mode）；
 * - 缓存：`OneTimeTicketHolder` 是**唯一**持有者，TanStack Query 里没有任何票据 key；
 * - URL：兑换用的是 `POST /techpie/webview-session/:ticket`，票据在**请求路径**里，
 *   打开校园系统用的是**服务端返回的地址**（不含票据）。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import {
  checkCampusTargetUrl,
  type TechpieCapability,
  type TechpieWebviewLaunch,
} from '@/domain/models/techpie';
import type { TechpieRepository } from '@/domain/ports/techpie';
import { techpieTraceLogger } from '@/platform/redact';

/**
 * 如实告知用户的文案（**逐字**要求，见交付说明）。
 * 这句话不是装饰：它决定了用户是否知道"登录发生在学校页面、可达鸭不接触凭证"。
 */
export const WEBVIEW_HONEST_NOTICE =
  '接下来的页面由学校系统提供，请在那里登录；可达鸭只转发一次性的访问票据，不接触你的登录凭证。';

/** Phase 0 采用 W4：不做 cookie 注入（§8.4 方案表：「可行且零合规风险」） */
export const WEBVIEW_PHASE0_MODE_NOTE =
  '可达鸭不会向学校页面注入任何 cookie —— 小程序 web-view 与浏览器都无法跨域设置第三方 cookie。' +
  '因此 Phase 0 的做法是让你在学校页面自己登录（规格 §8.4 的 W4 方案）。';

export type TicketState = 'empty' | 'issued' | 'consumed';

/**
 * 一次性票据持有者 —— **票据的唯一落点**。
 *
 * 为什么不是 React state / TanStack Query：
 * - React state 会被 React DevTools 展示，且可能在意外的地方被序列化；
 * - Query 缓存会跨页面存活、会被 devtools 展示、会被持久化插件写进 storage。
 *
 * 这里的 `#ticket` 是**私有字段**，且 `toJSON()` 刻意只返回状态 ——
 * 于是即便有人 `JSON.stringify(holder)`，也拿不到票据。
 */
export class OneTimeTicketHolder {
  #ticket: string | null = null;
  #state: TicketState = 'empty';

  /** 记录一张刚签发的票据（覆盖上一张：上一张若未兑换就作废，服务端也会让它过期） */
  issue(ticket: string): void {
    this.#ticket = ticket;
    this.#state = 'issued';
  }

  /**
   * 取走票据 —— **只能成功一次**。
   * 第二次返回 `null`（此时状态已是 `consumed`），调用方必须把它当作失败。
   */
  consume(): string | null {
    if (this.#state !== 'issued' || this.#ticket === null) return null;
    const ticket = this.#ticket;
    this.#ticket = null;
    this.#state = 'consumed';
    return ticket;
  }

  get state(): TicketState {
    return this.#state;
  }

  get hasTicket(): boolean {
    return this.#state === 'issued';
  }

  clear(): void {
    this.#ticket = null;
    this.#state = 'empty';
  }

  /** 序列化时**只暴露状态**：票据不可能经由 JSON 泄漏 */
  toJSON(): { state: TicketState } {
    return { state: this.#state };
  }
}

/** 默认持有者（页面级单例；测试各自 new 一个） */
export const webviewTicketHolder = new OneTimeTicketHolder();

/* ------------------------------------------------------------------ *
 * 目标地址解析（只能来自服务端）
 * ------------------------------------------------------------------ */

/** 从 URL 里取 host（**只用于日志**；票据与路径不进日志） */
export function webviewHostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid-url';
  }
}

/** URL 里是否夹带了票据参数（防"票据进 URL 历史"的兜底断言） */
export function urlCarriesTicket(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('ticket')) return true;
    return /[?&]ticket=/i.test(url);
  } catch {
    return /[?&]ticket=/i.test(url);
  }
}

export interface WebviewLaunchResult {
  launch: TechpieWebviewLaunch;
  capabilityId: string;
  /** 票据已用后即焚（结构上标明，避免调用方以为还能复用） */
  ticketBurned: true;
}

/**
 * 用例：用服务端下发的能力换取一次性票据，**立即**兑换成打开地址。
 *
 * 全过程票据只活在 `holder` 的内存里，且只被读取一次。
 */
export async function openCampusWebview(
  repository: TechpieRepository,
  input: {
    capability: TechpieCapability;
    holder?: OneTimeTicketHolder;
    /** 注入时间源仅用于测试（票据立即兑换，不做等待） */
    now?: Date;
  },
): Promise<Result<WebviewLaunchResult, ApiError>> {
  const holder = input.holder ?? webviewTicketHolder;
  const capability = input.capability;

  if (capability.access !== 'webview') {
    return err({
      code: 'FORBIDDEN',
      message: '该能力不是 WebView 直连能力，不能换取票据。',
      details: { reason: 'NOT_A_WEBVIEW_CAPABILITY' },
    });
  }

  // ⚠️ 契约 §11.18-B：地址必须来自服务端白名单。
  // 客户端**没有**接受 URL 字符串的入口 —— 只能传能力 id / 能力对象。
  if (!capability.targetUrl) {
    return err({
      code: 'FORBIDDEN',
      message: '服务端没有为该能力下发目标地址（白名单为空或该能力未登记）。',
      details: { reason: 'TARGET_URL_MISSING' },
    });
  }

  const check = checkCampusTargetUrl(capability.targetUrl);
  if (!check.allowed) {
    // fail-closed：宁可报错，也不用一个"看起来像校园域名"的地址开 WebView
    techpieTraceLogger.track({
      name: 'techpie.webview.blocked',
      moduleId: 'techpie',
      data: { capabilityId: capability.id, reason: check.reason, ok: false },
    });
    return err({
      code: 'FORBIDDEN',
      message: '目标地址未通过校园域名白名单校验（fail-closed），已拒绝打开。',
      details: { reason: 'TARGET_URL_NOT_ALLOWED', detail: check.reason },
    });
  }

  const session = await repository.createWebviewSession({
    platform: capability.platform,
    targetUrl: capability.targetUrl,
  });
  if (!session.ok) {
    // `CAMPUS_BINDING_REQUIRED` 是**合法状态**：调用方要给引导，不要报错
    techpieTraceLogger.track({
      name: 'techpie.webview.session_failed',
      moduleId: 'techpie',
      data: { capabilityId: capability.id, errorCode: session.error.code, ok: false },
    });
    return err(session.error);
  }

  holder.issue(session.value.ticket);
  const ticket = holder.consume();
  if (ticket === null) {
    return err({
      code: 'INTERNAL',
      message: '一次性票据未被正确签发（holder 状态异常）。',
      details: { reason: 'TICKET_NOT_ISSUED' },
    });
  }

  const redeemed = await repository.redeemWebviewTicket(ticket);
  if (!redeemed.ok) {
    techpieTraceLogger.track({
      name: 'techpie.webview.redeem_failed',
      moduleId: 'techpie',
      data: { capabilityId: capability.id, errorCode: redeemed.error.code, ok: false },
    });
    return err(redeemed.error);
  }

  if (urlCarriesTicket(redeemed.value.url)) {
    return err({
      code: 'INTERNAL',
      message: '服务端返回的打开地址里夹带了票据 —— 票据不得进入 URL（会被浏览器历史记录留存）。',
      details: { reason: 'TICKET_IN_URL' },
    });
  }

  // 只记白名单字段：能力 id、目标 host、模式。**没有票据**。
  techpieTraceLogger.track({
    name: 'techpie.webview.opened',
    moduleId: 'techpie',
    data: {
      capabilityId: capability.id,
      host: webviewHostOf(redeemed.value.targetUrl),
      mode: redeemed.value.mode,
      ok: true,
    },
  });

  return ok({
    launch: redeemed.value,
    capabilityId: capability.id,
    ticketBurned: true,
  });
}

/** 供页面在打开之前做最后一次兜底断言（返回 `null` = 可以打开） */
export function refuseIfTicketInUrl(url: string): string | null {
  return urlCarriesTicket(url)
    ? '拒绝打开：地址里夹带了票据。票据是一次性的，不能进入浏览器历史。'
    : null;
}
