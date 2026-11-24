import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../presentation/components/kedaya_shell.dart';
import '../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../presentation/theme/kedaya_tokens.dart';

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

/// 注入到页面里的抓取函数（纯字符串，便于单测）。
const String campusWebBridgeScript = r'''
(function () {
  if (window.__kedayaBridgeInstalled) return;
  window.__kedayaBridgeInstalled = true;
  window.kedayaFetch = async function (url, options) {
    try {
      const response = await fetch(url, Object.assign({
        credentials: 'include',
        headers: { 'Accept': 'application/json, text/plain, */*' }
      }, options || {}));
      const text = await response.text();
      if (window.KedayaBridge) {
        window.KedayaBridge.postMessage(JSON.stringify({
          url: url, status: response.status, body: text
        }));
      }
      return text;
    } catch (error) {
      if (window.KedayaBridge) {
        window.KedayaBridge.postMessage(JSON.stringify({
          url: url, status: 0, body: String(error)
        }));
      }
      return null;
    }
  };
})();
''';

bool campusWebSupported(TargetPlatform platform) =>
    platform == TargetPlatform.android || platform == TargetPlatform.iOS;

class _CampusWebPageState extends State<CampusWebPage> {
  WebViewController? _controller;
  String? _lastFetch;
  bool get _supported => !kIsWeb && campusWebSupported(defaultTargetPlatform);

  @override
  void initState() {
    super.initState();
    if (!_supported) return;
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel(
        'KedayaBridge',
        onMessageReceived: (JavaScriptMessage message) {
          if (!mounted) return;
          setState(() => _lastFetch = message.message);
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (String url) {
            _controller?.runJavaScript(campusWebBridgeScript);
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
          onPressed: () {
            _controller?.runJavaScript('kedayaFetch(location.href)');
          },
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
                '桥接回传 ${_lastFetch!.length} 字符（内容不落日志）',
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
