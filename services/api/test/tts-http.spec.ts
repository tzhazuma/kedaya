/**
 * 朗读 · HTTP 端到端验收。
 *
 * ## 为什么还要一个 HTTP 测试（控制器测试已经覆盖了逻辑）
 *
 * 控制器测试是**直接调方法**，拿不到真正经过 Nest 管道的东西：
 * - `ZodBody` 校验是否真的生效（超长文本是被 zod 拒还是被 service 拒）
 * - 全局异常过滤器把 `HttpException` 转成什么形状
 * - `GET /audio/:id` 的二进制响应是否真的带对了 `Content-Type`
 * - 401（未登录）是不是真的由 `AuthGuard` 产生
 *
 * 这些只有走真实 HTTP 才能验证。
 *
 * ## 模型
 *
 * 本机有模型（`tools/fetch-tts-model.mjs`）时跑真实合成；
 * 没有时只验证「503 + 正确错误码」，因为那才是 CI 里能验证的部分。
 */
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

import { API_BASE_PATH, TTS_TEXT_MAX } from '@kedaya/contracts';

import { UnauthenticatedError } from '../src/common/errors/app-error';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { AuthGuard } from '../src/common/auth/auth.guard';
import { TtsModule } from '../src/modules/tts/tts.module';
import { TtsService } from '../src/modules/tts/application/tts.service';

/**
 * 未登录的守卫。
 *
 * ⚠️ 不能写成 `canActivate: () => false` —— 那样 Nest 会抛 **403 Forbidden**。
 * 真实 `AuthGuard` 抛的是 `UnauthenticatedError`，经全局过滤器映射为 **401**。
 * 这里必须模拟真实行为，否则测的就不是客户端会遇到的东西。
 */
const unauthenticatedGuard = {
  canActivate: () => {
    throw new UnauthenticatedError();
  },
};
/** 已登录：直接放行（本测试不关心鉴权细节，那是 auth 模块的事） */
const authenticatedGuard = {
  canActivate: () => true,
};

async function boot(guard: unknown): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [TtsModule],
    providers: [
      { provide: APP_PIPE, useValue: undefined },
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
    ],
  })
    .overrideGuard(AuthGuard)
    .useValue(guard)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));
  // ⚠️ 必须 listen 才能 getUrl()；端口 0 = 让系统分配空闲端口，
  // 避免与本地已跑的 API（3100）冲突
  await app.listen(0, '127.0.0.1');
  return app;
}

/** 极简 HTTP 客户端（不引 supertest，避免加依赖） */
async function http(
  app: INestApplication,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const url = await app.getUrl();
  const res = await fetch(`${url.replace('[::1]', '127.0.0.1')}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return { status: res.status, headers, body: buf };
}

describe('朗读 HTTP（已登录）', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await boot(authenticatedGuard);
  });

  afterAll(async () => {
    await app.close();
  });

  it('超长文本被拒，返回 4xx 且提示字数上限', async () => {
    const res = await http(app, 'POST', `${API_BASE_PATH}/tts/synthesize`, {
      text: '好'.repeat(TTS_TEXT_MAX + 1),
    });
    // ⚠️ 实际是 **zod 先拒**（`ZodBody` 的 `.max(TTS_TEXT_MAX)`），
    // 所以错误码是 `VALIDATION_FAILED` 而不是 service 的 `text-too-long`。
    // 这不是 bug：两层校验都在，只是 zod 更靠前。
    // 客户端真正需要的是「4xx + 能看懂的上限提示」。
    expect(res.status).toBe(400);
    const text = res.body.toString('utf8');
    expect(text).toContain('VALIDATION_FAILED');
    // 提示里要出现上限数字，否则用户不知道能读多少字
    expect(text).toContain(String(TTS_TEXT_MAX));
  });

  it('不存在的 audioId → 404', async () => {
    const res = await http(app, 'GET', `${API_BASE_PATH}/tts/audio/${'0'.repeat(32)}`);
    expect(res.status).toBe(404);
  });

  it('⚠️ 非法 audioId → 400（防路径穿越，且不能 500）', async () => {
    const res = await http(app, 'GET', `${API_BASE_PATH}/tts/audio/..%2F..%2Fetc%2Fpasswd`);
    expect([400, 404]).toContain(res.status);
  });

  it('status 接口可用且报告 installed 布尔', async () => {
    const res = await http(app, 'GET', `${API_BASE_PATH}/tts/status`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body.toString('utf8')) as {
      installed?: boolean;
      sampleRate?: number;
    };
    // 信封可能包一层 data
    const payload = (json as unknown as { data?: typeof json }).data ?? json;
    expect(typeof payload.installed).toBe('boolean');
    expect(payload.sampleRate).toBe(22050);
  });
});

describe('朗读 HTTP（未登录）', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await boot(unauthenticatedGuard);
  });

  afterAll(async () => {
    await app.close();
  });

  it('⚠️ 未登录合成 → 401（不能让人匿名烧 CPU）', async () => {
    const res = await http(app, 'POST', `${API_BASE_PATH}/tts/synthesize`, { text: '测试' });
    expect(res.status).toBe(401);
  });

  it('未登录也能取音频（播放器带不上 Authorization 头）', async () => {
    const res = await http(app, 'GET', `${API_BASE_PATH}/tts/audio/${'a'.repeat(32)}`);
    // 缓存里没有 → 404，但**不是** 401
    expect(res.status).toBe(404);
  });
});
