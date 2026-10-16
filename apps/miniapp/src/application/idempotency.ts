/**
 * 幂等键生成（契约 §11.3：`POST` **必须**带 `Idempotency-Key`）。
 *
 * 位置在 `application/` 根目录（而不是某个 feature 下）：论坛与 FAQ 的写动作都用它，
 * 放在任一 feature 里都会让另一个 feature 产生跨特性依赖。
 *
 * 为什么不用内容哈希：端上不需要引入加密依赖，而且「同一毫秒内两次不同提交」
 * 必须得到不同的 key。用「时间 + 单调计数器」即可保证：
 * - 同一次 `submit()` 调用只生成一次 key；
 * - 网络层内部的 401 重试**复用**同一个 key（同一次请求），因此不会重复发帖/重复投票。
 */

let counter = 0

export function createIdempotencyKey(scope: string, now: Date): string {
  counter += 1
  return `${scope}:${now.getTime().toString(36)}:${counter.toString(36)}`
}

/** 仅供测试：重置计数器，保证断言可复现 */
export function __resetIdempotencyCounterForTests(): void {
  counter = 0
}
