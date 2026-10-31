import '../models/result.dart';
import '../models/tts.dart';

/// 朗读端口。
///
/// 只有**一个**方法：合成。播放是 presentation 层的事（`audioplayers`），
/// domain 不该知道「怎么放声音」。
abstract interface class TtsPort {
  /// 合成一段文本。
  ///
  /// ⚠️ 服务端在模型未安装时返回 503（`UPSTREAM_UNAVAILABLE`）——
  /// 那是**部署问题**，UI 必须如实说明，不能说成「网络错误」。
  Future<Result<TtsAudio>> synthesize(String text, {double? speed});
}
