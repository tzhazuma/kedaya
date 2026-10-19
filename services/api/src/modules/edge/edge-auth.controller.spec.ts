import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { EDGE_JWT_AUDIENCE, EdgeAuthController, EdgeTokenVerifier } from './edge-auth.controller';

/**
 * 公网边缘登录。
 *
 * 三条必须由测试锁住的护栏：
 * 1. **未配置凭据 → 404（不是放行）** —— "没配"绝不能等于"谁都能进"
 * 2. **错密码 → 401，且不泄露用户名是否存在**
 * 3. **签出的票带独立 `aud = kedaya-edge`** —— 业务侧 AuthGuard 不能认它
 */
function makeController(env: Record<string, string | undefined>): EdgeAuthController {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  return new EdgeAuthController(config);
}

const ENV = {
  EDGE_USERNAME: 'azuma',
  EDGE_PASSWORD: 'test-password-not-real',
  JWT_SECRET: 'test-jwt-secret',
};

describe('EdgeAuthController', () => {
  it('⚠️ 未配置凭据 → 404（功能未启用，而不是用一个默认密码放行）', () => {
    const c = makeController({ JWT_SECRET: 'x' });
    expect(() => c.login({ username: 'azuma', password: 'anything' })).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });

  it('只配了用户名、没配密码 → 同样 404', () => {
    const c = makeController({ EDGE_USERNAME: 'azuma', JWT_SECRET: 'x' });
    expect(() => c.login({ username: 'azuma', password: 'x' })).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });

  it('凭据正确 → 返回 token / expiresAt / expiresInSec', () => {
    const c = makeController(ENV);
    const result = c.login({ username: 'azuma', password: ENV.EDGE_PASSWORD });
    expect(result.token.split('.')).toHaveLength(3);
    expect(result.expiresInSec).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(result.expiresAt))).toBe(false);
  });

  it('密码错误 → 401（不是 404，也不是 500）', () => {
    const c = makeController(ENV);
    expect(() => c.login({ username: 'azuma', password: 'wrong' })).toThrowError(
      expect.objectContaining({ status: 401 }),
    );
  });

  it('用户名错误 → 401，且错误信息与「密码错误」**完全相同**（不泄露用户名是否存在）', () => {
    const c = makeController(ENV);
    let userErr: unknown;
    let passErr: unknown;
    try {
      c.login({ username: 'nobody', password: ENV.EDGE_PASSWORD });
    } catch (e) {
      userErr = e;
    }
    try {
      c.login({ username: 'azuma', password: 'wrong' });
    } catch (e) {
      passErr = e;
    }
    expect((userErr as Error).message).toBe((passErr as Error).message);
  });

  it('缺字段 / 非字符串 → 401（不炸 500）', () => {
    const c = makeController(ENV);
    for (const body of [{}, { username: 'azuma' }, { password: 'x' }, { username: 1, password: 2 }]) {
      expect(() => c.login(body)).toThrowError(expect.objectContaining({ status: 401 }));
    }
  });

  it('⚠️ 签出的票 aud = kedaya-edge（业务侧 AuthGuard 不认它）', () => {
    const c = makeController(ENV);
    const { token } = c.login({ username: 'azuma', password: ENV.EDGE_PASSWORD });
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] as string, 'base64url').toString('utf8'),
    ) as { aud: string; exp: number };
    expect(payload.aud).toBe(EDGE_JWT_AUDIENCE);
    expect(payload.exp * 1000).toBeGreaterThan(Date.now());
  });
});

describe('EdgeTokenVerifier', () => {
  it('认自己签的票', () => {
    const config = { get: (k: string) => ENV[k as keyof typeof ENV] } as unknown as ConfigService;
    const token = new EdgeAuthController(config).login({
      username: 'azuma',
      password: ENV.EDGE_PASSWORD,
    }).token;
    expect(new EdgeTokenVerifier(config).verify(token)).toBe(true);
  });

  it('拒绝被篡改的票 / 错 secret 签的票 / 乱字符串', () => {
    const config = { get: (k: string) => ENV[k as keyof typeof ENV] } as unknown as ConfigService;
    const verifier = new EdgeTokenVerifier(config);
    const token = new EdgeAuthController(config).login({
      username: 'azuma',
      password: ENV.EDGE_PASSWORD,
    }).token;
    const [h, , s] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'attacker', aud: EDGE_JWT_AUDIENCE, exp: 9_999_999_999 }),
    ).toString('base64url');

    expect(verifier.verify(`${h}.${forged}.${s}`)).toBe(false);
    expect(verifier.verify('not-a-jwt')).toBe(false);

    const otherSecret = {
      get: (k: string) => (k === 'JWT_SECRET' ? 'different' : ENV[k as keyof typeof ENV]),
    } as unknown as ConfigService;
    expect(new EdgeTokenVerifier(otherSecret).verify(token)).toBe(false);
  });
});
