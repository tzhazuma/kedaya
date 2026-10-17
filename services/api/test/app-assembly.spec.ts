import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { API_BASE_PATH, TRACE_HEADER } from '@kedaya/contracts';
import { AppModule } from '../src/app.module';
import { TraceMiddleware } from '../src/common/middleware/trace.middleware';

/**
 * 应用装配测试：**真的把 `AppModule` 起起来**。
 *
 * 为什么值得单独一个文件：本项目的 DI 全部使用显式 `@Inject(TOKEN)`，
 * 但**全局提供者**（`APP_PIPE` / `APP_INTERCEPTOR` / `APP_FILTER`）必须能被
 * 容器**无参**实例化 —— 这一条只有在真正装配 19 个模块时才会暴露。
 * 之前 `ZodValidationPipe` 的构造函数没有 `@Optional()`，
 * 单元测试全绿但 `AppModule` 根本起不来（Nest can't resolve dependencies…），
 * 这个测试就是那个 bug 的回归防线。
 *
 * 不依赖数据库：只打「会在触碰数据库**之前**就被拦下」的请求。
 */

const BASE = API_BASE_PATH;

describe('应用装配（AppModule + 全局管道/拦截器/过滤器）', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix(BASE.replace(/^\//, ''));

    const trace = app.get(TraceMiddleware);
    app.use((req: Request, res: Response, next: NextFunction) => trace.use(req, res, next));

    // 装配成功即可；不要让数据库告警刷屏
    app.useLogger(false);

    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('19 个模块全部装配成功，且全局管道 / 拦截器 / 过滤器都在', () => {
    expect(app).toBeDefined();
    expect(app.getHttpAdapter()).toBeDefined();
  });

  it('不存在的路由 → 404 且是统一失败信封（过滤器生效）', async () => {
    const response = await fetch(`${baseUrl}${BASE}/definitely-not-a-route`);
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; message: string };
      traceId: string;
    };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get(TRACE_HEADER)).toBe(body.traceId);
  });

  it('查询参数不合法 → 400 VALIDATION_FAILED（说明 @ZodQuery 在 handler 之前拦下，无需数据库）', async () => {
    const response = await fetch(`${baseUrl}${BASE}/errand/items?limit=abc`);
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; message: string; details?: unknown };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toBeDefined();
  });

  it('枚举白名单外取值同样被拒（脏筛选条件不会漏到服务层）', async () => {
    const response = await fetch(`${baseUrl}${BASE}/errand/items?status=not-a-status`);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });
});
