import { createHash, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * 一次性验证码的生成、哈希与策略。
 *
 * 设计要点：
 *   1. **只存哈希**：数据库泄漏也拿不到可用验证码；
 *   2. 用 `scrypt` + 固定盐（`target:purpose`）派生，避免为每次发送写随机盐列，
 *      同时保证同一验证码在不同 target 下哈希不同；
 *   3. 用 `randomInt`（CSPRNG）而非 `Math.random` 生成，防止可预测；
 *   4. TTL、最大尝试次数、发送冷却、每小时上限都在这里定义，
 *      由服务层统一执行 —— 策略只写一次。
 */

/** 验证码用途（数据库里以字符串存储） */
export type VerificationPurpose = 'register' | 'reset-password' | 'change-password' | 'bind-email';

export const VERIFICATION_PURPOSES: readonly VerificationPurpose[] = [
  'register',
  'reset-password',
  'change-password',
  'bind-email',
];

/** 验证码位数 */
export const CODE_DIGITS = 6;
/** 验证码有效期：10 分钟 */
export const CODE_TTL_MS = 10 * 60 * 1000;
/** 单个验证码最多尝试次数（超过即作废，必须重新发送） */
export const CODE_MAX_ATTEMPTS = 5;
/** 同一用途两次发送的最小间隔：60 秒 */
export const CODE_RESEND_COOLDOWN_MS = 60 * 1000;
/** 同一目标 + 用途每小时最多发送次数 */
export const CODE_MAX_SENDS_PER_HOUR = 5;

const CODE_HASH_SALT_PREFIX = 'kedaya-verification-code';

export function isVerificationPurpose(value: string): value is VerificationPurpose {
  return (VERIFICATION_PURPOSES as readonly string[]).includes(value);
}

/** 生成 6 位数字验证码（含前导零） */
export function generateCode(): string {
  const max = 10 ** CODE_DIGITS;
  return String(randomInt(0, max)).padStart(CODE_DIGITS, '0');
}

/**
 * 验证码哈希。固定盐 + scrypt（N 取小值即可：验证码空间只有 10^6，
 * 真正的防线是 TTL + 尝试次数 + 发送频控，而不是哈希强度）。
 */
export function hashCode(target: string, purpose: VerificationPurpose, code: string): string {
  const salt = `${CODE_HASH_SALT_PREFIX}:${target.toLowerCase()}:${purpose}`;
  const derived = scryptSync(code, salt, 32, { N: 1024, r: 8, p: 1 });
  return derived.toString('base64');
}

export function verifyCode(
  target: string,
  purpose: VerificationPurpose,
  code: string,
  storedHash: string,
): boolean {
  if (typeof storedHash !== 'string' || storedHash.length === 0) return false;
  if (typeof code !== 'string' || !new RegExp(`^\\d{${CODE_DIGITS}}$`).test(code)) return false;

  const expected = Buffer.from(storedHash, 'base64');
  const actual = Buffer.from(hashCode(target, purpose, code), 'base64');
  if (expected.length !== actual.length || expected.length === 0) return false;
  return timingSafeEqual(expected, actual);
}

/** 规范化邮箱：小写 + 去空白（账号唯一性以规范化结果为准） */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * 邮箱格式校验。
 *
 * 刻意保持"足够严但不过度"：拒绝空格、连续点、缺少 TLD 等明显错误，
 * 但不尝试完全符合 RFC 5322（那类正则几乎都过严）。
 */
export function isEmailLike(email: string): boolean {
  const value = normalizeEmail(email);
  if (value.length === 0 || value.length > 254) return false;
  if (/\s/.test(value)) return false;
  if (value.includes('..')) return false;
  // 本地部分不允许以点开头/结尾，也不允许空段（`a.@b.com`、`.a@b.com` 都拒绝）
  const local = value.slice(0, value.lastIndexOf('@'));
  const domain = value.slice(value.lastIndexOf('@') + 1);
  if (local.length === 0 || domain.length === 0) return false;
  if (local.startsWith('.') || local.endsWith('.')) return false;
  if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) return false;
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(domain);
}

/** 与验证码无关的通用哈希（用于刷新令牌指纹） */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * 匿名 handle 生成（宿舍矛盾 / 论坛匿名）。
 * 用 `sha256(seed)` 的前 6 位十六进制 + 前缀，保证同一种子稳定、
 * 不同种子几乎不碰撞；不含任何实名信息。
 */
export function anonymousHandle(seed: string): string {
  return `鸭友${sha256Hex(seed).slice(0, 6).toUpperCase()}`;
}

/** 一次性追踪码（宿舍矛盾：明文只返回一次，库里只存哈希） */
export function generateTrackCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    if (i === 4 || i === 8) out += '-';
    out += alphabet[randomInt(0, alphabet.length)];
  }
  return out;
}
