/**
 * WebView 一次性票据存储（规格 §8.4）
 *
 * ## 票据语义（逐条来自规格 §8.4 的"票据语义"表）
 *
 * | 属性 | 值 | 理由 |
 * | --- | --- | --- |
 * | **一次性** | 用后即焚 | 防重放 |
 * | **短时效** | **30 秒** | 只需覆盖"换取 → 打开 WebView"的时间 |
 * | **绑定 host** | 票据绑定到签发时的 `targetUrl` host | 防止票据被用于其它域名 |
 * | **不含 cookie** | 票据是**引用**，不是凭证 | 客户端**从未拿到** cookie |
 *
 * ## ⚠️ 已知限制（如实声明，不假装它是分布式的）
 *
 * 当前实现是**进程内内存 Map**：单实例可用，多实例/重启后会丢。
 * 与 `common/idempotency/idempotency.store.ts` 同一取舍。
 * 生产必须换成 Redis（`docker-compose.yml` 里已有 Redis 7），接口不变。
 */

import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CampusPlatform } from '../../domain/ports/campus-session.port';

/** 票据有效期（秒）—— 规格 §8.4 冻结为 30 */
export const WEBVIEW_TICKET_TTL_SEC = 30;

/** 票据前缀，便于日志/审计里识别（**票据值本身绝不进日志**，规格 §10.3） */
export const WEBVIEW_TICKET_PREFIX = 'wvt_';

export interface WebviewTicketRecord {
  userId: string;
  /** 需要绑定才能换取的平台；`null` = W4 公开入口（用户自登录，不需要绑定） */
  platform: CampusPlatform | null;
  targetUrl: string;
  /** 票据绑定到的 host（防止票据被用于其它域名） */
  host: string;
  issuedAt: number;
  expiresAt: number;
}

@Injectable()
export class WebviewTicketStore {
  private readonly tickets = new Map<string, WebviewTicketRecord>();

  /** 签发票据。返回值是**引用**，不是凭证 —— 里面没有任何 cookie 材料。 */
  issue(input: Omit<WebviewTicketRecord, 'issuedAt' | 'expiresAt'>): { ticket: string; expiresAt: Date } {
    this.prune();
    const ticket = `${WEBVIEW_TICKET_PREFIX}${randomBytes(18).toString('base64url')}`;
    const issuedAt = Date.now();
    const expiresAt = issuedAt + WEBVIEW_TICKET_TTL_SEC * 1000;
    this.tickets.set(ticket, { ...input, issuedAt, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt) };
  }

  /**
   * 看一眼票据（**不消费**）。
   *
   * 用途：兑换时**先确认归属**再消费 —— 否则"别人拿我的票据试一次"
   * 就会把我的票据烧掉（一个廉价的拒绝服务）。
   * 票据本身有 144 bit 熵，不消费不会带来暴力破解风险。
   *
   * 返回 `null` 表示不存在或已过期（不区分，理由同 `consume`）。
   */
  peek(ticket: string): WebviewTicketRecord | null {
    this.prune();
    const record = this.tickets.get(ticket);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) return null;
    return record;
  }

  /**
   * 兑换票据（**用后即焚**）。
   *
   * 返回 `null` 表示票据不存在、已被用过、或已过期 —— 三者**刻意不区分**，
   * 因为"这个票据以前存在过"本身就是不应泄漏的信息（防票据枚举）。
   */
  consume(ticket: string): WebviewTicketRecord | null {
    this.prune();
    const record = this.tickets.get(ticket);
    if (!record) return null;
    this.tickets.delete(ticket);
    if (record.expiresAt <= Date.now()) return null;
    return record;
  }

  /** 测试用：当前票据数 */
  size(): number {
    this.prune();
    return this.tickets.size;
  }

  /** 测试用：清空 */
  clear(): void {
    this.tickets.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [ticket, record] of this.tickets) {
      if (record.expiresAt <= now) this.tickets.delete(ticket);
    }
  }
}
