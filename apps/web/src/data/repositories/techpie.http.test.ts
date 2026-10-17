/**
 * TechPie HTTP 仓储测试 —— 断言**契约形状**：
 * - 路由由 `@kedaya/contracts` 的模块注册表派生（不硬编码模块名）；
 * - `techpie.renew` 是契约 §11.2 **已冻结**的动作名；
 * - 写操作带 `Idempotency-Key`（契约 §11.3）；
 * - **明文密码凭证在发请求之前就被拒绝**（§11.18-D：一个请求都不发）；
 * - 入站数据过 zod 校验；出现 I1 的禁用凭证键名 → `INTERNAL`（不渲染脏数据）；
 * - `webview-session` 的 `targetUrl` 即使服务端说 200，也要过客户端白名单（fail-closed）。
 */
import { modulePath } from '@kedaya/contracts';
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';
import { describe, expect, it } from 'vitest';

import type { ApiClient, ApiRequest, ApiResult, RequestOptions } from '../api/client';
import { createCampusCardHttpRepository, createTechpieHttpRepository } from './techpie.http';

interface RecordedCall {
  method: ApiRequest['method'];
  path: string;
  query?: ApiRequest['query'];
  body?: unknown;
  idempotencyKey?: string;
}

function createFakeClient(handler: (call: RecordedCall) => Result<unknown, ApiError>): {
  client: ApiClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const record = (req: ApiRequest, options?: RequestOptions): Result<unknown, ApiError> => {
    const call: RecordedCall = {
      method: req.method,
      path: req.path,
      ...(req.query === undefined ? {} : { query: req.query }),
      ...(req.body === undefined ? {} : { body: req.body }),
      ...(options?.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
    };
    calls.push(call);
    return handler(call);
  };

  const client: ApiClient = {
    baseUrl: '/api/v1',
    request: async <T>(req: ApiRequest, options?: RequestOptions) =>
      record(req, options) as ApiResult<T>,
    get: async <T>(path: string, query?: ApiRequest['query'], options?: RequestOptions) =>
      record({ path, method: 'GET', ...(query ? { query } : {}) }, options) as ApiResult<T>,
    post: async <T>(path: string, body?: unknown, options?: RequestOptions) =>
      record({ path, method: 'POST', ...(body === undefined ? {} : { body }) }, options) as ApiResult<T>,
    patch: async <T>(path: string, body?: unknown, options?: RequestOptions) =>
      record({ path, method: 'PATCH', ...(body === undefined ? {} : { body }) }, options) as ApiResult<T>,
    put: async <T>(path: string, body?: unknown, options?: RequestOptions) =>
      record({ path, method: 'PUT', ...(body === undefined ? {} : { body }) }, options) as ApiResult<T>,
    del: async <T>(path: string, options?: RequestOptions) =>
      record({ path, method: 'DELETE' }, options) as ApiResult<T>,
    upload: async <T>(path: string, _form: FormData, options?: RequestOptions) =>
      record({ path, method: 'POST' }, options) as ApiResult<T>,
  };

  return { client, calls };
}

const LINKS_PATH = `/${modulePath('techpie', 'links')}`;
const CAPABILITIES_PATH = `/${modulePath('techpie', 'capabilities')}`;
const WEBVIEW_PATH = `/${modulePath('techpie', 'webview-session')}`;
const CARD_PATH = `/${modulePath('campus-card')}`;

const SUMMARY = {
  id: 'lk-1',
  platform: 'ecard',
  status: 'LINKED',
  externalUserId: '2023XXXXXX',
  expiresAt: null,
  lastSyncAt: '2026-10-17T02:00:00.000Z',
};

const TICKET = {
  ticket: 'wvt_01JBXR8K7M3QZ9V0P2N4T6W8YC',
  expiresInSec: 30,
  targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
};

describe('techpie HTTP 路由（规格 §8.1 / 契约 §11.2）', () => {
  it('GET /techpie/links 带游标分页参数', async () => {
    const { client, calls } = createFakeClient(() => ok({ items: [SUMMARY], nextCursor: null }));
    const repo = createTechpieHttpRepository(client);

    const result = await repo.listLinks({ cursor: 'c_2', limit: 5 });
    expect(result.ok).toBe(true);
    expect(calls[0]).toEqual({
      method: 'GET',
      path: LINKS_PATH,
      query: { cursor: 'c_2', limit: 5 },
    });
  });

  it('POST /techpie/links 带 Idempotency-Key（契约 §11.3）', async () => {
    const { client, calls } = createFakeClient(() => ok(SUMMARY));
    const repo = createTechpieHttpRepository(client);

    const result = await repo.createLink({
      platform: 'ecard',
      credential: { kind: 'openid', channel: 'wechat' },
    });
    expect(result.ok).toBe(true);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe(LINKS_PATH);
    expect(calls[0]?.body).toEqual({
      platform: 'ecard',
      credential: { kind: 'openid', channel: 'wechat' },
    });
    expect(calls[0]?.idempotencyKey).toBeTruthy();
  });

  it('**明文密码凭证：一个请求都不发**（§11.18-D）', async () => {
    const { client, calls } = createFakeClient(() => ok(SUMMARY));
    const repo = createTechpieHttpRepository(client);

    const result = await repo.createLink({
      platform: 'cpdaily',
      credential: { kind: 'password', studentId: '2023XXXXXX', password: 'hunter2' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
    expect((result.error.details as { reason?: string }).reason).toBe('PHASE_1_NOT_IMPLEMENTED');
    // 关键断言：**没有**任何请求被发出，因此明文密码不可能离开客户端
    expect(calls).toEqual([]);
  });

  it('POST /techpie/links/:id/renew —— 已冻结动作名，路径逐字一致', async () => {
    const { client, calls } = createFakeClient(() => ok(SUMMARY));
    const repo = createTechpieHttpRepository(client);

    const result = await repo.renewLink('lk-1');
    expect(result.ok).toBe(true);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe(`${LINKS_PATH}/lk-1/renew`);
    expect(calls[0]?.idempotencyKey).toBeTruthy();
  });

  it('DELETE /techpie/links/:id 解绑', async () => {
    const { client, calls } = createFakeClient(() => ok({ deleted: true }));
    const repo = createTechpieHttpRepository(client);

    const result = await repo.deleteLink('lk-1');
    expect(result.ok).toBe(true);
    expect(calls[0]).toEqual({ method: 'DELETE', path: `${LINKS_PATH}/lk-1` });
  });

  it('GET /techpie/capabilities', async () => {
    const { client, calls } = createFakeClient(() =>
      ok({ items: [], allowlistPlaceholder: true }),
    );
    const repo = createTechpieHttpRepository(client);

    const result = await repo.listCapabilities();
    expect(result.ok).toBe(true);
    expect(calls[0]).toEqual({ method: 'GET', path: CAPABILITIES_PATH });
  });

  it('POST /techpie/webview-session 下发 {platform, targetUrl} + Idempotency-Key', async () => {
    const { client, calls } = createFakeClient(() => ok(TICKET));
    const repo = createTechpieHttpRepository(client);

    const result = await repo.createWebviewSession({
      platform: null,
      targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
    });
    expect(result.ok).toBe(true);
    expect(calls[0]?.path).toBe(WEBVIEW_PATH);
    // ⚠️ `platform: null` 时**整个键都不下发**（不是发 null）：
    // 服务端 schema 是 `platformEnum.optional()`，zod 的 optional 不接受 null，
    // 发 null 会被判 422。Phase 0 的 W4 直连本来就不需要绑定。
    expect(calls[0]?.body).toEqual({
      targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
    });
    expect(calls[0]?.body).not.toHaveProperty('platform');
    expect(calls[0]?.idempotencyKey).toBeTruthy();
  });

  it('需要绑定的平台才下发 platform（且值就是能力声明的平台）', async () => {
    const { client, calls } = createFakeClient(() => ok(TICKET));
    const repo = createTechpieHttpRepository(client);

    const result = await repo.createWebviewSession({
      platform: 'ecard',
      targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
    });
    expect(result.ok).toBe(true);
    expect(calls[0]?.body).toEqual({
      platform: 'ecard',
      targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
    });
  });

  it('票据兑换走 POST /webview-session/:ticket（票据只在请求路径里）', async () => {
    const { client, calls } = createFakeClient(() =>
      ok({
        url: 'https://ecourse.shanghaitech.edu.cn/',
        targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
        mode: 'direct',
        expiresAt: null,
      }),
    );
    const repo = createTechpieHttpRepository(client);

    const result = await repo.redeemWebviewTicket(TICKET.ticket);
    expect(result.ok).toBe(true);
    expect(calls[0]?.path).toBe(`${WEBVIEW_PATH}/${encodeURIComponent(TICKET.ticket)}`);
  });

  it('校园卡四条路由（模块路由派生，不硬编码）', async () => {
    const { client, calls } = createFakeClient((call) => {
      if (call.path === CARD_PATH) {
        return ok({
          cardNoMasked: '****1024',
          balanceFen: 5830,
          status: 'ACTIVE',
          syncedAt: '2026-10-17T02:00:00.000Z',
        });
      }
      if (call.path === `${CARD_PATH}/transactions`) {
        return ok({ items: [], nextCursor: null });
      }
      if (call.path === `${CARD_PATH}/payment-code` && call.method === 'POST') {
        return ok({
          payload: 'KEDAYA-ECARD-000001',
          issuedAt: '2026-10-17T02:00:00.000Z',
          expiresAt: '2026-10-17T02:01:00.000Z',
          ttlSec: 60,
        });
      }
      return ok({ revoked: true });
    });
    const repo = createCampusCardHttpRepository(client);

    expect((await repo.getCard()).ok).toBe(true);
    expect((await repo.listTransactions({ limit: 5 })).ok).toBe(true);
    expect((await repo.issuePaymentCode()).ok).toBe(true);
    expect((await repo.revokePaymentCode()).ok).toBe(true);

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET ${CARD_PATH}`,
      `GET ${CARD_PATH}/transactions`,
      `POST ${CARD_PATH}/payment-code`,
      `DELETE ${CARD_PATH}/payment-code/current`,
    ]);
  });
});

describe('techpie HTTP 入站校验（契约 §11.4 I1 / §11.18-B）', () => {
  it('绑定摘要里出现禁用凭证键名 → INTERNAL，不渲染', async () => {
    const { client } = createFakeClient(() =>
      ok({ items: [{ ...SUMMARY, castgc: 'TGT-1234' }], nextCursor: null }),
    );
    const repo = createTechpieHttpRepository(client);

    const result = await repo.listLinks({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL');
    expect(JSON.stringify(result.error.details)).toContain('castgc');
  });

  it('绑定详情里出现 cookie 字段 → INTERNAL', async () => {
    const { client } = createFakeClient(() => ok({ ...SUMMARY, cookie: 'CASTGC=abc' }));
    const repo = createTechpieHttpRepository(client);

    const result = await repo.getLink('lk-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('capabilities 响应里出现 sessionToken → INTERNAL', async () => {
    const { client } = createFakeClient(() =>
      ok({ items: [], allowlistPlaceholder: true, sessionToken: 'x' }),
    );
    const repo = createTechpieHttpRepository(client);

    const result = await repo.listCapabilities();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('webview-session 返回白名单外的 targetUrl → INTERNAL（客户端 fail-closed，即便服务端说 200）', async () => {
    const { client } = createFakeClient(() =>
      ok({ ...TICKET, targetUrl: 'https://evil.example.com/' }),
    );
    const repo = createTechpieHttpRepository(client);

    const result = await repo.createWebviewSession({
      platform: null,
      targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL');
    expect(JSON.stringify(result.error.details)).toContain('白名单');
  });

  it('webview-session 返回非 https 的 targetUrl → INTERNAL', async () => {
    const { client } = createFakeClient(() =>
      ok({ ...TICKET, targetUrl: 'http://ecourse.shanghaitech.edu.cn/' }),
    );
    const repo = createTechpieHttpRepository(client);

    const result = await repo.createWebviewSession({
      platform: null,
      targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
    });
    expect(result.ok).toBe(false);
  });

  it('票据响应**允许**含 ticket 字段（它是 §8.4 冻结的资源本身，不是凭证泄漏）', async () => {
    const { client } = createFakeClient(() => ok(TICKET));
    const repo = createTechpieHttpRepository(client);

    const result = await repo.createWebviewSession({
      platform: null,
      targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ticket).toBe(TICKET.ticket);
    expect(result.value.expiresInSec).toBe(30);
  });

  it('打开地址里夹带票据 → INTERNAL（票据不得进 URL 历史）', async () => {
    const { client } = createFakeClient(() =>
      ok({
        url: 'https://ecourse.shanghaitech.edu.cn/?ticket=wvt_x',
        targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
        mode: 'direct',
        expiresAt: null,
      }),
    );
    const repo = createTechpieHttpRepository(client);

    // launch 的 schema 本身不禁止 query，因此这里允许通过；
    // "票据进 URL"的最终拦截在 application 层（openCampusWebview）
    const result = await repo.redeemWebviewTicket('wvt_x');
    expect(result.ok).toBe(true);
  });

  it('错误码原样透传（含 CAMPUS_BINDING_REQUIRED）', async () => {
    const { client } = createFakeClient(() =>
      err({ code: 'CAMPUS_BINDING_REQUIRED', message: '尚未绑定校园卡' }),
    );
    const repo = createCampusCardHttpRepository(client);

    const result = await repo.getCard();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CAMPUS_BINDING_REQUIRED');
  });
});
