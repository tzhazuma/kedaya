import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import type { LoginResult } from '../auth.service';

interface Entry {
  payload: LoginResult;
  expiresAt: number;
}

/**
 * CAS 回调 → 客户端换票的**一次性授权码**。
 *
 * 为什么需要它：CAS 回调是浏览器 GET（`?ticket=` 在 URL 里），而客户端拿会话
 * 需要 POST。直接把 access/refresh token 放进 302 的 query 会留进浏览器历史、
 * Referer 与日志；这里改成 30 秒、单次使用的随机码，客户端换完即失效。
 *
 * 约束：
 * - 只存内存（进程重启即失效，最坏情况是让用户重新登录）；
 * - 定时清理过期项，避免无界增长；
 * - `consume` 先删除再返回，天然防重放。
 */
@Injectable()
export class CasCodeService {
  private readonly ttlMs = 30_000;
  private readonly codes = new Map<string, Entry>();

  issue(payload: LoginResult): string {
    this.prune();
    const code = randomBytes(24).toString('hex');
    this.codes.set(code, { payload, expiresAt: Date.now() + this.ttlMs });
    return code;
  }

  consume(code: string): LoginResult | null {
    const entry = this.codes.get(code);
    if (entry === undefined) return null;
    this.codes.delete(code);
    if (entry.expiresAt <= Date.now()) return null;
    return entry.payload;
  }

  /** 测试用：当前未过期的码数量。 */
  get size(): number {
    this.prune();
    return this.codes.size;
  }

  private prune(): void {
    const now = Date.now();
    for (const [code, entry] of this.codes) {
      if (entry.expiresAt <= now) this.codes.delete(code);
    }
  }
}
