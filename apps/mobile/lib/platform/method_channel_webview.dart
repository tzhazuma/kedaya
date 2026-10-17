import 'package:flutter/services.dart';

import '../domain/ports/webview_port.dart';

/// [WebViewPort] 的原生实现：通过 MethodChannel 让原生宿主打开一次性中转 URL。
///
/// **原生侧契约**（iOS / Android / 鸿蒙各实现一次）：
/// ```
/// channel : kedaya/webview
/// method  : openOneTimeUrl -> bool
///           参数 { url: String }   // 服务端签发的一次性中转 URL
/// ```
///
/// ⚠️ **原生侧实现未写**（与 `MethodChannelUnifiedIdentity` / `MethodChannelLocation`
/// 的现状一致：`android/` `ios/` `ohos/` 目录都还没生成）。因此真实运行时
/// [openOneTimeUrl] 会返回 `false`，UI 自动降级为"本机暂不支持内嵌打开"的
/// 说明文案 —— 这条降级路径是**完整可用**的，不是占位。
///
/// ⚠️ **方法只接受一个 URL**：原生侧**不得**从 Dart 侧接收任何校园会话串 /
/// cookie / 自定义请求头（ADR §4-D 明确否决的路径）。原生 WebView 只负责打开
/// 服务端签发的一次性中转 URL；会话的注入发生在**服务端**，客户端从未持有它。
final class MethodChannelWebView implements WebViewPort {
  const MethodChannelWebView({MethodChannel channel = _defaultChannel})
      : _channel = channel;

  static const MethodChannel _defaultChannel = MethodChannel('kedaya/webview');

  final MethodChannel _channel;

  @override
  Future<bool> openOneTimeUrl(String url) async {
    try {
      final bool? opened = await _channel.invokeMethod<bool>(
        'openOneTimeUrl',
        <String, Object?>{'url': url},
      );
      return opened ?? false;
    } on MissingPluginException {
      return false;
    } on PlatformException {
      return false;
    }
  }
}
