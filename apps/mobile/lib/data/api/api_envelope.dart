import 'dart:convert';

import '../../domain/models/api_error.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/result.dart';

/// 后端统一响应信封（冻结契约 §6.1）。
///
/// **所有**网络响应都必须先收敛到本类型，不允许各处自行解包。
/// 这是 `dart:convert` 允许出现的位置（`domain` 层禁止）。
sealed class ApiEnvelope<T> {
  const ApiEnvelope({required this.traceId});

  /// 契约 §6.1：响应体 `traceId`，用于跨端排查。
  final String traceId;

  bool get isOk => this is ApiSuccess<T>;

  bool get isFailure => this is ApiFailure<T>;

  /// 成功信封（后端与 mock 共用）。
  static ApiSuccess<T> success<T>(T data, String traceId) =>
      ApiSuccess<T>(data: data, traceId: traceId);

  /// 失败信封。
  static ApiFailure<T> failure<T>(
    ApiErrorCode code,
    String message,
    String traceId, {
    Object? details,
  }) => ApiFailure<T>(
    error: ApiError(code: code, message: message, details: details),
    traceId: traceId,
  );

  /// 解析**已解码**的 JSON 对象。
  static ApiEnvelope<T> parse<T>(Object? decoded, T Function(Object? data) decode) {
    if (decoded is! Map<String, Object?>) {
      return failure<T>(
        ApiErrorCode.internal,
        '响应不是 JSON 对象（${decoded.runtimeType}）',
        '',
      );
    }
    final String traceId = readStringOr(decoded, 'traceId', '');
    if (decoded['ok'] == true) {
      return ApiSuccess<T>(data: decode(decoded['data']), traceId: traceId);
    }
    final Object? rawError = decoded['error'];
    final ApiError error = rawError is Map<String, Object?>
        ? ApiError.fromJson(rawError)
        : const ApiError(code: ApiErrorCode.internal, message: '响应缺少 error 字段');
    return ApiFailure<T>(error: error, traceId: traceId);
  }

  /// 从原始响应体字符串解析。
  static ApiEnvelope<T> parseBody<T>(String body, T Function(Object? data) decode) {
    if (body.trim().isEmpty) {
      return failure<T>(ApiErrorCode.internal, '空响应体', '');
    }
    Object? decoded;
    try {
      decoded = jsonDecode(body);
    } on FormatException catch (error) {
      return failure<T>(ApiErrorCode.internal, '响应解析失败：${error.message}', '');
    }
    return parse<T>(decoded, decode);
  }
}

final class ApiSuccess<T> extends ApiEnvelope<T> {
  const ApiSuccess({required this.data, required super.traceId});

  final T data;

  @override
  String toString() => 'ApiSuccess(traceId=$traceId)';
}

final class ApiFailure<T> extends ApiEnvelope<T> {
  const ApiFailure({required this.error, required super.traceId});

  final ApiError error;

  @override
  String toString() => 'ApiFailure($error, traceId=$traceId)';
}

/// 信封 -> [Result]（契约 §6.3）。
Result<T> toResult<T>(ApiEnvelope<T> envelope) => switch (envelope) {
  ApiSuccess<T>(:final T data) => Ok<T>(data),
  ApiFailure<T>(:final ApiError error, :final String traceId) =>
    Err<T>(error, traceId: traceId),
};
