import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { UnauthenticatedError } from '../errors/app-error';

/**
 * 最小 HS256 JWT 实现（node:crypto，零依赖）。
 *
 * 为什么不用 @nestjs/jwt / jsonwebtoken：
 *   契约 §5 要求第一级身份**唯一产出 KedaYa 自有 JWT**，
 *   而 JWT 只是 identity 层的一个编码细节，用一个 60 行的
 *   HMAC-SHA256 实现即可，避免再引入一个依赖树。
 *
 * 注意：这里刻意**只**承载身份信息（sub/typ），
 * 不承载任何校园系统 session —— 见 auth 模块的两级模型。
 */

export type TokenType = 'access' | 'refresh';

export interface JwtPayload {
  /** 主体 = KedaYa userId（第一级身份） */
  sub: string;
  typ: TokenType;
  iat: number;
  exp: number;
  /**
   * 令牌唯一 id（仅刷新令牌使用）。
   *
   * 为什么必须有：JWT 的内容只由 `{sub, typ, iat, exp}` 决定，
   * 同一秒内为同一用户签发的两个刷新令牌会是**完全相同的字符串** ——
   * 那样"轮换"就失去了意义（旧令牌等于新令牌，撤销旧的就等于撤销新的）。
   * 因此刷新令牌强制带 jti，保证每次签发都不同。
   */
  jti?: string;
}

interface JwtHeader {
  alg: 'HS256';
  typ: 'JWT';
}

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function hmac(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signJwt(
  sub: string,
  type: TokenType,
  secret: string,
  ttlSeconds: number,
  options: { jti?: string } = {},
): string {
  if (!secret) throw new Error('JWT_SECRET 未配置');

  const now = Math.floor(Date.now() / 1000);
  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
  const payload: JwtPayload = { sub, typ: type, iat: now, exp: now + ttlSeconds };
  if (type === 'refresh') {
    // 刷新令牌一律带 jti：轮换/撤销都依赖它
    payload.jti = options.jti ?? randomUUID();
  } else if (options.jti !== undefined) {
    payload.jti = options.jti;
  }

  const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
  return `${signingInput}.${hmac(signingInput, secret)}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload {
  if (!secret) throw new Error('JWT_SECRET 未配置');

  const parts = token.split('.');
  if (parts.length !== 3) throw new UnauthenticatedError('访问令牌格式不正确');

  const [encodedHeader, encodedPayload, signature] = parts;
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new UnauthenticatedError('访问令牌格式不正确');
  }

  const expected = hmac(`${encodedHeader}.${encodedPayload}`, secret);
  const provided = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');

  // 长度不等时 timingSafeEqual 会抛错，必须先比长度；比较用等长缓冲
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
    throw new UnauthenticatedError('访问令牌签名校验失败');
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as JwtPayload;
  } catch {
    throw new UnauthenticatedError('访问令牌内容无法解析');
  }

  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
    throw new UnauthenticatedError('访问令牌缺少必要字段');
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new UnauthenticatedError('访问令牌已过期，请重新登录');
  }

  return payload;
}
