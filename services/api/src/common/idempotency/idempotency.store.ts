import { Injectable } from '@nestjs/common';

/**
 * 幂等记录存储（契约 §11.3）。
 *
 * ⚠️ **已知限制（如实声明）**：当前实现是**进程内内存 Map**。
 *   · 单实例可用；多实例/重启后会丢，退化成"重试会再执行一次"；
 *   · 生产必须换成 Redis（`docker-compose.yml` 里已有 Redis 7）或
 *     `IdempotencyRecord` 表，接口不变（`begin/complete/abort`）。
 * 这条限制写进交付说明，不假装它是分布式幂等。
 */

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type BeginResult =
  | { kind: 'started' }
  | { kind: 'in-flight' }
  | { kind: 'replay'; data: unknown };

interface Record_ {
  state: 'in-flight' | 'done';
  data?: unknown;
  createdAt: number;
}

@Injectable()
export class IdempotencyStore {
  private readonly records = new Map<string, Record_>();

  /**
   * 记录保留时长。
   * 刻意**不做成构造参数** —— Nest 会把构造参数当成待注入依赖
   * （`Number` 无法解析，应用启动即失败）。需要改 TTL 时由子类覆盖。
   */
  protected ttlMs: number = IDEMPOTENCY_TTL_MS;

  /**
   * 占位。三种结果：
   *   started   —— 第一次见到这个 key，调用方应继续执行
   *   in-flight —— 同 key 的请求正在处理（并发重试），调用方应返回 409
   *   replay    —— 已有成功结果，直接回放
   */
  begin(key: string): BeginResult {
    this.prune();
    const found = this.records.get(key);
    if (!found) {
      this.records.set(key, { state: 'in-flight', createdAt: Date.now() });
      return { kind: 'started' };
    }
    if (found.state === 'in-flight') return { kind: 'in-flight' };
    return { kind: 'replay', data: found.data };
  }

  /** 处理成功：落结果，供重试回放 */
  complete(key: string, data: unknown): void {
    this.records.set(key, { state: 'done', data, createdAt: Date.now() });
  }

  /**
   * 处理失败：**不**落结果，让重试能重新执行。
   * 这是刻意的 —— 失败请求没有产生副作用（或副作用由业务自己保证），
   * 若把错误也缓存，客户端就永远修不好一个临时故障。
   */
  abort(key: string): void {
    this.records.delete(key);
  }

  /** 测试用：清空 */
  clear(): void {
    this.records.clear();
  }

  /** 测试用：当前记录数 */
  size(): number {
    return this.records.size;
  }

  private prune(): void {
    const deadline = Date.now() - this.ttlMs;
    for (const [key, record] of this.records) {
      if (record.createdAt < deadline) this.records.delete(key);
    }
  }
}

/**
 * 幂等作用域键。
 *
 * 必须绑定**主体**：否则 A 用户的 key 与 B 用户的 key 撞车时，
 * B 会拿到 A 的响应（跨用户数据泄漏）。
 * 未登录主体统一记 `anon`（论坛/FAQ 允许匿名提交）。
 */
export function idempotencyScope(parts: {
  actorId?: string;
  method: string;
  path: string;
  key: string;
}): string {
  return [parts.actorId ?? 'anon', parts.method.toUpperCase(), parts.path, parts.key].join('|');
}
