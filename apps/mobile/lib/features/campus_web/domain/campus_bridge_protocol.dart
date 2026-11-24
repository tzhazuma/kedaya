/// 内嵌页面 ↔ Dart 的请求/响应协议。
///
/// 为什么需要 id：页面里的 `fetch` 是异步的，多个请求可能并发（ELRC 的课程列表
/// 与播放地址、OA 的表单提交），没有 id 就只能靠"最后一条覆盖前一条"，会串数据。
///
/// 协议形态（单条 JSON，长度不受 URL 限制）：
/// ```json
/// // Dart → 页面
/// {"id":"r1","url":"/learn/v1/...","method":"GET","form":null}
/// // 页面 → Dart
/// {"id":"r1","status":200,"body":"…","error":null}
/// ```
library;

import 'dart:convert';

/// Dart 侧发起的请求。
final class CampusBridgeRequest {
  const CampusBridgeRequest({
    required this.id,
    required this.url,
    this.method = 'GET',
    this.form,
    this.json,
    this.expr,
  });

  final String id;

  /// 可以是相对路径（页面内自动按 origin 解析），也可以是完整 URL。
  final String url;
  final String method;

  /// `application/x-www-form-urlencoded` 的字段；GET 时忽略。
  final Map<String, String>? form;

  /// `application/json` 请求体（ELRC 的 rman 接口要 JSON 而不是表单）。
  final Object? json;

  /// 页面内表达式（`eval`）。用于读 DOM/全局变量，例如 OA 的 `loginidweaver`。
  /// 与 `url` 二选一；设置时不会发网络请求。
  final String? expr;

  String encode() => jsonEncode(<String, Object?>{
        'id': id,
        'url': url,
        'method': method,
        'form': form,
        'json': json,
        'expr': expr,
      });
}

/// 页面回传的响应。
final class CampusBridgeResponse {
  const CampusBridgeResponse({
    required this.id,
    required this.status,
    required this.body,
    this.error,
  });

  final String id;
  final int status;
  final String body;
  final String? error;

  bool get isOk => error == null && status >= 200 && status < 400;

  /// 解析失败返回 null（页面返回的可能是 HTML）。
  Map<String, dynamic>? tryJson() {
    try {
      final Object? decoded = jsonDecode(body);
      return decoded is Map<String, dynamic> ? decoded : null;
    } catch (_) {
      return null;
    }
  }

  /// 未知/损坏的消息返回 null，调用方必须显式处理（不要静默当成成功）。
  static CampusBridgeResponse? decode(String raw) {
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return null;
      final Object? id = decoded['id'];
      final Object? status = decoded['status'];
      if (id is! String || status is! int) return null;
      return CampusBridgeResponse(
        id: id,
        status: status,
        body: (decoded['body'] as String?) ?? '',
        error: decoded['error'] as String?,
      );
    } catch (_) {
      return null;
    }
  }
}

/// 注入到页面的脚本：定义 `kedayaRequest(jsonString)`。
///
/// 与 `kedayaFetch` 的区别：这里必须带 id 并把结果原样回传，供 Dart 侧按 id 配对。
/// 依然**不读 document.cookie**：同源 fetch 由浏览器自动带 cookie。
const String campusBridgeScript = r'''
(function () {
  if (window.__kedayaBridgeInstalled) return;
  window.__kedayaBridgeInstalled = true;
  window.kedayaEval = function (payloadJson) {
    var payload;
    try { payload = JSON.parse(payloadJson); } catch (e) { payload = null; }
    if (!payload || !payload.id) return;
    var value = null;
    var error = null;
    try {
      // 只允许读取值：调用方传的是表达式，不是函数体。
      value = (0, eval)(payload.expr);
      if (value !== null && typeof value === 'object') {
        value = JSON.stringify(value);
      }
    } catch (e) { error = String(e); }
    if (window.KedayaBridge) {
      window.KedayaBridge.postMessage(JSON.stringify({
        id: payload.id, status: error ? 0 : 200,
        body: error ? '' : String(value), error: error
      }));
    }
  };
  window.kedayaRequest = async function (payloadJson) {
    var payload;
    try { payload = JSON.parse(payloadJson); } catch (e) { payload = null; }
    if (!payload || !payload.id) return;
    var reply = function (status, body, error) {
      if (window.KedayaBridge) {
        window.KedayaBridge.postMessage(JSON.stringify({
          id: payload.id, status: status, body: body, error: error || null
        }));
      }
    };
    try {
      var options = { credentials: 'include', method: payload.method || 'GET',
        headers: { 'Accept': 'application/json, text/html;q=0.9, */*;q=0.8' } };
      if (payload.json !== null && payload.json !== undefined) {
        options.body = JSON.stringify(payload.json);
        options.headers['Content-Type'] = 'application/json';
      } else if (payload.form && options.method !== 'GET') {
        options.body = new URLSearchParams(payload.form);
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      var response = await fetch(payload.url, options);
      var text = await response.text();
      reply(response.status, text, null);
    } catch (error) {
      reply(0, '', String(error));
    }
  };
})();
''';
