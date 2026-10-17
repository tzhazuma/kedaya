import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * 对称加密小工具（AES-256-GCM）。
 *
 * 用途：`CampusBinding.encryptedSession`（契约 §5 第二级）。
 * 校园系统的 session cookie **绝不明文落库**，只存密文 + 不可逆指纹。
 *
 * 存储格式：`v1.<iv>.<authTag>.<ciphertext>`（各段 base64url）
 * 带版本前缀是为了将来换算法时能平滑迁移。
 */

const VERSION = 'v1';
const IV_BYTES = 12; // GCM 推荐 96 bit
const KEY_BYTES = 32; // AES-256

function parseKey(keyHexOrBase64: string): Buffer {
  const trimmed = keyHexOrBase64.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (key.length !== KEY_BYTES) {
    throw new Error(`CAMPUS_SESSION_ENC_KEY 必须是 ${KEY_BYTES} 字节（64 位 hex 或 base64）`);
  }
  return key;
}

export function encryptSecret(plaintext: string, keyHexOrBase64: string): string {
  const key = parseKey(keyHexOrBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string, keyHexOrBase64: string): string {
  const key = parseKey(keyHexOrBase64);
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('密文格式不受支持');
  }

  const [, ivPart, tagPart, dataPart] = parts;
  if (!ivPart || !tagPart || !dataPart) throw new Error('密文格式不受支持');

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * 不可逆指纹：用来判断"这个绑定是不是同一个 session"，
 * 而不需要解密、也不泄漏明文。加盐防止对短 cookie 的彩虹表反查。
 */
export function fingerprintSecret(plaintext: string, salt = 'kedaya'): string {
  return createHash('sha256').update(`${salt}:${plaintext}`).digest('hex').slice(0, 32);
}
