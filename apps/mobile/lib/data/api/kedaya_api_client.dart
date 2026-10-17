import 'dart:convert';

import 'package:dio/dio.dart';

import '../../domain/models/api_error.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/kedaya_api_port.dart';
import 'api_envelope.dart';
import 'dio_client.dart';

/// 保证 path 以 `/` 开头，且不重复携带 `/api/v1` 前缀（契约 §6.1）。
String normalizePath(String path) {
  String normalized = path.trim();
  if (normalized.startsWith(apiBasePath)) {
    normalized = normalized.substring(apiBasePath.length);
  }
  if (!normalized.startsWith('/')) {
    normalized = '/$normalized';
  }
  return normalized;
}

/// [KedayaApiPort] 的 Dio 实现：把后端 `ApiEnvelope` 收敛为 Dart [Result]。
final class KedaYaApiClient implements KedayaApiPort {
  KedaYaApiClient({required KedaYaDioClient client}) : _client = client;

  final KedaYaDioClient _client;

  @override
  String? get lastTraceId => _client.lastTraceId;

  @override
  Future<Result<T>> send<T>(
          ApiRequest request, T Function(Object? data) decode) async =>
      toResult<T>(await _request<T>(request, decode));

  @override
  Future<Result<Unit>> sendVoid(ApiRequest request) async {
    try {
      final Response<Object?> response = await _client.raw.request<Object?>(
        normalizePath(request.path),
        data: request.body,
        queryParameters: request.query,
        options: _optionsFor(request),
      );
      final Object? body = response.data;
      if (body is String && body.trim().isNotEmpty) {
        return toResult<Unit>(
          ApiEnvelope.parseBody<Unit>(body, (Object? _) => Unit.instance),
        );
      }
      return Ok<Unit>(Unit.instance);
    } on DioException catch (error) {
      final ApiEnvelope<Unit>? envelope = _failureEnvelope<Unit>(
        error,
        (Object? _) => Unit.instance,
      );
      if (envelope != null) return toResult<Unit>(envelope);
      final ApiError mapped = _mapDioError(error);
      return Err<Unit>(mapped, traceId: _client.lastTraceId);
    } on Object catch (error) {
      return Err<Unit>(
        ApiError(code: ApiErrorCode.internal, message: '请求失败：$error'),
        traceId: _client.lastTraceId,
      );
    }
  }

  Future<ApiEnvelope<T>> _request<T>(
      ApiRequest request, T Function(Object? data) decode) async {
    try {
      final Response<Object?> response = await _client.raw.request<Object?>(
        normalizePath(request.path),
        data: request.body,
        queryParameters: request.query,
        options: _optionsFor(request),
      );
      return _envelopeFrom<T>(response, decode);
    } on DioException catch (error) {
      final ApiEnvelope<T>? envelope = _failureEnvelope<T>(error, decode);
      if (envelope != null) return envelope;
      final ApiError mapped = _mapDioError(error);
      return ApiEnvelope.failure<T>(
          mapped.code, mapped.message, _client.lastTraceId ?? '');
    } on Object catch (error) {
      return ApiEnvelope.failure<T>(
        ApiErrorCode.internal,
        '请求失败：$error',
        _client.lastTraceId ?? '',
      );
    }
  }

  /// `multipart/form-data` 上传（规格 §4.1：图片走服务端代理上传）。
  ///
  /// 与 [send] 共用 [_envelopeFrom] 与 [_failureEnvelope]，因此错误语义完全一致
  /// （422 `VALIDATION_FAILED` / `MEDIA_TOO_LARGE` 等由后端信封给出）。
  /// 不设置 `contentType`：由 Dio 自己写 multipart boundary，也让后端的
  /// **魔数校验**（规格 §4.2：不信任 `Content-Type`）成为唯一的格式判据。
  @override
  Future<Result<T>> sendMultipart<T>(
    ApiRequest request,
    List<ApiUploadFile> files,
    T Function(Object? data) decode,
  ) async {
    try {
      final FormData form = FormData();
      final Object? body = request.body;
      if (body is Map<String, Object?>) {
        for (final MapEntry<String, Object?> entry in body.entries) {
          final Object? value = entry.value;
          if (value == null) continue;
          form.fields.add(MapEntry<String, String>(entry.key, '$value'));
        }
      }
      for (final ApiUploadFile file in files) {
        form.files.add(
          MapEntry<String, MultipartFile>(
            file.field,
            MultipartFile.fromBytes(file.bytes, filename: file.fileName),
          ),
        );
      }

      final Response<Object?> response = await _client.raw.request<Object?>(
        normalizePath(request.path),
        data: form,
        queryParameters: request.query,
        options: _optionsFor(request),
      );
      return toResult<T>(_envelopeFrom<T>(response, decode));
    } on DioException catch (error) {
      final ApiEnvelope<T>? envelope = _failureEnvelope<T>(error, decode);
      if (envelope != null) return toResult<T>(envelope);
      return Err<T>(_mapDioError(error), traceId: _client.lastTraceId);
    } on Object catch (error) {
      return Err<T>(
        ApiError(code: ApiErrorCode.internal, message: '上传失败：$error'),
        traceId: _client.lastTraceId,
      );
    }
  }

  /// 把一次响应收敛为信封（[send] 与 [sendMultipart] 共用）。
  ApiEnvelope<T> _envelopeFrom<T>(
      Response<Object?> response, T Function(Object? data) decode) {
    final Object? body = response.data;
    if (body is String && body.trim().isNotEmpty) {
      return ApiEnvelope.parseBody<T>(body, decode);
    }
    if (body is Map<String, Object?>) {
      return ApiEnvelope.parse<T>(body, decode);
    }
    return ApiEnvelope.failure<T>(
      ApiErrorCode.internal,
      '空响应体',
      _client.lastTraceId ?? '',
    );
  }

  Options _optionsFor(ApiRequest request) => Options(
        method: request.method.wire,
        // null 时保持 Dio 全局默认（`application/json`）；契约 §11.1 的
        // JSON Merge Patch 会显式传 `application/merge-patch+json`。
        contentType: request.contentType,
        headers: <String, dynamic>{
          if (request.idempotencyKey != null)
            idempotencyHeader: request.idempotencyKey,
        },
      );

  /// 4xx/5xx 的响应体通常仍是失败信封 —— 优先用它，能拿到后端的中文文案与错误码。
  ///
  /// 只有确认 `ok: false` 才采用；否则（例如反代返回的 HTML 错误页）交给 HTTP 状态映射。
  ApiEnvelope<T>? _failureEnvelope<T>(
      DioException error, T Function(Object? data) decode) {
    final Object? body = error.response?.data;
    Map<String, Object?>? json;
    if (body is Map<String, Object?>) {
      json = body;
    } else if (body is String && body.trim().startsWith('{')) {
      try {
        final Object? decoded = jsonDecode(body);
        if (decoded is Map<String, Object?>) json = decoded;
      } on FormatException {
        json = null;
      }
    }
    if (json == null || json['ok'] != false) return null;
    return ApiEnvelope.parse<T>(json, decode);
  }
}

ApiError _mapDioError(DioException error) => switch (error.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.sendTimeout ||
      DioExceptionType.receiveTimeout =>
        const ApiError(
          code: ApiErrorCode.upstreamUnavailable,
          message: '网络超时，请稍后重试',
        ),
      DioExceptionType.connectionError => const ApiError(
          code: ApiErrorCode.upstreamUnavailable,
          message: '无法连接服务器，请检查网络',
        ),
      DioExceptionType.badCertificate => const ApiError(
          code: ApiErrorCode.upstreamUnavailable,
          message: '服务器证书校验失败',
        ),
      DioExceptionType.cancel => const ApiError(
          code: ApiErrorCode.internal,
          message: '请求已取消',
        ),
      DioExceptionType.badResponse =>
        _mapStatusCode(error.response?.statusCode ?? 0),
      DioExceptionType.unknown => ApiError(
          code: ApiErrorCode.upstreamUnavailable,
          message: '网络异常：${error.message ?? '未知原因'}',
        ),
      _ => const ApiError(code: ApiErrorCode.internal, message: '请求失败'),
    };

ApiError _mapStatusCode(int status) {
  if (status == 401) {
    return const ApiError(
        code: ApiErrorCode.unauthenticated, message: '登录已过期，请重新登录');
  }
  if (status == 403) {
    return const ApiError(code: ApiErrorCode.forbidden, message: '没有权限执行该操作');
  }
  if (status == 404) {
    return const ApiError(code: ApiErrorCode.notFound, message: '内容不存在或已下架');
  }
  if (status == 409) {
    return const ApiError(code: ApiErrorCode.conflict, message: '操作冲突，请刷新后重试');
  }
  if (status == 400 || status == 422) {
    return const ApiError(
        code: ApiErrorCode.validationFailed, message: '请求参数不合法');
  }
  if (status == 429) {
    return const ApiError(
        code: ApiErrorCode.rateLimited, message: '操作过于频繁，请稍后再试');
  }
  if (status >= 500) {
    return const ApiError(
        code: ApiErrorCode.upstreamUnavailable, message: '服务暂时不可用');
  }
  return ApiError(code: ApiErrorCode.internal, message: '请求失败（HTTP $status）');
}
