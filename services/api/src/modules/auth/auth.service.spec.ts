import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { verifyJwt } from '../../common/auth/jwt';
import { CampusBindingRequiredError, InternalError } from '../../common/errors/app-error';
import {
  assertIdentityOnly,
  type AuthPort,
  type CampusBindingRecord,
  type CampusIdentity,
  type CampusSessionPort,
  type UserRecord,
  type UserRepository,
} from './domain/auth.domain';
import { createInMemoryAuth } from './testing/in-memory-auth';

/**
 * 契约 §5「两级身份模型」的回归测试。
 *
 * 要证明的核心命题：
 *   第一级 `AuthPort` **只**回答"你是谁"，任何校园系统 session/cookie/tgc
 *   都不允许从它流到 API 响应里；第二级能力必须另走 `CampusSessionPort`。
 */

const SECRET = 'test-secret-please-change-me-32-chars';

const USER: UserRecord = {
  id: 'user-1',
  displayName: '同学0001',
  avatarUrl: null,
  department: '信息学院',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
};

const IDENTITY: CampusIdentity = {
  provider: 'SHTU_CAS',
  externalId: '20260001',
  email: '20260001@shanghaitech.edu.cn',
  realName: '同学0001',
  department: '信息学院',
};

function makeConfig(): ConfigService {
  const values: Record<string, string> = {
    JWT_SECRET: SECRET,
    JWT_ACCESS_TTL: '900',
    JWT_REFRESH_TTL: '2592000',
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function makeUsers(): UserRepository {
  return {
    upsertFromIdentity: vi.fn().mockResolvedValue(USER),
    findById: vi.fn().mockResolvedValue(USER),
    findIdentity: vi.fn().mockResolvedValue(null),
    linkIdentity: vi.fn(),
    unlinkIdentity: vi.fn().mockResolvedValue(0),
    listIdentities: vi.fn().mockResolvedValue([]),
    updateProfile: vi.fn().mockResolvedValue(USER),
  } as unknown as UserRepository;
}

function makeBindings(): CampusBindingRecord[] {
  return [
    {
      id: 'bind-1',
      platform: 'CARD',
      status: 'active',
      scopes: ['balance:read'],
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      lastUsedAt: null,
    },
  ];
}

function makeCampusSession(options: {
  bindings?: CampusBindingRecord[];
  session?: { platform: 'CARD'; sessionRef: string; expiresAt: Date } | null;
} = {}): CampusSessionPort {
  const bindings = options.bindings ?? [];
  const session = options.session ?? null;
  return {
    bind: vi.fn(),
    listBindings: vi.fn().mockResolvedValue(bindings),
    acquireSession: vi.fn().mockResolvedValue(session),
    unbind: vi.fn(),
  } as unknown as CampusSessionPort;
}

function build(authPort: AuthPort, campusSession = makeCampusSession()) {
  const users = makeUsers();
  const sessions = createInMemoryAuth({ now: () => new Date('2026-10-17T00:00:00.000Z') });
  const service = new AuthService(
    authPort,
    campusSession,
    users,
    sessions.accounts,
    makeConfig(),
    sessions.sessions,
  );
  return { service, users, campusSession, sessions };
}

/** 递归收集对象里的所有 key（用于检查是否泄漏 session 类字段） */
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

describe('契约 §5 · 两级身份模型解耦', () => {
  describe('assertIdentityOnly（运行时护栏）', () => {
    it('合法身份通过', () => {
      expect(assertIdentityOnly(IDENTITY)).toBe(IDENTITY);
    });

    it.each(['sessionCookie', 'tgc', 'casTicket', 'egateSession', 'password', 'credentialRef'])(
      '身份里出现 %s 时立刻抛错（把文档约定变成可执行断言）',
      (leakedKey) => {
        const dirty = { ...IDENTITY, [leakedKey]: 'leaked-value' } as CampusIdentity;
        expect(() => assertIdentityOnly(dirty)).toThrow(InternalError);
        expect(() => assertIdentityOnly(dirty)).toThrow(/契约 §5/);
      },
    );
  });

  describe('login（第一级）', () => {
    it('返回值不含任何校园 session 字段（结构上不给凭据留位置）', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort);

      const result = await service.login('mock-20260001');

      // 形状被显式锁住：新增字段必须在这里"过一遍"，
      // 免得哪天有人顺手把 session/cookie 塞进登录响应。
      expect(Object.keys(result).sort()).toEqual([
        'accessToken',
        'account',
        'campusBound',
        'expiresAt',
        'expiresIn',
        'refreshToken',
        'user',
      ]);
    });

    it('响应里不含任何 cookie/session/tgc 字段（自有 JWT 除外）', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort);

      const result = await service.login('mock-20260001');

      const leaked = collectKeys(result)
        // accessToken / refreshToken 是 KedaYa **自有**令牌，不属于校园 session
        .filter((key) => key !== 'accessToken' && key !== 'refreshToken')
        .filter((key) => /(cookie|session|tgc)/i.test(key));

      expect(leaked).toEqual([]);
    });

    it('campusBound 恒为 false —— 登录 ≠ 已绑定（契约 §5 硬规则 3）', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort);

      expect((await service.login('ticket')).campusBound).toBe(false);
    });

    it('上游 AuthPort 泄漏 session 时，登录直接失败而不是把凭据发给客户端', async () => {
      const authPort: AuthPort = {
        authenticateTicket: vi
          .fn()
          .mockResolvedValue({ ...IDENTITY, sessionCookie: 'EGATE=abc' } as CampusIdentity),
      };
      const { service } = build(authPort);

      await expect(service.login('ticket')).rejects.toThrow(/契约 §5/);
    });

    it('签发的 JWT 只承载身份字段，不承载校园 session', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort);

      const { accessToken } = await service.login('ticket');
      const payload = verifyJwt(accessToken, SECRET);

      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub', 'typ']);
      expect(payload.sub).toBe(USER.id);
    });
  });

  describe('me / 第二级能力', () => {
    it('未绑定时 campusBound=false，但**身份依然有效**（已登录但未绑定是合法状态）', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort, makeCampusSession({ bindings: [] }));

      const me = await service.me(USER.id);

      expect(me.user.id).toBe(USER.id);
      expect(me.campusBindings).toEqual([]);
      expect(me.campusBound).toBe(false);
    });

    it('已绑定时绑定信息作为**独立字段**返回，与身份分离', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort, makeCampusSession({ bindings: makeBindings() }));

      const me = await service.me(USER.id);

      expect(me.campusBound).toBe(true);
      expect(me.campusBindings).toHaveLength(1);
      // 身份对象本身不含绑定信息
      expect(collectKeys(me.user)).not.toContain('campusBindings');
      // 绑定视图不含密文/指纹
      expect(collectKeys(me.campusBindings)).not.toContain('encryptedSession');
      expect(collectKeys(me.campusBindings)).not.toContain('sessionFingerprint');
    });

    it('campusCapability 只回布尔值，绝不回 session 本体', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(
        authPort,
        makeCampusSession({
          session: { platform: 'CARD', sessionRef: 'SECRET-SESSION', expiresAt: new Date() },
        }),
      );

      const capability = await service.campusCapability(USER.id, 'CARD');

      expect(capability).toEqual({ available: true });
      expect(JSON.stringify(capability)).not.toContain('SECRET-SESSION');
    });

    it('未绑定时要求第二级能力 → CAMPUS_BINDING_REQUIRED', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort, makeCampusSession({ session: null }));

      await expect(service.requireCampusSession(USER.id, 'CARD')).rejects.toThrow(
        CampusBindingRequiredError,
      );
      await expect(service.requireCampusSession(USER.id, 'CARD')).rejects.toMatchObject({
        code: 'CAMPUS_BINDING_REQUIRED',
      });
    });
  });

  describe('令牌会话（轮换 / 撤销）', () => {
    it('login 会把 refresh token 的指纹写进会话表，而不是明文', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service, sessions } = build(authPort);

      const result = await service.login('ticket');
      const stored = sessions.inspect().sessions;

      expect(stored).toHaveLength(1);
      expect(JSON.stringify(stored)).not.toContain(result.refreshToken);
    });

    it('refresh 会轮换 refreshToken：旧的那一支立即失效', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort);

      const login = await service.login('ticket');
      const refreshed = await service.refresh(login.refreshToken);

      expect(refreshed.refreshToken).not.toBe(login.refreshToken);
      expect(refreshed.expiresIn).toBeGreaterThan(0);
      expect(new Date(refreshed.expiresAt).getTime()).toBeGreaterThan(Date.now());

      await expect(service.refresh(login.refreshToken)).rejects.toThrow(/登录状态已失效/);
    });

    it('被撤销过的令牌再次使用 → 全部会话下线（按令牌泄漏处理）', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service, sessions } = build(authPort);

      const login = await service.login('ticket');
      await service.refresh(login.refreshToken);

      // 用已轮换掉的旧令牌重放
      await expect(service.refresh(login.refreshToken)).rejects.toThrow();

      expect(sessions.inspect().sessions.every((s) => s.revokedAt !== null)).toBe(true);
    });

    it('伪造的 refreshToken（签名不对）→ UNAUTHENTICATED', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort);

      await expect(service.refresh('a.b.c')).rejects.toThrow(/签名校验失败|格式不正确/);
    });

    it('access token 不能当 refreshToken 用', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort);

      const login = await service.login('ticket');
      await expect(service.refresh(login.accessToken)).rejects.toThrow(/请使用 refreshToken/);
    });

    it('logout 撤销指定会话；不带 token 时撤销该用户全部会话', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort);

      const first = await service.login('ticket');
      const second = await service.login('ticket');

      expect(await service.logout(USER.id, first.refreshToken)).toEqual({ revoked: 1 });
      expect(await service.logout(USER.id)).toEqual({ revoked: 1 });

      await expect(service.refresh(second.refreshToken)).rejects.toThrow(/登录状态已失效/);
    });

    it('revokeAllSessions 用于改密后强制下线', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort);

      await service.login('ticket');
      await service.login('ticket');

      expect(await service.revokeAllSessions(USER.id)).toBe(2);
    });
  });
});
