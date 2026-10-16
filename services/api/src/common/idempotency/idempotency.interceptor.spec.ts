import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { IDEMPOTENCY_HEADER } from '@kedaya/contracts';
import { lastValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { requestContext } from '../context/request-context';
import { ConflictError, ValidationError } from '../errors/app-error';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyStore, idempotencyScope } from './idempotency.store';

/**
 * 契约 §11.3 的验收测试：
 *   POST 缺 `Idempotency-Key` → VALIDATION_FAILED；
 *   同 key 重试 → 回放首次结果，**不重复执行**副作用；
 *   同 key 并发 → CONFLICT；
 *   失败请求不缓存（重试能重新执行）。
 */

const URL_PATH = '/api/v1/forum/items';

function makeContext(
  method: string,
  headers: Record<string, string | undefined> = {},
  url = URL_PATH,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, headers, originalUrl: url }),
    }),
  } as unknown as ExecutionContext;
}

function makeNext(value: unknown): CallHandler {
  return { handle: () => of(value) } as unknown as CallHandler;
}

describe('IdempotencyInterceptor（契约 §11.3）', () => {
  let store: IdempotencyStore;
  let interceptor: IdempotencyInterceptor;

  beforeEach(() => {
    store = new IdempotencyStore();
    interceptor = new IdempotencyInterceptor(store);
  });

  it('GET 不需要 Idempotency-Key，直接放行', async () => {
    const result = await lastValueFrom(interceptor.intercept(makeContext('GET'), makeNext({ ok: 1 })));
    expect(result).toEqual({ ok: 1 });
    expect(store.size()).toBe(0);
  });

  it('PATCH / DELETE 是可选幂等，缺头也放行', async () => {
    for (const method of ['PATCH', 'DELETE']) {
      const result = await lastValueFrom(interceptor.intercept(makeContext(method), makeNext({ method })));
      expect(result).toEqual({ method });
    }
  });

  it('POST 缺少 Idempotency-Key → VALIDATION_FAILED（契约 §11.3 硬性要求）', async () => {
    const error = await lastValueFrom(interceptor.intercept(makeContext('POST'), makeNext({}))).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe('VALIDATION_FAILED');
    expect((error as ValidationError).details).toEqual({ header: IDEMPOTENCY_HEADER });
    expect(store.size()).toBe(0);
  });

  it('同一 key 的第二次请求回放首次结果（不重复执行处理器）', async () => {
    const headers = { [IDEMPOTENCY_HEADER]: 'key-1' };

    const first = await lastValueFrom(interceptor.intercept(makeContext('POST', headers), makeNext({ id: 'p1' })));
    const second = await lastValueFrom(interceptor.intercept(makeContext('POST', headers), makeNext({ id: 'p2' })));

    expect(first).toEqual({ id: 'p1' });
    expect(second).toEqual({ id: 'p1' }); // 回放首次结果，而不是 p2
    expect(store.size()).toBe(1);
  });

  it('换一个 key 会真正重新执行', async () => {
    const first = await lastValueFrom(
      interceptor.intercept(makeContext('POST', { [IDEMPOTENCY_HEADER]: 'key-a' }), makeNext({ id: 'a' })),
    );
    const second = await lastValueFrom(
      interceptor.intercept(makeContext('POST', { [IDEMPOTENCY_HEADER]: 'key-b' }), makeNext({ id: 'b' })),
    );

    expect(first).toEqual({ id: 'a' });
    expect(second).toEqual({ id: 'b' });
    expect(store.size()).toBe(2);
  });

  it('同 key 并发（in-flight）→ CONFLICT，不静默双写', async () => {
    const headers = { [IDEMPOTENCY_HEADER]: 'key-race' };
    // 模拟"第一个请求还在处理中"：手动占位
    store.begin(idempotencyScope({ actorId: undefined, method: 'POST', path: URL_PATH, key: 'key-race' }));

    await expect(lastValueFrom(interceptor.intercept(makeContext('POST', headers), makeNext({})))).rejects.toThrow(
      ConflictError,
    );
  });

  it('处理器抛错时不缓存，重试可以重新执行', async () => {
    const headers = { [IDEMPOTENCY_HEADER]: 'key-fail' };
    const failing: CallHandler = { handle: () => throwError(() => new Error('上游抖动')) } as unknown as CallHandler;

    await expect(lastValueFrom(interceptor.intercept(makeContext('POST', headers), failing))).rejects.toThrow(
      '上游抖动',
    );
    expect(store.size()).toBe(0);

    const retry = await lastValueFrom(interceptor.intercept(makeContext('POST', headers), makeNext({ id: 'ok' })));
    expect(retry).toEqual({ id: 'ok' });
  });

  it('幂等作用域绑定主体：不同用户的同名 key 互不串号', async () => {
    const headers = { [IDEMPOTENCY_HEADER]: 'shared-key' };

    const asUserA = await requestContext.run({ traceId: 't-a', userId: 'user-A' }, () =>
      lastValueFrom(interceptor.intercept(makeContext('POST', headers), makeNext({ owner: 'A' }))),
    );
    const asUserB = await requestContext.run({ traceId: 't-b', userId: 'user-B' }, () =>
      lastValueFrom(interceptor.intercept(makeContext('POST', headers), makeNext({ owner: 'B' }))),
    );

    expect(asUserA).toEqual({ owner: 'A' });
    expect(asUserB).toEqual({ owner: 'B' }); // 没有拿到 A 的响应
    expect(store.size()).toBe(2);
  });

  it('路径不同即作用域不同（/items 与 /items/x/report 不互相回放）', async () => {
    const headers = { [IDEMPOTENCY_HEADER]: 'k' };
    const created = await lastValueFrom(
      interceptor.intercept(makeContext('POST', headers, '/api/v1/forum/items'), makeNext({ route: 'create' })),
    );
    const reported = await lastValueFrom(
      interceptor.intercept(
        makeContext('POST', headers, '/api/v1/forum/items/x/report'),
        makeNext({ route: 'report' }),
      ),
    );

    expect(created).toEqual({ route: 'create' });
    expect(reported).toEqual({ route: 'report' });
  });

  it('空字符串 / 纯空白的 Idempotency-Key 视为缺失', async () => {
    for (const value of ['', '   ']) {
      const error = await lastValueFrom(
        interceptor.intercept(makeContext('POST', { [IDEMPOTENCY_HEADER]: value }), makeNext({})),
      ).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(ValidationError);
    }
  });

  it('请求头名大小写不敏感（Express 会把入站头名全部小写）', async () => {
    // 这个缺陷是真实 HTTP 用例抓出来的：只按 'Idempotency-Key' 原样取会永远取不到
    const lower = IDEMPOTENCY_HEADER.toLowerCase();
    const result = await lastValueFrom(
      interceptor.intercept(makeContext('POST', { [lower]: 'lower-key' }), makeNext({ id: 'ok' })),
    );

    expect(result).toEqual({ id: 'ok' });
    expect(store.size()).toBe(1);
  });

  it('数组形式的头（重复发送）取第一个值', async () => {
    const headers = { [IDEMPOTENCY_HEADER]: ['first-key', 'second-key'] } as unknown as Record<string, string>;
    const result = await lastValueFrom(interceptor.intercept(makeContext('POST', headers), makeNext({ id: 'ok' })));

    expect(result).toEqual({ id: 'ok' });
  });
});
