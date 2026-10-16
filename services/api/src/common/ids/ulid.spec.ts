import { describe, expect, it } from 'vitest';
import { UlidFactory, isUlid, ulid } from './ulid';

/**
 * ULID 生成器测试。
 *
 * 为什么值得单测：论坛匿名发帖必须**先有 id 才能派生 handle**，
 * 而分页是 `orderBy id asc`，所以"同毫秒单调递增"是分页稳定性的前提。
 */
describe('ULID 生成器', () => {
  it('生成 26 位 Crockford Base32，且能通过 isUlid 校验', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
  });

  it('连续生成 1000 枚不重复', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => ulid()));
    expect(ids.size).toBe(1000);
  });

  it('同一毫秒内单调递增（分页 orderBy id asc 依赖这一点）', () => {
    const factory = new UlidFactory({
      now: () => 1_700_000_000_000,
      random: () => new Uint8Array(10).fill(0),
    });

    const ids = [factory.next(), factory.next(), factory.next()];

    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(3);
  });

  it('随机段全满时进位到下一毫秒，仍然单调且不重复', () => {
    const factory = new UlidFactory({
      now: () => 1_700_000_000_000,
      random: () => new Uint8Array(10).fill(0xff),
    });

    const first = factory.next();
    const second = factory.next();

    expect(second > first).toBe(true);
    expect(second).not.toBe(first);
  });

  it('时间戳不同的两枚 id，前 10 位（时间前缀）不同', () => {
    let clock = 1_700_000_000_000;
    const factory = new UlidFactory({ now: () => clock, random: () => new Uint8Array(10).fill(7) });

    const a = factory.next();
    clock += 1000;
    const b = factory.next();

    expect(a.slice(0, 10)).not.toBe(b.slice(0, 10));
    expect(b > a).toBe(true);
  });

  it('isUlid 拒绝长度不对、含非法字符（I/L/O/U）的输入', () => {
    expect(isUlid('')).toBe(false);
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FA')).toBe(false); // 25 位
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAI')).toBe(false); // 含 I
    expect(isUlid('01arz3ndektsv4rrffq69g5fav')).toBe(true); // 小写也接受
  });
});
