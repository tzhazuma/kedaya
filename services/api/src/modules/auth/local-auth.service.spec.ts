import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import {
  ConflictError,
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { verifyJwt } from '../../common/auth/jwt';
import { hashCode } from './domain/verification-code';
import type { MailMessage, MailPort } from './domain/local-account.domain';
import type { UserRecord } from './domain/auth.domain';
import { LocalAuthService } from './local-auth.service';
import { AuthService } from './auth.service';
import { createInMemoryAuth, type InMemoryAuth } from './testing/in-memory-auth';

/**
 * 自建账号（邮箱 + 密码）全流程回归测试。
 *
 * 覆盖的是**行为契约**，而不是调用次数：
 *   · 验证码拿不到就无法注册（且不会留下半成品账号）
 *   · 密码错误会累加并锁定，锁定期间即使密码正确也拒绝
 *   · 改密/重置后所有刷新令牌立即失效（演示"被踢下线"）
 *   · 账号不存在与密码错误返回同一文案（防账号枚举）
 *   · 注册/登录签发的 JWT 与 CAS 路径完全同构
 */

const SECRET = 'test-secret-please-change-me-32-chars';

function makeConfig(values: Record<string, string> = {}): ConfigService {
  const table: Record<string, string> = {
    JWT_SECRET: SECRET,
    JWT_ACCESS_TTL: '900',
    JWT_REFRESH_TTL: '2592000',
    AUTH_DEV_EXPOSE_CODES: 'true',
    ...values,
  };
  return { get: (key: string) => table[key] } as unknown as ConfigService;
}

interface Harness {
  service: LocalAuthService;
  auth: InMemoryAuth;
  mail: { sent: MailMessage[]; port: MailPort };
}

function build(values: Record<string, string> = {}, now?: () => Date): Harness {
  const auth = createInMemoryAuth(now === undefined ? {} : { now });
  const sent: MailMessage[] = [];
  const mail: MailPort = {
    send: vi.fn(async (message: MailMessage) => {
      sent.push(message);
    }),
  };

  const config = makeConfig(values);
  const authService = new AuthService(
    { authenticateTicket: vi.fn() },
    {
      bind: vi.fn(),
      listBindings: vi.fn().mockResolvedValue([]),
      acquireSession: vi.fn().mockResolvedValue(null),
      unbind: vi.fn(),
    },
    auth.users,
    auth.accounts,
    config,
    auth.sessions,
  );

  const clock = now ?? ((): Date => new Date());
  const service = new LocalAuthService(
    auth.accounts,
    auth.codes,
    auth.sessions,
    mail,
    auth.users,
    config,
    authService,
    clock,
  );

  return { service, auth, mail: { sent, port: mail } };
}

/** 从发信正文里把验证码抠出来（模拟用户查收邮件） */
function codeFromMail(message: MailMessage): string {
  const matched = /(\d{6})/.exec(message.text);
  if (!matched) throw new Error(`邮件里没有验证码：${message.text}`);
  return matched[1]!;
}

const EMAIL = 'kedaya@stu.shanghaitech.edu.cn';
const PASSWORD = 'Kedaya2026';

async function registerUser(harness: Harness): Promise<{ userId: string; refreshToken: string }> {
  const receipt = await harness.service.sendRegisterCode(EMAIL);
  const code = receipt.devCode ?? codeFromMail(harness.mail.sent.at(-1)!);
  const outcome = await harness.service.register({ email: EMAIL, code, password: PASSWORD });
  return { userId: outcome.user.id, refreshToken: outcome.refreshToken };
}

describe('注册', () => {
  it('验证码正确 → 建档并直接登录（返回可用 JWT）', async () => {
    const harness = build();
    await registerUser(harness);

    const account = harness.auth.inspect().accounts[0];
    expect(account?.email).toBe(EMAIL);
    expect(account?.passwordHash).not.toContain(PASSWORD);

    const tokens = harness.auth.inspect().sessions;
    expect(tokens).toHaveLength(1);
  });

  it('验证码错误 → 拒绝，且不留下任何账号', async () => {
    const harness = build();
    const receipt = await harness.service.sendRegisterCode(EMAIL);
    const wrong = receipt.devCode === '000000' ? '111111' : '000000';

    await expect(
      harness.service.register({ email: EMAIL, code: wrong, password: PASSWORD }),
    ).rejects.toThrow(ValidationError);
    expect(harness.auth.inspect().accounts).toHaveLength(0);
  });

  it('同一验证码只能用一次（消费后重放失败）', async () => {
    const harness = build();
    const receipt = await harness.service.sendRegisterCode(EMAIL);
    const code = receipt.devCode!;

    await harness.service.register({ email: EMAIL, code, password: PASSWORD });

    // 第二次用同一验证码：邮箱已存在
    await expect(
      harness.service.register({ email: EMAIL, code, password: PASSWORD }),
    ).rejects.toThrow(ConflictError);
  });

  it('邮箱已注册时直接拒绝发码（提前告知，避免白填表单）', async () => {
    const harness = build();
    await registerUser(harness);
    await expect(harness.service.sendRegisterCode(EMAIL)).rejects.toThrow(ConflictError);
  });

  it('弱密码在消费验证码之前就被拒绝', async () => {
    const harness = build();
    const receipt = await harness.service.sendRegisterCode(EMAIL);
    await expect(
      harness.service.register({ email: EMAIL, code: receipt.devCode!, password: 'short' }),
    ).rejects.toThrow(ValidationError);
    // 验证码未被消费，用户可以改密码后重试
    expect(harness.auth.inspect().codes[0]?.consumedAt).toBeNull();
  });

  it('邮箱格式非法 → VALIDATION_FAILED', async () => {
    const harness = build();
    await expect(harness.service.sendRegisterCode('not-an-email')).rejects.toThrow(ValidationError);
  });

  it('签发的令牌与 CAS 路径同构（sub/typ 两字段 + 有效期）', async () => {
    const harness = build();
    const { userId } = await registerUser(harness);
    const outcome = await harness.service.login({ email: EMAIL, password: PASSWORD });

    const payload = verifyJwt(outcome.accessToken, SECRET);
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub', 'typ']);
    expect(payload.sub).toBe(userId);
    expect(payload.typ).toBe('access');
  });
});

describe('登录与锁定', () => {
  it('密码正确 → 签发新令牌并清空失败计数', async () => {
    const harness = build();
    await registerUser(harness);

    const outcome = await harness.service.login({ email: EMAIL, password: PASSWORD });

    expect(outcome.campusBound).toBe(false);
    expect(harness.auth.inspect().accounts[0]?.failedAttempts).toBe(0);
    expect(harness.auth.inspect().accounts[0]?.lastLoginAt).not.toBeNull();
    expect(harness.auth.inspect().sessions).toHaveLength(2);
  });

  it('账号不存在与密码错误返回**完全一致**的文案（防账号枚举）', async () => {
    const harness = build();
    await registerUser(harness);

    const wrongPassword = await harness.service
      .login({ email: EMAIL, password: 'Wrong12345' })
      .catch((error: Error) => error);
    const noSuchUser = await harness.service
      .login({ email: 'nobody@stu.shanghaitech.edu.cn', password: PASSWORD })
      .catch((error: Error) => error);

    expect((wrongPassword as Error).message).toBe((noSuchUser as Error).message);
    expect(wrongPassword).toBeInstanceOf(UnauthenticatedError);
  });

  it('连续 5 次密码错误 → 锁定；锁定期内即使密码正确也拒绝', async () => {
    const harness = build();
    await registerUser(harness);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        harness.service.login({ email: EMAIL, password: 'Wrong12345' }),
      ).rejects.toThrow(UnauthenticatedError);
    }

    const locked = harness.auth.inspect().accounts[0];
    expect(locked?.failedAttempts).toBe(5);
    expect(locked?.status).toBe('locked');

    await expect(harness.service.login({ email: EMAIL, password: PASSWORD })).rejects.toThrow(
      ForbiddenError,
    );
  });

  // ⚠️ 本用例连续做 8 次 scrypt（N=16384），是纯 CPU 重的用例。
  // 默认 5s 在全量并行（81 个 fork）时会因 CPU 争用被拖超时，与代码正确性无关 ——
  // 因此按本仓库对重计算用例的惯例显式放宽（参见 buddy-db / techpie-http 等）。
  it('锁定期过后（时间推进）可以正常登录', async () => {
    let current = new Date('2026-10-17T00:00:00.000Z');
    const harness = build({}, () => current);
    await registerUser(harness);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await harness.service.login({ email: EMAIL, password: 'Wrong12345' }).catch(() => undefined);
    }
    await expect(harness.service.login({ email: EMAIL, password: PASSWORD })).rejects.toThrow(
      ForbiddenError,
    );

    // 16 分钟后锁定自然过期
    current = new Date('2026-10-17T00:16:00.000Z');
    await expect(harness.service.login({ email: EMAIL, password: PASSWORD })).resolves.toMatchObject({
      campusBound: false,
    });
  }, 30_000);
});

describe('验证码频控', () => {
  it('60 秒内重复发码 → CONFLICT，并给出等待秒数', async () => {
    const harness = build();
    await harness.service.sendRegisterCode(EMAIL);
    const error = await harness.service.sendRegisterCode(EMAIL).catch((e: Error) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).details).toMatchObject({ retryAfterSeconds: expect.any(Number) });
  });

  it('每小时最多 5 条：超过后拒绝', async () => {
    let current = new Date('2026-10-17T00:00:00.000Z');
    const harness = build({}, () => current);

    for (let i = 0; i < 5; i += 1) {
      await harness.service.sendRegisterCode(EMAIL);
      current = new Date(current.getTime() + 61_000);
    }

    await expect(harness.service.sendRegisterCode(EMAIL)).rejects.toThrow(ConflictError);
    expect(harness.auth.inspect().codes).toHaveLength(5);
  });

  it('验证码尝试超过 5 次后作废（必须重新获取）', async () => {
    const harness = build();
    const receipt = await harness.service.sendRegisterCode(EMAIL);

    for (let i = 0; i < 5; i += 1) {
      await harness.service
        .register({ email: EMAIL, code: '000000', password: PASSWORD })
        .catch(() => undefined);
    }

    await expect(
      harness.service.register({ email: EMAIL, code: receipt.devCode!, password: PASSWORD }),
    ).rejects.toThrow(/尝试次数过多/);
  });

  it('开发开关关闭时响应里没有验证码（生产形态）', async () => {
    const harness = build({ AUTH_DEV_EXPOSE_CODES: 'false' });
    const receipt = await harness.service.sendRegisterCode(EMAIL);

    expect(receipt.devCode).toBeUndefined();
    expect(harness.mail.sent).toHaveLength(1);
  });

  it('NODE_ENV=production 时即使开关为 true 也不回显验证码', async () => {
    const harness = build({ AUTH_DEV_EXPOSE_CODES: 'true', NODE_ENV: 'production' });
    expect((await harness.service.sendRegisterCode(EMAIL)).devCode).toBeUndefined();
  });

  it('验证码以哈希形式落库（库里查不到明文）', async () => {
    const harness = build();
    const receipt = await harness.service.sendRegisterCode(EMAIL);
    const stored = harness.auth.inspect().codes[0]!;

    expect(stored.codeHash).not.toContain(receipt.devCode!);
    expect(stored.codeHash).toBe(hashCode(EMAIL, 'register', receipt.devCode!));
  });
});

describe('找回密码与修改密码', () => {
  it('找回密码：验证码正确 → 新密码可登录，旧密码失效', async () => {
    const harness = build();
    await registerUser(harness);

    const receipt = await harness.service.sendResetCode(EMAIL);
    await harness.service.resetPassword({
      email: EMAIL,
      code: receipt.devCode!,
      password: 'NewKedaya2026',
    });

    await expect(harness.service.login({ email: EMAIL, password: PASSWORD })).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(
      harness.service.login({ email: EMAIL, password: 'NewKedaya2026' }),
    ).resolves.toMatchObject({ campusBound: false });
  });

  it('找回密码未注册的邮箱：同样返回 sent=true，但不发信（防枚举）', async () => {
    const harness = build();
    const receipt = await harness.service.sendResetCode('nobody@stu.shanghaitech.edu.cn');

    expect(receipt.sent).toBe(true);
    expect(receipt.devCode).toBeUndefined();
    expect(harness.mail.sent).toHaveLength(0);
  });

  it('重置密码后所有既有会话被撤销（其他设备强制下线）', async () => {
    const harness = build();
    const { userId } = await registerUser(harness);

    const receipt = await harness.service.sendResetCode(EMAIL);
    await harness.service.resetPassword({
      email: EMAIL,
      code: receipt.devCode!,
      password: 'NewKedaya2026',
    });

    const sessions = harness.auth.inspect().sessions.filter((s) => s.userId === userId);
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it('重置用的验证码被一次性消费（防重放）', async () => {
    const harness = build();
    await registerUser(harness);
    const receipt = await harness.service.sendResetCode(EMAIL);

    await harness.service.resetPassword({
      email: EMAIL,
      code: receipt.devCode!,
      password: 'NewKedaya2026',
    });

    await expect(
      harness.service.resetPassword({
        email: EMAIL,
        code: receipt.devCode!,
        password: 'AnotherPass2026',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('修改密码：当前密码错误 → 拒绝；正确 → 新密码生效并换发新令牌', async () => {
    const harness = build();
    const { userId } = await registerUser(harness);

    await expect(
      harness.service.changePassword(userId, {
        currentPassword: 'Wrong12345',
        newPassword: 'NewKedaya2026',
      }),
    ).rejects.toThrow(UnauthenticatedError);

    const outcome = await harness.service.changePassword(userId, {
      currentPassword: PASSWORD,
      newPassword: 'NewKedaya2026',
    });

    expect(outcome.user.id).toBe(userId);
    // 旧令牌全部撤销，只留下改密时新签发的一条
    const active = harness.auth.inspect().sessions.filter((s) => s.revokedAt === null);
    expect(active).toHaveLength(1);

    await expect(
      harness.service.login({ email: EMAIL, password: 'NewKedaya2026' }),
    ).resolves.toMatchObject({ campusBound: false });
  });

  it('新密码与当前密码相同 → 拒绝', async () => {
    const harness = build();
    const { userId } = await registerUser(harness);

    await expect(
      harness.service.changePassword(userId, {
        currentPassword: PASSWORD,
        newPassword: PASSWORD,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('hasPassword 反映账号是否设置了密码', async () => {
    const harness = build();
    const { userId } = await registerUser(harness);

    await expect(harness.service.hasPassword(userId)).resolves.toBe(true);
    await expect(harness.service.hasPassword('someone-else')).resolves.toBe(false);
  });
});

describe('绑定邮箱（给微信账号补一条后路）', () => {
  const BIND_EMAIL = 'duck-bind@stu.shanghaitech.edu.cn';

  /** 造一个"只有微信登录方式"的账号：有 User、没有凭据、没有身份映射（模拟已解绑） */
  function seedWechatOnlyUser(harness: Harness): string {
    const record: UserRecord = {
      id: 'user-wechat-only',
      displayName: '微信用户1234',
      avatarUrl: null,
      department: null,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    harness.auth.seedUser(record);
    return record.id;
  }

  it('在同一个 userId 上挂凭据，不新建账号', async () => {
    const harness = build();
    const userId = seedWechatOnlyUser(harness);

    const receipt = await harness.service.sendBindEmailCode(userId, BIND_EMAIL);
    const outcome = await harness.service.bindEmail(userId, {
      email: BIND_EMAIL,
      code: receipt.devCode!,
      password: PASSWORD,
    });

    expect(outcome.user.id).toBe(userId);
    expect(outcome.account.hasPassword).toBe(true);
    expect(outcome.account.email).toBe(BIND_EMAIL);
    expect(harness.auth.inspect().users).toHaveLength(1);
    expect(harness.auth.inspect().accounts).toHaveLength(1);
    expect(harness.auth.inspect().accounts[0]?.userId).toBe(userId);
  });

  it('绑定后可以用邮箱密码登录，仍是同一个账号', async () => {
    const harness = build();
    const userId = seedWechatOnlyUser(harness);
    const receipt = await harness.service.sendBindEmailCode(userId, BIND_EMAIL);
    await harness.service.bindEmail(userId, {
      email: BIND_EMAIL,
      code: receipt.devCode!,
      password: PASSWORD,
    });

    const login = await harness.service.login({ email: BIND_EMAIL, password: PASSWORD });

    expect(login.user.id).toBe(userId);
    expect(login.isNewUser).toBe(false);
  });

  it('账号已设邮箱密码 → 发码与绑定都返回 CONFLICT', async () => {
    const harness = build();
    const { userId } = await registerUser(harness);

    await expect(harness.service.sendBindEmailCode(userId, BIND_EMAIL)).rejects.toThrow(
      ConflictError,
    );
    await expect(
      harness.service.bindEmail(userId, {
        email: BIND_EMAIL,
        code: '123456',
        password: PASSWORD,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('邮箱已被其他账号占用 → 提前拒绝，不浪费一封信', async () => {
    const harness = build();
    await registerUser(harness);
    const wechatUserId = seedWechatOnlyUser(harness);

    await expect(harness.service.sendBindEmailCode(wechatUserId, EMAIL)).rejects.toThrow(
      ConflictError,
    );
  });

  it('验证码错误 → 拒绝且不留下凭据', async () => {
    const harness = build();
    const userId = seedWechatOnlyUser(harness);
    const receipt = await harness.service.sendBindEmailCode(userId, BIND_EMAIL);
    const wrong = receipt.devCode === '000000' ? '111111' : '000000';

    await expect(
      harness.service.bindEmail(userId, { email: BIND_EMAIL, code: wrong, password: PASSWORD }),
    ).rejects.toThrow(ValidationError);
    expect(harness.auth.inspect().accounts).toHaveLength(0);
  });
});

describe('登录响应形状（三条登录路径同构）', () => {
  it('注册/登录都返回 account 概览与 isNewUser，供「我的」一次渲染', async () => {
    const harness = build();
    const { userId } = await registerUser(harness);

    const outcome = await harness.service.login({ email: EMAIL, password: PASSWORD });

    expect(outcome.user.id).toBe(userId);
    expect(outcome.isNewUser).toBe(false);
    expect(outcome.expiresAt).toBeTruthy();
    expect(outcome.account).toEqual({
      hasPassword: true,
      email: EMAIL,
      wechatBound: false,
      hasOtherLoginMethod: true,
    });
  });
});

describe('会话撤销', () => {
  it('登出（带 token）只撤销本次登录', async () => {
    const harness = build();
    const { refreshToken } = await registerUser(harness);
    await harness.service.login({ email: EMAIL, password: PASSWORD });

    const result = await harness.service.logout(
      harness.auth.inspect().accounts[0]!.userId,
      refreshToken,
    );

    expect(result.revoked).toBe(1);
  });

  it('登出（不带 token）撤销全部会话', async () => {
    const harness = build();
    const { userId } = await registerUser(harness);
    await harness.service.login({ email: EMAIL, password: PASSWORD });

    const result = await harness.service.logout(userId);

    expect(result.revoked).toBe(2);
    expect(harness.auth.inspect().sessions.every((s) => s.revokedAt !== null)).toBe(true);
  });
});

describe('空实现兜底', () => {
  it('未注册用户改密码 → NOT_FOUND（而不是 500）', async () => {
    const harness = build();
    const record: UserRecord = {
      id: 'user-without-credential',
      displayName: 'CAS 同学',
      avatarUrl: null,
      department: null,
      createdAt: new Date(),
    };
    harness.auth.seedUser(record);

    await expect(
      harness.service.changePassword(record.id, {
        currentPassword: PASSWORD,
        newPassword: 'NewKedaya2026',
      }),
    ).rejects.toThrow(/没有设置密码/);
  });
});
