/**
 * 朗读服务 · 真实模型集成测试。
 *
 * ## 为什么用 `describe.skipIf`
 *
 * 模型是 **60 MB 的部署产物**，不在仓库里（见 `.gitignore`）。
 * CI 里没有它，所以这组测试在 CI 里**跳过**；本地跑过
 * `node tools/fetch-tts-model.mjs` 之后会自动执行。
 *
 * 这不是「测试写得宽松」—— 单元测试（`tts.service.spec.ts`）已经覆盖了
 * 全部逻辑分支；这里额外验证的是**与真实模型的接口契约**：
 * 采样率、音频非静音、WAV 可解析、缓存命中。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { TTS_SAMPLE_RATE } from '@kedaya/contracts';

import { TtsService } from './tts.service';

/** 默认模型目录（与 service 的解析逻辑一致） */
const MODEL_DIR = join(__dirname, '..', '..', '..', '..', 'models', 'vits-piper-zh_CN-xiao_ya-medium');
const INSTALLED = existsSync(join(MODEL_DIR, 'zh_CN-xiao_ya-medium.onnx'));

describe.skipIf(!INSTALLED)('真实模型：合成 → WAV → 缓存', () => {
  const service = new TtsService();

  beforeAll(() => {
    service.resetForTest();
    service.setModelDirForTest(MODEL_DIR);
  });

  it('模型被识别为已安装', () => {
    expect(service.isModelInstalled()).toBe(true);
  });

  it('合成一段中文，返回可解析的 WAV', async () => {
    const outcome = await service.synthesize('可达鸭是上海科技大学的校园服务平台。');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(`合成失败: ${outcome.code}`);

    const { result, wav } = outcome;
    expect(wav).not.toBeNull();
    const bytes = wav as Buffer;

    // ---- WAV 头 ----
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
    expect(bytes.readUInt32LE(24)).toBe(TTS_SAMPLE_RATE);
    expect(bytes.readUInt16LE(22)).toBe(1); // 单声道
    expect(bytes.readUInt16LE(34)).toBe(16); // 16-bit

    // ---- 响应字段 ----
    expect(result.audioId).toMatch(/^[0-9a-f]{32}$/);
    expect(result.url).toBe(`/api/v1/tts/audio/${result.audioId}`);
    expect(result.sampleRate).toBe(TTS_SAMPLE_RATE);
    expect(result.cached).toBe(false);
    expect(result.durationMs).toBeGreaterThan(1000);
    expect(result.byteLength).toBe(bytes.byteLength);

    // ---- data 长度与 durationMs 自洽 ----
    const dataBytes = bytes.readUInt32LE(40);
    expect(dataBytes).toBe(bytes.byteLength - 44);
    const expectedMs = Math.round((dataBytes / 2 / TTS_SAMPLE_RATE) * 1000);
    expect(Math.abs(result.durationMs - expectedMs)).toBeLessThanOrEqual(1);
  });

  it('⚠️ 音频不是静音（这是唯一能自动验证「真的发声」的办法）', async () => {
    const outcome = await service.synthesize('今天二食堂有素食窗口，在一楼东侧。');
    if (!outcome.ok) throw new Error(`合成失败: ${outcome.code}`);
    const bytes = outcome.wav as Buffer;

    // 取 data 段，统计峰值与 RMS
    let peak = 0;
    let sumSq = 0;
    const n = (bytes.byteLength - 44) / 2;
    for (let i = 0; i < n; i += 1) {
      const v = bytes.readInt16LE(44 + i * 2);
      const abs = Math.abs(v);
      if (abs > peak) peak = abs;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / n);
    // 实测：峰值 ~20000，RMS ~2400。给足余量，只要不是静音就行。
    expect(peak).toBeGreaterThan(3000);
    expect(rms).toBeGreaterThan(500);
  });

  it('同一文本第二次命中缓存，且不再跑模型', async () => {
    const text = '缓存命中测试：二食堂今天有素食窗口。';
    const first = await service.synthesize(text);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    expect(first.result.cached).toBe(false);
    expect(first.wav).not.toBeNull();

    const second = await service.synthesize(text);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('unreachable');
    expect(second.result.cached).toBe(true);
    // ⚠️ 命中缓存时不再返回 WAV（调用方从缓存读），避免重复占用内存
    expect(second.wav).toBeNull();
    // id 与时长必须一致
    expect(second.result.audioId).toBe(first.result.audioId);
    expect(second.result.durationMs).toBe(first.result.durationMs);

    // 缓存里能取到音频
    const cached = service.getAudio(first.result.audioId);
    expect(cached).not.toBeNull();
    expect(cached?.byteLength).toBe(first.result.byteLength);
  });

  it('语速会改变缓存 key（同一文本不同语速是两条缓存）', async () => {
    const text = '语速测试。';
    const slow = await service.synthesize(text, 0.8);
    const fast = await service.synthesize(text, 1.5);
    if (!slow.ok || !fast.ok) throw new Error('合成失败');
    expect(slow.result.audioId).not.toBe(fast.result.audioId);
    // 慢速的音频应该更长
    expect(slow.result.durationMs).toBeGreaterThan(fast.result.durationMs);
  });

  it('数字与日期被 rule FST 正常处理（不报错且时长合理）', async () => {
    const outcome = await service.synthesize('2026年10月31号，拨打110。');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.result.durationMs).toBeGreaterThan(1000);
  });
});
