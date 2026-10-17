import { describe, expect, it } from 'vitest';
import { lastValueFrom, of, type Observable } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { failure } from '@kedaya/contracts';
import { EnvelopeInterceptor } from './envelope.interceptor';
import { requestContext } from '../context/request-context';

/** 构造一个只返回固定值的 CallHandler */
function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) as Observable<unknown> };
}

/** 在带 traceId 的请求上下文里跑拦截器（拦截器从 AsyncLocalStorage 读 traceId） */
function runWithTrace<T>(traceId: string, fn: () => Promise<T>): Promise<T> {
  return requestContext.run({ traceId }, fn);
}

describe('EnvelopeInterceptor（契约 §6.1 统一响应信封）', () => {
  const interceptor = new EnvelopeInterceptor();

  it('把普通返回值包装成 { ok: true, data, traceId }', async () => {
    const result = await runWithTrace('trace-abc-123', () =>
      lastValueFrom(
        interceptor.intercept({} as ExecutionContext, handlerReturning({ hello: '可达鸭' })),
      ),
    );

    expect(result).toEqual({ ok: true, data: { hello: '可达鸭' }, traceId: 'trace-abc-123' });
  });

  it('undefined 收敛成 data: null（DELETE 之类无返回体的处理器）', async () => {
    const result = await runWithTrace('trace-del', () =>
      lastValueFrom(interceptor.intercept({} as ExecutionContext, handlerReturning(undefined))),
    );

    expect(result).toEqual({ ok: true, data: null, traceId: 'trace-del' });
  });

  it('已经是成功信封时原样透传，不二次包装', async () => {
    const existing = { ok: true as const, data: { nested: true }, traceId: 'inner-trace' };
    const result = await runWithTrace('outer-trace', () =>
      lastValueFrom(interceptor.intercept({} as ExecutionContext, handlerReturning(existing))),
    );

    expect(result).toBe(existing);
  });

  it('已经是失败信封时也透传（不把它包成成功）', async () => {
    const existing = failure('NOT_FOUND', '没有', 'inner-trace');
    const result = await runWithTrace('outer-trace', () =>
      lastValueFrom(interceptor.intercept({} as ExecutionContext, handlerReturning(existing))),
    );

    expect(result).toBe(existing);
    expect(result.ok).toBe(false);
  });

  it('traceId 来自请求上下文，而不是硬编码', async () => {
    const a = await runWithTrace('trace-A', () =>
      lastValueFrom(interceptor.intercept({} as ExecutionContext, handlerReturning(1))),
    );
    const b = await runWithTrace('trace-B', () =>
      lastValueFrom(interceptor.intercept({} as ExecutionContext, handlerReturning(1))),
    );

    expect(a.traceId).toBe('trace-A');
    expect(b.traceId).toBe('trace-B');
  });
});
