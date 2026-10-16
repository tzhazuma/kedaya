import { describe, expect, it } from 'vitest';
import { cosineSimilarity, mmrRerank } from './mmr';

/**
 * 验收 T10（规格 §3.1 第 9 步 / §8.2）：
 * MMR 在 `λ=0` 时，第二选是**与第一选最不相似**的候选。
 *
 * 另外钉死一个刻意的行为：**没有向量时退回相关度排序**，
 * 而不是拿标签 Jaccard 冒充余弦相似度（那会让"MMR 已生效"变成一句无法验证的话）。
 */

/** 造一个 2 维单位向量（便于心算相似度） */
function vec(x: number, y: number): number[] {
  const norm = Math.hypot(x, y);
  return [x / norm, y / norm];
}

describe('cosineSimilarity', () => {
  it('同向 = 1、正交 = 0、反向 = -1', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it('维度不一致或零向量返回 0（不抛异常：推荐路径不该因为脏向量挂掉）', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe('mmrRerank（规格 §3.1 第 9 步，验收 T10）', () => {
  it('λ=1 → 纯相关度排序（等价于关闭 MMR）', () => {
    const items = [
      { item: 'low', relevance: 0.1, vector: vec(1, 0) },
      { item: 'high', relevance: 0.9, vector: vec(1, 0) },
      { item: 'mid', relevance: 0.5, vector: vec(0, 1) },
    ];
    expect(mmrRerank(items, 1).map((entry) => entry.item)).toEqual(['high', 'mid', 'low']);
  });

  it('λ=0 → 第二选是与第一选**最不相似**的候选（验收 T10 原文）', () => {
    // A 与 B 几乎同向（相似度高），C 与 A 正交（相似度 0）
    const A = vec(1, 0);
    const B = vec(1, 0.05);
    const C = vec(0, 1);
    const items = [
      { item: 'A', relevance: 0.9, vector: A },
      { item: 'B', relevance: 0.85, vector: B },
      { item: 'C', relevance: 0.4, vector: C },
    ];

    const ranked = mmrRerank(items, 0);
    expect(ranked[0]?.item).toBe('A'); // 首个必选相关度最高者
    expect(ranked[1]?.item).toBe('C'); // λ=0 时只按"与已选最不相似"选
    expect(ranked[2]?.item).toBe('B');
  });

  it('λ=0.7（默认）时相关度仍占主导，但相似候选被压后', () => {
    const items = [
      { item: 'A', relevance: 0.9, vector: vec(1, 0) },
      { item: 'B', relevance: 0.88, vector: vec(1, 0.02) },
      { item: 'C', relevance: 0.5, vector: vec(0, 1) },
    ];
    const ranked = mmrRerank(items, 0.7);
    expect(ranked[0]?.item).toBe('A');
    // B 相关度更高，但与 A 几乎同向；λ=0.7 下 C 反超
    // mmr(B) = 0.7*0.88 - 0.3*~1.0 ≈ 0.316；mmr(C) = 0.7*0.5 - 0.3*0 ≈ 0.35
    expect(ranked[1]?.item).toBe('C');
  });

  it('无向量时**退回相关度排序**，不假装做了多样性', () => {
    const items = [
      { item: 'low', relevance: 0.1 },
      { item: 'high', relevance: 0.9 },
    ];
    expect(mmrRerank(items, 0).map((entry) => entry.item)).toEqual(['high', 'low']);
  });

  it('**部分**候选缺向量时也整体退回（半途惩罚比不做更糟：结果会依赖"谁恰好有向量"）', () => {
    const items = [
      { item: 'A', relevance: 0.9, vector: vec(1, 0) },
      { item: 'B', relevance: 0.8 }, // 缺向量
      { item: 'C', relevance: 0.1, vector: vec(0, 1) },
    ];
    expect(mmrRerank(items, 0).map((entry) => entry.item)).toEqual(['A', 'B', 'C']);
  });

  it('limit 生效，且不超过候选数', () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      item: `i${index}`,
      relevance: 1 - index * 0.1,
      vector: vec(1, index * 0.01),
    }));
    expect(mmrRerank(items, 0.7, 2)).toHaveLength(2);
    expect(mmrRerank(items, 0.7, 99)).toHaveLength(5);
  });

  it('0 或 1 个候选直接返回（不做无意义的循环）', () => {
    expect(mmrRerank([], 0.7)).toEqual([]);
    expect(mmrRerank([{ item: 'x', relevance: 1, vector: vec(1, 0) }], 0)).toHaveLength(1);
  });

  it('λ 越界被夹到 [0,1]（配置写错不该产生诡异排序）', () => {
    const items = [
      { item: 'A', relevance: 0.9, vector: vec(1, 0) },
      { item: 'B', relevance: 0.1, vector: vec(0, 1) },
    ];
    expect(mmrRerank(items, 5).map((entry) => entry.item)).toEqual(['A', 'B']);
    expect(mmrRerank(items, -3).map((entry) => entry.item)).toEqual(['A', 'B']);
  });

  it('不修改入参数组（纯函数）', () => {
    const items = [
      { item: 'A', relevance: 0.1, vector: vec(1, 0) },
      { item: 'B', relevance: 0.9, vector: vec(0, 1) },
    ];
    const snapshot = items.map((entry) => entry.item);
    mmrRerank(items, 0);
    expect(items.map((entry) => entry.item)).toEqual(snapshot);
  });
});
