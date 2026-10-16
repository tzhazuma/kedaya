/**
 * 找搭子 · MMR 多样性重排（规格 §3.1 第 9 步，移植 STUMatch `matching.py:303-347`，验收 T10）
 *
 * ```
 * mmr(i) = λ × relevance(i) − (1 − λ) × max_{s ∈ selected} cos(vec_i, vec_s)
 * ```
 *
 * λ 默认 `0.7`（`config.py:103`）。首个必选相关度最高者（`matching.py:324-327`）。
 *
 * ## 为什么需要它
 *
 * 纯按分数排序时，同一批"羽毛球 + 图书馆 + 周末"的帖子会霸占整个列表 ——
 * 用户看到 10 条几乎一样的推荐。MMR 用"与已选项的最大相似度"做惩罚，
 * 在**牺牲很小相关度**的前提下换回多样性。
 *
 * ## λ 的语义（容易被写反，所以写清楚）
 *
 * - `λ = 1` → 纯相关度排序（**等价于关闭 MMR**）。验收 T5 就是这样关掉它，
 *   否则多样性惩罚会掩盖"like 让分数变高"这件事。
 * - `λ = 0` → 第二选是**与第一选最不相似**的候选（验收 T10 断言这一点）。
 *
 * ## 没有向量时怎么办
 *
 * `rule` 降级档（无 pgvector）没有向量可比。此时本函数返回**原序**，
 * 并且**不做任何假装**：不拿标签 Jaccard 冒充余弦相似度
 * （那会让"MMR 已生效"变成一句无法验证的话）。
 */

export interface MmrCandidate<T> {
  item: T;
  /** 相关度（已融合的 finalScore） */
  relevance: number;
  /** 已归一化的向量；缺失表示该候选无法参与相似度惩罚 */
  vector?: readonly number[];
}

/** 余弦相似度（假定输入已 L2 归一化时等价于点积；这里仍按定义算，容错未归一化输入） */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
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

/**
 * MMR 重排。
 *
 * @param candidates 候选（顺序无关，函数内部按 relevance 选首个）
 * @param lambda 0..1；`1` = 关闭多样性惩罚
 * @param limit 取前 N（缺省取全部）
 *
 * 若**任何一个**候选缺少向量，函数返回**原序**（按 relevance 降序）——
 * 半途用一半的候选做惩罚会让结果依赖于"谁恰好有向量"，比不做更糟。
 */
export function mmrRerank<T>(
  candidates: readonly MmrCandidate<T>[],
  lambda: number,
  limit?: number,
): Array<MmrCandidate<T>> {
  const pool = [...candidates];
  if (pool.length <= 1) return limit === undefined ? pool : pool.slice(0, limit);

  const vectorsAvailable = pool.every((c) => c.vector !== undefined && c.vector.length > 0);
  if (!vectorsAvailable) {
    // 无向量：诚实退回相关度排序，不假装做了多样性
    return pool.sort((a, b) => b.relevance - a.relevance).slice(0, limit);
  }

  const lambdaClamped = lambda < 0 ? 0 : lambda > 1 ? 1 : lambda;
  const selected: Array<MmrCandidate<T>> = [];
  const remaining = [...pool];
  const target = limit === undefined ? pool.length : Math.min(limit, pool.length);

  // 首个必选相关度最高者（matching.py:324-327）
  remaining.sort((a, b) => b.relevance - a.relevance);
  selected.push(remaining.shift() as MmrCandidate<T>);

  while (selected.length < target && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i] as MmrCandidate<T>;
      let maxSim = 0;
      for (const chosen of selected) {
        const sim = cosineSimilarity(candidate.vector as readonly number[], chosen.vector as readonly number[]);
        if (sim > maxSim) maxSim = sim;
      }
      const score = lambdaClamped * candidate.relevance - (1 - lambdaClamped) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    selected.push(remaining.splice(bestIndex, 1)[0] as MmrCandidate<T>);
  }

  return selected;
}
