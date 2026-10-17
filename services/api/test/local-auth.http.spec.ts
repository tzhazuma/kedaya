import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { API_BASE_PATH, TRACE_HEADER } from '@kedaya/contracts';
import { signJwt } from '../src/common/auth/jwt';
import { AuthGuard } from '../src/common/auth/auth.guard';
import { UnauthenticatedError } from '../src/common/errors/app-error';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor';
import { TraceMiddleware } from '../src/common/middleware/trace.middleware';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';
import { LocalAuthController } from '../src/modules/auth/local-auth.controller';
import { LocalAuthService } from '../src/modules/auth/local-auth.service';

/**
 * 自建账号的 **HTTP 层**测试（不依赖数据库）。
 *
 * 覆盖的是「接线是否正确」，也就是各层交界处最容易出错的四件事：
 *   1. 路由前缀与路径与客户端约定一致（`/api/v1/auth/account/...`）；
 *   2. Zod 校验真的挡在 controller 之前，脏请求不会打到服务层；
 *   3. 业务错误被收敛成 `{ ok:false, error:{code} }` + 正确的 HTTP 状态码；
 *   4. `@UseGuards(AuthGuard)` 真的要求 Bearer 令牌，`@CurrentUser()` 解出的是 JWT 的 sub。
 *
 * 服务层与数据库的验证分别在 `local-auth.service.spec.ts`（内存）
 * 与 `local-auth.integration.spec.ts`（真实 Postgres）里，这里把 LocalAuthService 换成假的。
 */

const ACCOUNT = `${API_BASE_PATH}/auth/account`;

interface FakeLocalAuth {
  sendRegisterCode: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  sendResetCode: ReturnType<typeof vi.fn>;
  resetPassword: ReturnType<typeof vi.fn>;
  changePassword: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  hasPassword: ReturnType<typeof vi.fn>;
}

function makeFake(): FakeLocalAuth {
  return {
    sendRegisterCode: vi
      .fn()
      .mockResolvedValue({ sent: true, email: 'duck@kedaya.dev', purpose: 'register', devCode: '123456' }),
    register: vi.fn().mockResolvedValue({
      user: { id: 'user-1', displayName: '可达鸭' },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 900,
      campusBound: false,
    }),
    login: vi.fn().mockResolvedValue({
      user: { id: 'user-1', displayName: '可达鸭' },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 900,
      campusBound: false,
    }),
    sendResetCode: vi
      .fn()
      .mockResolvedValue({ sent: true, email: 'duck@kedaya.dev', purpose: 'reset-password' }),
    resetPassword: vi.fn().mockResolvedValue({ reset: true, message: '密码已重置，请用新密码登录' }),
    changePassword: vi.fn().mockResolvedValue({
      user: { id: 'user-1', displayName: '可达鸭' },
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresIn: 900,
      campusBound: false,
    }),
    logout: vi.fn().mockResolvedValue({ revoked: 2 }),
    hasPassword: vi.fn().mockResolvedValue(true),
  };
}

@Module({
  controllers: [LocalAuthController],
  providers: [
    TraceMiddleware,
    AuthGuard,
    { provide: LocalAuthService, useValue: {} },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
class AccountHttpModule {}

let fake: FakeLocalAuth;

describe('账号 HTTP 层（路由 / Zod / 信封 / 鉴权）', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let bearer: string;

  beforeAll(async () => {
    fake = makeFake();

    const moduleRef = await Test.createTestingModule({ imports: [AccountHttpModule] })
      .overrideProvider(LocalAuthService)
      .useValue(fake)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));

    const trace = app.get(TraceMiddleware);
    app.use((req: Request, res: Response, next: NextFunction) => trace.use(req, res, next));
    app.useLogger(false);

    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    bearer = `Bearer ${signJwt('user-1', 'access', process.env.JWT_SECRET ?? '', 900)}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function post(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${baseUrl}${ACCOUNT}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it('注册验证码：成功走统一信封，且 traceId 出现在响应头', async () => {
    const response = await fetch(`${baseUrl}${ACCOUNT}/register/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'duck@kedaya.dev' }),
    });
    const body = (await response.json()) as {
      ok: boolean;
      data: { sent: boolean; devCode?: string };
      traceId: string;
    };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.devCode).toBe('123456');
    expect(response.headers.get(TRACE_HEADER)).toBe(body.traceId);
    expect(fake.sendRegisterCode).toHaveBeenCalledWith('duck@kedaya.dev', expect.any(Object));
  });

  it('验证码位数不对 / 邮箱缺失 → 400 VALIDATION_FAILED，且**不**打到服务层', async () => {
    const badCode = await post('/register', {
      email: 'duck@kedaya.dev',
      code: '123',
      password: 'Kedaya2026',
    });
    expect(badCode.status).toBe(400);
    expect(badCode.body.ok).toBe(false);
    expect((badCode.body.error as { code: string }).code).toBe('VALIDATION_FAILED');

    const missingEmail = await post('/login', { password: 'Kedaya2026' });
    expect(missingEmail.status).toBe(400);

    expect(fake.register).not.toHaveBeenCalled();
    expect(fake.login).not.toHaveBeenCalled();
  });

  it('密码太短（<8）同样被 Zod 拦下，错误里带字段级 details', async () => {
    const { status, body } = await post('/register', {
      email: 'duck@kedaya.dev',
      code: '123456',
      password: 'short1',
    });

    expect(status).toBe(400);
    const error = body.error as { code: string; details?: unknown };
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toBeDefined();
    expect(fake.register).not.toHaveBeenCalled();
  });

  it('登录：合法请求打到服务层，返回信封（含新令牌）', async () => {
    const { status, body } = await post('/login', {
      email: 'duck@kedaya.dev',
      password: 'Kedaya2026',
    });

    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect((body.data as { accessToken: string }).accessToken).toBe('access-token');
    expect(fake.login).toHaveBeenCalledWith(
      { email: 'duck@kedaya.dev', password: 'Kedaya2026' },
      expect.any(Object),
    );
  });

  it('未登录访问修改密码 / 登出 / 密码状态 → 401 UNAUTHENTICATED（守卫真的在拦）', async () => {
    for (const path of ['/password/change', '/logout']) {
      const { status, body } = await post(path, {
        currentPassword: 'Kedaya2026',
        newPassword: 'Kedaya2027',
      });
      expect(status, path).toBe(401);
      expect((body.error as { code: string }).code).toBe('UNAUTHENTICATED');
    }

    const status = await fetch(`${baseUrl}${ACCOUNT}/password/status`);
    expect(status.status).toBe(401);

    expect(fake.changePassword).not.toHaveBeenCalled();
    expect(fake.logout).not.toHaveBeenCalled();
    expect(fake.hasPassword).not.toHaveBeenCalled();
  });

  it('带合法 Bearer 时 @CurrentUser() 解出 JWT 的 sub 并下传', async () => {
    const changed = await post(
      '/password/change',
      { currentPassword: 'Kedaya2026', newPassword: 'Kedaya2027' },
      { authorization: bearer },
    );

    expect(changed.status).toBe(201);
    expect(fake.changePassword).toHaveBeenCalledWith(
      'user-1',
      { currentPassword: 'Kedaya2026', newPassword: 'Kedaya2027' },
      expect.any(Object),
    );

    const logout = await post('/logout', { refreshToken: 'refresh-token' }, { authorization: bearer });
    expect(logout.status).toBe(201);
    expect(fake.logout).toHaveBeenCalledWith('user-1', 'refresh-token');
    expect((logout.body.data as { loggedOut: boolean }).loggedOut).toBe(true);

    const statusResponse = await fetch(`${baseUrl}${ACCOUNT}/password/status`, {
      headers: { authorization: bearer },
    });
    const statusBody = (await statusResponse.json()) as { data: { hasPassword: boolean } };
    expect(statusBody.data.hasPassword).toBe(true);
  });

  it('找回密码端点与客户端约定一致：/password/forgot 与 /password/reset', async () => {
    const forgot = await post('/password/forgot', { email: 'ghost@kedaya.dev' });
    expect(forgot.status).toBe(201);
    expect((forgot.body.data as { sent: boolean }).sent).toBe(true);

    const reset = await post('/password/reset', {
      email: 'duck@kedaya.dev',
      code: '654321',
      password: 'Kedaya2028',
    });
    expect(reset.status).toBe(201);
    expect(fake.resetPassword).toHaveBeenCalledWith({
      email: 'duck@kedaya.dev',
      code: '654321',
      password: 'Kedaya2028',
    });

    // 旧的 /reset、/change-password 这类路径不存在（防止客户端悄悄写错还能跑通）
    const wrong = await post('/reset', { email: 'duck@kedaya.dev' });
    expect(wrong.status).toBe(404);
  });

  it('未知账号/密码错误由服务层抛出的业务错误被翻成统一错误码', async () => {
    fake.login.mockRejectedValueOnce(new UnauthenticatedError('邮箱或密码不正确'));

    const { status, body } = await post('/login', {
      email: 'duck@kedaya.dev',
      password: 'WrongPass2026',
    });

    expect(status).toBe(401);
    expect(body.ok).toBe(false);
    const error = body.error as { code: string; message: string };
    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.message).toBe('邮箱或密码不正确');
  });
});
