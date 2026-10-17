import '../../domain/models/api_error.dart';
import '../../domain/models/result.dart';
import 'mock_failure.dart';

/// mock 适配器共享的运行时开关：**模拟延迟** + **故障注入**。
///
/// 测试里传 `MockControls(latency: Duration.zero)`，UI 里保留默认延迟以便看到
/// loading 态。所有 mock 仓库都暴露自己的 `controls`，可在运行时切换。
final class MockControls {
  MockControls({
    this.latency = const Duration(milliseconds: 250),
    this.failureMode = MockFailureMode.none,
  });

  Duration latency;
  MockFailureMode failureMode;

  /// 让列表返回空集（用于演示/验证 **empty** 三态）。
  bool emptyResults = false;

  /// 让 loading 态可见；[latency] 为零时不做任何等待（测试友好）。
  Future<void> simulate() async {
    if (latency > Duration.zero) {
      await Future<void>.delayed(latency);
    }
  }

  /// 当前注入的错误；null 表示正常路径。
  ApiError? get failure => failureMode.error;

  /// 便捷构造失败结果。
  Err<T> failureResult<T>() => Err<T>(failure!, traceId: 'mock-trace');

  /// mock 响应的固定 traceId（契约 §6.1）。
  static const String traceId = 'mock-trace';
}
