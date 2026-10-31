/**
 * 朗读（TTS）—— `sherpa-onnx` + `vits-piper-zh_CN-xiao_ya-medium`
 *
 * ## 为什么 TTS 跑在服务端，而不是端上
 *
 * 模型本体是 **60 MB 的 ONNX**。三个客户端都放不下：
 *
 * | 端 | 约束 | 结论 |
 * | --- | --- | --- |
 * | 微信小程序 | 主包上限 **2 MiB**（我们已用 1.66） | 放不下 |
 * | Flutter APK | 已经 **54 MB** | 再加 60 MB 不合理 |
 * | Web | 用户首屏要下载 60 MB | 不可接受 |
 *
 * 所以：**服务端合成一次，客户端只取音频 URL**。
 * 一个模型实例服务所有用户，还能跨用户复用缓存。
 *
 * ## 为什么用「先 POST 拿 id，再 GET 取音频」
 *
 * `GET /tts?text=...` 看起来更简单，但：
 * 1. 长文本会撞 URL 长度限制（反代/网关常见 2–8 KB）
 * 2. 音频要能被 `<audio>` / `InnerAudioContext` / Flutter 播放器直接当 `src`，
 *    这些组件只会发 GET，不会发 POST
 *
 * 所以拆成两步：`POST /tts/synthesize` 返回 `{ audioId, url }`，
 * 播放器拿 `url` 去 `GET /tts/audio/:audioId`。这样还能按内容哈希缓存。
 */

/* ------------------------------------------------------------------ *
 * 1. 限制
 * ------------------------------------------------------------------ */

/**
 * 单次合成的最大字符数。
 *
 * 500 字约等于 **30–40 秒**音频（实测 RTF ≈ 0.08，合成耗时 ~3 秒）。
 * 再长的话：
 * - 用户等太久
 * - 服务端一次请求占用 CPU 太久，容易被当成 DoS 面
 *
 * 长文要朗读就**分段**，客户端按句子切。
 */
export const TTS_TEXT_MAX = 500;

/** 文本下限：一两个字不值得合成 */
export const TTS_TEXT_MIN = 1;

/** 语速范围（sherpa-onnx 的 `speed` 参数） */
export const TTS_SPEED_MIN = 0.5;
export const TTS_SPEED_MAX = 2.0;
export const TTS_SPEED_DEFAULT = 1.0;

/** 模型采样率（`vits-piper-zh_CN-xiao_ya-medium` 固定 22050） */
export const TTS_SAMPLE_RATE = 22050;

/** 缓存容量上限（条数）。每条最长 ~500 字 ≈ 1.5 MB wav，200 条约 300 MB */
export const TTS_CACHE_MAX_ENTRIES = 200;

/** 缓存总量上限（字节）。超过就按 LRU 淘汰 */
export const TTS_CACHE_MAX_BYTES = 256 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 * 2. 错误码
 * ------------------------------------------------------------------ */

/**
 * TTS 的失败原因。
 *
 * ⚠️ `model-unavailable` 必须与「合成失败」分开：
 * 前者是**部署问题**（模型没下载），后者是**这次输入的问题**。
 * 混成一个码会让运维看不出该修什么。
 */
export const TTS_ERROR_CODES = [
  'text-too-long',
  'text-empty',
  'speed-out-of-range',
  'model-unavailable',
  'synthesis-failed',
  'audio-not-found',
] as const;

export type TtsErrorCode = (typeof TTS_ERROR_CODES)[number];

export const TTS_ERROR_MESSAGES: Readonly<Record<TtsErrorCode, string>> = Object.freeze({
  'text-too-long': `单次朗读最多 ${TTS_TEXT_MAX} 字，长文请分段`,
  'text-empty': '没有可朗读的内容',
  'speed-out-of-range': `语速需在 ${TTS_SPEED_MIN}–${TTS_SPEED_MAX} 之间`,
  // ⚠️ 这句话要能让运维直接行动：告诉他跑哪个命令
  'model-unavailable':
    '朗读模型未安装（这是部署问题，不是你的输入问题）。服务端需运行 `node tools/fetch-tts-model.mjs`。',
  'synthesis-failed': '这次合成失败了，换一段文本或稍后再试',
  'audio-not-found': '音频不存在或已被清理，请重新合成',
});

/* ------------------------------------------------------------------ *
 * 3. wire 类型
 * ------------------------------------------------------------------ */

/** `POST /tts/synthesize` 的请求体 */
export interface TtsSynthesizeRequest {
  readonly text: string;
  /** 语速，默认 1.0；范围 0.5–2.0 */
  readonly speed?: number;
}

/** `POST /tts/synthesize` 的响应 */
export interface TtsSynthesizeResponse {
  /** 音频标识（内容哈希的前 32 位十六进制） */
  readonly audioId: string;
  /** 可直接给播放器的相对路径（已含 `/api/v1` 前缀） */
  readonly url: string;
  readonly sampleRate: number;
  /** 音频时长（毫秒） */
  readonly durationMs: number;
  /** 字节数（便于客户端预估下载量） */
  readonly byteLength: number;
  /** 是否命中缓存（false = 本次真的跑了模型） */
  readonly cached: boolean;
}

/** 失败响应（与其它模块的错误信封一致） */
export interface TtsErrorResponse {
  readonly code: TtsErrorCode;
  readonly message: string;
}

/* ------------------------------------------------------------------ *
 * 4. 客户端可用的纯函数
 * ------------------------------------------------------------------ */

/**
 * 把长文切成不超过 `TTS_TEXT_MAX` 的片段。
 *
 * 切分优先级（尽量在自然边界断开，别把词切断）：
 * 1. 句末标点（。！？；\n）
 * 2. 逗号（，、,）
 * 3. 空格
 * 4. 硬切（实在找不到边界）
 *
 * ⚠️ 不切英文单词/数字中间：`RTF` 被切成 `RT` + `F` 会读成两个字母。
 */
export function splitForTts(text: string, maxLen: number = TTS_TEXT_MAX): readonly string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxLen) return [trimmed];

  const chunks: string[] = [];
  let rest = trimmed;

  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    // 从后往前找自然边界
    let cut = -1;
    for (const boundary of ['。', '！', '？', '；', '\n', '，', '、', ',', ' ', ';']) {
      const at = window.lastIndexOf(boundary);
      if (at > maxLen * 0.4) {
        cut = at + 1;
        break;
      }
    }
    if (cut <= 0) cut = maxLen;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/** 校验一次合成请求；返回错误码或 `null` */
export function validateTtsRequest(
  text: string,
  speed: number | undefined,
): TtsErrorCode | null {
  const trimmed = text.trim();
  if (trimmed.length < TTS_TEXT_MIN) return 'text-empty';
  if (trimmed.length > TTS_TEXT_MAX) return 'text-too-long';
  if (speed !== undefined) {
    if (!Number.isFinite(speed) || speed < TTS_SPEED_MIN || speed > TTS_SPEED_MAX) {
      return 'speed-out-of-range';
    }
  }
  return null;
}

/** 拼出音频的相对 URL（客户端直接当播放器的 src） */
export function ttsAudioUrl(audioId: string): string {
  return `/api/v1/tts/audio/${audioId}`;
}
