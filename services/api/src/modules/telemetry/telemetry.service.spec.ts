import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestContext } from '../../common/context/request-context';
import {
  CLIENT_EVENT_KINDS,
  CLIENT_EVENT_LIMITS,
  CLIENT_EVENT_RATE_LIMIT,
  SlidingWindowLimiter,
  normalizeClientEvent,
  normalizeKind,
  redactSecrets,
  truncate,
} from './domain/telemetry.domain';
import { TelemetryService } from './telemetry.service';
import type { NormalizedClientEvent } from './domain/telemetry.domain';
import type { TelemetryRepository } from './data/telemetry.repository';

/**
 * 遥测测试。
 *
 * 这一层要守住的不是"能写进去"，而是三条**出错时不会报错、只会静默坏掉**的性质：
 *   1. 脱敏（token / 邮箱 / 手机号）—— 漏一个就是把凭据写进数据库；
 *   2. 落库失败不能变成客户端可见的错误（否则遥测自己成了故障源）；
 *   3. 限流真的生效，但不会误伤正常量级。
 */

function makeRepo(): TelemetryRepository & { save: ReturnType<typeof vi.fn> } {
  return { save: vi.fn().mockResolvedValue(undefined) };
}

/** 把服务放进一个带 ip / userId 的请求上下文里执行（模拟中间件已注入） */
function withContext<T>(
  context: { ip?: string; userId?: string; ua?: string },
  run: () => Promise<T>,
): Promise<T> {
  return requestContext.run({ traceId: 'trace-test', ...context }, run);
}

describe('redactSecrets（脱敏是这份代码最重要的性质）', () => {
  it('抹掉 Authorization Bearer 里的 token', () => {
    const raw = 'Request failed: Authorization: Bearer abc123DEF456ghi789';
    expect(redactSecrets(raw)).not.toContain('abc123DEF456ghi789');
    expect(redactSecrets(raw)).toContain('Bearer <redacted>');
  });

  it('抹掉裸 JWT 与 JSON 里的 accessToken / refreshToken', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.abcdefgh';
    expect(redactSecrets(`token=${jwt}`)).not.toContain(jwt);
    expect(redactSecrets('{"accessToken":"super-secret-value"}')).not.toContain(
      'super-secret-value',
    );
    expect(redactSecrets('refresh_token: another-secret-value')).not.toContain(
      'another-secret-value',
    );
  });

  it('抹掉密码', () => {
    expect(redactSecrets('{"password":"hunter2xyz"}')).not.toContain('hunter2xyz');
  });

  it('抹掉邮箱与手机号（遥测里不该出现能定位到人的标识）', () => {
    const raw = 'demo@kedaya.dev 在 13800138000 附近崩溃';
    const out = redactSecrets(raw);
    expect(out).not.toContain('demo@kedaya.dev');
    expect(out).not.toContain('13800138000');
  });

  it('普通文本原样保留（别把日志脱敏成看不懂）', () => {
    expect(redactSecrets('undefined is not a function at addToCart')).toBe(
      'undefined is not a function at addToCart',
    );
  });
});

describe('truncate / normalizeKind', () => {
  it('按码点截断，不把代理对切成半个 emoji', () => {
    expect(truncate('可达鸭🦆🦆🦆', 4)).toBe('可达鸭🦆…');
  });

  it('未知 kind 归为 error 而不是丢弃（客户端版本总是先于服务端上线）', () => {
    expect(normalizeKind('brand-new-kind-from-v2')).toBe('error');
    expect(normalizeKind('render-error')).toBe('render-error');
  });

  it('白名单里每个 kind 都能原样通过', () => {
    for (const kind of CLIENT_EVENT_KINDS) expect(normalizeKind(kind)).toBe(kind);
  });
});

describe('normalizeClientEvent', () => {
  it('超长 message 被截断而不是让整条丢掉', () => {
    const event = normalizeClientEvent({ kind: 'error', message: 'x'.repeat(2000) });
    expect([...(event.message ?? '')].length).toBeLessThanOrEqual(CLIENT_EVENT_LIMITS.message + 1);
    expect(event.message.endsWith('…')).toBe(true);
  });

  it('context 只留标量，嵌套对象与数组被丢弃，键数有上限', () => {
    const event = normalizeClientEvent({
      kind: 'error',
      message: 'boom',
      context: {
        pageNo: 2,
        ok: false,
        note: null,
        nested: { a: 1 },
        list: [1, 2, 3],
        ...Object.fromEntries(
          Array.from({ length: 30 }, (_, index) => [`k${String(index)}`, index]),
        ),
      },
    });
    expect(Object.keys(event.context ?? {}).length).toBeLessThanOrEqual(
      CLIENT_EVENT_LIMITS.contextKeys,
    );
    expect(event.context).not.toHaveProperty('nested');
    expect(event.context).not.toHaveProperty('list');
  });

  it('context 里没有可留的键时为 null（不写空对象）', () => {
    expect(normalizeClientEvent({ kind: 'error', message: 'x', context: {} }).context).toBeNull();
  });

  it('context 的字符串值同样脱敏', () => {
    const event = normalizeClientEvent({
      kind: 'error',
      message: 'x',
      context: { auth: 'Bearer leaked-token-value-123456' },
    });
    expect(JSON.stringify(event.context)).not.toContain('leaked-token-value-123456');
  });
});

describe('SlidingWindowLimiter', () => {
  it('窗口内超过上限即拒绝，窗口滑过后恢复', () => {
    const limiter = new SlidingWindowLimiter(1000, 3);
    expect(limiter.tryAcquire('ip-1', 0)).toBe(true);
    expect(limiter.tryAcquire('ip-1', 10)).toBe(true);
    expect(limiter.tryAcquire('ip-1', 20)).toBe(true);
    expect(limiter.tryAcquire('ip-1', 30)).toBe(false);
    // 1000ms 后第一条已过期 → 又能过一条
    expect(limiter.tryAcquire('ip-1', 1001)).toBe(true);
  });

  it('按来源隔离：邻居被限流不影响我', () => {
    const limiter = new SlidingWindowLimiter(1000, 1);
    expect(limiter.tryAcquire('ip-1', 0)).toBe(true);
    expect(limiter.tryAcquire('ip-1', 1)).toBe(false);
    expect(limiter.tryAcquire('ip-2', 1)).toBe(true);
  });

  it('sweep 清掉过期键，避免 Map 随来源数无限增长', () => {
    const limiter = new SlidingWindowLimiter(1000, 1);
    limiter.tryAcquire('ip-1', 0);
    limiter.tryAcquire('ip-2', 0);
    expect(limiter.size).toBe(2);
    limiter.sweep(5000);
    expect(limiter.size).toBe(0);
  });
});

describe('TelemetryService.accept', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: TelemetryService;

  beforeEach(() => {
    repo = makeRepo();
    service = new TelemetryService(repo);
  });

  it('正常上报：受理、落库、并把 userId / ip / ua 一起记下', async () => {
    const result = await withContext({ ip: '10.0.0.1', userId: 'user-A', ua: 'weapp/1.0' }, () =>
      service.accept({ kind: 'error', message: 'Cannot read property x', route: 'pages/a' }),
    );

    expect(result).toEqual({ accepted: true });
    expect(repo.save).toHaveBeenCalledTimes(1);
    const [event, meta] = repo.save.mock.calls[0] as [
      NormalizedClientEvent,
      { userId: string | null; ip: string | null; userAgent: string | null },
    ];
    expect(event.kind).toBe('error');
    expect(meta).toEqual({ userId: 'user-A', ip: '10.0.0.1', userAgent: 'weapp/1.0' });
  });

  it('未登录也能上报（崩溃常在登录前）', async () => {
    await withContext({}, () => service.accept({ kind: 'error', message: 'boom' }));
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('落库失败**不抛错**且仍返回受理（遥测不得成为故障源）', async () => {
    repo.save.mockRejectedValue(new Error('connection terminated'));

    const result = await withContext({ ip: '10.0.0.2' }, () =>
      service.accept({ kind: 'api-failure', message: 'GET /forum/posts → 500' }),
    );

    expect(result).toEqual({ accepted: true });
  });

  it('超过窗口上限后拒绝，且不再写库', async () => {
    const context = { ip: '10.0.0.9' };
    for (let index = 0; index < CLIENT_EVENT_RATE_LIMIT.max; index += 1) {
      const result = await withContext(context, () => service.accept({ kind: 'error', message: 'x' }));
      expect(result.accepted).toBe(true);
    }

    const rejected = await withContext(context, () =>
      service.accept({ kind: 'error', message: 'x' }),
    );
    expect(rejected).toEqual({ accepted: false });
    expect(repo.save).toHaveBeenCalledTimes(CLIENT_EVENT_RATE_LIMIT.max);
  });

  it('没有请求上下文（理论上不该发生）时不崩，ip 落 null', async () => {
    const result = await service.accept({ kind: 'error', message: 'boom' });
    expect(result).toEqual({ accepted: true });
    const [, meta] = repo.save.mock.calls[0] as [unknown, { ip: string | null }];
    expect(meta.ip).toBeNull();
  });

  it('入库的是脱敏后的内容（端到端串一遍，防止只测了纯函数）', async () => {
    await withContext({ ip: '10.0.0.3' }, () =>
      service.accept({
        kind: 'api-failure',
        message: 'POST /auth/account/login failed with {"accessToken":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.abcdefgh"}',
        stack: 'Error: 401\n  at request (Authorization: Bearer zzz-secret-zzz)',
      }),
    );

    const [event] = repo.save.mock.calls[0] as [NormalizedClientEvent];
    expect(event.message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(event.stack).not.toContain('zzz-secret-zzz');
  });
});
