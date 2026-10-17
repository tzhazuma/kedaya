import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../common/errors/app-error';
import {
  assertPasswordStrength,
  hashPassword,
  passwordIssues,
  verifyPassword,
} from './password';

/**
 * 密码派生与强度策略的回归测试。
 *
 * 要证明的核心命题：
 *   1. 库里存的**不是**明文，且同一密码两次哈希结果不同（有随机盐）；
 *   2. 校验是"任意篡改都不通过"，包括参数被改小、哈希被截断；
 *   3. 强度策略的边界行为明确（8 位、必须含字母+数字）。
 */
describe('密码哈希（scrypt）', () => {
  it('哈希串包含算法与参数，且不含明文密码', () => {
    const stored = hashPassword('Kedaya2026');
    expect(stored.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(stored).not.toContain('Kedaya2026');
    expect(stored.split('$')).toHaveLength(6);
  });

  it('同一密码两次哈希不同（随机盐），但都能校验通过', () => {
    const first = hashPassword('Kedaya2026');
    const second = hashPassword('Kedaya2026');

    expect(first).not.toBe(second);
    expect(verifyPassword('Kedaya2026', first)).toBe(true);
    expect(verifyPassword('Kedaya2026', second)).toBe(true);
  });

  it('密码错误时不通过', () => {
    const stored = hashPassword('Kedaya2026');
    expect(verifyPassword('Kedaya2025', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  it.each([
    ['空串', ''],
    ['格式不对', 'not-a-hash'],
    ['段数不足', 'scrypt$16384$8$1$abc'],
    ['算法不对', hashPassword('Kedaya2026').replace('scrypt', 'md5')],
    ['哈希被截断', hashPassword('Kedaya2026').slice(0, 40)],
  ])('被篡改的哈希（%s）一律不通过，而不是抛异常', (_label, stored) => {
    expect(() => verifyPassword('Kedaya2026', stored)).not.toThrow();
    expect(verifyPassword('Kedaya2026', stored)).toBe(false);
  });

  it('成本参数非法时不通过（不因解析出 NaN 而绕过校验）', () => {
    const [scheme, , r, p, salt, hash] = hashPassword('Kedaya2026').split('$');
    const broken = [scheme, 'abc', r, p, salt, hash].join('$');
    expect(verifyPassword('Kedaya2026', broken)).toBe(false);
  });
});

describe('密码强度策略', () => {
  it('接受 8 位以上且含字母与数字的密码', () => {
    expect(() => assertPasswordStrength('abc12345')).not.toThrow();
    expect(() => hashPassword('a'.repeat(63) + '1')).not.toThrow();
  });

  it.each([
    ['too-short', 'abc123'],
    ['too-long', 'a1'.repeat(40)],
    ['weak', 'abcdefgh'],
    ['weak', '12345678'],
    ['whitespace', 'abc 12345'],
  ])('%s：拒绝 %s', (reason, password) => {
    try {
      assertPasswordStrength(password);
      throw new Error('本应拒绝该密码');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toMatchObject({ reason });
    }
  });

  it('passwordIssues 把违反的规则全部列出（用于前端即时提示）', () => {
    expect(passwordIssues('abc')).toEqual(['至少 8 位', '需要包含数字']);
    expect(passwordIssues('abc12345')).toEqual([]);
  });
});
