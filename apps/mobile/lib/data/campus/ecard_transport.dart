import 'package:dio/dio.dart';

import 'campus_http_client.dart';
import 'ecard_api_client.dart';

/// [EcardTransport] 的 Dio 实现：任意方法 + 原始 body + 自定义头。
///
/// 为什么不用 `CampusHttpClient`：它只有 `get` 与 `postForm`，而校园卡流水是
/// **GET 带 body**、且需要 `session-type` / `isWechatApp` 这类自定义头。
///
/// 明确不做的事：
/// - 不跟随跨 host 重定向（会话失效时的跳转不该被静默跟随）；
/// - 不打印请求体/头（`datajson` 与 cookie 都在里面）。
final class DioEcardTransport {
  DioEcardTransport({Dio? dio})
      : _dio = dio ??
            Dio(
              BaseOptions(
                connectTimeout: const Duration(seconds: 12),
                receiveTimeout: const Duration(seconds: 20),
                followRedirects: false,
                responseType: ResponseType.plain,
                validateStatus: (int? status) => status != null,
              ),
            );

  final Dio _dio;

  Future<CampusHttpResponse> call({
    required String method,
    required Uri uri,
    required String body,
    required Map<String, String> headers,
  }) async {
    final Response<String> response = await _dio.request<String>(
      uri.toString(),
      data: method == 'GET' ? null : body,
      options: Options(method: method, headers: headers),
    );
    return CampusHttpResponse(
      statusCode: response.statusCode ?? 0,
      body: response.data ?? '',
      headers: response.headers.map,
    );
  }

  EcardTransport get transport => call;
}
