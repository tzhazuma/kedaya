import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { AuthService } from './auth.service';
import { WechatAuthService } from './wechat-auth.service';
import { WeChatMiniProgramAdapter } from './data/wechat-miniprogram.adapter';
import type { AuthPort, CampusSessionPort } from './domain/auth.domain';
import { DISPLAY_NAME_MAX } from './domain/display-name';
import { WECHAT_IDENTITY_PROVIDER } from './domain/wechat.domain';
import { createInMemoryAuth, type InMemoryAuth } from './testing/in-memory-auth';

/**
 * 微信小程序登录的回归测试。
 *
 * 要证明的核心命题：
 *   1. 这是**第一级身份**（产出 KedaYa 自有 JWT），响应里没有任何校园 session；
 *   2. 同一 openid 反复登录是同一账号，不同 openid 是不同账号；
 *   3. 开发模拟（`dev:` 凭证）只在非生产可用，且被明确标注 `simulated`；
 *   4. 绑定/解绑的边界：不能抢别人的微信，也不能把自己锁在门外。
 */

const SECRET = 'test-secret-please-change-me-32-chars';

function makeConfig(values: Record<string, string> = {}): ConfigService {
  const table: Record<string, string> = {
    JWT_SECRET: SECRET,
    JWT_ACCESS_TTL: '900',
    JWT_REFRESH_TTL: '2592000',
    ...values,
  };
  return { get: (key: string) => table[key] } as unknown as ConfigService;
}

interface Harness {
  service: WechatAuthService;
  auth: InMemoryAuth;
  upstream: WeChatMiniProgramAdapter;
}

function build(values: Record<string, string> = {}): Harness {
  const auth = createInMemoryAuth({ now: () => new Date('2026-10-17T00:00:00.000Z') });
  const config = makeConfig(values);

  const authService = new AuthService(
    { authenticateTicket: vi.fn() } as unknown as AuthPort,
    {
      bind: vi.fn(),
      listBindings: vi.fn().mockResolvedValue([]),
      acquireSession: vi.fn().mockResolvedValue(null),
      unbind: vi.fn(),
    } as unknown as CampusSessionPort,
    auth.users,
    auth.accounts,
    config,
    auth.sessions,
  );

  const upstream = new WeChatMiniProgramAdapter(config);
  const service = new WechatAuthService(upstream, auth.users, auth.accounts, authService);
  return { service, auth, upstream };
}

describe('微信小程序登录（第一级身份层）', () => {
  describe('首次登录即注册', () => {
    it('首次 openid 登录建号，返回 isNewUser 与兜底昵称', async () => {
      const { service, auth } = build();

      const result = await service.login({ code: 'dev:iphone-15' });

      expect(result.isNewUser).toBe(true);
      expect(result.simulated).toBe(true);
      expect(result.campusBound).toBe(false);
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.user.displayName).toMatch(/^微信用户/);
      expect(result.account).toEqual({
        hasPassword: false,
        email: null,
        wechatBound: true,
        hasOtherLoginMethod: false,
      });
      expect(auth.inspect().identities).toHaveLength(1);
      expect(auth.inspect().identities[0]?.provider).toBe(WECHAT_IDENTITY_PROVIDER);
    });

    it('同一 openid 再次登录是同一账号（老用户不重复建号）', async () => {
      const { service, auth } = build();

      const first = await service.login({ code: 'dev:iphone-15' });
      const second = await service.login({ code: 'dev:iphone-15' });

      expect(second.isNewUser).toBe(false);
      expect(second.user.id).toBe(first.user.id);
      expect(auth.inspect().users).toHaveLength(1);
    });

    it('不同 openid 是不同账号', async () => {
      const { service } = build();

      const a = await service.login({ code: 'dev:iphone-15' });
      const b = await service.login({ code: 'dev:pixel-9' });

      expect(a.user.id).not.toBe(b.user.id);
    });

    it('老用户登录不会把用户改过的昵称重置回微信名', async () => {
      const { service, auth } = build();

      const first = await service.login({ code: 'dev:iphone-15', displayName: '可达鸭本鸭' });
      expect(first.user.displayName).toBe('可达鸭本鸭');

      const second = await service.login({ code: 'dev:iphone-15' });
      expect(second.user.displayName).toBe('可达鸭本鸭');
      expect(auth.inspect().users[0]?.displayName).toBe('可达鸭本鸭');
    });
  });

  describe('昵称与头像', () => {
    it('昵称被规范化（去控制字符 + 按码点截断到 24）', async () => {
      const { service } = build();

      const result = await service.login({
        code: 'dev:iphone-15',
        displayName: `  鸭\u200b友${'长'.repeat(40)}  `,
      });

      const name = result.user.displayName;
      expect(name.startsWith('鸭友')).toBe(true);
      expect(name).not.toContain('\u200b');
      expect([...name].length).toBe(DISPLAY_NAME_MAX);
    });

    it('接受合法头像 data URL 并落库', async () => {
      const { service, auth } = build();
      const png = 'data:image/png;base64,iVBORw0KGgo=';

      const result = await service.login({ code: 'dev:iphone-15', avatarDataUrl: png });

      expect(result.user.avatarUrl).toBe(png);
      expect(auth.inspect().users[0]?.avatarUrl).toBe(png);
    });

    it('拒绝超大 / 非图片的头像', async () => {
      const { service } = build();
      const tooBig = `data:image/png;base64,${'A'.repeat(100_000)}`;

      await expect(service.login({ code: 'dev:iphone-15', avatarDataUrl: tooBig })).rejects.toThrow(
        ValidationError,
      );
      await expect(
        service.login({ code: 'dev:iphone-15', avatarDataUrl: 'data:text/plain;base64,QUJD' }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('开发模拟与生产边界', () => {
    it('未配置小程序密钥时，真实 code 无法登录（明确报错而不是静默建号）', async () => {
      const { service } = build();

      await expect(service.login({ code: '0a1b2c3d4e5f' })).rejects.toThrow(/微信登录未配置/);
    });

    it('生产环境拒绝 dev: 模拟凭证', async () => {
      const { service } = build({ NODE_ENV: 'production' });

      await expect(service.login({ code: 'dev:iphone-15' })).rejects.toThrow(UnauthenticatedError);
    });

    it('空 code 直接拒绝', async () => {
      const { service } = build();
      await expect(service.login({ code: '   ' })).rejects.toThrow(ValidationError);
    });

    it('配置了密钥时，客户端可先问 /config（不泄漏密钥）', () => {
      const unconfigured = build().upstream.describeUpstream();
      expect(unconfigured.configured).toBe(false);
      expect(unconfigured.appIdTail).toBeNull();

      const configured = build({
        WECHAT_MINIAPP_APPID: 'wx1234567890abcdef',
        WECHAT_MINIAPP_SECRET: 'top-secret',
      }).upstream.describeUpstream();
      expect(configured.configured).toBe(true);
      expect(configured.appIdTail).toBe('***cdef');
    });
  });

  describe('绑定与解绑', () => {
    it('未绑定时 status 报 bound=false', async () => {
      const { service, auth } = build();
      auth.seedUser({
        id: 'user-1',
        displayName: '邮箱同学',
        avatarUrl: null,
        department: null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      });
      await auth.accounts.createAccount({
        email: 'a@example.com',
        passwordHash: 'scrypt$1$1$1$salt$hash',
        displayName: '邮箱同学',
      });
      const user = auth.inspect().users.find((item) => item.displayName === '邮箱同学');
      const status = await service.status(user?.id ?? '');

      expect(status.bound).toBe(false);
      expect(status.canUnbind).toBe(false);
    });

    it('绑定后 status 报 bound=true 且可以解绑（还有邮箱密码）', async () => {
      const { service, auth } = build();
      await auth.accounts.createAccount({
        email: 'a@example.com',
        passwordHash: 'scrypt$1$1$1$salt$hash',
        displayName: '邮箱同学',
      });
      const userId = auth.inspect().users[0]?.id ?? '';

      const status = await service.bind(userId, 'dev:iphone-15');

      expect(status.bound).toBe(true);
      expect(status.canUnbind).toBe(true);
      expect(status.simulated).toBe(true);
    });

    it('微信已属于另一个账号时绑定返回 CONFLICT（不静默合并）', async () => {
      const { service, auth } = build();

      // 张三用微信注册
      const zhang = await service.login({ code: 'dev:zhang-phone' });
      // 李四有邮箱账号
      await auth.accounts.createAccount({
        email: 'li@example.com',
        passwordHash: 'scrypt$1$1$1$salt$hash',
        displayName: '李四',
      });
      const li = auth.inspect().users.find((item) => item.displayName === '李四');

      await expect(service.bind(li?.id ?? '', 'dev:zhang-phone')).rejects.toThrow(ConflictError);
      // 张三的账号没有被换人
      expect(auth.inspect().users.find((item) => item.id === zhang.user.id)?.displayName).toMatch(
        /^微信用户/,
      );
    });

    it('只有微信一种登录方式时不允许解绑（否则用户被锁在门外）', async () => {
      const { service } = build();
      const wechat = await service.login({ code: 'dev:iphone-15' });

      await expect(service.unbind(wechat.user.id)).rejects.toThrow(ForbiddenError);
    });

    it('未绑定微信时解绑返回 NOT_FOUND', async () => {
      const { service, auth } = build();
      await auth.accounts.createAccount({
        email: 'a@example.com',
        passwordHash: 'scrypt$1$1$1$salt$hash',
        displayName: '邮箱同学',
      });
      const userId = auth.inspect().users[0]?.id ?? '';

      await expect(service.unbind(userId)).rejects.toThrow(NotFoundError);
    });

    it('绑定邮箱密码之后即可解绑微信', async () => {
      const { service, auth } = build();
      const wechat = await service.login({ code: 'dev:iphone-15' });

      // 补一套邮箱密码（等价于 POST /auth/account/bind-email）
      await auth.accounts.attachCredential({
        userId: wechat.user.id,
        email: 'duck@example.com',
        passwordHash: 'scrypt$1$1$1$salt$hash',
      });

      const status = await service.unbind(wechat.user.id);
      expect(status.bound).toBe(false);
      expect(auth.inspect().identities).toHaveLength(0);
    });
  });

  it('登录响应里没有 campus session 类字段（契约 §5）', async () => {
    const { service } = build();

    const result = await service.login({ code: 'dev:iphone-15' });
    const keys = collectKeys(result);

    expect(keys.filter((key) => /(cookie|session|tgc)/i.test(key))).toEqual([]);
  });
});

function collectKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, acc);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      acc.push(key);
      collectKeys(nested, acc);
    }
  }
  return acc;
}
