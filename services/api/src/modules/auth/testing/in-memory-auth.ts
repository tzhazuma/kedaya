import { randomUUID } from 'node:crypto';
import type { IdentityRecord, UserRecord, UserRepository } from '../domain/auth.domain';
import type {
  AttachCredentialInput,
  CreateLocalAccountInput,
  CreateRefreshSessionInput,
  CreateVerificationCodeInput,
  LocalAccountRecord,
  LocalAccountRepository,
  RefreshSessionRecord,
  RefreshSessionRepository,
  VerificationCodeRecord,
  VerificationCodeRepository,
} from '../domain/local-account.domain';

/**
 * 认证模块的**内存实现**（测试用，不参与构建 —— 见 tsconfig.build 的
 * `src/**\/testing/**` 排除规则）。
 *
 * 为什么不用 mock 库：认证逻辑的正确性依赖"状态被真的改了"
 * （尝试次数递增、验证码被消费、令牌被撤销），用 spy 打桩会把这些行为断言掉。
 * 这里用一个够用的内存存储，让测试验证的是**行为**而不是调用次数。
 */
export interface InMemoryAuthOptions {
  now?: () => Date;
}

export interface InMemoryAuth {
  accounts: LocalAccountRepository;
  codes: VerificationCodeRepository;
  sessions: RefreshSessionRepository;
  users: UserRepository;
  /** 测试断言用：当前内存里的全部数据（只读快照） */
  inspect(): {
    accounts: LocalAccountRecord[];
    codes: VerificationCodeRecord[];
    sessions: RefreshSessionRecord[];
    users: UserRecord[];
    identities: (IdentityRecord & { userId: string })[];
  };
  /** 预置一个用户（用于「已登录用户改密码」这类用例） */
  seedUser(record: UserRecord): void;
  /** 预置一条身份映射（微信 / CAS 登录的既有账号） */
  seedIdentity(
    userId: string,
    provider: IdentityRecord['provider'],
    externalId: string,
  ): IdentityRecord & { userId: string };
}

export function createInMemoryAuth(options: InMemoryAuthOptions = {}): InMemoryAuth {
  const now = options.now ?? (() => new Date());

  const accounts: LocalAccountRecord[] = [];
  const codes: VerificationCodeRecord[] = [];
  const sessions: RefreshSessionRecord[] = [];
  const users: UserRecord[] = [];
  /** 第一级身份映射（CAS / 微信）—— 与真实库的 AuthIdentity 对应 */
  const identities: (IdentityRecord & { userId: string })[] = [];
  /** refresh session id → tokenHash（真实实现里是唯一索引，这里显式映射） */
  const sessionHashes = new Map<string, string>();

  const accountRepo: LocalAccountRepository = {
    async findByEmail(email) {
      return accounts.find((item) => item.email === email) ?? null;
    },
    async findByUserId(userId) {
      return accounts.find((item) => item.userId === userId) ?? null;
    },
    async createAccount(input: CreateLocalAccountInput) {
      const userId = randomUUID();
      users.push({
        id: userId,
        displayName: input.displayName,
        avatarUrl: null,
        department: null,
        createdAt: now(),
      });
      const record: LocalAccountRecord = {
        id: randomUUID(),
        userId,
        email: input.email,
        passwordHash: input.passwordHash,
        status: 'active',
        failedAttempts: 0,
        lockedUntil: null,
        passwordChangedAt: now(),
        lastLoginAt: null,
      };
      accounts.push(record);
      return { ...record };
    },
    async attachCredential(input: AttachCredentialInput) {
      const existing = accounts.find((item) => item.userId === input.userId);
      if (existing) throw new Error('该账号已设置邮箱密码');
      const record: LocalAccountRecord = {
        id: randomUUID(),
        userId: input.userId,
        email: input.email,
        passwordHash: input.passwordHash,
        status: 'active',
        failedAttempts: 0,
        lockedUntil: null,
        passwordChangedAt: now(),
        lastLoginAt: null,
      };
      accounts.push(record);
      return { ...record };
    },
    async updatePassword(accountId, passwordHash) {
      const found = accounts.find((item) => item.id === accountId);
      if (!found) throw new Error(`account not found: ${accountId}`);
      found.passwordHash = passwordHash;
      found.passwordChangedAt = now();
      found.failedAttempts = 0;
      found.lockedUntil = null;
      found.status = 'active';
    },
    async recordFailedAttempt(accountId, failedAttempts, lockedUntil) {
      const found = accounts.find((item) => item.id === accountId);
      if (!found) throw new Error(`account not found: ${accountId}`);
      found.failedAttempts = failedAttempts;
      found.lockedUntil = lockedUntil;
      found.status = lockedUntil ? 'locked' : 'active';
    },
    async markLogin(accountId, at) {
      const found = accounts.find((item) => item.id === accountId);
      if (!found) throw new Error(`account not found: ${accountId}`);
      found.lastLoginAt = at;
      found.failedAttempts = 0;
      found.lockedUntil = null;
      found.status = 'active';
    },
  };

  const codeRepo: VerificationCodeRepository = {
    async findLatestActive(target, purpose) {
      const matching = codes
        .filter((item) => item.target === target && item.purpose === purpose && item.consumedAt === null)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return matching[0] ?? null;
    },
    async countSince(target, purpose, since) {
      return codes.filter(
        (item) =>
          item.target === target && item.purpose === purpose && item.createdAt.getTime() >= since.getTime(),
      ).length;
    },
    async create(input: CreateVerificationCodeInput) {
      const record: VerificationCodeRecord = {
        id: randomUUID(),
        target: input.target,
        purpose: input.purpose,
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        consumedAt: null,
        attempts: 0,
        createdAt: now(),
      };
      codes.push(record);
      return { ...record };
    },
    async incrementAttempts(id) {
      const found = codes.find((item) => item.id === id);
      if (found) found.attempts += 1;
    },
    async consume(id, at) {
      const found = codes.find((item) => item.id === id);
      if (found) found.consumedAt = at;
    },
    async consumeAll(target, purpose, at) {
      for (const item of codes) {
        if (item.target === target && item.purpose === purpose && item.consumedAt === null) {
          item.consumedAt = at;
        }
      }
    },
  };

  const sessionRepo: RefreshSessionRepository = {
    async create(input: CreateRefreshSessionInput) {
      const id = randomUUID();
      sessionHashes.set(id, input.tokenHash);
      sessions.push({
        id,
        userId: input.userId,
        expiresAt: input.expiresAt,
        revokedAt: null,
      });
    },
    async findByHash(tokenHash) {
      const found = [...sessionHashes.entries()].find(([, hash]) => hash === tokenHash);
      if (!found) return null;
      const record = sessions.find((item) => item.id === found[0]);
      return record ? { ...record } : null;
    },
    async revoke(id) {
      const found = sessions.find((item) => item.id === id);
      if (found) found.revokedAt = now();
    },
    async revokeAllForUser(userId) {
      let count = 0;
      for (const item of sessions) {
        if (item.userId === userId && item.revokedAt === null) {
          item.revokedAt = now();
          count += 1;
        }
      }
      return count;
    },
  };

  const userRepo: UserRepository = {
    async upsertFromIdentity(identity) {
      // CAS / 微信登录：同一 (provider, externalId) 复用同一账号
      const foundIdentity = identities.find(
        (item) => item.provider === identity.provider && item.externalId === identity.externalId,
      );
      if (foundIdentity) {
        foundIdentity.lastLoginAt = now();
        const existing = users.find((item) => item.id === foundIdentity.userId);
        if (!existing) throw new Error('identity without user');
        if (identity.realName !== undefined) existing.displayName = identity.realName;
        return { ...existing };
      }

      const user: UserRecord = {
        id: randomUUID(),
        displayName: identity.realName ?? `同学${identity.externalId.slice(-4)}`,
        avatarUrl: null,
        department: identity.department ?? null,
        createdAt: now(),
      };
      users.push(user);
      identities.push({
        userId: user.id,
        provider: identity.provider,
        externalId: identity.externalId,
        lastLoginAt: now(),
        createdAt: now(),
      });
      return { ...user };
    },
    async findById(id) {
      const found = users.find((item) => item.id === id);
      return found ? { ...found } : null;
    },
    async findIdentity(provider, externalId) {
      const found = identities.find(
        (item) => item.provider === provider && item.externalId === externalId,
      );
      return found ? { userId: found.userId, identity: { ...found } } : null;
    },
    async linkIdentity(userId, identity) {
      const existing = identities.find(
        (item) => item.provider === identity.provider && item.externalId === identity.externalId,
      );
      if (existing) {
        if (existing.userId === userId) return { ...existing };
        throw new Error('identity already linked to another user');
      }
      const record = {
        userId,
        provider: identity.provider,
        externalId: identity.externalId,
        lastLoginAt: now(),
        createdAt: now(),
      };
      identities.push(record);
      return { ...record };
    },
    async unlinkIdentity(userId, provider) {
      let removed = 0;
      for (let i = identities.length - 1; i >= 0; i -= 1) {
        const item = identities[i];
        if (item && item.userId === userId && item.provider === provider) {
          identities.splice(i, 1);
          removed += 1;
        }
      }
      return removed;
    },
    async listIdentities(userId) {
      return identities.filter((item) => item.userId === userId).map((item) => ({ ...item }));
    },
    async updateProfile(userId, patch) {
      const found = users.find((item) => item.id === userId);
      if (!found) throw new Error(`user not found: ${userId}`);
      if (patch.displayName !== undefined) found.displayName = patch.displayName;
      if (patch.avatarUrl !== undefined) found.avatarUrl = patch.avatarUrl;
      if (patch.department !== undefined) found.department = patch.department;
      return { ...found };
    },
  };

  return {
    accounts: accountRepo,
    codes: codeRepo,
    sessions: sessionRepo,
    users: userRepo,
    inspect: () => ({
      accounts: accounts.map((item) => ({ ...item })),
      codes: codes.map((item) => ({ ...item })),
      sessions: sessions.map((item) => ({ ...item })),
      users: users.map((item) => ({ ...item })),
      identities: identities.map((item) => ({ ...item })),
    }),
    seedUser(record) {
      users.push(record);
    },
    seedIdentity(userId, provider, externalId) {
      const record = {
        userId,
        provider,
        externalId,
        lastLoginAt: null,
        createdAt: now(),
      };
      identities.push(record);
      return { ...record };
    },
  };
}
