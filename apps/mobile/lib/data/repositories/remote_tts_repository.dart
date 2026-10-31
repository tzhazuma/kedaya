import '../../domain/models/api_error.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/result.dart';
import '../../domain/models/tts.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../../domain/ports/tts_port.dart';

/// 真后端朗读仓储。
///
/// 端点：`POST /api/v1/tts/synthesize` → `{ audioId, url, sampleRate, durationMs, ... }`
///
/// ⚠️ 模型未安装时服务端返回 **503**（信封码 `UPSTREAM_UNAVAILABLE`）。
/// 这里**不改写**成别的码 —— presentation 层要能区分「部署没做好」与「这次输入有问题」。
final class RemoteTtsRepository implements TtsPort {
  const RemoteTtsRepository(this._api);

  static const String _path = 'tts/synthesize';

  final KedayaApiPort _api;

  @override
  Future<Result<TtsAudio>> synthesize(String text, {double? speed}) {
    // 客户端先做一次本地校验：超长文本不该占用一次网络往返。
    // 但**不替代**服务端校验 —— 服务端仍然会再验一次。
    final String? problem = validateTtsText(text);
    if (problem != null) {
      return Future<Result<TtsAudio>>.value(
        Err<TtsAudio>(ApiError(code: ApiErrorCode.validationFailed, message: problem)),
      );
    }

    return _api.send<TtsAudio>(
      ApiRequest(
        path: _path,
        method: ApiMethod.post,
        body: <String, Object?>{
          'text': text.trim(),
          if (speed != null) 'speed': speed,
        },
      ),
      (Object? data) {
        if (data is! Map<String, Object?>) {
          throw const FormatException('tts synthesize: 响应不是对象');
        }
        return TtsAudio.fromJson(data);
      },
    );
  }
}
