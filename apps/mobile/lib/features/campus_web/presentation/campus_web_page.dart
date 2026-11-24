import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../presentation/components/kedaya_shell.dart';
import '../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../presentation/theme/kedaya_tokens.dart';
import '../domain/campus_bridge_protocol.dart';

/// 校园系统内嵌页 + 同源抓取桥。
///
/// 为什么必须"在页面里 fetch"：CASTGC/JSESSIONID 这类 cookie 是 HttpOnly 的，
/// Dart 侧既读不到也不该读；只有**同源页面内的 fetch** 才会自动带上它们。
/// 所以这里不搬运 cookie，而是在加载完成后注入一个 `kedayaFetch` 函数，
/// 由页面自己发请求，再把 `{status, body}` 通过 JS 通道回传。
///
/// 平台限制：`webview_flutter` 只覆盖 Android / iOS；桌面与鸿蒙走
/// "复制链接到系统浏览器"的降级路径（见 `CampusServicesPage`）。
class CampusWebPage extends StatefulWidget {
  const CampusWebPage({
    required this.url,
    required this.title,
    super.key,
  });

  final String url;
  final String title;

  @override
  State<CampusWebPage> createState() => _CampusWebPageState();
}

/// 兼容旧测试：页面注入的脚本就是协议脚本。
const String campusWebBridgeScript = campusBridgeScript;

bool campusWebSupported(TargetPlatform platform) =>
    platform == TargetPlatform.android || platform == TargetPlatform.iOS;

class _CampusWebPageState extends State<CampusWebPage> {
  WebViewController? _controller;
  String? _lastFetch;
  final Map<String, Completer<CampusBridgeResponse>> _pending =
      <String, Completer<CampusBridgeResponse>>{};
  int _sequence = 0;
  bool get _supported => !kIsWeb && campusWebSupported(defaultTargetPlatform);

  Future<void> _requestCurrentPage() async {
    final WebViewController? controller = _controller;
    if (controller == null) return;
    final String id = 'r${_sequence++}';
    final Completer<CampusBridgeResponse> completer =
        Completer<CampusBridgeResponse>();
    _pending[id] = completer;
    final CampusBridgeRequest request =
        CampusBridgeRequest(id: id, url: 'location.href');
    // location.href 不是合法 URL；页面里换成当前地址。
    final String script =
        'kedayaRequest(${jsonEncode(request.encode())})'
            .replaceFirst('"location.href"', 'location.href');
    await controller.runJavaScript(script);
    final CampusBridgeResponse response = await completer.future.timeout(
      const Duration(seconds: 20),
      onTimeout: () {
        _pending.remove(id);
        return CampusBridgeResponse(
          id: id,
          status: 0,
          body: '',
          error: '请求超时',
        );
      },
    );
    if (!mounted) return;
    setState(() {
      _lastFetch = response.error == null
          ? '${response.status} · ${response.body.length} 字符'
          : '失败：${response.error}';
    });
  }

  @override
  void initState() {
    super.initState();
    if (!_supported) return;
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel(
        'KedayaBridge',
        onMessageReceived: (JavaScriptMessage message) {
          final CampusBridgeResponse? response =
              CampusBridgeResponse.decode(message.message);
          if (response == null) return;
          final Completer<CampusBridgeResponse>? completer =
              _pending.remove(response.id);
          completer?.complete(response);
          if (!mounted) return;
          setState(() => _lastFetch = response.error == null
              ? '${response.id} · HTTP ${response.status} · '
                  '${response.body.length} 字符'
              : '${response.id} · 失败：${response.error}');
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (String url) {
            _controller?.runJavaScript(campusBridgeScript);
          },
        ),
      )
      ..loadRequest(Uri.parse(widget.url));
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    if (!_supported) {
      return KedaYaPageScaffold(
        title: widget.title,
        child: Center(
          child: Text(
            '当前平台没有内嵌浏览器。请在手机上使用本功能，或把链接复制到浏览器打开。',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              color: colors.textMuted,
            ),
          ),
        ),
      );
    }
    return KedaYaPageScaffold(
      title: widget.title,
      padding: EdgeInsets.zero,
      actions: <Widget>[
        IconButton(
          tooltip: '抓取当前页',
          onPressed: () => _requestCurrentPage(),
          icon: const Icon(Icons.cloud_download_outlined),
        ),
      ],
      // 提示条之外仍然保持整页高度给 WebView。
      child: Column(
        children: <Widget>[
          if (_lastFetch != null)
            Container(
              width: double.infinity,
              color: colors.surfaceAlt,
              padding: const EdgeInsets.symmetric(
                horizontal: KedaYaTokens.space3,
                vertical: KedaYaTokens.space1,
              ),
              child: Text(
                '桥接：$_lastFetch（内容不落日志）',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: colors.textMuted,
                ),
              ),
            ),
          Expanded(child: WebViewWidget(controller: _controller!)),
        ],
      ),
    );
  }
}

/// 建议路由。
const String campusWebRoutePath = '/campus-web';
