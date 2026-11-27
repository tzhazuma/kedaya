import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../presentation/theme/kedaya_tokens.dart';
import '../../campus_web/presentation/campus_web_page.dart' show campusWebSupported;
import '../domain/cas_callback.dart';

/// 内嵌的学校统一身份登录页（Android / iOS）。
///
/// 用户在**学校自己的页面**里输入账号密码；本页只盯着地址栏：
/// 一旦跳到校方注册过的回调地址，就取出一次性授权码并交给上层换令牌。
/// 密码不经过 Dart 侧，回调地址本身也不会被保存。
class CasWebViewPage extends StatefulWidget {
  const CasWebViewPage({
    required this.loginUrl,
    required this.returnUrl,
    super.key,
  });

  final String loginUrl;

  /// 校方注册的回调地址（服务端 `auth/cas/login-url` 的 `service` 字段）。
  final String returnUrl;

  /// 当前平台是否有内嵌浏览器。
  static bool get supported =>
      !kIsWeb && campusWebSupported(defaultTargetPlatform);

  @override
  State<CasWebViewPage> createState() => _CasWebViewPageState();
}

class _CasWebViewPageState extends State<CasWebViewPage> {
  WebViewController? _controller;
  bool _finished = false;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (NavigationRequest request) {
            if (_tryExtract(request.url)) return NavigationDecision.prevent;
            return NavigationDecision.navigate;
          },
          onPageFinished: _tryExtract,
        ),
      )
      ..loadRequest(Uri.parse(widget.loginUrl));
  }

  /// 地址是否已经是回调；是则取出授权码并结束本页。
  bool _tryExtract(String url) {
    if (_finished || widget.returnUrl.isEmpty) return false;
    if (!url.startsWith(widget.returnUrl)) return false;
    final String? code = extractCasCode(url);
    if (code == null) return false;
    _finished = true;
    // 回调地址本身会被加载出来，但那只是个空壳页；直接返回即可。
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.of(context).pop(code);
    });
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Scaffold(
      appBar: AppBar(title: const Text('学校统一身份认证')),
      body: Column(
        children: <Widget>[
          Container(
            width: double.infinity,
            color: colors.surfaceAlt,
            padding: const EdgeInsets.all(KedaYaTokens.space3),
            child: Text(
              '这是学校的登录页面。登录成功后会自动返回，无需手动复制授权码。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
          ),
          Expanded(
            child: _controller == null
                ? const Center(child: CircularProgressIndicator())
                : WebViewWidget(controller: _controller!),
          ),
        ],
      ),
    );
  }
}
