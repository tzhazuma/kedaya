import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';

import 'ecard_api_client.dart' show EcardException;

/// 绑定码换来的 OPENID，以及它属于哪个渠道。
final class EcardBindResult {
  const EcardBindResult({
    required this.openId,
    this.userType,
    this.orgId,
  });

  final String openId;
  final String? userType;
  final String? orgId;

  /// 小程序上报的 `usertype` 决定渠道；未上报时按微信处理。
  String get channel {
    final String? type = userType?.trim();
    return type == null || type.isEmpty ? 'wechat' : type;
  }
}

/// 绑定码交换的传输函数（测试替身用）。
typedef EcardBindTransport = Future<EcardBindHttpResponse> Function({
  required String method,
  required Uri uri,
  required String body,
  required Map<String, String> headers,
});

final class EcardBindHttpResponse {
  const EcardBindHttpResponse({required this.statusCode, required this.body});

  final int statusCode;
  final String body;
}

/// 一次性绑定码 → OPENID 的交换客户端。
///
/// 为什么单独一个客户端而不是塞进 [EcardApiClient]：这条链路**不走**校园卡
/// 的 `datajson` 信封与加密，它是 `/__ecard_bind` 下的独立 JSON 端点，鉴权靠
/// 一个共享密钥头；混进业务客户端会让两种协议互相渗透。
///
/// 密钥不写死在源码里：`bindToken` 由调用方从配置（`--dart-define` 或服务端
/// 下发）注入，为空时构造即失败——宁可启动就报错，也不要在运行时静默降级成
/// 「没有密钥也能绑定」的假象。
final class EcardBindClient {
  EcardBindClient({
    required String bindToken,
    EcardBindTransport? transport,
    this.baseUrl = 'https://ecard.shanghaitech.edu.cn',
    this.timeout = const Duration(seconds: 15),
  })  : _bindToken = bindToken.trim(),
        _transport = transport ?? _sendOverHttp {
    if (_bindToken.isEmpty) {
      throw ArgumentError.value(
        bindToken,
        'bindToken',
        '绑定码交换需要共享密钥，请通过配置注入',
      );
    }
  }

  static const String exchangePath = '/__ecard_bind/exchange';
  static const String healthPath = '/__ecard_bind/health';

  final String _bindToken;
  final EcardBindTransport _transport;
  final String baseUrl;
  final Duration timeout;

  Uri get exchangeUrl => Uri.parse('$baseUrl$exchangePath');

  /// 把小程序展示的绑定码换成 OPENID。
  ///
  /// 码先在本地规整（去空白、转大写）再发，避免用户把带空格的码贴进来时
  /// 被服务端判成格式错误；空码不发请求。
  Future<EcardBindResult> exchange(String code) async {
    final String normalized = code.replaceAll(RegExp(r'\s+'), '').toUpperCase();
    if (normalized.isEmpty) {
      throw const EcardException('请输入绑定码');
    }

    final EcardBindHttpResponse response;
    try {
      response = await _transport(
        method: 'POST',
        uri: exchangeUrl,
        body: jsonEncode(<String, String>{'code': normalized}),
        headers: <String, String>{
          'content-type': 'application/json',
          'accept': 'application/json',
          'X-Bind-Token': _bindToken,
        },
      ).timeout(timeout);
    } on TimeoutException {
      throw const EcardException('绑定服务响应超时，请检查网络后重试');
    } on Exception {
      throw const EcardException('无法连接绑定服务，请确认网络环境后重试');
    }

    if (response.statusCode == 400) {
      throw const EcardException('绑定码格式不正确');
    }
    if (response.statusCode == 401) {
      throw const EcardException('绑定服务未授权，请联系管理员');
    }
    if (response.statusCode == 404 || response.statusCode == 410) {
      throw const EcardException('绑定码无效或已过期，请在小程序重新获取');
    }
    if (response.statusCode != 200) {
      throw EcardException('绑定服务暂时不可用（${response.statusCode}）');
    }

    // 200 不等于成功：落到同一 host 的别的服务、强制门户也会回 200，
    // 它们的 JSON 里没有 ok。只有 ok == true 才算换到了码。
    final Object? decoded = _decode(response.body);
    if (decoded is! Map<String, Object?> || decoded['ok'] != true) {
      throw const EcardException('绑定服务返回异常，请重试');
    }
    final Object? openId = decoded['openid'];
    if (openId is! String || openId.trim().isEmpty) {
      throw const EcardException('绑定服务未返回 OPENID，请重试');
    }
    return EcardBindResult(
      openId: openId.trim(),
      userType: decoded['usertype']?.toString(),
      orgId: decoded['orgid']?.toString(),
    );
  }

  /// 自检：服务在不在、密钥认不认。
  Future<bool> health() async {
    final EcardBindHttpResponse response;
    try {
      response = await _transport(
        method: 'GET',
        uri: Uri.parse('$baseUrl$healthPath'),
        body: '',
        headers: <String, String>{'accept': 'application/json'},
      ).timeout(timeout);
    } on TimeoutException {
      return false;
    } on Exception {
      return false;
    }
    if (response.statusCode != 200) return false;
    final Object? decoded = _decode(response.body);
    return decoded is Map<String, Object?> && decoded['ok'] == true;
  }

  static Object? _decode(String body) {
    if (body.isEmpty) return null;
    try {
      return jsonDecode(body);
    } on FormatException {
      return null;
    }
  }

  /// 默认传输：无 cookie、无重定向。绑定端点是幂等的一次性换码，
  /// 不需要沿用校园卡会话，也不需要跟着重定向跑到别的 host 上去。
  static Future<EcardBindHttpResponse> _sendOverHttp({
    required String method,
    required Uri uri,
    required String body,
    required Map<String, String> headers,
  }) async {
    final Dio dio = Dio(
      BaseOptions(
        connectTimeout: const Duration(seconds: 12),
        receiveTimeout: const Duration(seconds: 15),
        followRedirects: false,
        responseType: ResponseType.plain,
        validateStatus: (int? status) => status != null,
      ),
    );
    try {
      final Response<String> response = await dio.request<String>(
        uri.toString(),
        data: method == 'GET' ? null : body,
        options: Options(method: method, headers: headers),
      );
      return EcardBindHttpResponse(
        statusCode: response.statusCode ?? 0,
        body: response.data ?? '',
      );
    } finally {
      dio.close(force: true);
    }
  }
}
