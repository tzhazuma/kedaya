import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestingModule } from '@nestjs/testing';

import { verifyJwt } from '../src/common/auth/jwt';
import { UnauthenticatedError } from '../src/common/errors/app-error';
import { AuthModule } from '../src/modules/auth/auth.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { LocalAuthService } from '../src/modules/auth/local-auth.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 自建账号（邮箱 + 密码）**打真实数据库**的集成测试。
 *
 * 与 `local-auth.service.spec.ts`（内存假仓储）的分工：
 *   · 单测证明「编排与规则」；
 *   · 本测试证明「真的能用」—— 迁移能建表、Prisma 读写正常、
 *     密码落库是 scrypt 哈希而不是明文、刷新令牌能在库里被轮换与撤销。
 *
 * 数据库不可用时**整体跳过**（本机没起 Postgres 不该让 CI 变红），
 * 这是刻意设计：基础设施缺失 ≠ 代码有 bug。
 */

// ⚠️ 必须用**校园邮箱域**：`LocalAuthService.normalizeTarget()` 现在只放行
// `CAMPUS_EMAIL_DOMAINS`（`@shanghaitech.edu.cn` / `@stu.shanghaitech.edu.cn`），
// 其它域名会以 `CAMPUS_EMAIL_REQUIRED` 被拒。这里用学生邮箱子域，
// 并且**只**用 `it-` 前缀的随机邮箱，便于 afterAll 精确清理。
const EMAIL_DOMAIN = 'stu.shanghaitech.edu.cn';

function uniqueEmail(): string {
  return `it-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@${EMAIL_DOMAIN}`;
}

const PASSWORD = 'Kedaya2026';
const NEW_PASSWORD = 'Kedaya2027';

describe('自建账号 · 真实 Postgres 集成（注册 → 登录 → 轮换 → 改密 → 重置 → 登出）', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let localAuth: LocalAuthService;
  let auth: AuthService;
  let dbAvailable = false;

  /** 每次用例用独立邮箱，互不干扰；结束后按域名前缀清理 */
  const createdEmails: string[] = [];

  beforeAll(async () => {
    // devCode 只在开发开关打开时回显；集成测试必须能拿到验证码
    process.env.AUTH_DEV_EXPOSE_CODES = 'true';

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env.local', '.env'],
          cache: false,
        }),
        PrismaModule,
        AuthModule,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    localAuth = moduleRef.get(LocalAuthService);
    auth = moduleRef.get(AuthService);

    try {
      await prisma.$queryRaw`SELECT 1`;
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  }, 30_000);

  afterAll(async () => {
    if (dbAvailable) {
      // 清理本次测试造出的数据（User 上配置了级联删除，会带走凭据与会话）
      await prisma.verificationCode.deleteMany({
        where: { target: { in: createdEmails } },
      });
      await prisma.refreshSession.deleteMany({
        where: { user: { credential: { email: { in: createdEmails } } } },
      });
      await prisma.user.deleteMany({
        where: { credential: { email: { in: createdEmails } } },
      });
    }
    await moduleRef?.close();
  }, 30_000);

  /** 走完整注册流程，返回刚建好的账号 */
  async function registerAccount(email: string, password = PASSWORD) {
    createdEmails.push(email);

    const receipt = await localAuth.sendRegisterCode(email);
    expect(receipt.devCode).toMatch(/^\d{6}$/);

    // 错误的验证码一律拒绝，且不留下账号
    await expect(
      localAuth.register({ email, code: '000000', password }, { ip: '127.0.0.1' }),
    ).rejects.toThrow();

    const outcome = await localAuth.register(
      { email, code: receipt.devCode ?? '', password, displayName: '集成测试鸭' },
      { ip: '127.0.0.1', userAgent: 'vitest' },
    );
    expect(outcome.campusBound).toBe(false);
    return outcome;
  }

  it('注册：账号 / 凭据 / 会话真的落库，且密码只存 scrypt 哈希', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const email = uniqueEmail();
    const outcome = await registerAccount(email);

    const credential = await prisma.userCredential.findUnique({
      where: { email },
      include: { user: true },
    });
    expect(credential).not.toBeNull();
    expect(credential?.userId).toBe(outcome.user.id);
    expect(credential?.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(credential?.passwordHash).not.toContain(PASSWORD);
    expect(credential?.status).toBe('active');
    expect(credential?.passwordChangedAt).toBeInstanceOf(Date);
    // 注册阶段还没有「最近登录」
    expect(credential?.lastLoginAt).toBeNull();

    // 签发出来的 access token 与 CAS 路径同构：sub = userId, typ = access
    const payload = verifyJwt(outcome.accessToken, process.env.JWT_SECRET ?? '');
    expect(payload.sub).toBe(outcome.user.id);
    expect(payload.typ).toBe('access');

    // 刷新令牌在库里只以 sha256 指纹形式存在，不存明文
    const sessions = await prisma.refreshSession.findMany({ where: { userId: outcome.user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).not.toBe(outcome.refreshToken);
    expect(sessions[0]?.revokedAt).toBeNull();

    // 登录一次后「最近登录」写入数据库（证明登录记账也真的落库）
    await localAuth.login({ email, password: PASSWORD });
    const afterLogin = await prisma.userCredential.findUnique({ where: { email } });
    expect(afterLogin?.lastLoginAt).toBeInstanceOf(Date);
  }, 30_000);

  it('重复注册同一邮箱被拒（邮箱唯一性真的落在数据库上）', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const email = uniqueEmail();
    await registerAccount(email);

    await expect(localAuth.sendRegisterCode(email)).rejects.toThrow(/已注册/);
  }, 30_000);

  it('登录：密码错误与账号不存在都是同一种拒绝（防枚举）', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const email = uniqueEmail();
    await registerAccount(email);

    const wrong = await localAuth
      .login({ email, password: 'WrongPass2026' })
      .catch((error: unknown) => error);
    const ghost = await localAuth
      .login({ email: uniqueEmail(), password: 'WrongPass2026' })
      .catch((error: unknown) => error);

    expect(wrong).toBeInstanceOf(UnauthenticatedError);
    expect(ghost).toBeInstanceOf(UnauthenticatedError);
    expect((wrong as Error).message).toBe((ghost as Error).message);
  }, 30_000);

  it('刷新令牌轮换：旧令牌立刻失效，新令牌可用', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const email = uniqueEmail();
    const registered = await registerAccount(email);

    const rotated = await auth.refresh(registered.refreshToken);
    expect(rotated.refreshToken).not.toBe(registered.refreshToken);

    // 正常轮换链：新令牌可以继续换下一对
    const again = await auth.refresh(rotated.refreshToken);
    expect(again.accessToken).not.toBe('');

    const sessions = await prisma.refreshSession.findMany({
      where: { userId: registered.user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((row) => row.revokedAt !== null)).toHaveLength(2);

    // 重放**已撤销**的旧令牌：拒绝，并按「令牌可能已泄漏」撤销该用户全部会话
    await expect(auth.refresh(registered.refreshToken)).rejects.toThrow();
    await expect(auth.refresh(again.refreshToken)).rejects.toThrow();

    const afterReplay = await prisma.refreshSession.findMany({
      where: { userId: registered.user.id },
    });
    expect(afterReplay.every((row) => row.revokedAt !== null)).toBe(true);
  }, 30_000);

  it('修改密码：当前密码错 → 拒绝；正确 → 换发令牌且其他设备下线', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const email = uniqueEmail();
    const registered = await registerAccount(email);

    // 另一台设备也登录一次
    const otherDevice = await localAuth.login({ email, password: PASSWORD });
    expect(otherDevice.refreshToken).not.toBe(registered.refreshToken);

    await expect(
      localAuth.changePassword(registered.user.id, {
        currentPassword: 'NotMyPassword1',
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);

    const changed = await localAuth.changePassword(registered.user.id, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(changed.refreshToken).not.toBe(registered.refreshToken);

    // 改密后：全部旧会话失效（含其他设备），新密码可登录、旧密码不可
    await expect(auth.refresh(otherDevice.refreshToken)).rejects.toThrow();
    await expect(auth.refresh(registered.refreshToken)).rejects.toThrow();

    const relogin = await localAuth.login({ email, password: NEW_PASSWORD });
    expect(relogin.user.id).toBe(registered.user.id);
    await expect(localAuth.login({ email, password: PASSWORD })).rejects.toThrow();
  }, 30_000);

  it('找回密码：验证码一次性、重置后所有会话被撤销', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const email = uniqueEmail();
    const registered = await registerAccount(email);

    const receipt = await localAuth.sendResetCode(email);
    expect(receipt.devCode).toMatch(/^\d{6}$/);

    // 先来一次错误的验证码，确认不会生效
    await expect(
      localAuth.resetPassword({ email, code: '999999', password: NEW_PASSWORD }),
    ).rejects.toThrow();

    const reset = await localAuth.resetPassword({
      email,
      code: receipt.devCode ?? '',
      password: NEW_PASSWORD,
    });
    expect(reset.reset).toBe(true);

    // 同一验证码不能被复用
    await expect(
      localAuth.resetPassword({ email, code: receipt.devCode ?? '', password: 'Kedaya2028' }),
    ).rejects.toThrow();

    // 重置把所有会话踢下线
    await expect(auth.refresh(registered.refreshToken)).rejects.toThrow();

    const relogin = await localAuth.login({ email, password: NEW_PASSWORD });
    expect(relogin.user.id).toBe(registered.user.id);
  }, 30_000);

  it('不存在的邮箱找回密码同样返回 sent=true（不泄漏账号是否存在）', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const receipt = await localAuth.sendResetCode(uniqueEmail());
    expect(receipt.sent).toBe(true);
  }, 30_000);

  it('登出：按 refresh token 撤销单个会话，未给 token 则撤销全部', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const email = uniqueEmail();
    const registered = await registerAccount(email);
    const second = await localAuth.login({ email, password: PASSWORD });

    const single = await localAuth.logout(registered.user.id, second.refreshToken);
    expect(single.revoked).toBe(1);

    // 注意顺序：**不要**先去 refresh 已撤销的令牌 —— 那会被服务端判定为
    // 「令牌可能已泄漏」并撤销全部会话（见 AuthService.refresh 的注释）。
    // 先验证第一台设备不受影响，再演示「在别处登出」撤销全部。
    const stillActive = await auth.refresh(registered.refreshToken);
    expect(stillActive.refreshToken).not.toBe(registered.refreshToken);

    const all = await localAuth.logout(registered.user.id);
    expect(all.revoked).toBeGreaterThanOrEqual(1);
    await expect(auth.refresh(stillActive.refreshToken)).rejects.toThrow();
  }, 30_000);

  it('hasPassword / 无密码账号改密：CAS-only 账号改密会明确报错而不是 500', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const email = uniqueEmail();
    const registered = await registerAccount(email);
    expect(await localAuth.hasPassword(registered.user.id)).toBe(true);

    // 造一个没有凭据的账号（等价于纯 CAS 账号）
    const casOnly = await prisma.user.create({
      data: { displayName: '只有 CAS 的账号' },
    });
    expect(await localAuth.hasPassword(casOnly.id)).toBe(false);
    await expect(
      localAuth.changePassword(casOnly.id, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toThrow(/没有设置密码/);

    await prisma.user.delete({ where: { id: casOnly.id } });
  }, 30_000);
});
