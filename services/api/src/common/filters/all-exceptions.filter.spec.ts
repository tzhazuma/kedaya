import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';
import { AllExceptionsFilter } from './all-exceptions.filter';
import {
  AppError,
  ConsentRequiredError,
  NotFoundError,
  UpstreamUnavailableError,
} from '../errors/app-error';
import { requestContext } from '../context/request-context';

interface Captured {
  status: number;
  body: unknown;
}

/** 造一个最小的 ArgumentsHost，把 status()/json() 的调用捕获下来 */
function makeHost(captured: Captured): ArgumentsHost {
  const response = {
    status(code: number) {
      captured.status = code;
      return {
        json(payload: unknown) {
          captured.body = payload;
        },
      };
    },
  } as unknown as Response;

  return {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
}

function catchWith(exception: unknown, traceId = 'trace-err-1'): Captured {
  const captured: Captured = { status: 0, body: undefined };
  const filter = new AllExceptionsFilter();
  const host = makeHost(captured);
  requestContext.run({ traceId }, () => filter.catch(exception, host));
  return captured;
}

describe('AllExceptionsFilter（契约 §6.1 失败信封 + 错误码）', () => {
  beforeEach(() => {
    // 过滤器会打日志，测试里静音以免污染输出
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('AppError 映射为对应错误码 + HTTP 状态码', () => {
    const captured = catchWith(new NotFoundError('拼单不存在'));
    expect(captured.status).toBe(404);
    expect(captured.body).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: '拼单不存在' },
      traceId: 'trace-err-1',
    });
  });

  it('CONSENT_REQUIRED 用 403，并把 module 放进 details', () => {
    const captured = catchWith(new ConsentRequiredError('wellbeing'));
    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({
      ok: false,
      error: { code: 'CONSENT_REQUIRED', details: { module: 'wellbeing' } },
    });
  });

  it('ZodError 映射为 VALIDATION_FAILED 并给出字段级 details', () => {
    const schema = z.object({ title: z.string().min(1), count: z.number().int() });
    const parsed = schema.safeParse({ title: '', count: 'nope' });
    expect(parsed.success).toBe(false);

    const captured = catchWith(parsed.error);
    expect(captured.status).toBe(400);

    const body = captured.body as {
      error: { code: string; details: Array<{ path: string }> };
    };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.map((issue) => issue.path).sort()).toEqual(['count', 'title']);
  });

  it('Prisma 已知错误码被翻译，不泄漏成 500', () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const captured = catchWith(p2002);
    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({ error: { code: 'CONFLICT' } });

    const p1001 = Object.assign(new Error('Cannot reach database'), { code: 'P1001' });
    expect(catchWith(p1001).body).toMatchObject({ error: { code: 'UPSTREAM_UNAVAILABLE' } });
  });

  it('未知异常兜底为 INTERNAL，且**不把原始 message 泄漏给客户端**', () => {
    const captured = catchWith(new Error('数据库密码是 hunter2'));
    expect(captured.status).toBe(500);
    expect(captured.body).toMatchObject({ error: { code: 'INTERNAL' } });
    expect(JSON.stringify(captured.body)).not.toContain('hunter2');
  });

  it('UPSTREAM_UNAVAILABLE 用 503', () => {
    const captured = catchWith(new UpstreamUnavailableError());
    expect(captured.status).toBe(503);
    expect(captured.body).toMatchObject({ error: { code: 'UPSTREAM_UNAVAILABLE' } });
  });

  it('保留 AppError 自定义状态码（可用于覆盖默认映射）', () => {
    const custom = new AppError('CONFLICT', '自定义', undefined, 418);
    expect(catchWith(custom).status).toBe(418);
  });
});
