import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { API_BASE_PATH, IDEMPOTENCY_HEADER } from '@kedaya/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { json, type NextFunction, type Request, type Response } from 'express';

import { signJwt } from '../src/common/auth/jwt';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { IdempotencyStore } from '../src/common/idempotency/idempotency.store';
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor';
import { TraceMiddleware } from '../src/common/middleware/trace.middleware';
import { ValidationError } from '../src/common/errors/app-error';
import { ActivitiesService } from '../src/modules/activities/application/activities.service';
import { ActivitiesController } from '../src/modules/activities/activities.controller';

/**
 * 活动 HTTP 路由验收：真实控制器 + 守卫 + 幂等拦截器 + 统一信封，
 * 只把 `ActivitiesService` 换成内存假实现。
 *
 * 钉死三件事：
 *   1. 用户端点必须登录；管理员派发只认 AdminGuard（外部 cron 可只带 x-admin-key）；
 *   2. 所有 POST 都必须带 Idempotency-Key（契约 §11.3）；
 *   3. 路由形状与共同契约一致（/activities/items、/imports/wechat、/reminders…）。
 */

const SECRET = process.env.JWT_SECRET ?? 'test-secret-please-change-me-32-chars';
const USER_ID = 'user-http';
const ITEM = {
  id: 'act-1',
  source: 'manual',
  kind: 'lecture',
  title: 'AI for Science',
  startsAt: '2026-11-25T10:00:00.000Z',
  endsAt: null,
  location: null,
  organizer: null,
  registrationDeadlineAt: null,
  registrationDeadlineRaw: null,
  registrationUrl: null,
  evidenceText: '',
  confidence: 1,
  status: 'confirmed',
  sourceUrl: null,
  sourceLabel: null,
  publishedAt: null,
  stale: false,
};

const service = {
  list: vi.fn(async () => ({ items: [ITEM] })),
  detail: vi.fn(async () => ITEM),
  createManual: vi.fn(async () => ITEM),
  update: vi.fn(async () => ITEM),
  confirm: vi.fn(async () => ITEM),
  dismiss: vi.fn(async () => ({ ...ITEM, status: 'dismissed' })),
  archive: vi.fn(async () => ({ ...ITEM, status: 'archived' })),
  restore: vi.fn(async () => ({ ...ITEM, status: 'candidate' })),
  importWechat: vi.fn(async () => ({ item: ITEM, items: [ITEM], created: 1, skipped: 0 })),
  importMail: vi.fn(async () => ({ item: ITEM, items: [ITEM], created: 1, skipped: 0 })),
  listReminders: vi.fn(async () => ({ items: [] })),
  createReminder: vi.fn(async () => ({
    id: 'rem-1',
    activityId: 'act-1',
    activityTitle: 'AI for Science',
    kind: 'custom',
    remindAt: '2026-11-24T00:00:00.000Z',
    channel: 'inapp',
    status: 'pending',
  })),
  deleteReminder: vi.fn(async (userId: string, id: string) => ({ id, deleted: true })),
  dispatchDue: vi.fn(async () => ({ claimed: 0, sent: 0, failed: 0, cancelled: 0, reclaimed: 0 })),
};

@Module({
  controllers: [ActivitiesController],
  providers: [
    IdempotencyStore,
    TraceMiddleware,
    { provide: ActivitiesService, useValue: service },
    { provide: ConfigService, useValue: { get: () => undefined } },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
class ActivitiesProbeModule {}

describe('HTTP 集成：/activities 路由 + 登录 + Idempotency + AdminGuard', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let token: string;
  const previousAdminKey = process.env.ADMIN_API_KEY;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = 'activities-admin-key';
    const moduleRef = await Test.createTestingModule({ imports: [ActivitiesProbeModule] }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));
    app.use(json({ type: ['application/json', 'application/merge-patch+json'] }));

    const trace = app.get(TraceMiddleware);
    app.use((req: Request, res: Response, next: NextFunction) => trace.use(req, res, next));
    app.useLogger(false);

    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}${API_BASE_PATH}`;
    token = signJwt(USER_ID, 'access', SECRET, 900);
  });

  afterAll(async () => {
    if (previousAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdminKey;
    await app?.close();
  });

  it('GET /activities/items 需要登录；带 token 返回成功信封', async () => {
    const anonymous = await fetch(`${baseUrl}/activities/items`);
    expect(anonymous.status).toBe(401);

    const response = await fetch(`${baseUrl}/activities/items`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as { ok: boolean; data: { items: unknown[] } };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(service.list).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Object),
      expect.objectContaining({ limit: 20 }),
    );
  });

  it('POST /activities/items 缺 Idempotency-Key → 400；带 key 成功且重试回放', async () => {
    const payload = {
      kind: 'lecture',
      title: 'AI for Science',
      startsAt: '2026-11-25T10:00:00.000Z',
    };

    const missing = await fetch(`${baseUrl}/activities/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    expect(missing.status).toBe(400);
    expect(service.createManual).not.toHaveBeenCalled();

    const request = () =>
      fetch(`${baseUrl}/activities/items`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          [IDEMPOTENCY_HEADER]: 'activities-http-key-1',
        },
        body: JSON.stringify(payload),
      });

    const firstResponse = await request();
    expect(firstResponse.status).toBe(201);
    const first = (await firstResponse.json()) as { ok: boolean; data: { id: string } };
    const second = (await (await request()).json()) as { ok: boolean; data: { id: string } };
    expect(first.ok).toBe(true);
    expect(second.data.id).toBe(first.data.id);
    expect(service.createManual).toHaveBeenCalledTimes(1);
  });

  it('确认 / 忽略 / 编辑 / 提醒删除都走用户身份', async () => {
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      [IDEMPOTENCY_HEADER]: 'activities-http-key-2',
    };

    const confirmed = await fetch(`${baseUrl}/activities/items/act-1/confirm`, {
      method: 'POST',
      headers,
    });
    expect(confirmed.status).toBe(200);
    expect(service.confirm).toHaveBeenCalledWith(USER_ID, 'act-1');

    const dismissed = await fetch(`${baseUrl}/activities/items/act-1/dismiss`, {
      method: 'POST',
      headers: { ...headers, [IDEMPOTENCY_HEADER]: 'activities-http-key-3' },
    });
    expect(dismissed.status).toBe(200);
    expect(service.dismiss).toHaveBeenCalledWith(USER_ID, 'act-1');

    const updated = await fetch(`${baseUrl}/activities/items/act-1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: '新标题' }),
    });
    expect(updated.status).toBe(200);
    expect(service.update).toHaveBeenCalledWith(USER_ID, 'act-1', { title: '新标题' });

    const deleted = await fetch(`${baseUrl}/activities/reminders/rem-1`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleted.status).toBe(200);
    expect(service.deleteReminder).toHaveBeenCalledWith(USER_ID, 'rem-1');
  });

  it('归档 / 恢复是独立的领域动作端点（用户身份 + 幂等键）', async () => {
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      [IDEMPOTENCY_HEADER]: 'activities-http-key-archive',
    };

    const archived = await fetch(`${baseUrl}/activities/items/act-1/archive`, {
      method: 'POST',
      headers,
    });
    expect(archived.status).toBe(200);
    expect(service.archive).toHaveBeenCalledWith(USER_ID, 'act-1');
    const archivedBody = (await archived.json()) as { data: { status: string } };
    expect(archivedBody.data.status).toBe('archived');

    const restored = await fetch(`${baseUrl}/activities/items/act-1/restore`, {
      method: 'POST',
      headers: { ...headers, [IDEMPOTENCY_HEADER]: 'activities-http-key-restore' },
    });
    expect(restored.status).toBe(200);
    expect(service.restore).toHaveBeenCalledWith(USER_ID, 'act-1');
    const restoredBody = (await restored.json()) as { data: { status: string } };
    expect(restoredBody.data.status).toBe('candidate');

    const anonymous = await fetch(`${baseUrl}/activities/items/act-1/archive`, { method: 'POST' });
    expect(anonymous.status).toBe(401);
  });

  it('导入端点：微信单篇 / 邮件提升 / 自定义提醒', async () => {
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      [IDEMPOTENCY_HEADER]: 'activities-http-key-4',
    };

    const wechat = await fetch(`${baseUrl}/activities/imports/wechat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'https://mp.weixin.qq.com/s/abc' }),
    });
    expect(wechat.status).toBe(201);
    expect(service.importWechat).toHaveBeenCalledWith(USER_ID, {
      url: 'https://mp.weixin.qq.com/s/abc',
    });
    const wechatBody = (await wechat.json()) as {
      data: { item: { id: string }; items: unknown[]; created: number; skipped: number };
    };
    expect(wechatBody.data.item.id).toBe('act-1');
    expect(wechatBody.data.items).toHaveLength(1);
    expect(wechatBody.data.created).toBe(1);
    expect(wechatBody.data.skipped).toBe(0);

    const mail = await fetch(`${baseUrl}/activities/imports/mail`, {
      method: 'POST',
      headers: { ...headers, [IDEMPOTENCY_HEADER]: 'activities-http-key-5' },
      body: JSON.stringify({ eventIds: ['mail-1'] }),
    });
    expect(mail.status).toBe(201);
    expect(service.importMail).toHaveBeenCalledWith(USER_ID, { eventIds: ['mail-1'] });

    const reminder = await fetch(`${baseUrl}/activities/items/act-1/reminders`, {
      method: 'POST',
      headers: { ...headers, [IDEMPOTENCY_HEADER]: 'activities-http-key-6' },
      body: JSON.stringify({
        kind: 'custom',
        remindAt: '2026-11-24T00:00:00.000Z',
        channel: 'inapp',
      }),
    });
    expect(reminder.status).toBe(201);
    expect(service.createReminder).toHaveBeenCalledWith(USER_ID, 'act-1', {
      kind: 'custom',
      remindAt: new Date('2026-11-24T00:00:00.000Z'),
      channel: 'inapp',
    });
  });

  it('非微信链接导入 → 422（不是 503，也不是 500）', async () => {
    service.importWechat.mockRejectedValueOnce(
      new ValidationError(
        '只支持 https://mp.weixin.qq.com/s/ 形式的公众号文章链接',
        { reason: 'WECHAT_URL_UNSUPPORTED' },
        422,
      ),
    );

    const response = await fetch(`${baseUrl}/activities/imports/wechat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        [IDEMPOTENCY_HEADER]: 'activities-http-key-not-wechat',
      },
      body: JSON.stringify({ url: 'https://example.com/not-wechat' }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('具体时刻必须带时区：YYYY-MM-DD 被 400 拒绝；+08:00 转成 UTC 再交给服务', async () => {
    const dateOnly = await fetch(`${baseUrl}/activities/items`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        [IDEMPOTENCY_HEADER]: 'activities-http-key-date-only',
      },
      body: JSON.stringify({ kind: 'lecture', title: '日期漂移', startsAt: '2026-11-25' }),
    });
    expect(dateOnly.status).toBe(400);

    const offset = await fetch(`${baseUrl}/activities/items`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        [IDEMPOTENCY_HEADER]: 'activities-http-key-offset',
      },
      body: JSON.stringify({
        kind: 'lecture',
        title: '带时区',
        startsAt: '2026-11-25T14:00:00+08:00',
      }),
    });
    expect(offset.status).toBe(201);
    expect(service.createManual).toHaveBeenLastCalledWith(
      USER_ID,
      expect.objectContaining({ startsAt: new Date('2026-11-25T06:00:00.000Z') }),
    );
  });

  it('PATCH 不接受 status（确认/忽略走领域动作端点）', async () => {
    const response = await fetch(`${baseUrl}/activities/items/act-1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'confirmed' }),
    });
    expect(response.status).toBe(400);
    expect(service.update).not.toHaveBeenCalledWith(
      USER_ID,
      'act-1',
      expect.objectContaining({ status: 'confirmed' }),
    );
  });

  it('PATCH 接受 application/merge-patch+json（契约的 Merge Patch 形状）', async () => {
    const response = await fetch(`${baseUrl}/activities/items/act-1`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/merge-patch+json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title: 'Merge Patch 标题' }),
    });
    expect(response.status).toBe(200);
    expect(service.update).toHaveBeenCalledWith(USER_ID, 'act-1', {
      title: 'Merge Patch 标题',
    });
  });

  it('手动创建接受共同契约的 sports / club 类型', async () => {
    const response = await fetch(`${baseUrl}/activities/items`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        [IDEMPOTENCY_HEADER]: 'activities-http-key-sports',
      },
      body: JSON.stringify({ kind: 'sports', title: '周末羽毛球' }),
    });
    expect(response.status).toBe(201);
    expect(service.createManual).toHaveBeenLastCalledWith(
      USER_ID,
      expect.objectContaining({ kind: 'sports' }),
    );
  });

  it('管理员派发：只带 x-admin-key 也能调用；没有管理员凭据 → 403', async () => {
    const forbidden = await fetch(`${baseUrl}/activities/reminders/dispatch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [IDEMPOTENCY_HEADER]: 'activities-http-key-7',
      },
      body: JSON.stringify({ limit: 10 }),
    });
    expect(forbidden.status).toBe(403);

    // dispatch 不在契约的幂等键列表里：外部 cron 不带 Idempotency-Key 也能调用
    const allowed = await fetch(`${baseUrl}/activities/reminders/dispatch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-key': 'activities-admin-key',
      },
      body: JSON.stringify({ limit: 10 }),
    });
    expect(allowed.status).toBe(200);
    expect(service.dispatchDue).toHaveBeenCalledWith(10);

    // 外部 cron 可以完全不带请求体
    const emptyBody = await fetch(`${baseUrl}/activities/reminders/dispatch`, {
      method: 'POST',
      headers: { 'x-admin-key': 'activities-admin-key' },
    });
    expect(emptyBody.status).toBe(200);
    expect(service.dispatchDue).toHaveBeenLastCalledWith(50);
  });
});
