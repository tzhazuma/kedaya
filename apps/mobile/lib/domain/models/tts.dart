/// 朗读（TTS）的领域模型与纯函数。
///
/// ## 与 `packages/contracts/src/tts.ts` 的关系
///
/// 逐条镜像，不新增规则。TS 侧是**唯一真相源**；这里只是 Dart 端能用的形态。
/// 任何一边改了限制（字数上限、语速范围、切段边界），另一边必须同步，
/// 否则会出现「小程序能读、APK 说太长」这种割裂。
library;

/// 单次合成的最大字符数（镜像契约 `TTS_TEXT_MAX`）。
const int ttsTextMax = 500;

/// 文本下限。
const int ttsTextMin = 1;

/// 语速范围（镜像契约）。
const double ttsSpeedMin = 0.5;
const double ttsSpeedMax = 2.0;
const double ttsSpeedDefault = 1.0;

/// 模型采样率（`vits-piper-zh_CN-xiao_ya-medium` 固定 22050）。
const int ttsSampleRate = 22050;

/// 一次合成成功的结果。
final class TtsAudio {
  const TtsAudio({
    required this.audioId,
    required this.url,
    required this.sampleRate,
    required this.durationMs,
    required this.byteLength,
    required this.cached,
  });

  factory TtsAudio.fromJson(Map<String, Object?> json) {
    final Object? id = json['audioId'];
    final Object? url = json['url'];
    if (id is! String || id.isEmpty) {
      throw const FormatException('TtsAudio: audioId 缺失');
    }
    if (url is! String || url.isEmpty) {
      throw const FormatException('TtsAudio: url 缺失');
    }
    return TtsAudio(
      audioId: id,
      url: url,
      sampleRate: _readInt(json['sampleRate'], ttsSampleRate),
      durationMs: _readInt(json['durationMs'], 0),
      byteLength: _readInt(json['byteLength'], 0),
      cached: json['cached'] == true,
    );
  }

  /// 内容哈希（32 位十六进制）
  final String audioId;

  /// 相对路径 `/api/v1/tts/audio/:id`
  final String url;

  final int sampleRate;

  /// 音频时长（毫秒）
  final int durationMs;

  final int byteLength;

  /// 是否命中服务端缓存
  final bool cached;

  /// 转成播放器能用的**绝对**地址。
  ///
  /// [apiBaseUrl] 形如 `https://api.example.com`（不含 `/api/v1`）。
  String absoluteUrl(String apiBaseUrl) {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    final String base = apiBaseUrl.replaceAll(RegExp(r'/+$'), '');
    return url.startsWith('/') ? '$base$url' : '$base/$url';
  }
}

int _readInt(Object? value, int fallback) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return fallback;
}

/// 把长文切成不超过 [maxLen] 的片段（镜像契约 `splitForTts`）。
///
/// 切分优先级：句末标点 > 逗号 > 空格 > 硬切。
/// ⚠️ 不在英文单词中间切 —— `RTF` 切成 `RT` + `F` 会读成「啊提艾弗」。
List<String> splitForTts(String text, {int maxLen = ttsTextMax}) {
  final String trimmed = text.trim();
  if (trimmed.isEmpty) return const <String>[];
  if (trimmed.length <= maxLen) return <String>[trimmed];

  final List<String> chunks = <String>[];
  String rest = trimmed;

  while (rest.length > maxLen) {
    final String window = rest.substring(0, maxLen);
    int cut = -1;
    for (final String boundary in <String>['。', '！', '？', '；', '\n', '，', '、', ',', ' ', ';']) {
      final int at = window.lastIndexOf(boundary);
      // 断点不能太靠前，否则会切出一堆很短的小段
      if (at > maxLen * 0.4) {
        cut = at + 1;
        break;
      }
    }
    if (cut <= 0) cut = maxLen;
    chunks.add(rest.substring(0, cut).trim());
    rest = rest.substring(cut).trim();
  }
  if (rest.isNotEmpty) chunks.add(rest);
  return chunks;
}

/// 校验一次合成请求；返回问题或 `null`。
///
/// 与 TS 的 `validateTtsRequest` 返回**错误码**不同，这里返回人类可读的中文 ——
/// Flutter 端不需要把错误码再映射一次。
String? validateTtsText(String text) {
  final String trimmed = text.trim();
  if (trimmed.length < ttsTextMin) return '没有可朗读的内容';
  if (trimmed.length > ttsTextMax) return '单次朗读最多 $ttsTextMax 字，长文请分段';
  return null;
}
