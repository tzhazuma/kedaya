import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, fingerprintSecret } from './secret-box';

const KEY = 'a'.repeat(64); // 32 字节 hex

describe('secret-box（契约 §5：校园 session 加密存储）', () => {
  it('加密后能解回原文', () => {
    const plaintext = 'EGATE_SESSION=abc123; Path=/';
    const cipher = encryptSecret(plaintext, KEY);
    expect(decryptSecret(cipher, KEY)).toBe(plaintext);
  });

  it('密文不含明文（校园 session 绝不落明文）', () => {
    const plaintext = 'super-secret-session-cookie';
    const cipher = encryptSecret(plaintext, KEY);
    expect(cipher).not.toContain(plaintext);
    expect(cipher.startsWith('v1.')).toBe(true);
  });

  it('相同明文两次加密得到不同密文（随机 IV）', () => {
    const a = encryptSecret('same', KEY);
    const b = encryptSecret('same', KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe('same');
    expect(decryptSecret(b, KEY)).toBe('same');
  });

  it('换密钥无法解密（GCM 认证失败）', () => {
    const cipher = encryptSecret('secret', KEY);
    expect(() => decryptSecret(cipher, 'b'.repeat(64))).toThrow();
  });

  it('密文被篡改时解密失败（GCM 完整性保护）', () => {
    const cipher = encryptSecret('secret', KEY);
    const parts = cipher.split('.');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('tampered').toString('base64url')].join(
      '.',
    );
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  it('密钥长度不合法时直接报错', () => {
    expect(() => encryptSecret('x', 'tooshort')).toThrow(/32 字节/);
  });

  it('指纹不可逆且稳定（用于判断是否需重新绑定）', () => {
    const fp1 = fingerprintSecret('cookie-value');
    const fp2 = fingerprintSecret('cookie-value');
    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fingerprintSecret('other-value'));
    expect(fp1).not.toContain('cookie-value');
    expect(fp1).toHaveLength(32);
  });
});
