import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/app_providers.dart';
import '../../../application/session_controller.dart';
import '../../../domain/models/api_request.dart';
import '../../../domain/models/result.dart';
import '../../../domain/ports/kedaya_api_port.dart';
import '../../../platform/system_browser.dart';
import '../../../presentation/components/kedaya_shell.dart';
import '../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../presentation/theme/kedaya_tokens.dart';
import '../domain/cas_callback.dart';
import 'cas_webview_page.dart';

/// 校园统一身份登录（CAS）。
///
/// 流程：
///   1. `GET /api/v1/auth/cas/login-url` 取登录地址与回调地址
///   2. 手机端在内嵌的学校页面里登录，跳到回调地址时**自动**取出授权码；
///      桌面端交给系统浏览器，用户把回调地址整段粘回来即可（不用手摘 code）
///   3. `POST /auth/cas/exchange` 换取令牌
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
  String? _returnUrl;
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
      setState(() => _notice = '当前是演示运行时，未连接后端，暂时无法登录学校账号');
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
    setState(() {
      _notice = url == null
          ? (result.errorOrNull?.userMessage ?? '暂时拿不到登录地址')
          : null;
      _loginUrl = url;
      _returnUrl = data?['service'] as String?;
    });
  }

  Future<void> _openLogin() async {
    final String? url = _loginUrl;
    if (url == null) return;

    // 手机端：内嵌学校页面，回调时自动取码，全程不用复制粘贴。
    if (CasWebViewPage.supported && (_returnUrl?.isNotEmpty ?? false)) {
      final String? code = await Navigator.of(context).push<String>(
        MaterialPageRoute<String>(
          builder: (_) => CasWebViewPage(
            loginUrl: url,
            returnUrl: _returnUrl!,
          ),
        ),
      );
      if (code != null && mounted) {
        _code.text = code;
        await _submit();
      }
      return;
    }

    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    // 桌面端：原生宿主还没实现内嵌打开，直接交给系统浏览器。
    if (await openInSystemBrowser(url)) {
      messenger.showSnackBar(
        const SnackBar(content: Text('已在浏览器打开学校登录页，登录后把地址整段粘回来即可')),
      );
      return;
    }
    final bool opened = await ref.read(webViewProvider).openOneTimeUrl(url);
    if (opened) return;
    await ref.read(shareProvider).copyToClipboard(url);
    messenger.showSnackBar(
      const SnackBar(content: Text('已复制登录链接，请在浏览器打开')),
    );
  }

  Future<void> _submit() async {
    final String? code = extractCasCode(_code.text);
    if (code == null) {
      setState(() => _notice = '没认出授权码：可以只填 code，也可以粘贴整个回调地址');
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
    final bool embedded = CasWebViewPage.supported;
    return KedaYaPageScaffold(
      title: '统一身份登录',
      child: ListView(
        children: <Widget>[
          Container(
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            decoration: BoxDecoration(
              color: colors.surface,
              borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
              border: Border.all(color: colors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: colors.brandSoft,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(Icons.badge_outlined,
                          size: 22, color: colors.brandStrong),
                    ),
                    const SizedBox(width: KedaYaTokens.space3),
                    Expanded(
                      child: Text(
                        '用学校账号登录',
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeLg,
                          fontWeight: KedaYaTokens.fontWeightSemibold,
                          color: colors.text,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: KedaYaTokens.space3),
                Text(
                  '登录在学校自己的页面上完成。本应用只接收一次性授权码，'
                  '看不到、也不会保存你的密码。',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    color: colors.textMuted,
                    height: KedaYaTokens.lineHeightLoose,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _loginUrl == null ? null : _openLogin,
              icon: const Icon(Icons.open_in_new, size: 18),
              label: Text(
                _loginUrl == null
                    ? '正在获取登录地址…'
                    : embedded
                        ? '在应用内打开学校登录页'
                        : '在浏览器打开学校登录页',
              ),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space5),
          if (!embedded) ...<Widget>[
            Text(
              '登录完成后',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: colors.text,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '浏览器会跳到一个打不开的地址（形如 …?code=…）。'
              '把地址栏整段复制过来就行，授权码会自动识别。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightLoose,
                color: colors.textMuted,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space3),
            TextField(
              controller: _code,
              decoration: InputDecoration(
                labelText: '授权码或回调地址',
                helperText: '支持直接粘贴完整地址，自动提取 code',
                suffixIcon: IconButton(
                  tooltip: '粘贴',
                  icon: const Icon(Icons.content_paste, size: 18),
                  onPressed: () async {
                    final ClipboardData? data =
                        await Clipboard.getData(Clipboard.kTextPlain);
                    final String? text = data?.text;
                    if (text == null || text.isEmpty || !mounted) return;
                    setState(() => _code.text = text);
                  },
                ),
              ),
              minLines: 1,
              maxLines: 3,
            ),
            const SizedBox(height: KedaYaTokens.space3),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _busy ? null : _submit,
                child: Text(_busy ? '登录中…' : '完成登录'),
              ),
            ),
          ],
          if (_notice != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            Text(
              _notice!,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: colors.warning,
                height: KedaYaTokens.lineHeightNormal,
              ),
            ),
          ],
          const SizedBox(height: KedaYaTokens.space4),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(
              '部署说明（给运维看）',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
            children: <Widget>[
              Text(
                '需要在校方注册回调地址，并在服务端设置 '
                'CAMPUS_CAS_SERVICE / CAMPUS_CAS_MODE=live / KEDAYA_CAS_RETURN_URL。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: colors.textMuted,
                  height: KedaYaTokens.lineHeightNormal,
                ),
              ),
            ],
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
