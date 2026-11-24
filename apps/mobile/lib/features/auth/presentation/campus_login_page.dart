import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/app_providers.dart';
import '../../../domain/models/api_request.dart';
import '../../../domain/models/result.dart';
import '../../../domain/ports/kedaya_api_port.dart';
import '../../../domain/ports/webview_port.dart';
import '../../../presentation/components/kedaya_shell.dart';
import '../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../presentation/theme/kedaya_tokens.dart';
import '../../../application/session_controller.dart';

/// 校园统一身份登录（CAS）。
///
/// 流程：
///   1. `GET /api/v1/auth/cas/login-url` 取登录地址（服务端按注册的回调拼出）
///   2. 用内嵌浏览器 / 系统浏览器完成登录
///   3. 回调跳到 `KEDAYA_CAS_RETURN_URL?code=…`，把 code 粘回来（或由深链接自动填入）
///   4. `POST /auth/cas/exchange` 换取令牌
///
/// 为什么不用密码自动化：CAS 的密码登录可能带验证码/设备校验，把密码交给脚本
/// 既脆弱又容易被风控；浏览器登录 + 一次性授权码是标准做法，桌面端也能用。
class CampusLoginPage extends ConsumerStatefulWidget {
  const CampusLoginPage({super.key});

  @override
  ConsumerState<CampusLoginPage> createState() => _CampusLoginPageState();
}

class _CampusLoginPageState extends ConsumerState<CampusLoginPage> {
  final TextEditingController _code = TextEditingController();
  String? _loginUrl;
  String? _notice;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadLoginUrl();
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _loadLoginUrl() async {
    final KedayaApiPort? api = ref.read(appRuntimeProvider).api;
    if (api == null) {
      setState(() => _notice = '当前是演示运行时，未连接后端');
      return;
    }
    final Result<Map<String, dynamic>> result =
        await api.send<Map<String, dynamic>>(
      const ApiRequest(path: 'auth/cas/login-url', method: ApiMethod.get),
      (Object? body) => body is Map<String, dynamic> ? body : <String, dynamic>{},
    );
    if (!mounted) return;
    final Map<String, dynamic>? data = result.valueOrNull;
    final String? url = data?['url'] as String?;
    setState(() => _notice = url == null
        ? (result.errorOrNull?.userMessage ?? '暂时拿不到登录地址')
        : null);
    if (url != null) setState(() => _loginUrl = url);
  }

  Future<void> _openLogin() async {
    final String? url = _loginUrl;
    if (url == null) return;
    final WebViewPort port = ref.read(webViewProvider);
    // 先取 messenger，避免 await 之后再碰 context。
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    final bool opened = await port.openOneTimeUrl(url);
    if (opened) return;
    await ref.read(shareProvider).copyToClipboard(url);
    messenger.showSnackBar(
      const SnackBar(content: Text('已复制登录链接，请在浏览器打开')),
    );
  }

  Future<void> _submit() async {
    final String code = _code.text.trim();
    if (code.isEmpty) {
      setState(() => _notice = '请粘贴回调地址里的 code');
      return;
    }
    setState(() {
      _busy = true;
      _notice = null;
    });
    final GoRouter router = GoRouter.of(context);
    await ref.read(sessionControllerProvider.notifier).signInWithCode(code);
    if (!mounted) return;
    final AsyncValue<Object?> state = ref.read(sessionControllerProvider);
    setState(() {
      _busy = false;
      _notice = state.hasError ? '登录失败：${state.error}' : null;
    });
    if (!state.hasError) router.pop();
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return KedaYaPageScaffold(
      title: '校园统一身份登录',
      child: ListView(
        children: <Widget>[
          Text(
            '登录在学校页面上完成，本应用只接收一次性授权码，不接触你的密码。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              color: colors.textMuted,
              height: KedaYaTokens.lineHeightNormal,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          FilledButton.icon(
            onPressed: _loginUrl == null ? null : _openLogin,
            icon: const Icon(Icons.open_in_new, size: 18),
            label: const Text('打开学校登录页'),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          TextField(
            controller: _code,
            decoration: const InputDecoration(
              labelText: '授权码（回调地址里的 code）',
              helperText: '登录后浏览器会跳到带 ?code=… 的地址，把 code 粘到这里',
            ),
            minLines: 1,
            maxLines: 2,
          ),
          if (_notice != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(_notice!, style: TextStyle(color: colors.warning)),
          ],
          const SizedBox(height: KedaYaTokens.space4),
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? '登录中…' : '用授权码登录'),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          Text(
            '管理员需要在校方注册回调地址，并在服务端设置 '
            'CAMPUS_CAS_SERVICE / CAMPUS_CAS_MODE=live / KEDAYA_CAS_RETURN_URL。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
              height: KedaYaTokens.lineHeightNormal,
            ),
          ),
        ],
      ),
    );
  }
}

/// 建议路由。
const String campusLoginRoutePath = '/campus-login';

List<RouteBase> campusLoginRoutes() => <RouteBase>[
      GoRoute(
        path: campusLoginRoutePath,
        name: 'campus-login',
        builder: (BuildContext context, GoRouterState state) =>
            const CampusLoginPage(),
      ),
    ];
