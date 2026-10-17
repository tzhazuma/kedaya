import 'package:dio/dio.dart';

import '../../domain/models/api_request.dart';
import 'request_ids.dart';

/// 取当前 accessToken（无会话返回 null）。
typedef AccessTokenSupplier = String? Function();

/// 401 时尝试续期；返回是否成功。
typedef SessionRefresher = Future<bool> Function();

/// 追踪 id 生成器。
typedef TraceIdFactory = String Function();

/// 统一 Dio 装配（冻结契约 §6.1 HTTP 约定）：
///   - baseUrl 收敛为 `<host>/api/v1`；
///   - 请求头注入 `Authorization: Bearer <accessToken>` 与 `X-KedaYa-Trace`；
///   - 401 时调用 [SessionRefresher] 续期一次并重放原请求（幂等重试）；
///   - 响应体保持原始字符串，交由 `ApiEnvelope` 解包（见 `kedaya_api_client.dart`）。
final class KedaYaDioClient {
  KedaYaDioClient({
    required String baseUrl,
    required AccessTokenSupplier accessToken,
    required SessionRefresher refreshSession,
    Dio? dio,
    TraceIdFactory? traceIdFactory,
    Duration connectTimeout = const Duration(seconds: 10),
    Duration receiveTimeout = const Duration(seconds: 20),
  })  : _accessToken = accessToken,
        _refreshSession = refreshSession,
        _traceIdFactory = traceIdFactory ?? defaultTraceIdFactory,
        _dio = dio ?? Dio() {
    _dio.options = _dio.options.copyWith(
      baseUrl: normalizeBaseUrl(baseUrl),
      connectTimeout: connectTimeout,
      receiveTimeout: receiveTimeout,
      contentType: Headers.jsonContentType,
      responseType: ResponseType.plain,
    );
    _dio.interceptors.add(
      InterceptorsWrapper(onRequest: _onRequest, onError: _onError),
    );
  }

  static const String _retriedKey = 'kedaya.auth.retried';

  final Dio _dio;
  final AccessTokenSupplier _accessToken;
  final SessionRefresher _refreshSession;
  final TraceIdFactory _traceIdFactory;

  /// 最近一次请求的 traceId（契约 §6.1）。
  String? lastTraceId;

  /// 供 [KedaYaApiClient] 直接发起请求。
  Dio get raw => _dio;

  /// 把 host 收敛为 `<host>/api/v1`；已带前缀时不重复拼接。
  static String normalizeBaseUrl(String host) {
    final String trimmed =
        host.endsWith('/') ? host.substring(0, host.length - 1) : host;
    return trimmed.endsWith(apiBasePath) ? trimmed : '$trimmed$apiBasePath';
  }

  void _onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final String traceId = _traceIdFactory();
    lastTraceId = traceId;
    options.headers[traceHeader] = traceId;
    final String? token = _accessToken();
    if (token != null && token.isNotEmpty) {
      options.headers[authHeader] = 'Bearer $token';
    }
    handler.next(options);
  }

  Future<void> _onError(
      DioException error, ErrorInterceptorHandler handler) async {
    final RequestOptions options = error.requestOptions;
    final bool alreadyRetried = options.extra[_retriedKey] == true;
    if (error.response?.statusCode != 401 || alreadyRetried) {
      handler.next(error);
      return;
    }
    final bool refreshed = await _refreshSession();
    if (!refreshed) {
      handler.next(error);
      return;
    }
    options.extra[_retriedKey] = true;
    final String? token = _accessToken();
    if (token != null && token.isNotEmpty) {
      options.headers[authHeader] = 'Bearer $token';
    }
    try {
      final Response<Object?> retried = await _dio.fetch<Object?>(options);
      handler.resolve(retried);
    } on DioException catch (retryError) {
      handler.next(retryError);
    }
  }

  /// 释放底层连接池（`AppRuntime.dispose()` 调用）。
  Future<void> close() async => _dio.close(force: true);
}
