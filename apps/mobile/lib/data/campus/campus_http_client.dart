import 'dart:convert';

import 'package:dio/dio.dart';

import 'campus_cookie_jar.dart';

/// 校园系统的 HTTP 客户端：自动带 cookie、自动吸收 `Set-Cookie`。
///
/// 明确不做的事：
/// - 不打印请求/响应头（cookie 在头里）；
/// - 不把响应体写日志；
/// - 不跟随跨 host 重定向（CAS 之外的重定向一般意味着会话失效）。
final class CampusHttpClient {
  CampusHttpClient({
    required CampusCookieJar jar,
    Dio? dio,
  })  : _jar = jar,
        _dio = dio ??
            Dio(
              BaseOptions(
                connectTimeout: const Duration(seconds: 12),
                receiveTimeout: const Duration(seconds: 20),
                followRedirects: true,
                maxRedirects: 5,
                responseType: ResponseType.plain,
                validateStatus: (int? status) => status != null,
              ),
            );

  final CampusCookieJar _jar;
  final Dio _dio;

  /// GET，自动带该 host 的 cookie 并把响应的 `Set-Cookie` 吸收进 jar。
  Future<CampusHttpResponse> get(String url) async {
    final Uri uri = Uri.parse(url);
    final Response<String> response = await _dio.get<String>(
      url,
      options: Options(headers: _headersFor(uri)),
    );
    _absorb(uri, response);
    return CampusHttpResponse(
      statusCode: response.statusCode ?? 0,
      body: response.data ?? '',
      headers: response.headers.map,
    );
  }

  /// 表单 POST（OA / 教务系统大量使用 `application/x-www-form-urlencoded`）。
  Future<CampusHttpResponse> postForm(
    String url,
    Map<String, String> form,
  ) async {
    final Uri uri = Uri.parse(url);
    final Response<String> response = await _dio.post<String>(
      url,
      data: form,
      options: Options(
        headers: <String, dynamic>{
          ..._headersFor(uri),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      ),
    );
    _absorb(uri, response);
    return CampusHttpResponse(
      statusCode: response.statusCode ?? 0,
      body: response.data ?? '',
      headers: response.headers.map,
    );
  }

  Map<String, dynamic> _headersFor(Uri uri) {
    final String? cookie = _jar.headerFor(uri.host);
    return <String, dynamic>{
      if (cookie != null) 'Cookie': cookie,
      'User-Agent': 'KedaYa/0.1 (+campus client)',
      'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
    };
  }

  void _absorb(Uri uri, Response<dynamic> response) {
    final List<String>? raw = response.headers['set-cookie'];
    if (raw != null && raw.isNotEmpty) {
      _jar.absorb(uri.host, raw);
    }
  }
}

/// 精简后的响应（页面/表单都按字符串处理）。
final class CampusHttpResponse {
  const CampusHttpResponse({
    required this.statusCode,
    required this.body,
    required this.headers,
  });

  final int statusCode;
  final String body;
  final Map<String, List<String>> headers;

  bool get isOk => statusCode >= 200 && statusCode < 400;

  /// 教务/OA 的 JSON 接口常返回 `{"code":...}`；解析失败返回 null 而不是抛错。
  Map<String, dynamic>? tryJson() {
    try {
      final Object? decoded = jsonDecode(body);
      return decoded is Map<String, dynamic> ? decoded : null;
    } catch (_) {
      return null;
    }
  }
}
