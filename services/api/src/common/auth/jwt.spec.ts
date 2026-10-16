import { describe, expect, it } from 'vitest';
import { signJwt, verifyJwt } from './jwt';
import { UnauthenticatedError } from '../errors/app-error';

const SECRET = 'test-secret-at-least-32-characters-long';

describe('JWT（契约 §5：第一级身份唯一产出 KedaYa 自有 JWT）', () => {
  it('签发后能校验并取回 sub', () => {
    const token = signJwt('user-1', 'access', SECRET, 900);
    const payload = verifyJwt(token, SECRET);
    expect(payload.sub).toBe('user-1');
    expect(payload.typ).toBe('access');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('JWT 只承载身份（sub/typ/iat/exp），不承载任何校园 session 字段', () => {
    const token = signJwt('user-1', 'access', SECRET, 900);
    const payload = verifyJwt(token, SECRET);
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub', 'typ']);
  });

  it('换密钥校验失败', () => {
    const token = signJwt('user-1', 'access', SECRET, 900);
    expect(() => verifyJwt(token, 'another-secret-at-least-32-chars!!')).toThrow(
      UnauthenticatedError,
    );
  });

  it('篡改 payload 会被签名校验拦下', () => {
    const token = signJwt('user-1', 'access', SECRET, 900);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'admin', typ: 'access', iat: 1, exp: 9999999999 }),
    ).toString('base64url');
    expect(() => verifyJwt(`${header}.${forged}.${signature}`, SECRET)).toThrow(
      UnauthenticatedError,
    );
  });

  it('过期 token 被拒绝', () => {
    const token = signJwt('user-1', 'access', SECRET, -10);
    expect(() => verifyJwt(token, SECRET)).toThrow(/已过期/);
  });

  it('格式不对的 token 被拒绝', () => {
    expect(() => verifyJwt('not-a-jwt', SECRET)).toThrow(UnauthenticatedError);
    expect(() => verifyJwt('a.b', SECRET)).toThrow(UnauthenticatedError);
  });

  it('refresh 与 access 通过 typ 区分', () => {
    const refresh = signJwt('user-1', 'refresh', SECRET, 2592000);
    expect(verifyJwt(refresh, SECRET).typ).toBe('refresh');
  });
});
