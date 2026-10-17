import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { verifyJwt } from '../../common/auth/jwt';
import { InternalError } from '../../common/errors/app-error';
import {
  IDENTITY_SESSION_FORBIDDEN_KEYS,
  assertIdentityOnly,
  assertIdentitySessionHasNoCredentialKeys,
  toIdentitySession,
  type AuthPort,
  type CampusIdentity,
  type KedaYaIdentitySession,
  type UserRecord,
  type UserRepository,
} from './domain/auth.domain';
import type { CampusBindingSummary, CampusSessionPort } from '../techpie/domain/ports/campus-session.port';

/**
 * 契约 §5「两级身份模型」的回归测试。
 *
 * 要证明的核心命题：
 *   第一级 `AuthPort` **只**回答"你是谁"，任何校园系统 session/cookie/tgc
 *   都不允许从它流到 API 响应里；第二级能力必须另走 `CampusSessionPort`。
 *
 * ⚠️ 2026-10-17 起，第二级端口与实现都搬到了 `modules/techpie/`（不变式 I2）。
 * 本文件因此从 techpie 的 domain 里 import 端口类型 —— 而
 * `modules/auth/data/**` 里**没有任何**这样的 import（由 `test/techpie-arch.spec.ts` 扫描）。
 */

const SECRET = 'test-secret-please-change-me-32-chars';

const USER: UserRecord = {
  id: 'user-1',
  displayName: '同学0001',
  avatarUrl: null,
  department: '信息学院',
  studentId: '20260001',
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
  } as unknown as UserRepository;
}

function makeBindings(): CampusBindingSummary[] {
  return [
    {
      id: 'bind-1',
      platform: 'ecard',
      status: 'LINKED',
      externalUserId: 'openid-abc',
      expiresAt: '2026-12-01T00:00:00.000Z',
      lastSyncAt: null,
      phase: 'phase0',
    },
  ];
}

function makeCampusSession(options: { bindings?: CampusBindingSummary[] } = {}): CampusSessionPort {
  const bindings = options.bindings ?? [];
  return {
    bind: vi.fn(),
    listBindings: vi.fn().mockResolvedValue(bindings),
    getBinding: vi
      .fn()
      .mockImplementation(async (_userId: string, platform: string) =>
        bindings.find((binding) => binding.platform === platform) ?? null,
      ),
    unbind: vi.fn(),
    renew: vi.fn(),
    cookieHeaderFor: vi.fn(),
  } as unknown as CampusSessionPort;
}

function build(authPort: AuthPort, campusSession = makeCampusSession()) {
  const users = makeUsers();
  const service = new AuthService(authPort, campusSession, users, makeConfig());
  return { service, users, campusSession };
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

  /* ================================================================ *
   * 契约 §11.4 I1：身份会话的序列化不含 8 个禁用键
   * ================================================================ */

  describe('契约 §11.4 I1 · KedaYaIdentitySession', () => {
    it('投影恰好是 4 个字段，一个都不多', () => {
      const session = toIdentitySession(USER);
      expect(Object.keys(session).sort()).toEqual(['department', 'name', 'studentId', 'userId']);
    });

    it('8 个禁用键名一个都不出现（类型上就没有，运行时再断言一次）', () => {
      const session = toIdentitySession(USER);
      const keys = Object.keys(session).map((key) => key.toLowerCase());
      for (const forbidden of IDENTITY_SESSION_FORBIDDEN_KEYS) {
        expect(keys).not.toContain(forbidden.toLowerCase());
      }
    });

    it('JSON.stringify 的结果里扫不到任何禁用键名或凭证形态', () => {
      const serialized = JSON.stringify(toIdentitySession(USER));
      expect(serialized).not.toMatch(/castgc|tgc|sessionToken|cookie|ticket|tenant/i);
      expect(serialized).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/); // 没有长 base64 串
    });

    it('运行时断言会拦下被污染的会话（含嵌套结构）', () => {
      expect(() => assertIdentitySessionHasNoCredentialKeys({ userId: 'u', sessionToken: 'x' })).toThrow(
        InternalError,
      );
      expect(() =>
        assertIdentitySessionHasNoCredentialKeys({ userId: 'u', nested: { castgc: 'x' } }),
      ).toThrow(InternalError);
      // 大小写 / 分隔符都不放过
      expect(() => assertIdentitySessionHasNoCredentialKeys({ 'SESSION-TOKEN': 'x' })).toThrow(InternalError);
      expect(() => assertIdentitySessionHasNoCredentialKeys({ user_id: 'u', name: 'n' })).not.toThrow();
    });

    it('`GET /auth/session` 走的是同一个投影（service.session）', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort);

      const session: KedaYaIdentitySession = await service.session(USER.id);

      expect(session).toEqual({
        userId: USER.id,
        studentId: '20260001',
        name: '同学0001',
        department: '信息学院',
      });
    });

    it('I5：session() 不碰任何上游端口（纯本地读取）', async () => {
      const authenticateTicket = vi.fn().mockResolvedValue(IDENTITY);
      const authPort: AuthPort = { authenticateTicket };
      const campusSession = makeCampusSession();
      const { service } = build(authPort, campusSession);

      await service.session(USER.id);

      expect(authenticateTicket).not.toHaveBeenCalled();
      expect(campusSession.listBindings).not.toHaveBeenCalled();
      expect(campusSession.getBinding).not.toHaveBeenCalled();
    });
  });

  describe('login（第一级）', () => {
    it('返回值恰好是 5 个字段，结构上不给校园 session 留位置', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort);

      const result = await service.login('mock-20260001');

      expect(Object.keys(result).sort()).toEqual([
        'accessToken',
        'campusBound',
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
      // 绑定摘要不含密文/指纹/会话
      expect(collectKeys(me.campusBindings)).not.toContain('encryptedSession');
      expect(collectKeys(me.campusBindings)).not.toContain('sessionFingerprint');
      expect(collectKeys(me.campusBindings)).not.toContain('sessionCipher');
    });

    it('campusCapability 只回布尔值，绝不回 session 本体', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort, makeCampusSession({ bindings: makeBindings() }));

      const capability = await service.campusCapability(USER.id, 'ecard');

      expect(capability).toEqual({ available: true });
    });

    it('未绑定时 campusCapability 回 false（**不是**抛错 —— 这是引导态，不是错误态）', async () => {
      const authPort: AuthPort = { authenticateTicket: vi.fn().mockResolvedValue(IDENTITY) };
      const { service } = build(authPort, makeCampusSession({ bindings: [] }));

      expect(await service.campusCapability(USER.id, 'cpdaily')).toEqual({ available: false });
    });
  });
});
