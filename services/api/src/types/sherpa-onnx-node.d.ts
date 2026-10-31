/**
 * `sherpa-onnx-node` **不自带类型声明**（2.0.1 实测 `package.json` 没有 `types`）。
 *
 * 这里只手写我们**真正用到**的那一小块 API —— 不是完整镜像。
 * 好处：
 * 1. `tsc` 能过
 * 2. 我们不可能误用一个没声明的方法（编译期就挡住）
 *
 * 如果将来要用 ASR / VAD / 说话人分离，请在这里补对应声明，
 * 而不是把整个模块 `any` 掉。
 */
declare module 'sherpa-onnx-node' {
  /** 生成参数 */
  export class GenerationConfig {
    constructor(config: { sid: number; speed: number; silenceScale?: number });
  }

  export interface OfflineTtsVitsConfig {
    model: string;
    tokens: string;
    lexicon?: string;
    dataDir?: string;
  }

  export interface OfflineTtsModelConfig {
    vits: OfflineTtsVitsConfig;
    numThreads?: number;
    debug?: boolean;
    provider?: 'cpu' | 'cuda' | 'coreml';
  }

  export interface OfflineTtsConfig {
    model: OfflineTtsModelConfig;
    ruleFsts?: string;
    maxNumSentences?: number;
  }

  export interface GeneratedAudio {
    samples: Float32Array;
    sampleRate: number;
  }

  export class OfflineTts {
    constructor(config: OfflineTtsConfig);
    readonly sampleRate: number;
    readonly numSpeakers: number;
    generate(args: {
      text: string;
      generationConfig: GenerationConfig;
      onProgress?: (info: { samples: Float32Array; progress: number }) => number;
    }): GeneratedAudio;
    free(): void;
  }

  export function writeWave(
    filename: string,
    audio: { samples: Float32Array; sampleRate: number },
  ): void;
}
