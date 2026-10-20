import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import {
  ConflictError,
  InternalError,
  UnauthenticatedError,
  ValidationError,
} from '../../../common/errors/app-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { AccountDeletionPrismaRepository } from '../data/account-deletion.prisma-repository';
import { UserPrismaRepository } from '../data/user.prisma-repository';
import type { AccountDeletionRepository } from '../domain/account-deletion.domain';
import type { AuthPort, CampusSessionPort } from '../domain/auth.domain';
import type {
  LocalAccountRecord,
  LocalAccountRepository,
  RefreshSessionRepository,
} from '../domain/local-account.domain';
import { hashPassword } from '../domain/password';
import { AccountDeletionService } from './account-deletion.service';
import type { LocalAuthService } from '../local-auth.service';

/**
 * 账号注销。
 *
 * 分两层：
 *   1. **服务层**（mock 仓储）：防误触、防账号枚举、已注销 409 —— 这些判定
 *      不能只靠前端，错一次就是隐私事故；
 *   2. **真实仓储 + 内存 Prisma**：事务真的回滚了吗？并发真的只有一个赢家吗？
 *      注销后旧 token 真的进不来了吗？这三件事用 mock 证明不了。
 *
 * 第 2 层刻意不依赖 PostgreSQL：本机没有数据库，而"事务回滚""并发抢锁"的行为
 * 由交互式事务语义决定，用内存实现可以精确注入"第 N 步 delete 失败"，
 * 比真库更容易构造因果判据（真库版本见 `local-auth.integration.spec.ts` 的做法）。
 *
 * ⚠️ `hashPassword` 内部会 `assertPasswordStrength`（必须同时含字母与数字），
 * 测试密码常量也必须满足，否则整个文件在准备阶段就抛错。
 */
const PASSWORD = 'CorrectHorse2026';
const HASHED = hashPassword(PASSWORD);

/* ================================================================== *
 * 1. 服务层：判定顺序与错误语义
 * ================================================================== */

function makeRepo(outcome: 'ok' | 'already' = 'ok'): AccountDeletionRepository & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async isDeleted() {
      // 默认「没注销过」。要测"已注销"的用例传 outcome='already'。
      return outcome === 'already';
    },
    async deleteAccount(userId: string) {
      calls.push(userId);
      return outcome === 'ok'
        ? { deletedAt: '2026-10-20T00:00:00.000Z' }
        : ('already-deleted' as const);
    },
  };
}

/**
 * `LocalAuthService` 的替身：只实现注销用到的 `verifyDeletionCode`。
 * `acceptCode` 用于让某条用例决定"这个码对不对"。
 */
function makeLocalAuth(acceptCode = '123456') {
  const calls: { email: string; code: string }[] = [];
  return {
    calls,
    async verifyDeletionCode(email: string, code: string) {
      calls.push({ email, code });
      if (code !== acceptCode) throw new Error('验证码不正确');
    },
  } as unknown as LocalAuthService & { calls: { email: string; code: string }[] };
}

function makeAccounts(found = true): LocalAccountRepository {
  return {
    async findByUserId() {
      return found
        ? ({
            userId: 'u1',
            email: 'a@b.c',
            passwordHash: HASHED,
            status: 'active',
          } as never)
        : null;
    },
    async findByEmail() {
      return null;
    },
    async create() {
      throw new Error('not used');
    },
    async attachCredential() {
      throw new Error('not used');
    },
  } as unknown as LocalAccountRepository;
}

describe('AccountDeletionService', () => {
  it('⚠️ confirm 不是 DELETE → 400，且**不碰仓储**', async () => {
    const repo = makeRepo();
    const service = new AccountDeletionService(repo, makeAccounts(), makeLocalAuth());

    const error = await service
      .deleteAccount('u1', { password: PASSWORD, confirm: 'delete' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).status).toBe(400);
    // 文案要告诉用户这是防误触，而不是"参数错误"
    expect((error as Error).message).toContain('DELETE');
    // 关键断言：防误触必须发生在**任何写操作之前**
    expect(repo.calls).toEqual([]);
  });

  it('confirm 完全缺失也拒绝', async () => {
    const repo = makeRepo();
    const service = new AccountDeletionService(repo, makeAccounts(), makeLocalAuth());
    await expect(
      service.deleteAccount('u1', { password: PASSWORD, confirm: '' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.calls).toEqual([]);
  });

  it('密码错 → 401，且不碰仓储', async () => {
    const repo = makeRepo();
    const service = new AccountDeletionService(repo, makeAccounts(), makeLocalAuth());

    const error = await service
      .deleteAccount('u1', { password: 'wrong', confirm: 'DELETE' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((error as UnauthenticatedError).status).toBe(401);
    expect(repo.calls).toEqual([]);
  });

  it('⚠️ 账号不存在与密码错是**同一类错误**（防账号枚举）', async () => {
    const repo = makeRepo();
    const noAccount = new AccountDeletionService(repo, makeAccounts(false), makeLocalAuth());
    const wrongPassword = new AccountDeletionService(repo, makeAccounts(true), makeLocalAuth());

    const e1 = await noAccount
      .deleteAccount('u1', { password: PASSWORD, confirm: 'DELETE' })
      .catch((e: unknown) => e);
    const e2 = await wrongPassword
      .deleteAccount('u1', { password: 'wrong', confirm: 'DELETE' })
      .catch((e: unknown) => e);

    expect(e1).toBeInstanceOf(UnauthenticatedError);
    expect(e2).toBeInstanceOf(UnauthenticatedError);
    // 文案必须一致 —— 否则从错误信息就能区分"这个账号存不存在"
    expect((e1 as Error).message).toBe((e2 as Error).message);
  });

  it('已注销过 → 409，且**先于密码校验**（凭据已被删除也要回 409 而不是 401）', async () => {
    const repo = makeRepo('already');
    // 已注销账号的凭据行已经没了 → accounts 返回 null；若顺序写反会得到 401
    const service = new AccountDeletionService(repo, makeAccounts(false), makeLocalAuth());

    const error = await service
      .deleteAccount('u1', { password: PASSWORD, confirm: 'DELETE' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).status).toBe(409);
    expect((error as Error).message).toBe('该账号已注销');
    expect(repo.calls).toEqual([]);
  });

  it('正常注销 → 返回 deletedAt', async () => {
    const repo = makeRepo();
    const service = new AccountDeletionService(repo, makeAccounts(), makeLocalAuth());
    const result = await service.deleteAccount('u1', { password: PASSWORD, confirm: 'DELETE' });
    expect(result.deletedAt).toBe('2026-10-20T00:00:00.000Z');
    expect(repo.calls).toEqual(['u1']);
  });
});

/* ================================================================== *
 * 2. 真实仓储 + 内存 Prisma：事务、并发、旧 token
 * ================================================================== */

type Row = Record<string, any>;

const TABLE_NAMES = [
  'user',
  'userCredential',
  'authIdentity',
  'refreshSession',
  'campusBinding',
  'campusSession',
  'techpieLink',
  'consent',
  'profileSetting',
  'mailAccount',
  'mailEvent',
  'aiPortraitProfile',
  'wellbeingAppointment',
  'auditLog',
  'forumPost',
] as const;

type TableName = (typeof TABLE_NAMES)[number];

/** 注销时必须清空的表（与实现一一对应；改实现不改这里测试会红） */
const DELETED_TABLES: readonly TableName[] = [
  'refreshSession',
  'userCredential',
  'authIdentity',
  'campusBinding',
  'campusSession',
  'techpieLink',
  'consent',
  'profileSetting',
  'mailAccount',
  'mailEvent',
  'aiPortraitProfile',
  'wellbeingAppointment',
];

interface FakeTable {
  rows: Row[];
  findUnique(args?: { where?: Row; select?: Row }): Promise<Row | null>;
  findFirst(args?: { where?: Row; select?: Row }): Promise<Row | null>;
  updateMany(args: { where?: Row; data: Row }): Promise<{ count: number }>;
  deleteMany(args?: { where?: Row }): Promise<{ count: number }>;
  create(args: { data: Row }): Promise<Row>;
}

type FakePrisma = Record<TableName, FakeTable> & {
  $transaction<T>(callback: (tx: FakePrisma) => Promise<T>): Promise<T>;
  $failOn(failure: { table: TableName; operation: 'create' | 'updateMany' | 'deleteMany' }): void;
};

function matchesWhere(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === null) return row[key] === null || row[key] === undefined;
    return row[key] === expected;
  });
}

function project(row: Row | undefined, select?: Row): Row | null {
  if (row === undefined) return null;
  if (select === undefined) return { ...row };
  const out: Row = {};
  for (const key of Object.keys(select)) out[key] = row[key];
  return out;
}

/**
 * 内存版 Prisma（只覆盖注销用到的子集）。
 *
 * 事务语义刻意做成：**串行执行 + 失败整体还原**。
 * 真库靠行锁让第二个 `updateMany` 等到第一个提交后 count=0；这里用队列复现
 * 同一个可观察结果（同一时刻只有一个事务在跑）。
 */
function createFakePrisma(seed: Partial<Record<TableName, Row[]>> = {}): FakePrisma {
  const holders = {} as Record<TableName, { rows: Row[] }>;
  for (const name of TABLE_NAMES) holders[name] = { rows: seed[name] ?? [] };

  let failure: { table: TableName; operation: string } | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function guard(name: TableName, operation: string): void {
    if (failure?.table === name && failure.operation === operation) {
      throw new Error(`模拟数据库失败：${name}.${operation}（外键约束）`);
    }
  }

  function makeTable(name: TableName): FakeTable {
    return {
      get rows() {
        return holders[name].rows;
      },
      async findUnique(args = {}) {
        return project(holders[name].rows.find((row) => matchesWhere(row, args.where)), args.select);
      },
      async findFirst(args = {}) {
        return project(holders[name].rows.find((row) => matchesWhere(row, args.where)), args.select);
      },
      async updateMany(args) {
        guard(name, 'updateMany');
        let count = 0;
        for (const row of holders[name].rows) {
          if (matchesWhere(row, args.where)) {
            Object.assign(row, args.data, { updatedAt: new Date() });
            count += 1;
          }
        }
        return { count };
      },
      async deleteMany(args = {}) {
        guard(name, 'deleteMany');
        const keep: Row[] = [];
        let count = 0;
        for (const row of holders[name].rows) {
          if (matchesWhere(row, args.where)) count += 1;
          else keep.push(row);
        }
        holders[name].rows = keep;
        return { count };
      },
      async create(args) {
        guard(name, 'create');
        const row = {
          id: `fake-${name}-${holders[name].rows.length + 1}`,
          createdAt: new Date(),
          ...args.data,
        };
        holders[name].rows.push(row);
        return { ...row };
      },
    };
  }

  const client = {} as FakePrisma;
  for (const name of TABLE_NAMES) client[name] = makeTable(name);

  client.$transaction = <T>(callback: (tx: FakePrisma) => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const backup = {} as Record<TableName, Row[]>;
      for (const name of TABLE_NAMES) {
        backup[name] = holders[name].rows;
        holders[name].rows = structuredClone(backup[name]!);
      }
      try {
        return await callback(client);
      } catch (error) {
        // 事务回滚：把**每一步**的写入全部还原，包括已成功的 delete 与 updateMany
        for (const name of TABLE_NAMES) holders[name].rows = backup[name]!;
        throw error;
      }
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  client.$failOn = (next) => {
    failure = next;
  };

  return client;
}

const USER = 'user-delete';
const OTHER = 'user-keep';
const LIVE_PASSWORD = 'Kedaya2026';
const LIVE_HASH = hashPassword(LIVE_PASSWORD);

function seedUser(fake: FakePrisma, userId: string): void {
  fake.user.rows.push({
    id: userId,
    displayName: `昵称-${userId}`,
    avatarUrl: `data:image/png;base64,${userId}`,
    department: '信息学院',
    anonEnabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  });
  fake.userCredential.rows.push({
    id: `cred-${userId}`,
    userId,
    email: `${userId}@stu.shanghaitech.edu.cn`,
    passwordHash: userId === USER ? LIVE_HASH : hashPassword('Other2026'),
    status: 'active',
    failedAttempts: 0,
    lockedUntil: null,
    passwordChangedAt: new Date(),
    lastLoginAt: null,
  });
  fake.authIdentity.rows.push({
    id: `identity-${userId}`,
    userId,
    provider: 'WECHAT_MINIPROGRAM',
    externalId: `openid-${userId}`,
  });
  fake.refreshSession.rows.push({
    id: `session-${userId}`,
    userId,
    tokenHash: `sha256-${userId}`,
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    revokedAt: null,
  });
  fake.campusBinding.rows.push({ id: `binding-${userId}`, userId, platform: 'ecard' });
  fake.campusSession.rows.push({ id: `campus-session-${userId}`, userId, platform: 'ecard' });
  fake.techpieLink.rows.push({ id: `link-${userId}`, userId, provider: 'ecard' });
  fake.consent.rows.push({ id: `consent-${userId}`, userId, module: 'wellbeing' });
  fake.profileSetting.rows.push({ id: `setting-${userId}`, userId });
  fake.mailAccount.rows.push({
    id: `mail-${userId}`,
    userId,
    email: `${userId}@shanghaitech.edu.cn`,
  });
  fake.mailEvent.rows.push({
    id: `mail-event-${userId}`,
    userId,
    accountId: `mail-${userId}`,
    uid: 1,
  });
  fake.aiPortraitProfile.rows.push({ id: `portrait-${userId}`, userId });
  fake.wellbeingAppointment.rows.push({ id: `appointment-${userId}`, userId });
  // 业务内容：注销**不该**删它（作者匿名化即可）
  fake.forumPost.rows.push({ id: `post-${userId}`, userId, title: '出闲置显示器' });
}

function liveAccounts(): LocalAccountRepository {
  return {
    async findByEmail() {
      return null;
    },
    async findByUserId(userId) {
      return {
        id: `cred-${userId}`,
        userId,
        email: `${userId}@stu.shanghaitech.edu.cn`,
        passwordHash: LIVE_HASH,
        status: 'active',
        failedAttempts: 0,
        lockedUntil: null,
        passwordChangedAt: new Date(),
        lastLoginAt: null,
      } satisfies LocalAccountRecord;
    },
    async createAccount() {
      throw new Error('not used');
    },
    async attachCredential() {
      throw new Error('not used');
    },
    async updatePassword() {
      throw new Error('not used');
    },
    async recordFailedAttempt() {
      throw new Error('not used');
    },
    async markLogin() {
      throw new Error('not used');
    },
  };
}

function buildService(fake: FakePrisma): AccountDeletionService {
  const repository = new AccountDeletionPrismaRepository(fake as unknown as PrismaService);
  // 真实 Prisma 仓储 + 内存账号表 + LocalAuthService 替身。
  // ⚠️ 第三个参数是免密账号走验证码注销所需的校验器（见「免密账号」那组用例）。
  return new AccountDeletionService(repository, liveAccounts(), makeLocalAuth());
}

/** 走真实的 `AuthController` → `AuthService` → `UserPrismaRepository`（只把 Prisma 换成内存） */
function buildAuthController(fake: FakePrisma, service: AccountDeletionService): AuthController {
  const users = new UserPrismaRepository(fake as unknown as PrismaService);
  const authService = new AuthService(
    { authenticateTicket: async () => { throw new Error('not used'); } } as unknown as AuthPort,
    {
      bind: async () => { throw new Error('not used'); },
      listBindings: async () => [],
      acquireSession: async () => null,
      unbind: async () => undefined,
    } as unknown as CampusSessionPort,
    users,
    liveAccounts(),
    { get: () => undefined } as unknown as ConfigService,
    {
      create: async () => undefined,
      findByHash: async () => null,
      revoke: async () => undefined,
      revokeAllForUser: async () => 0,
    } as unknown as RefreshSessionRepository,
  );
  // 构造参数顺序：accountDeletion → localAuth → authService → users → campusLinks
  // 第 2 个（LocalAuthService）本组不测（发码路径由 service 层用例覆盖），
  // 第 5 个（校园绑定端口）本组不碰绑定列表之外的能力。
  return new AuthController(service, {} as never, authService, users, {} as never);
}

describe('账号注销 · 真实仓储行为', () => {
  it('⚠️ confirm 错 → 400，且数据库**一行都没动**', async () => {
    const fake = createFakePrisma();
    seedUser(fake, USER);
    const service = buildService(fake);

    const error = await service
      .deleteAccount(USER, { password: LIVE_PASSWORD, confirm: 'Delete' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(fake.user.rows[0]?.displayName).toBe(`昵称-${USER}`);
    expect(fake.user.rows[0]?.deletedAt).toBeNull();
    for (const name of DELETED_TABLES) {
      expect(fake[name].rows.filter((row) => row.userId === USER)).toHaveLength(1);
    }
    expect(fake.auditLog.rows).toHaveLength(0);
  });

  it('成功：会话/凭据/身份/绑定/隐私数据真的没了，User 被匿名化，业务内容保留', async () => {
    const fake = createFakePrisma();
    seedUser(fake, USER);
    seedUser(fake, OTHER);
    const service = buildService(fake);

    const result = await service.deleteAccount(USER, {
      password: LIVE_PASSWORD,
      confirm: 'DELETE',
    });

    // 返回 ISO 时间戳
    expect(Number.isNaN(Date.parse(result.deletedAt))).toBe(false);

    const user = fake.user.rows.find((row) => row.id === USER);
    expect(user).toBeDefined();
    // ⚠️ 行还在（业务内容的外键依赖它），但已经不可能对应到真人
    expect(user?.displayName).toBe('已注销用户');
    expect(user?.avatarUrl).toBeNull();
    expect(user?.department).toBeNull();
    expect(user?.deletedAt).toBeInstanceOf(Date);

    for (const name of DELETED_TABLES) {
      expect(
        fake[name].rows.filter((row) => row.userId === USER),
        `${name} 仍有该用户的记录`,
      ).toHaveLength(0);
    }

    // 别人的数据一条都不能少
    for (const name of DELETED_TABLES) {
      expect(
        fake[name].rows.filter((row) => row.userId === OTHER),
        `${name} 误删了其他用户的数据`,
      ).toHaveLength(1);
    }
    expect(fake.user.rows.filter((row) => row.id === OTHER)).toHaveLength(1);

    // 业务内容保留（作者已匿名化），并留下一条不含 PII 的审计
    expect(fake.forumPost.rows.filter((row) => row.userId === USER)).toHaveLength(1);
    expect(fake.auditLog.rows.map((row) => row.action)).toContain('account.delete');
    expect(JSON.stringify(fake.auditLog.rows)).not.toContain('shanghaitech.edu.cn');
  });

  it('重复注销 → 409「该账号已注销」（不是 401 密码错）', async () => {
    const fake = createFakePrisma();
    seedUser(fake, USER);
    const service = buildService(fake);
    await service.deleteAccount(USER, { password: LIVE_PASSWORD, confirm: 'DELETE' });

    const error = await service
      .deleteAccount(USER, { password: LIVE_PASSWORD, confirm: 'DELETE' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toBe('该账号已注销');
  });

  it('⚠️ 并发：两个请求只有一个成功，另一个 409（不能都删一次）', async () => {
    const fake = createFakePrisma();
    seedUser(fake, USER);
    const service = buildService(fake);

    const outcomes = await Promise.allSettled([
      service.deleteAccount(USER, { password: LIVE_PASSWORD, confirm: 'DELETE' }),
      service.deleteAccount(USER, { password: LIVE_PASSWORD, confirm: 'DELETE' }),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictError);
    expect((rejected[0]!.reason as ConflictError).status).toBe(409);

    // 只留下一次注销痕迹，且数据只被清理了一次
    expect(fake.auditLog.rows.filter((row) => row.action === 'account.delete')).toHaveLength(1);
    expect(fake.user.rows.find((row) => row.id === USER)?.deletedAt).toBeInstanceOf(Date);
  });

  it('⚠️ 事务回滚：任一步 delete 失败 → 500，所有数据原样还在', async () => {
    const fake = createFakePrisma();
    seedUser(fake, USER);
    const service = buildService(fake);

    // 让**最后一步**删除失败：此时前面的 claim + 11 张表的 delete 都已执行，
    // 如果事务没有真正回滚，用户会看到"注销了一半"的账号。
    fake.$failOn({ table: 'wellbeingAppointment', operation: 'deleteMany' });

    const error = await service
      .deleteAccount(USER, { password: LIVE_PASSWORD, confirm: 'DELETE' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InternalError);
    expect((error as InternalError).status).toBe(500);
    expect((error as Error).message).toContain('已全部回滚');

    const user = fake.user.rows.find((row) => row.id === USER);
    expect(user?.displayName).toBe(`昵称-${USER}`);
    expect(user?.avatarUrl).toBe(`data:image/png;base64,${USER}`);
    expect(user?.department).toBe('信息学院');
    expect(user?.deletedAt).toBeNull();

    for (const name of DELETED_TABLES) {
      expect(
        fake[name].rows.filter((row) => row.userId === USER),
        `${name} 未回滚`,
      ).toHaveLength(1);
    }
    expect(fake.auditLog.rows).toHaveLength(0);
  });

  it('⚠️ 旧 token 立即失效：注销后同一身份调 /auth/me → 401', async () => {
    const fake = createFakePrisma();
    seedUser(fake, USER);
    const service = buildService(fake);
    const controller = buildAuthController(fake, service);

    // 因果对照：注销**前**，同一 sub 走同一条 /auth/me 代码路径是 200
    await expect(controller.me(USER)).resolves.toMatchObject({ user: { id: USER } });

    await service.deleteAccount(USER, { password: LIVE_PASSWORD, confirm: 'DELETE' });

    // JWT 是无状态的，旧 token 的签名仍然有效；「立即失效」的落点是
    // UserPrismaRepository.findById 必须过滤 deletedAt !== null。
    const error = await controller.me(USER).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((error as UnauthenticatedError).status).toBe(401);
  });
});

describe('AccountDeletionService · 免密账号走邮箱验证码', () => {
  /**
   * 免密账号（用邮箱验证码登录自动建的号）的 `passwordHash` 是哨兵值，
   * `verifyPassword` 永远 false。如果只认密码，这类账号**永远无法自助注销**。
   */
  it('⚠️ 免密账号（哨兵密码）用验证码可以注销', async () => {
    const repo = makeRepo();
    const localAuth = makeLocalAuth('123456');
    const accounts = {
      async findByUserId() {
        return {
          userId: 'u1',
          email: 'a@b.c',
          // 与 local-auth.service 里的 NO_PASSWORD_SENTINEL 同值
          passwordHash: '!no-password:sign-in-with-email-code',
          status: 'active',
        } as never;
      },
      async findByEmail() {
        return null;
      },
    } as unknown as LocalAccountRepository;

    const service = new AccountDeletionService(repo, accounts, localAuth);
    const result = await service.deleteAccount('u1', { code: '123456', confirm: 'DELETE' });

    expect(result.deletedAt).toBe('2026-10-20T00:00:00.000Z');
    // 码只发到**这个账号自己的邮箱**
    expect(localAuth.calls).toEqual([{ email: 'a@b.c', code: '123456' }]);
  });

  it('⚠️ 验证码错误 → 401，文案与"密码错误"**完全一致**', async () => {
    const repo = makeRepo();
    const localAuth = makeLocalAuth('123456');
    const service = new AccountDeletionService(repo, makeAccounts(), localAuth);

    const e1: Error = await service
      .deleteAccount('u1', { code: '000000', confirm: 'DELETE' })
      .then(
        () => new Error('不该成功'),
        (e: Error) => e,
      );
    const e2: Error = await service
      .deleteAccount('u1', { password: 'wrong', confirm: 'DELETE' })
      .then(
        () => new Error('不该成功'),
        (e: Error) => e,
      );

    expect(e1).toBeInstanceOf(UnauthenticatedError);
    // 文案一致才不会泄露"这个账号是免密的"
    expect(e1.message).toBe(e2.message);
    // 校验失败**不能**触发删除
    expect(repo.calls).toEqual([]);
  });

  it('密码和验证码都没给 → 400（不是 401）', async () => {
    const repo = makeRepo();
    const service = new AccountDeletionService(repo, makeAccounts(), makeLocalAuth());
    await expect(
      service.deleteAccount('u1', { confirm: 'DELETE' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.calls).toEqual([]);
  });

  it('⚠️ confirm 错时连验证码都不校验（防误触优先）', async () => {
    const repo = makeRepo();
    const localAuth = makeLocalAuth('123456');
    const service = new AccountDeletionService(repo, makeAccounts(), localAuth);
    await expect(
      service.deleteAccount('u1', { code: '123456', confirm: 'delete' }),
    ).rejects.toBeInstanceOf(ValidationError);
    // 码没有被消耗 —— 用户改对 confirm 后还能继续用
    expect(localAuth.calls).toEqual([]);
  });
});
