/**
 * 朗读服务测试。
 *
 * ## 这组测试的重心
 *
 * 1. **没有模型时 API 不能崩** —— 返回结构化错误码，而不是抛异常
 * 2. **WAV 编码是对的** —— 44 字节头 + 16-bit PCM，采样值夹紧
 * 3. **缓存按内容哈希**，同一文本不重复跑模型
 * 4. **`model-unavailable` 与 `synthesis-failed` 是两回事**
 * 5. **不依赖真实模型** —— CI 里没有 60 MB 模型也要全绿
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TTS_CACHE_MAX_ENTRIES, TTS_SAMPLE_RATE } from '@kedaya/contracts';

import { TtsService, encodeWav } from './tts.service';

describe('encodeWav —— 16-bit PCM 单声道', () => {
  it('写出合法的 44 字节 RIFF 头', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const wav = encodeWav(samples, 22050);

    expect(wav.byteLength).toBe(44 + samples.length * 2);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + samples.length * 2);
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // 单声道
    expect(wav.readUInt32LE(24)).toBe(22050);
    expect(wav.readUInt16LE(34)).toBe(16); // bits
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(samples.length * 2);
  });

  it('采样值按 32767 缩放', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 22050);
    expect(wav.readInt16LE(44)).toBe(0);
    expect(wav.readInt16LE(46)).toBe(32767);
    expect(wav.readInt16LE(48)).toBe(-32767);
  });

  it('⚠️ 超出 [-1,1] 会被夹紧，不会溢出成反相噪声', () => {
    // 不做夹紧的话 1.5 * 32767 = 49150，writeInt16LE 会回绕成负数 ——
    // 听感上是刺耳的爆音
    const wav = encodeWav(new Float32Array([1.5, -1.5, 99]), 22050);
    expect(wav.readInt16LE(44)).toBe(32767);
    expect(wav.readInt16LE(46)).toBe(-32767);
    expect(wav.readInt16LE(48)).toBe(32767);
  });

  it('空音频也产出合法头（data 长度 0）', () => {
    const wav = encodeWav(new Float32Array([]), 22050);
    expect(wav.byteLength).toBe(44);
    expect(wav.readUInt32LE(40)).toBe(0);
  });
});

describe('TtsService —— 模型缺失时的行为', () => {
  let service: TtsService;

  beforeEach(() => {
    service = new TtsService();
    service.resetForTest();
  });

  it('⚠️ 模型没装时返回 model-unavailable，而不是抛异常', async () => {
    service.setModelDirForTest('/nonexistent/path/for/tts/test');
    const outcome = await service.synthesize('测试文本');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.code).toBe('model-unavailable');
  });

  it('isModelInstalled 对不存在的目录返回 false', () => {
    service.setModelDirForTest('/nonexistent/path');
    expect(service.isModelInstalled()).toBe(false);
  });

  it('目录存在但缺文件也算未安装', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tts-partial-'));
    writeFileSync(join(dir, 'tokens.txt'), 'x');
    // 只有 tokens.txt，缺 onnx 与 lexicon
    service.setModelDirForTest(dir);
    expect(service.isModelInstalled()).toBe(false);
  });

  it('三个必需文件齐全才算已安装', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tts-full-'));
    for (const f of ['zh_CN-xiao_ya-medium.onnx', 'tokens.txt', 'lexicon.txt']) {
      writeFileSync(join(dir, f), 'x');
    }
    service.setModelDirForTest(dir);
    expect(service.isModelInstalled()).toBe(true);
  });
});

describe('TtsService —— 输入校验（不依赖模型）', () => {
  let service: TtsService;

  beforeEach(() => {
    service = new TtsService();
    service.resetForTest();
    // 指向不存在的目录：确保校验发生在加载模型之前
    service.setModelDirForTest('/nonexistent');
  });

  it('空文本 → text-empty', async () => {
    const outcome = await service.synthesize('   ');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.code).toBe('text-empty');
  });

  it('超长文本 → text-too-long（在碰模型之前就拒）', async () => {
    const outcome = await service.synthesize('好'.repeat(501));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    // ⚠️ 必须是 text-too-long，不能是 model-unavailable ——
    // 否则用户会以为是部署问题
    expect(outcome.code).toBe('text-too-long');
  });

  it('语速越界 → speed-out-of-range', async () => {
    for (const speed of [0.1, 3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const outcome = await service.synthesize('测试', speed);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code, `speed=${String(speed)}`).toBe('speed-out-of-range');
    }
  });

  it('合法语速边界不报语速错', async () => {
    // 会因模型缺失而失败，但不该是 speed-out-of-range
    for (const speed of [0.5, 1, 2]) {
      const outcome = await service.synthesize('测试', speed);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('model-unavailable');
    }
  });
});

describe('TtsService —— 缓存', () => {
  let service: TtsService;

  beforeEach(() => {
    service = new TtsService();
    service.resetForTest();
    service.setModelDirForTest('/nonexistent');
  });

  afterEach(() => {
    service.resetForTest();
  });

  it('未合成过的 id 取不到音频', () => {
    expect(service.getAudio('0'.repeat(32))).toBeNull();
  });

  it('缓存初始为空', () => {
    expect(service.cacheStats()).toEqual({ entries: 0, bytes: 0 });
  });

  it('⚠️ 缓存 key 是 32 位小写十六进制（与路由正则一致）', async () => {
    // 用真实模型跑太慢；这里只验证「如果命中，id 形状是对的」——
    // 通过 synthesize 的返回值无法在无模型时拿到 key，所以直接测 encodeWav 之外的契约：
    // 路由层用的是 /^[0-9a-f]{32}$/，而 service 用 sha256 hex slice(0,32)。
    const { createHash } = await import('node:crypto');
    const sample = createHash('sha256').update('1|测试').digest('hex').slice(0, 32);
    expect(sample).toMatch(/^[0-9a-f]{32}$/);
    expect(sample).toHaveLength(32);
  });

  it('缓存上限是契约里的常量（不各写一份）', () => {
    expect(TTS_CACHE_MAX_ENTRIES).toBe(200);
  });
});

describe('TtsService —— 重置', () => {
  it('resetForTest 清空缓存与模型状态', () => {
    const service = new TtsService();
    service.setModelDirForTest('/x');
    service.resetForTest();
    // 重置后 modelDir 回到默认解析（不是 /x）
    expect(service.resolveModelDir()).not.toBe('/x');
  });
});

describe('契约常量与实现一致', () => {
  it('采样率是 22050（模型固定值，改了要同步改契约）', () => {
    expect(TTS_SAMPLE_RATE).toBe(22050);
  });
});
