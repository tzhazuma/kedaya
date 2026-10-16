import '../models/api_request.dart';
import '../models/result.dart';

/// 唯一网络出口（契约 §7 硬规则 3）。
///
/// `presentation` 禁止直接发请求；所有 IO 必须经实现（`data/api/`）。
/// 实现负责：`/api/v1` 前缀、Bearer 注入、`X-KedaYa-Trace`、401 刷新重试、
/// 把后端 `ApiEnvelope` 收敛为 [Result]。
abstract interface class KedayaApiPort {
  /// 发送请求并解包信封。
  ///
  /// [decode] 把信封里的 `data`（已解码的 JSON）转成领域模型 —— 契约 §6.1 的
  /// `Page<T>` 也在这里被组装。失败（含 `ok: false` 与网络异常）返回 [Err]。
  Future<Result<T>> send<T>(ApiRequest request, T Function(Object? data) decode);

  /// 无返回体的请求（DELETE / 动作端点）。成功值为 [Unit.instance]。
  Future<Result<Unit>> sendVoid(ApiRequest request);

  /// 最近一次请求的 traceId（契约 §6.1），错误上报时带上。
  String? get lastTraceId;
}
