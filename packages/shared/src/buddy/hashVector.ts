/**
 * 找搭子 · 无 embedding 模型时的确定性哈希向量（规格 §3.5，移植 STUMatch `matching.py:251-258`）
 *
 * ⚠️ **这不是语义向量。** 它只是把文本按字符打散到固定维度再归一化 ——
 * 拼写相近的文本会有较高相似度，语义相近但用词不同的文本**不会**。
 * 因此使用它时响应必须带 `matchMode: 'hash'`，
 * 且前端展示理由时**不得**声称"语义相似"（规格 §3.4 模式 B 的硬要求）。
 *
 * 它的价值在于：**没有模型、没有 API key、没有 pgvector 的纯 PostgreSQL 上，
 * 匹配仍然可用且有确定性**（同样输入永远同样输出，便于对照与复现）。
 */

/** 默认维度。规格建议 768（与常见中文 embedding 模型一致），可按部署配置 */
export const DEFAULT_HASH_DIM = 768;

/**
 * 确定性哈希向量。
 *
 * 算法（与 STUMatch 一致）：对每个字符 c 在位置 i，
 * 累加到 `(i + codePoint(c)) % dim`，最后做 L2 归一化。
 */
export function hashVector(text: string, dim: number = DEFAULT_HASH_DIM): number[] {
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new RangeError(`hashVector: dim 必须是正整数，收到 ${dim}`);
  }
  const vec = new Array<number>(dim).fill(0);
  const chars = [...text]; // 按码点切分，避免代理对（emoji）被拆坏
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] as string;
    const cp = ch.codePointAt(0) ?? 0;
    const idx = (i + cp) % dim;
    vec[idx] = (vec[idx] as number) + 1;
  }
  return l2Normalize(vec);
}

/** L2 归一化；零向量原样返回（避免除零得到 NaN） */
export function l2Normalize(vec: readonly number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  if (sum === 0) return [...vec];
  const norm = Math.sqrt(sum);
  return vec.map((v) => v / norm);
}

/** 余弦相似度（两个已归一化向量的点积；未归一化时按定义算） */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new RangeError(`cosineSimilarity: 维度不一致 ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 余弦距离 = 1 − 相似度；喂给 `baseScoreFromCosineDistance` */
export function cosineDistance(a: readonly number[], b: readonly number[]): number {
  return 1 - cosineSimilarity(a, b);
}

/**
 * 把用户/帖子的文本特征拼成一段用于哈希的稳定文本。
 * **顺序固定**，否则同一份数据会得到不同向量（破坏确定性）。
 */
export function profileText(parts: {
  bio?: string | null;
  description?: string | null;
  interestTags?: readonly string[];
  activityTags?: readonly string[];
  tags?: readonly string[];
}): string {
  return [
    parts.bio ?? '',
    parts.description ?? '',
    [...(parts.interestTags ?? [])].sort().join(' '),
    [...(parts.activityTags ?? [])].sort().join(' '),
    [...(parts.tags ?? [])].sort().join(' '),
  ].join('\u0000');
}
