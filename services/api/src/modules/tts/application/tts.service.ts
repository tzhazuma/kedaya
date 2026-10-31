/**
 * 朗读服务 —— `sherpa-onnx` + `vits-piper-zh_CN-xiao_ya-medium`
 *
 * ## 三个刻意的设计
 *
 * ### 1. 模型**懒加载 + 动态 import**
 *
 * `sherpa-onnx-node` 是原生插件（`.node` 二进制）。如果写成模块级 `import`，
 * 那么**任何**环境只要没有对应平台的原生包，整个 API 就起不来 ——
 * 包括 CI、包括只跑单测的开发机。
 *
 * 所以这里用 `await import('sherpa-onnx-node')`，且失败时**不抛到模块层**，
 * 而是让 `synthesize()` 返回 `model-unavailable`。
 * 结果是：**没有模型时 API 照常工作，只有朗读这一个功能报 503。**
 *
 * ### 2. 模型缺失与合成失败是两个不同的错误码
 *
 * - `model-unavailable` → 运维问题，提示去跑 `tools/fetch-tts-model.mjs`
 * - `synthesis-failed` → 这次输入的问题
 *
 * 混成一个码会让运维看不出该修什么。
 *
 * ### 3. 缓存按「文本 + 语速」的内容哈希
 *
 * FAQ 的答案、茶歇说明这类文本会被很多人朗读，同一段文本重复合成的
 * CPU 开销纯属浪费。用 `sha256(text|speed)` 做 key，天然跨用户复用。
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  TTS_CACHE_MAX_BYTES,
  TTS_CACHE_MAX_ENTRIES,
  TTS_SAMPLE_RATE,
  TTS_SPEED_DEFAULT,
  ttsAudioUrl,
  validateTtsRequest,
  type TtsErrorCode,
  type TtsSynthesizeResponse,
} from '@kedaya/contracts';

/** 合成成功的结果 */
export interface TtsSuccess {
  readonly ok: true;
  readonly result: TtsSynthesizeResponse;
  /** WAV 字节（仅首次合成时非空；命中缓存时为 null，调用方从缓存读） */
  readonly wav: Buffer | null;
}

/** 合成失败 */
export interface TtsFailure {
  readonly ok: false;
  readonly code: TtsErrorCode;
}

export type TtsOutcome = TtsSuccess | TtsFailure;

interface CacheEntry {
  readonly wav: Buffer;
  readonly sampleRate: number;
  readonly durationMs: number;
  /** 最后访问时间（毫秒），用于 LRU */
  lastAccess: number;
}

/** `sherpa-onnx-node` 里我们真正用到的那几个成员（避免 `any` 扩散） */
interface SherpaModule {
  OfflineTts: new (config: unknown) => SherpaTts;
  GenerationConfig: new (config: { sid: number; speed: number }) => unknown;
}

interface SherpaTts {
  sampleRate: number;
  numSpeakers: number;
  generate: (args: {
    text: string;
    generationConfig: unknown;
  }) => { samples: Float32Array; sampleRate: number };
}

/**
 * 模型目录。
 *
 * 默认放在 `services/api/models/`（已 gitignore —— 60 MB 不该进仓库）。
 * 可用 `TTS_MODEL_DIR` 覆盖（生产环境常挂只读卷）。
 */
const MODEL_DIR_NAME = 'vits-piper-zh_CN-xiao_ya-medium';

/** 模型必需的文件 —— 少任何一个都算「未安装」 */
const REQUIRED_FILES = [
  'zh_CN-xiao_ya-medium.onnx',
  'tokens.txt',
  'lexicon.txt',
] as const;

/** 可选但强烈建议的 rule FST（没有它们，数字/日期会读错） */
const RULE_FSTS = ['phone.fst', 'date.fst', 'number.fst'] as const;

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  /** 惰性加载的模型实例。`null` = 还没试过；`false` = 试过但失败 */
  private tts: SherpaTts | null = null;
  private loadFailed = false;

  /** 加载中（并发首请求时只加载一次） */
  private loading: Promise<SherpaTts | null> | null = null;

  private readonly cache = new Map<string, CacheEntry>();
  private cacheBytes = 0;

  /** 模型目录（测试可覆盖） */
  private modelDir: string | null = null;

  /** 解析模型目录：env 优先，否则相对本包 */
  resolveModelDir(): string {
    if (this.modelDir !== null) return this.modelDir;
    const fromEnv = process.env['TTS_MODEL_DIR'];
    if (fromEnv !== undefined && fromEnv.length > 0) {
      this.modelDir = fromEnv;
      return fromEnv;
    }
    // services/api/src/modules/tts/application → 上溯到 services/api
    const here = __dirname;
    const apiRoot = join(here, '..', '..', '..', '..');
    this.modelDir = join(apiRoot, 'models', MODEL_DIR_NAME);
    return this.modelDir;
  }

  /** 模型是否已安装（只看文件在不在，不加载） */
  isModelInstalled(): boolean {
    const dir = this.resolveModelDir();
    return REQUIRED_FILES.every((f) => existsSync(join(dir, f)));
  }

  /**
   * 合成一段文本。
   *
   * @returns 成功时带 WAV；失败时带错误码。**从不抛异常** —— 调用方
   *          只需要看 `ok`，不需要 try/catch 分支出错路径。
   */
  async synthesize(rawText: string, speed?: number): Promise<TtsOutcome> {
    const text = rawText.trim();
    const effectiveSpeed = speed ?? TTS_SPEED_DEFAULT;

    // ---- 1. 输入校验（不依赖模型，所以先做）----
    const problem = validateTtsRequest(text, speed);
    if (problem !== null) return { ok: false, code: problem };

    // ---- 2. 缓存 ----
    const key = this.cacheKey(text, effectiveSpeed);
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      hit.lastAccess = Date.now();
      return {
        ok: true,
        wav: null,
        result: {
          audioId: key,
          url: ttsAudioUrl(key),
          sampleRate: hit.sampleRate,
          durationMs: hit.durationMs,
          byteLength: hit.wav.byteLength,
          cached: true,
        },
      };
    }

    // ---- 3. 加载模型 ----
    const tts = await this.ensureModel();
    if (tts === null) return { ok: false, code: 'model-unavailable' };

    // ---- 4. 合成 ----
    let samples: Float32Array;
    let sampleRate: number;
    try {
      const mod = await this.importSherpa();
      if (mod === null) return { ok: false, code: 'model-unavailable' };
      const audio = tts.generate({
        text,
        generationConfig: new mod.GenerationConfig({ sid: 0, speed: effectiveSpeed }),
      });
      samples = audio.samples;
      sampleRate = audio.sampleRate;
    } catch (error) {
      // ⚠️ 不把原始错误抛给客户端（可能含路径），但服务端要留痕
      this.logger.warn(`TTS 合成失败: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, code: 'synthesis-failed' };
    }

    if (samples.length === 0) {
      this.logger.warn('TTS 返回了空音频（模型可能存在但输出为空）');
      return { ok: false, code: 'synthesis-failed' };
    }

    // ---- 5. 编码 WAV 并缓存 ----
    const wav = encodeWav(samples, sampleRate);
    const durationMs = Math.round((samples.length / sampleRate) * 1000);
    this.putCache(key, { wav, sampleRate, durationMs, lastAccess: Date.now() });

    return {
      ok: true,
      wav,
      result: {
        audioId: key,
        url: ttsAudioUrl(key),
        sampleRate,
        durationMs,
        byteLength: wav.byteLength,
        cached: false,
      },
    };
  }

  /** 按 id 取缓存的 WAV；没有则 `null` */
  getAudio(audioId: string): Buffer | null {
    const entry = this.cache.get(audioId);
    if (entry === undefined) return null;
    entry.lastAccess = Date.now();
    return entry.wav;
  }

  /** 缓存统计（健康检查用） */
  cacheStats(): { entries: number; bytes: number } {
    return { entries: this.cache.size, bytes: this.cacheBytes };
  }

  /** 测试用：清空缓存与模型状态 */
  resetForTest(): void {
    this.cache.clear();
    this.cacheBytes = 0;
    this.tts = null;
    this.loadFailed = false;
    this.loading = null;
    this.modelDir = null;
  }

  /** 测试用：直接指定模型目录 */
  setModelDirForTest(dir: string): void {
    this.modelDir = dir;
  }

  /* ---------------------------------------------------------------- *
   * 内部
   * ---------------------------------------------------------------- */

  private cacheKey(text: string, speed: number): string {
    return createHash('sha256').update(`${speed}|${text}`).digest('hex').slice(0, 32);
  }

  private putCache(key: string, entry: CacheEntry): void {
    // 先按条数淘汰
    while (this.cache.size >= TTS_CACHE_MAX_ENTRIES) {
      if (!this.evictOldest()) break;
    }
    // 再按字节淘汰
    while (this.cacheBytes + entry.wav.byteLength > TTS_CACHE_MAX_BYTES) {
      if (!this.evictOldest()) break;
    }
    this.cache.set(key, entry);
    this.cacheBytes += entry.wav.byteLength;
  }

  private evictOldest(): boolean {
    let oldestKey: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [k, v] of this.cache) {
      if (v.lastAccess < oldest) {
        oldest = v.lastAccess;
        oldestKey = k;
      }
    }
    if (oldestKey === null) return false;
    const removed = this.cache.get(oldestKey);
    if (removed !== undefined) this.cacheBytes -= removed.wav.byteLength;
    this.cache.delete(oldestKey);
    return true;
  }

  /** 动态 import 原生插件；失败返回 null（不抛） */
  private async importSherpa(): Promise<SherpaModule | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod = (await import('sherpa-onnx-node')) as unknown as {
        default?: SherpaModule;
      } & SherpaModule;
      // CJS 包里类挂在 default 上（实测 2.0.1）
      return mod.default ?? mod;
    } catch (error) {
      this.logger.warn(
        `sherpa-onnx-node 不可用: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** 加载模型（并发安全：同时只加载一次） */
  private async ensureModel(): Promise<SherpaTts | null> {
    if (this.tts !== null) return this.tts;
    if (this.loadFailed) return null;
    if (this.loading !== null) return await this.loading;

    this.loading = this.loadModel();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async loadModel(): Promise<SherpaTts | null> {
    if (!this.isModelInstalled()) {
      this.logger.warn(
        `朗读模型未安装（目录 ${this.resolveModelDir()}）。` +
          '运行 `node tools/fetch-tts-model.mjs` 下载；朗读接口会返回 503。',
      );
      this.loadFailed = true;
      return null;
    }

    const mod = await this.importSherpa();
    if (mod === null) {
      this.loadFailed = true;
      return null;
    }

    const dir = this.resolveModelDir();
    const fsts = RULE_FSTS.map((f) => join(dir, f)).filter((p) => existsSync(p));

    try {
      const t0 = Date.now();
      const instance = new mod.OfflineTts({
        model: {
          vits: {
            model: join(dir, 'zh_CN-xiao_ya-medium.onnx'),
            tokens: join(dir, 'tokens.txt'),
            lexicon: join(dir, 'lexicon.txt'),
          },
          debug: false,
          numThreads: 2,
          provider: 'cpu',
        },
        maxNumSentences: 1,
        // ⚠️ 没有 rule FST 时数字/日期会读错，所以只在文件存在时才传
        ...(fsts.length > 0 ? { ruleFsts: fsts.join(',') } : {}),
      });
      this.logger.log(
        `朗读模型已加载（${Date.now() - t0} ms，采样率 ${instance.sampleRate}，` +
          `音色 ${instance.numSpeakers}，ruleFsts ${fsts.length} 个）`,
      );
      this.tts = instance;
      return instance;
    } catch (error) {
      this.logger.error(
        `朗读模型加载失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.loadFailed = true;
      return null;
    }
  }
}

/* ------------------------------------------------------------------ *
 * WAV 编码
 * ------------------------------------------------------------------ */

/**
 * 把 [-1, 1] 的 float32 采样编码成 16-bit PCM 单声道 WAV。
 *
 * 为什么自己写而不是用 `sherpa.writeWave`：
 * 我们要把字节直接放进 HTTP 响应与内存缓存，不想多一次文件 IO。
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk 大小
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i += 1) {
    // 夹紧，避免削波溢出成反相噪声
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

export { TTS_SAMPLE_RATE };
