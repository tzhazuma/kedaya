/**
 * 找搭子 · 向量字面量（规格 §4.4，验收 T15）
 *
 * ## 安全模型（这是本文件存在的唯一理由）
 *
 * 向量查询用 `$queryRaw` + **参数绑定**：
 *
 * ```ts
 * Prisma.sql`SELECT ... (p."embedding" <=> ${literal}::vector) ...`
 * ```
 *
 * `${literal}` 会被 Prisma 转成 `$1` 绑定参数，`::vector` 是对**该参数**的类型转换，
 * 不是 SQL 注入点。这一点由 `test/buddy-db.spec.ts` 在**真实 pgvector** 上证明
 * （绑定参数 → 恶意字面量只被当作数据；对照实验里字符串拼接的 `DROP` 真的执行了）。
 *
 * 那为什么还要 `toVectorLiteral`？**纵深防御**：上面那个"绑定参数就安全"的信念，
 * 在有人把 `${literal}` 改成 `Prisma.raw(...)` 的那一刻就失效了。
 * 6 行数值白名单换来的是"即使调用方传了被污染的数据，也无法构造出非数值内容"。
 */

/**
 * `number[]` → pgvector 文本字面量 `'[0.1,0.2,...]'`。
 *
 * 拒绝：非数组、空数组、非 number、`NaN` / `Infinity` / `-Infinity`、超长维度。
 * 抛 `RangeError`（不是静默截断 —— 静默截断会让"维度写错"变成"相似度算错"）。
 */
export function toVectorLiteral(vector: readonly number[], expectedDim?: number): string {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new RangeError('toVectorLiteral: 向量不能为空');
  }
  if (expectedDim !== undefined && vector.length !== expectedDim) {
    throw new RangeError(`toVectorLiteral: 维度必须是 ${expectedDim}，收到 ${vector.length}`);
  }
  const parts: string[] = new Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) {
    const n = vector[i];
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new RangeError(`toVectorLiteral: 第 ${i} 个分量不是有限数（${String(n)}）`);
    }
    parts[i] = String(n);
  }
  return `[${parts.join(',')}]`;
}

/**
 * pgvector 文本 → `number[]`。用于 `SELECT "embedding"::text` 读回向量
 * （Prisma Client 不暴露 `Unsupported` 字段，只能这样读）。
 *
 * 非法输入返回 `null` 而不是抛异常：读路径上一条脏向量不该让推荐接口 500。
 */
export function parseVectorLiteral(text: unknown, expectedDim?: number): number[] | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;

  const body = trimmed.slice(1, -1).trim();
  if (body.length === 0) return [];

  const parts = body.split(',');
  const out: number[] = new Array(parts.length);
  for (let i = 0; i < parts.length; i += 1) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  if (expectedDim !== undefined && out.length !== expectedDim) return null;
  return out;
}
