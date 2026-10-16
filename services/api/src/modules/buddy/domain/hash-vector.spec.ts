import { describe, expect, it } from 'vitest';
import { hashVector, DEFAULT_HASH_DIM } from '@kedaya/shared';

/**
 * 验收 T7 / T8 / T9（规格 §3.5 / §8.2）：
 *   T7 `hashVector(text, 768)` 返回长度 768、L2 范数 ≈1.0（`abs < 1e-5`）
 *   T8 对相同输入**确定**（两次调用逐元素相等）
 *   T9 对**非 BMP 字符**（emoji 🦆）不抛异常且范数仍为 1
 *
 * ## 为什么这个 spec 在 api 包里，而不是只留在 shared 包
 *
 * 算法实现在 `@kedaya/shared`（那是唯一一份实现，客户端与服务端共用）。
 * 但**规格 §3.5 明确记了一个跨语言陷阱**：JS 的 `charCodeAt` 对非 BMP 字符
 * 返回代理对码元，Python 的 `ord` 返回码点 —— 同一段文本在两种实现下向量不同。
 * 规格说"我们必须固定一种实现并单测"。
 *
 * 这个 spec 就是那份"固定下来的契约"：它断言 API 依赖的行为
 * （维度来自配置、确定性、emoji 安全），因此 shared 包一旦改了行为，
 * 这里会红 —— 而不是等到线上推荐结果变了才发现。
 */

const DIM = 768;

function l2Norm(vector: readonly number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

describe('hashVector（规格 §3.5，验收 T7 / T8 / T9）', () => {
  it('T7：长度 768、L2 范数 ≈ 1.0（abs < 1e-5）', () => {
    const vector = hashVector('羽毛球 自习 一食堂', DIM);
    expect(vector).toHaveLength(DIM);
    expect(Math.abs(l2Norm(vector) - 1)).toBeLessThan(1e-5);
  });

  it('T7：非空文本的向量里至少有一个非零分量（否则"归一化"是空谈）', () => {
    const vector = hashVector('a', DIM);
    expect(vector.some((value) => value !== 0)).toBe(true);
  });

  it('T8：相同输入 → 逐元素完全相等（确定性）', () => {
    const text = '周六下午羽毛球，缺 2 人 badminton indoor';
    const first = hashVector(text, DIM);
    const second = hashVector(text, DIM);
    expect(first).toEqual(second);
  });

  it('T8：确定性不受调用顺序影响（没有共享可变状态）', () => {
    const a = hashVector('甲', DIM);
    hashVector('乙', DIM);
    hashVector('丙', DIM);
    expect(hashVector('甲', DIM)).toEqual(a);
  });

  it('T9：非 BMP 字符（emoji 🦆 / 𠮷）不抛异常且范数仍为 1', () => {
    for (const text of ['🦆', '可达鸭 🦆🦆', '𠮷野家', '🦆 a 𠮷']) {
      const vector = hashVector(text, DIM);
      expect(vector, text).toHaveLength(DIM);
      expect(Math.abs(l2Norm(vector) - 1), text).toBeLessThan(1e-5);
    }
  });

  it('T9：emoji 按**码点**切分（`[...text]` 而不是 `text.split("")`）', () => {
    // 如果实现用 charCodeAt 逐码元迭代，'🦆' 会被拆成两个代理码元 → 两个桶各 +1。
    // 按码点切分则只有一个桶 +1。两种实现的向量**不同**，这里钉死后者。
    const duck = hashVector('🦆', DIM);
    expect(duck.filter((value) => value !== 0)).toHaveLength(1);
  });

  it('空文本 → 全零向量（不做除零得到 NaN）', () => {
    const vector = hashVector('', DIM);
    expect(vector.every((value) => value === 0)).toBe(true);
    expect(vector.some((value) => Number.isNaN(value))).toBe(false);
  });

  it('默认维度是 768（与迁移里的 vector(768) 一致 —— 维度不一致会让 `<=>` 直接报错）', () => {
    expect(DEFAULT_HASH_DIM).toBe(768);
    expect(hashVector('x')).toHaveLength(768);
  });

  it('非法维度抛 RangeError（而不是静默产出一个空向量）', () => {
    expect(() => hashVector('x', 0)).toThrow(RangeError);
    expect(() => hashVector('x', -1)).toThrow(RangeError);
    expect(() => hashVector('x', 1.5)).toThrow(RangeError);
  });

  it('不同文本给出不同向量（否则哈希向量连"字符袋相似"都做不到）', () => {
    expect(hashVector('羽毛球', DIM)).not.toEqual(hashVector('图书馆', DIM));
  });
});
