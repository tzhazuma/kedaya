/**
 * mock 适配器共用的游标工具 —— **这是"服务端"的替身，不是客户端逻辑**。
 *
 * 契约 §6.1 + §11.10-E：`cursor` 对**客户端完全不透明** ——
 * 客户端不得解析、构造、或假设游标格式（服务端可以用复合游标，例如
 * `eyJvIjo0fQ==` 这种 base64 结构）。因此：
 * - 只有 mock 仓储（扮演服务端）会 encode/decode；
 * - `application` / `presentation` 只把 `nextCursor` 原样回传，绝不解析；
 * - 遇到无法解析的游标（例如真实后端换成复合格式）**安全退化为第一页**，不抛异常。
 *
 * 本文件也刻意**不**从 `data/mock/index.ts` 再导出，避免被 UI 误用。
 */

export function encodeCursor(offset: number): string {
  return `c_${offset}`;
}

export function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  const match = /^c_(\d+)$/.exec(cursor);
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** 页大小夹在 1..100，非法值退化为 fallback */
export function clampLimit(limit: number | undefined, fallback = 20): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(100, Math.max(1, Math.trunc(limit)));
}

/** 从数组切出一页并给出下一页游标 */
export function slicePage<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number | undefined,
  fallbackLimit = 20,
): { items: T[]; nextCursor: string | null; total: number } {
  const offset = decodeCursor(cursor);
  const size = clampLimit(limit, fallbackLimit);
  const page = items.slice(offset, offset + size);
  const nextOffset = offset + page.length;
  return {
    items: page,
    nextCursor: nextOffset < items.length ? encodeCursor(nextOffset) : null,
    total: items.length,
  };
}
