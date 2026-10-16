/**
 * 幂等键生成（application 层，纯逻辑）。
 *
 * 契约 §11.3：`POST` 必须带 `Idempotency-Key`，否则服务端返回
 * `VALIDATION_FAILED` / `IDEMPOTENCY_KEY_REQUIRED`。
 *
 * ⚠️ 为什么不直接用 `data/api/client.ts` 的 `createTraceId`：
 * application 层**不得** import data 层（依赖方向 `presentation → application → domain ← data`）。
 * 这里只需要"一个随机串"，与 HTTP 无关，因此自带一份（同样是零 IO 的纯函数）。
 */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `kdy-buddy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
