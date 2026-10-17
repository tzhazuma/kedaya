import '../../domain/models/api_error.dart';

/// mock 适配器的故障注入开关。
///
/// 目的是让 UI 的 **loading / error / empty 三态在无后端时也能被真实触发**
/// （契约 §7 硬规则 4）。切换后无需重启：直接改 `controls.failureMode`。
enum MockFailureMode {
  none,
  upstreamUnavailable,
  notFound,
  unauthenticated,
  consentRequired,
  validationFailed;

  /// 对应的领域错误；[none] 表示不注入故障。
  ApiError? get error => switch (this) {
    MockFailureMode.none => null,
    MockFailureMode.upstreamUnavailable => const ApiError(
      code: ApiErrorCode.upstreamUnavailable,
      message: '（mock）校园系统暂时不可用，请稍后再试',
    ),
    MockFailureMode.notFound => const ApiError(
      code: ApiErrorCode.notFound,
      message: '（mock）内容不存在或已下架',
    ),
    MockFailureMode.unauthenticated => const ApiError(
      code: ApiErrorCode.unauthenticated,
      message: '（mock）登录已过期，请重新登录',
    ),
    MockFailureMode.consentRequired => const ApiError(
      code: ApiErrorCode.consentRequired,
      message: '（mock）请先阅读并同意该模块的隐私说明',
    ),
    MockFailureMode.validationFailed => const ApiError(
      code: ApiErrorCode.validationFailed,
      message: '（mock）请求参数不合法',
    ),
  };
}
