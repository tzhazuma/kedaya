import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { API_BASE_PATH, TRACE_HEADER } from '@kedaya/contracts';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor';
import { TraceMiddleware } from '../src/common/middleware/trace.middleware';
import { NotFoundError } from '../src/common/errors/app-error';

/**
 * HTTP 层集成测试（契约 §6.1）。
 *
 * 用 @nestjs/testing 起一个**真实监听端口**的应用，走完整链路：
 *   TraceMiddleware → 路由 → EnvelopeInterceptor → AllExceptionsFilter
 *
 * 刻意用一个不依赖数据库的探针控制器：本机没有 PostgreSQL，
 * 而这段测试要证明的是**信封/追踪/错误码**这三件事，与持久化无关。
 */

@Controller('probe')
class ProbeController {
  @Get('ok')
  ok() {
    return { pong: true, 鸭: '可达' };
  }

  @Get('boom')
  boom(): never {
    throw new NotFoundError('探针资源不存在');
  }

  @Get('crash')
  crash(): never {
    throw new Error('内部细节：数据库密码是 hunter2');
  }
}

@Module({
  controllers: [ProbeController],
  providers: [
    TraceMiddleware,
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
class ProbeModule {}

describe('HTTP 集成：统一信封 + X-KedaYa-Trace + 全局前缀（契约 §6.1）', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));

    const trace = app.get(TraceMiddleware);
    app.use((req: Request, res: Response, next: NextFunction) => trace.use(req, res, next));

    // Logger 会往 stdout 打错误堆栈，测试输出里静音
    app.useLogger(false);

    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}${API_BASE_PATH}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('成功响应是 { ok:true, data, traceId }，且响应头带同名 traceId', async () => {
    const response = await fetch(`${baseUrl}/probe/ok`);
    const body = (await response.json()) as {
      ok: boolean;
      data: unknown;
      traceId: string;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ pong: true, 鸭: '可达' });
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get(TRACE_HEADER)).toBe(body.traceId);
  });

  it('客户端传入的 traceId 被透传（便于跨端串联链路）', async () => {
    const provided = 'client-trace-0001';
    const response = await fetch(`${baseUrl}/probe/ok`, {
      headers: { [TRACE_HEADER]: provided },
    });
    const body = (await response.json()) as { traceId: string };

    expect(body.traceId).toBe(provided);
    expect(response.headers.get(TRACE_HEADER)).toBe(provided);
  });

  it('非法 traceId 被忽略并生成新的（防响应头注入）', async () => {
    const response = await fetch(`${baseUrl}/probe/ok`, {
      headers: { [TRACE_HEADER]: 'bad value with spaces' },
    });
    const body = (await response.json()) as { traceId: string };

    expect(body.traceId).not.toBe('bad value with spaces');
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('业务错误是 { ok:false, error:{code}, traceId } 且 HTTP 状态码对应', async () => {
    const response = await fetch(`${baseUrl}/probe/boom`);
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; message: string };
      traceId: string;
    };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('探针资源不存在');
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('未预期异常兜底 INTERNAL，且不把内部细节泄漏出去', async () => {
    const response = await fetch(`${baseUrl}/probe/crash`);
    const raw = await response.text();

    expect(response.status).toBe(500);
    expect(raw).toContain('INTERNAL');
    expect(raw).not.toContain('hunter2');
  });

  it('全局前缀 api/v1 生效：不带前缀的路径 404', async () => {
    const response = await fetch(`http://127.0.0.1:${new URL(baseUrl).port}/probe/ok`);
    expect(response.status).toBe(404);
  });
});
