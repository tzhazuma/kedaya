import '../../domain/models/api_error.dart';
import '../../domain/models/result.dart';
import '../../domain/models/tts.dart';
import '../../domain/ports/tts_port.dart';

/// Mock 模式下的朗读端口。
///
/// ## 为什么是「永远失败」而不是「假装成功」
///
/// 朗读的产物是**音频**。mock 一个音频等于让 UI 显示「正在播放」但什么声音都没有 ——
/// 那比明确说「当前模式不支持朗读」更糟：用户会以为手机坏了。
///
/// 所以这里返回 `UPSTREAM_UNAVAILABLE`，文案说清楚是**当前模式**的限制。
/// presentation 层对 503 的处理本来就是「功能暂不可用」，正好对应。
final class MockTtsRepository implements TtsPort {
  const MockTtsRepository();

  @override
  Future<Result<TtsAudio>> synthesize(String text, {double? speed}) async {
    final String? problem = validateTtsText(text);
    if (problem != null) {
      return Err<TtsAudio>(ApiError(code: ApiErrorCode.validationFailed, message: problem));
    }
    return Err<TtsAudio>(
      const ApiError(
        code: ApiErrorCode.upstreamUnavailable,
        message: '当前是演示模式（无后端），朗读需要连接服务器',
      ),
    );
  }
}
