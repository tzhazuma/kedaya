import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ValidationError } from '../../../common/errors/app-error';

/**
 * 密码派生与强度校验（`node:crypto`，零依赖）。
 *
 * 为什么是 scrypt 而不是 bcrypt/argon2：
 *   · `node:crypto` 自带，避免为一个哈希函数引入原生编译依赖（CI 安装成本）；
 *   · scrypt 是内存硬函数，抗 GPU 暴力破解，参数可调（N/r/p 写进哈希串，
 *     将来提升成本参数时旧密码依然可验证）。
 *
 * 存储格式（自描述，含参数与盐）：
 *   `scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>`
 *
 * 安全约束：
 *   1. 任何情况下不落明文、不做可逆加密；
 *   2. 比较必须 `timingSafeEqual`，避免通过响应时间侧信道猜测密码；
 *   3. 校验失败不区分"密码错"与"账号不存在"（由服务层统一文案），避免账号枚举。
 */

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** 密码长度下限/上限（上限用于避免超长输入带来的 CPU 放大攻击） */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;

export function hashPassword(password: string): string {
  assertPasswordStrength(password);
  const salt = randomBytes(SALT_LENGTH);
  const derived = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * 校验密码。任何解析/格式问题都返回 `false`（而不是抛异常），
 * 让调用方只处理「通过 / 不通过」两种结果。
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (typeof stored !== 'string' || stored.length === 0) return false;

  const parts = stored.split('$');
  if (parts.length !== 6) return false;

  const [scheme, rawN, rawR, rawP, saltB64, hashB64] = parts;
  if (scheme !== 'scrypt' || !rawN || !rawR || !rawP || !saltB64 || !hashB64) return false;

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N, r, p });
  } catch {
    // 参数非法（例如 N 不是 2 的幂）时视为校验失败，不放行
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * 密码强度策略：8–64 位，必须同时包含字母与数字。
 *
 * 刻意**不**强制大小写与特殊字符 —— 那类规则会诱导用户使用
 * `Password1!` 这种可预测模式，实际收益有限；这里保留
 * 「长度 + 字符种类」两条最容易解释的规则。
 */
export function assertPasswordStrength(password: string): void {
  if (typeof password !== 'string') {
    throw new ValidationError('密码格式不正确');
  }

  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    throw new ValidationError(`密码至少 ${PASSWORD_MIN_LENGTH} 位`, {
      field: 'password',
      reason: 'too-short',
    });
  }
  if (length > PASSWORD_MAX_LENGTH) {
    throw new ValidationError(`密码最多 ${PASSWORD_MAX_LENGTH} 位`, {
      field: 'password',
      reason: 'too-long',
    });
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new ValidationError('密码需要同时包含字母和数字', {
      field: 'password',
      reason: 'weak',
    });
  }
  if (/\s/.test(password)) {
    throw new ValidationError('密码不能包含空格', { field: 'password', reason: 'whitespace' });
  }
}

/** 密码强度（供前端/接口返回可读提示，不抛异常） */
export function passwordIssues(password: string): string[] {
  const issues: string[] = [];
  const length = [...(password ?? '')].length;
  if (length < PASSWORD_MIN_LENGTH) issues.push(`至少 ${PASSWORD_MIN_LENGTH} 位`);
  if (length > PASSWORD_MAX_LENGTH) issues.push(`最多 ${PASSWORD_MAX_LENGTH} 位`);
  if (!/[A-Za-z]/.test(password ?? '')) issues.push('需要包含字母');
  if (!/\d/.test(password ?? '')) issues.push('需要包含数字');
  if (/\s/.test(password ?? '')) issues.push('不能包含空格');
  return issues;
}
