import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { createEdgeTokenMiddleware, EDGE_TOKEN_HEADER } from './edge-token.middleware';

/**
 * 边缘令牌中间件。
 *
 * 这个中间件有个"安全的默认"必须由测试锁住：
 * **未配置令牌时完全放行** —— 否则忘配一个环境变量就会把自己锁在门外。
 */
function makeRes() {
  // ⚠️ `status()` 必须返回**同一个**带 `json` 的对象 —— 否则链式
  // `res.status(401).json(...)` 会在 `.json` 处炸。第一版这里写成返回新对象，
  // 测试就在 `res.status(...).json is not a function` 上红了。
  const raw = { statusCode: 0, body: undefined as unknown };
  const res = {
    status: (code: number) => {
      raw.statusCode = code;
      return res as unknown as Response;
    },
    json: (body: unknown) => {
      raw.body = body;
      return res as unknown as Response;
    },
  };
  return { res: res as unknown as Response, raw };
}

function makeReq(path: string, token?: string, authorization?: string): Request {
  return {
    path,
    header: (name: string) => {
      const key = name.toLowerCase();
      if (key === EDGE_TOKEN_HEADER) return token;
      if (key === 'authorization') return authorization;
      return undefined;
    },
  } as unknown as Request;
}

describe('createEdgeTokenMiddleware', () => {
  it('⚠️ 未配置令牌 → 完全放行（忘配不能把自己锁死）', () => {
    const mw = createEdgeTokenMiddleware(undefined);
    const next = vi.fn() as unknown as NextFunction;
    const { res, raw } = makeRes();
    mw(makeReq('/api/v1/modules'), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(raw.statusCode).toBe(0); // 从没写过状态码

  });

  it('空字符串同样视为未配置', () => {
    const mw = createEdgeTokenMiddleware('   ');
    const next = vi.fn() as unknown as NextFunction;
    mw(makeReq('/api/v1/modules'), makeRes().res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('配置后：带对的令牌放行', () => {
    const mw = createEdgeTokenMiddleware('s3cret');
    const next = vi.fn() as unknown as NextFunction;
    mw(makeReq('/api/v1/modules', 's3cret'), makeRes().res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('配置后：不带令牌 / 带错令牌 → 401', () => {
    const mw = createEdgeTokenMiddleware('s3cret');
    for (const token of [undefined, 'wrong', 's3cres', 's3crett']) {
      const next = vi.fn() as unknown as NextFunction;
      const { res, raw } = makeRes();
      mw(makeReq('/api/v1/modules', token), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(raw.statusCode).toBe(401);
      expect(raw.body).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    }
  });

  it('⚠️ 只配登录口、没配共享令牌 → 闸门**仍然启用**（首次部署踩的坑）', () => {
    // 服务器上配了 EDGE_USERNAME/EDGE_PASSWORD（登录口可用）但没配 API_EDGE_TOKEN，
    // 旧实现走"未配置 → 放行"，结果**登录口存在、闸门却没关**，无票访问照样 200。
    const verify = () => false;
    const mw = createEdgeTokenMiddleware(undefined, verify);
    const next = vi.fn() as unknown as NextFunction;
    const { res, raw } = makeRes();
    mw(makeReq('/api/v1/modules'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(raw.statusCode).toBe(401);
  });

  it('登录口 + 有效 Bearer 票 → 放行', () => {
    const mw = createEdgeTokenMiddleware(undefined, (token) => token === 'good');
    const next = vi.fn() as unknown as NextFunction;
    mw(makeReq('/api/v1/modules', undefined, 'Bearer good'), makeRes().res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('登录口 + 无效 Bearer 票 → 401', () => {
    const mw = createEdgeTokenMiddleware(undefined, (token) => token === 'good');
    const next = vi.fn() as unknown as NextFunction;
    const { res, raw } = makeRes();
    mw(makeReq('/api/v1/modules', undefined, 'Bearer bad'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(raw.statusCode).toBe(401);
  });

  it('登录口本身豁免（否则没人能拿到第一张票）', () => {
    const mw = createEdgeTokenMiddleware(undefined, () => false);
    const next = vi.fn() as unknown as NextFunction;
    mw(makeReq('/api/v1/edge/login'), makeRes().res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('⚠️ /health 永远豁免（探针不会带我们的头）', () => {
    const mw = createEdgeTokenMiddleware('s3cret');
    const next = vi.fn() as unknown as NextFunction;
    mw(makeReq('/health'), makeRes().res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('401 的响应体不区分「没带」与「带错」（减少信息泄漏）', () => {
    const mw = createEdgeTokenMiddleware('s3cret');
    const bodies: unknown[] = [];
    for (const token of [undefined, 'wrong']) {
      const { res, raw } = makeRes();
      mw(makeReq('/api/v1/modules', token), res, vi.fn() as unknown as NextFunction);
      bodies.push(raw.body);
    }
    expect(bodies[0]).toEqual(bodies[1]);
  });
});
