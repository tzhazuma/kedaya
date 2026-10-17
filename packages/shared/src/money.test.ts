import { describe, expect, it } from 'vitest';
import { fenToSignedYuan, fenToYuan, isValidFen, yuanToFen } from './money';

describe('fenToYuan', () => {
  it('把整数分转为两位小数的元', () => {
    expect(fenToYuan(12345)).toBe('123.45');
    expect(fenToYuan(0)).toBe('0.00');
    expect(fenToYuan(5)).toBe('0.05');
    expect(fenToYuan(50)).toBe('0.50');
    expect(fenToYuan(100)).toBe('1.00');
  });

  it('处理负数', () => {
    expect(fenToYuan(-12345)).toBe('-123.45');
    expect(fenToYuan(-5)).toBe('-0.05');
  });

  it('对非有限数抛错', () => {
    expect(() => fenToYuan(Number.NaN)).toThrow(TypeError);
    expect(() => fenToYuan(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('yuanToFen', () => {
  it('解析元字符串为分', () => {
    expect(yuanToFen('123.45')).toBe(12345);
    expect(yuanToFen('0.05')).toBe(5);
    expect(yuanToFen('1')).toBe(100);
    expect(yuanToFen('0')).toBe(0);
    expect(yuanToFen(' 12.3 ')).toBe(1230);
  });

  it('处理负数', () => {
    expect(yuanToFen('-123.45')).toBe(-12345);
  });

  it('拒绝非法输入', () => {
    expect(() => yuanToFen('abc')).toThrow(TypeError);
    expect(() => yuanToFen('1.234')).toThrow(TypeError);
    expect(() => yuanToFen('')).toThrow(TypeError);
    expect(() => yuanToFen('1,000')).toThrow(TypeError);
  });

  it('与 fenToYuan 往返一致', () => {
    for (const fen of [0, 1, 99, 100, 12345, 999999]) {
      expect(yuanToFen(fenToYuan(fen))).toBe(fen);
    }
  });
});

describe('fenToSignedYuan / isValidFen', () => {
  it('带符号展示', () => {
    expect(fenToSignedYuan(12345)).toBe('+123.45');
    expect(fenToSignedYuan(-12345)).toBe('-123.45');
    expect(fenToSignedYuan(0)).toBe('+0.00');
  });

  it('只接受安全整数', () => {
    expect(isValidFen(100)).toBe(true);
    expect(isValidFen(1.5)).toBe(false);
    expect(isValidFen('100')).toBe(false);
    expect(isValidFen(Number.NaN)).toBe(false);
  });
});
