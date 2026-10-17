import { describe, expect, it } from 'vitest';
import {
  CODE_DIGITS,
  generateCode,
  generateTrackCode,
  hashCode,
  isEmailLike,
  normalizeEmail,
  verifyCode,
} from './verification-code';

describe('验证码生成与校验', () => {
  it('永远是 6 位数字（含前导零）', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_DIGITS);
      expect(/^\d{6}$/.test(code)).toBe(true);
    }
  });

  it('哈希后可校验通过，且哈希里不含明文验证码', () => {
    const code = generateCode();
    const hashed = hashCode('a@b.com', 'register', code);

    expect(hashed).not.toContain(code);
    expect(verifyCode('a@b.com', 'register', code, hashed)).toBe(true);
  });

  it('同一验证码在不同用途/邮箱下哈希不同（防跨场景复用）', () => {
    const code = '123456';
    const a = hashCode('a@b.com', 'register', code);
    const b = hashCode('a@b.com', 'reset-password', code);
    const c = hashCode('c@d.com', 'register', code);

    expect(new Set([a, b, c]).size).toBe(3);
    expect(verifyCode('a@b.com', 'reset-password', code, a)).toBe(false);
  });

  it.each([
    ['位数不对', '12345'],
    ['不是数字', 'abcdef'],
    ['带空格', ' 12345'],
    ['空串', ''],
  ])('非 6 位数字（%s）直接判否，不抛异常', (_label, code) => {
    const hashed = hashCode('a@b.com', 'register', '123456');
    expect(() => verifyCode('a@b.com', 'register', code, hashed)).not.toThrow();
    expect(verifyCode('a@b.com', 'register', code, hashed)).toBe(false);
  });

  it('空的或损坏的哈希判否', () => {
    expect(verifyCode('a@b.com', 'register', '123456', '')).toBe(false);
    expect(verifyCode('a@b.com', 'register', '123456', 'aGVsbG8=')).toBe(false);
  });
});

describe('邮箱规范化与校验', () => {
  it('规范化为小写并去空白（账号唯一性以它为准）', () => {
    expect(normalizeEmail('  Kedaya@Stu.ShanghaiTech.edu.cn ')).toBe(
      'kedaya@stu.shanghaitech.edu.cn',
    );
  });

  it.each([
    'a@b.com',
    'zhangsan@shanghaitech.edu.cn',
    'zhang.san+tag@stu.shanghaitech.edu.cn',
  ])('接受 %s', (email) => {
    expect(isEmailLike(email)).toBe(true);
  });

  it.each(['', 'a', 'a@b', 'a b@c.com', 'a@@b.com', 'a@b..com', '@b.com', 'a.@b.com', 'a@.com'])(
    '拒绝 %s',
    (email) => {
      expect(isEmailLike(email)).toBe(false);
    },
  );
});

describe('匿名 handle 与追踪码', () => {
  it('追踪码可读、分组、且不含易混淆字符', () => {
    const code = generateTrackCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(code).not.toMatch(/[IO01]/);
  });

  it('追踪码不重复（1000 次无碰撞）', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateTrackCode()));
    expect(codes.size).toBe(1000);
  });
});
