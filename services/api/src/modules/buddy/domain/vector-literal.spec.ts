import { describe, expect, it } from 'vitest';
import { parseVectorLiteral, toVectorLiteral } from './vector-literal';

/**
 * 验收 T15（规格 §4.4 / §8.2）：
 * `toVectorLiteral` 拒绝 `NaN` / `Infinity` / 空数组。
 *
 * 这个函数是**纵深防御**：向量本来就走 `$queryRaw` 的参数绑定
 * （真实 pgvector 上的注入实验见 `test/buddy-db.spec.ts`）。
 * 它的价值在于"有人把 `${literal}` 改成 `Prisma.raw()` 的那一刻"仍然安全。
 */
describe('toVectorLiteral（规格 §4.4，验收 T15）', () => {
  it('正常向量 → pgvector 文本字面量', () => {
    expect(toVectorLiteral([0.1, -2, 3])).toBe('[0.1,-2,3]');
    expect(toVectorLiteral([0])).toBe('[0]');
  });

  it('拒绝空数组 / 非数组', () => {
    expect(() => toVectorLiteral([])).toThrow(RangeError);
    expect(() => toVectorLiteral(null as unknown as number[])).toThrow(RangeError);
    expect(() => toVectorLiteral('abc' as unknown as number[])).toThrow(RangeError);
  });

  it('拒绝 NaN / Infinity / -Infinity（这是本函数存在的理由）', () => {
    expect(() => toVectorLiteral([1, Number.NaN])).toThrow(/不是有限数/);
    expect(() => toVectorLiteral([1, Number.POSITIVE_INFINITY])).toThrow(/不是有限数/);
    expect(() => toVectorLiteral([Number.NEGATIVE_INFINITY])).toThrow(/不是有限数/);
  });

  it('拒绝非 number 分量（字符串数字也不行 —— 宽松转换会掩盖类型错误）', () => {
    expect(() => toVectorLiteral([1, '2' as unknown as number])).toThrow(/不是有限数/);
    expect(() => toVectorLiteral([1, null as unknown as number])).toThrow(/不是有限数/);
  });

  it('维度不符时抛错（静默截断会让"维度写错"变成"相似度算错"）', () => {
    expect(() => toVectorLiteral([1, 2, 3], 768)).toThrow(/维度必须是 768/);
    expect(toVectorLiteral(new Array(768).fill(0), 768)).toContain('[');
  });

  it('**任何**输入都无法构造出非数值内容（注入不可能的结构性保证）', () => {
    const payloads: unknown[] = [
      "[1,0,0]'); DROP TABLE \"BuddyPost\"; --",
      "1,0,0]::vector; DELETE FROM \"User\"; --",
      [1, 0, 0],
      {},
      [[1]],
    ];
    for (const payload of payloads) {
      let produced: string | null = null;
      try {
        produced = toVectorLiteral(payload as number[]);
      } catch {
        produced = null;
      }
      if (produced !== null) {
        // 只要产出了字面量，它就**只**由数字、逗号、方括号构成
        expect(produced).toMatch(/^\[-?\d+(\.\d+)?(,-?\d+(\.\d+)?)*\]$/);
      }
    }
  });
});

describe('parseVectorLiteral（读回向量）', () => {
  it('往返一致', () => {
    const original = [0.5, -1.25, 3];
    expect(parseVectorLiteral(toVectorLiteral(original))).toEqual(original);
  });

  it('脏输入返回 null（读路径不该因为一条脏向量 500）', () => {
    expect(parseVectorLiteral('not a vector')).toBeNull();
    expect(parseVectorLiteral('[1,abc]')).toBeNull();
    expect(parseVectorLiteral(null)).toBeNull();
    expect(parseVectorLiteral(123)).toBeNull();
  });

  it('维度不符返回 null', () => {
    expect(parseVectorLiteral('[1,2,3]', 768)).toBeNull();
  });

  it('空向量 `[]` 解析为空数组（不是 null）', () => {
    expect(parseVectorLiteral('[]')).toEqual([]);
  });
});
