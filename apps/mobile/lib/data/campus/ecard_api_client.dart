import 'dart:convert';

import 'campus_http_client.dart';
import 'ecard_cipher.dart';

/// 校园卡业务失败（与网络错误区分）。
final class EcardException implements Exception {
  const EcardException(this.message, {this.authExpired = false});

  final String message;
  final bool authExpired;

  @override
  String toString() => message;
}

/// 传输函数：由调用方决定用 Dio / 桥 / 测试替身。
typedef EcardTransport = Future<CampusHttpResponse> Function({
  required String method,
  required Uri uri,
  required String body,
  required Map<String, String> headers,
});

/// 校园卡只读接口（账户 / 流水）。
///
/// 为什么不能走 WebView 桥：`/selftrade/queryCardSelfTradeList` 是 GET 带 body，
/// 浏览器 fetch 禁止；且需要 `session-type` 等自定义头。因此这里走 Dart 直连，
/// cookie 由 `CampusCookieVault` 提供。
final class EcardApiClient {
  EcardApiClient({
    required EcardTransport transport,
    required String openId,
    EcardCipher? cipher,
    this.baseUrl = 'https://ecard.shanghaitech.edu.cn',
    this.cookieHeader,
  })  : _transport = transport,
        _openId = openId,
        _cipher = cipher ?? EcardCipher();

  final EcardTransport _transport;
  final String _openId;
  final EcardCipher _cipher;
  final String baseUrl;

  /// 可选的 Cookie 头（来自 vault）；为空表示该接口不需要 cookie。
  final String? cookieHeader;

  Future<Object?> post(String path, Map<String, Object?> data) =>
      _send('POST', path, data);

  Future<Object?> get(String path, Map<String, Object?> data) =>
      _send('GET', path, data);

  /// 账户信息（余额、姓名、卡号脱敏等由上游返回）。
  Future<Map<String, dynamic>> account() async {
    final Object? data = await post('/myaccount/openMyAccountApp', <String, Object?>{});
    return _requireMap(data, context: '账户');
  }

  /// 交易流水（一页）。
  Future<Map<String, dynamic>> transactions({
    required String beginDate,
    required String endDate,
    int pageNumber = 0,
    int pageSize = 20,
  }) async {
    if (pageSize < 1 || pageSize > 50) {
      throw const EcardException('每页条数应在 1–50 之间');
    }
    final Object? data = await get('/selftrade/queryCardSelfTradeList', <String, Object?>{
      'beginDate': beginDate,
      'endDate': endDate,
      'starttime': beginDate,
      'endtime': endDate,
      'tradeType': 0,
      'pageSize': pageSize,
      'pageNumber': pageNumber,
    });
    return _requireMap(data, context: '流水');
  }

  Future<Object?> _send(
    String method,
    String path,
    Map<String, Object?> data,
  ) async {
    final Map<String, Object?> payload = <String, Object?>{
      ...data,
      'openid': _openId,
    };
    final String body = jsonEncode(<String, String>{
      'datajson': _cipher.encodeRequest(payload),
    });
    final Map<String, String> headers = <String, String>{
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      'session-type': 'uniapp',
      'isWechatApp': 'true',
      if (cookieHeader != null && cookieHeader!.isNotEmpty) 'cookie': cookieHeader!,
    };

    final CampusHttpResponse response = await _transport(
      method: method,
      uri: Uri.parse('$baseUrl$path'),
      body: body,
      headers: headers,
    );

    if (response.statusCode == 401 || response.statusCode == 403) {
      throw const EcardException('校园卡登录已失效', authExpired: true);
    }
    if (!response.isOk) {
      throw EcardException('校园卡请求失败（${response.statusCode}）');
    }

    final Object? decoded;
    try {
      decoded = EcardCipher.decodeResponse(response.body);
    } on FormatException {
      throw const EcardException('校园卡返回格式发生变化');
    }
    _throwIfRejected(decoded);
    return decoded;
  }

  void _throwIfRejected(Object? decoded) {
    if (decoded is! Map<dynamic, dynamic>) return;
    final Object? code = decoded['code'];
    if (code == null) return;
    final int? numeric = code is int ? code : int.tryParse('$code');
    if (numeric == null || numeric == 0 || numeric == 200) return;
    final String message = '${decoded['message'] ?? decoded['msg'] ?? ''}'.trim();
    throw EcardException(message.isEmpty ? '校园卡请求失败（$numeric）' : message);
  }

  Map<String, dynamic> _requireMap(Object? data, {required String context}) {
    if (data is Map<String, dynamic>) return data;
    throw EcardException('$context 返回格式发生变化');
  }
}
