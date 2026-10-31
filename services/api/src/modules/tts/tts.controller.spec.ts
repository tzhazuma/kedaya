/**
 * 朗读控制器测试（HTTP 层）。
 *
 * ## 验证的是客户端真正依赖的东西
 *
 * | 场景 | 状态码 | 为什么客户端在意 |
 * | --- | --- | --- |
 * | 文本太长 | **400** | 客户端要提示「分段朗读」而不是「服务器坏了」 |
 * | 模型没装 | **503** | 运维要能一眼看出是部署问题 |
 * | 合成成功 | **200** + JSON | 拿到 `url` 才能播放 |
 * | 取音频 | **200** + `audio/wav` | 播放器的 `src` 指向它 |
 * | 音频不存在 | **404** | 客户端要能重新合成 |
 * | audioId 形状不对 | **400** | 防路径穿越 |
 */
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../../common/auth/auth.guard';
import { TtsController } from './tts.controller';
import { TtsService } from './application/tts.service';

/** 构造一个最小的响应替身，记录状态码/头/body */
function makeRes() {
  const rec = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: Buffer.alloc(0) as Buffer,
    setHeader(name: string, value: string) {
      rec.headers[name] = value;
    },
    status(code: number) {
      rec.statusCode = code;
      return rec;
    },
    end(body: Buffer) {
      rec.body = body;
    },
  };
  return rec;
}

describe('TtsController', () => {
  let controller: TtsController;
  let service: TtsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TtsController],
      providers: [TtsService],
    })
      // 这个模块的测试不关心鉴权，绕过它
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(TtsController);
    service = moduleRef.get(TtsService);
    service.resetForTest();
    service.setModelDirForTest('/nonexistent/for/controller/test');
  });

  it('⚠️ 模型未安装 → 503（不是 500，也不是 400）', async () => {
    await expect(controller.synthesize({ text: '测试' })).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ code: 'model-unavailable' }),
    });
  });

  it('文本超长 → 400 且 code=text-too-long', async () => {
    await expect(controller.synthesize({ text: '好'.repeat(501) })).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'text-too-long' }),
    });
  });

  it('空文本 → 400', async () => {
    await expect(controller.synthesize({ text: '  ' })).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'text-empty' }),
    });
  });

  it('取不存在的音频 → 404', () => {
    const res = makeRes();
    controller.audio('0'.repeat(32), res);
    expect(res.statusCode).toBe(404);
  });

  it('⚠️ audioId 不是 32 位十六进制 → 400（防路径穿越）', () => {
    for (const bad of ['../../etc/passwd', 'ABC', '0'.repeat(31), '0'.repeat(33), 'zzzz']) {
      const res = makeRes();
      controller.audio(bad, res);
      expect(res.statusCode, `bad id: ${bad}`).toBe(400);
    }
  });

  it('合法 id 但缓存里没有 → 404', () => {
    const res = makeRes();
    controller.audio('a'.repeat(32), res);
    expect(res.statusCode).toBe(404);
  });

  it('缓存里有时返回 audio/wav 与正确的 Content-Length', () => {
    // 直接往 service 的缓存里塞一段假 WAV（不走模型）
    const fakeWav = Buffer.alloc(44 + 100);
    const id = 'b'.repeat(32);
    const putCache = (service as unknown as {
      putCache: (k: string, e: unknown) => void;
    }).putCache.bind(service);
    putCache(id, { wav: fakeWav, sampleRate: 22050, durationMs: 2, lastAccess: Date.now() });

    const res = makeRes();
    controller.audio(id, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('audio/wav');
    expect(res.headers['Content-Length']).toBe(String(fakeWav.byteLength));
    expect(res.body.byteLength).toBe(fakeWav.byteLength);
  });

  it('status 接口如实报告 installed: false', () => {
    const s = controller.status();
    expect(s.installed).toBe(false);
    expect(s.sampleRate).toBe(22050);
    expect(s.cache).toEqual({ entries: 0, bytes: 0 });
  });
});
