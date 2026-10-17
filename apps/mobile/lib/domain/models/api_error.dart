import 'json_read.dart';

/// 机器可读错误码（冻结契约 §6.1）。
///
/// **禁止**各端私自定义字符串：新增错误码必须先改 `packages/contracts`。
enum ApiErrorCode {
  unauthenticated('UNAUTHENTICATED'),
  forbidden('FORBIDDEN'),
  notFound('NOT_FOUND'),
  validationFailed('VALIDATION_FAILED'),
  rateLimited('RATE_LIMITED'),
  conflict('CONFLICT'),
  campusBindingRequired('CAMPUS_BINDING_REQUIRED'),
  consentRequired('CONSENT_REQUIRED'),
  upstreamUnavailable('UPSTREAM_UNAVAILABLE'),
  internal('INTERNAL');

  const ApiErrorCode(this.wire);

  /// 线上字符串形式。
  final String wire;

  /// 未知字符串收敛为 [ApiErrorCode.internal]（后端新增码而客户端未升级时，
  /// 至少不会把一次失败误判成成功）。
  static ApiErrorCode fromWire(String wire) {
    for (final ApiErrorCode code in ApiErrorCode.values) {
      if (code.wire == wire) return code;
    }
    return ApiErrorCode.internal;
  }
}

/// 面向用户的中文兜底文案（后端未给 message 时使用）。
const Map<ApiErrorCode, String> apiErrorFallbackMessages =
    <ApiErrorCode, String>{
  ApiErrorCode.unauthenticated: '登录已过期，请重新登录',
  ApiErrorCode.forbidden: '没有权限执行该操作',
  ApiErrorCode.notFound: '内容不存在或已下架',
  ApiErrorCode.validationFailed: '请求参数不合法',
  ApiErrorCode.rateLimited: '操作过于频繁，请稍后再试',
  ApiErrorCode.conflict: '操作冲突，请刷新后重试',
  ApiErrorCode.campusBindingRequired: '请先绑定校园系统后再使用该功能',
  ApiErrorCode.consentRequired: '请先阅读并同意该模块的隐私说明',
  ApiErrorCode.upstreamUnavailable: '校园系统暂时不可用，请稍后再试',
  ApiErrorCode.internal: '出了点问题，请稍后再试',
};

/// 结构化错误（契约 §6.1 `ApiError`）。
final class ApiError {
  const ApiError({required this.code, required this.message, this.details});

  factory ApiError.fromJson(Map<String, Object?> json) => ApiError(
        code: ApiErrorCode.fromWire(readStringOr(json, 'code', 'INTERNAL')),
        message: readStringOr(json, 'message', ''),
        details: json['details'],
      );

  final ApiErrorCode code;

  /// 面向用户的中文文案；可能为空，展示前请用 [userMessage]。
  final String message;

  /// 可选结构化细节（字段级校验错误等）。
  final Object? details;

  /// 需要用户先去绑定校园系统（契约 §5 硬规则 3）。
  bool get needsCampusBinding => code == ApiErrorCode.campusBindingRequired;

  /// 需要用户先做二次同意（契约 §9）。
  bool get needsConsent => code == ApiErrorCode.consentRequired;

  /// 一定非空的用户可读文案。
  String get userMessage => message.isNotEmpty
      ? message
      : (apiErrorFallbackMessages[code] ?? '出了点问题');

  Map<String, Object?> toJson() => <String, Object?>{
        'code': code.wire,
        'message': message,
        if (details != null) 'details': details,
      };

  @override
  String toString() => 'ApiError(${code.wire}: $userMessage)';
}

/// 领域层异常：把 [ApiError] 从 `Result` 里抛出来时使用。
///
/// `presentation` 通过 `error is ApiException` 就能拿到 [ApiErrorCode] 分支渲染，
/// 不需要认识 HTTP / Dio。
final class ApiException implements Exception {
  const ApiException(this.error, {this.traceId});

  final ApiError error;

  /// 契约 §6.1：追踪 id，错误上报时一并带上。
  final String? traceId;

  ApiErrorCode get code => error.code;

  @override
  String toString() => 'ApiException(${error.code.wire}: ${error.userMessage}'
      '${traceId == null ? '' : ', traceId=$traceId'})';
}
