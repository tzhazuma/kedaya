import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../domain/models/bind_credential.dart';
import '../../../../domain/models/techpie_link.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/mock_state_menu.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/techpie_providers.dart';
import '../components/techpie_cards.dart';

/// 绑定管理页（路由 `/techpie/bindings`）。
///
/// 三态由 [AsyncStateView] 统一渲染；数据只来自 `TechpiePort.listLinks()`，
/// 而绑定元数据里**没有任何凭证字段**（规格 §8.3）。
class TechpieBindingsPage extends ConsumerStatefulWidget {
  const TechpieBindingsPage({super.key});

  @override
  ConsumerState<TechpieBindingsPage> createState() =>
      _TechpieBindingsPageState();
}

class _TechpieBindingsPageState extends ConsumerState<TechpieBindingsPage> {
  String? _busyLinkId;

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<TechpieLink>> value = ref.watch(
      techpieLinksControllerProvider,
    );
    final TechpieLinksController controller = ref.read(
      techpieLinksControllerProvider.notifier,
    );
    final MockControls? mockControls = ref.watch(mockControlsProvider);

    return KedaYaPageScaffold(
      title: '绑定管理',
      padding: EdgeInsets.zero,
      actions: <Widget>[
        if (mockControls != null)
          MockStateMenu(
            controls: mockControls,
            onChanged: () => ref.invalidate(techpieLinksControllerProvider),
          ),
        IconButton(
          tooltip: '刷新',
          onPressed: () => unawaited(controller.refresh()),
          icon: const Icon(Icons.refresh),
        ),
      ],
      child: RefreshIndicator(
        onRefresh: controller.refresh,
        child: AsyncStateView<List<TechpieLink>>(
          value: value,
          isEmpty: (List<TechpieLink> links) => links.isEmpty,
          emptyTitle: '还没有任何绑定',
          emptyDescription: '绑定是第二级能力：它决定"你能访问哪些校园系统"，'
              '与"你是谁"（登录）是两件事。点下面的按钮发起绑定。',
          loadingMessage: '正在读取绑定…',
          onRetry: controller.refresh,
          builder: (BuildContext context, List<TechpieLink> links) => ListView(
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            children: <Widget>[
              const CredentialFreeNotice(
                extra: '服务端响应里若出现会话串 / 网站凭据 / 会话票据这类键名，'
                    '客户端不会读取它们（解析只认白名单里的键）。',
              ),
              const SizedBox(height: KedaYaTokens.space4),
              for (final TechpieLink link in links) ...<Widget>[
                TechpieLinkCard(
                  link: link,
                  busy: _busyLinkId != null,
                  onUnbind: () => unawaited(_unbind(link)),
                  onRenew: () => unawaited(_renew(link)),
                ),
                const SizedBox(height: KedaYaTokens.space3),
              ],
              const SizedBox(height: KedaYaTokens.space2),
              FilledButton.icon(
                onPressed: () => unawaited(_openBindSheet(context)),
                icon: const Icon(Icons.add_link, size: 18),
                label: const Text('发起绑定'),
              ),
              const SizedBox(height: KedaYaTokens.space2),
              OutlinedButton.icon(
                onPressed: () => context.push('/campus-card'),
                icon: const Icon(Icons.credit_card, size: 18),
                label: const Text('校园卡（独立 OPENID 通道）'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _unbind(TechpieLink link) async {
    setState(() => _busyLinkId = link.id);
    try {
      await ref.read(techpieActionsProvider).unbind(link.id);
      _toast('已解绑 ${link.platform.label}（登录状态不受影响）');
    } on Object catch (error) {
      _toast('解绑失败：$error');
    } finally {
      if (mounted) setState(() => _busyLinkId = null);
    }
  }

  Future<void> _renew(TechpieLink link) async {
    setState(() => _busyLinkId = link.id);
    try {
      await ref.read(techpieActionsProvider).renew(link.id);
      _toast('已续期 ${link.platform.label}');
    } on Object catch (error) {
      // F3：上游没有续期能力时**不谎称"已续期"**（规格 §10.1）。
      _toast('续期未成功：$error');
    } finally {
      if (mounted) setState(() => _busyLinkId = null);
    }
  }

  Future<void> _openBindSheet(BuildContext context) async {
    final bool isMock = ref.read(mockControlsProvider) != null;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) => _BindSheet(
        isMockRuntime: isMock,
        onBind: _bind,
        onOpenWebView: () {
          Navigator.of(sheetContext).pop();
          context.push('/techpie/webview');
        },
        onOpenCampusCard: () {
          Navigator.of(sheetContext).pop();
          context.push('/campus-card');
        },
      ),
    );
  }

  /// 返回是否绑定成功（失败时面板不关闭，用户能看到原因）。
  Future<bool> _bind(CampusPlatform platform, BindCredential credential) async {
    setState(() => _busyLinkId = platform.wire);
    try {
      await ref.read(techpieActionsProvider).bind(platform, credential);
      _toast('已绑定 ${platform.label}');
      return true;
    } on Object catch (error) {
      _toast('绑定失败：$error');
      return false;
    } finally {
      if (mounted) setState(() => _busyLinkId = null);
    }
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}

/// 发起绑定的选择面板。
///
/// ⚠️ **Phase 0 只提供免口令通道**：契约 §11.18-D（U12）明确
/// 「绑定时接受明文密码风险极高……在信息办回复前，Phase 1 的绑定流程不实现」。
/// 因此这里**没有**口令输入框，`BindCredential` 的密封类型里也没有口令变体 ——
/// 这是**类型层面**的约束，不是靠注释提醒。
class _BindSheet extends StatelessWidget {
  const _BindSheet({
    required this.isMockRuntime,
    required this.onBind,
    required this.onOpenWebView,
    required this.onOpenCampusCard,
  });

  final bool isMockRuntime;
  final Future<bool> Function(
      CampusPlatform platform, BindCredential credential) onBind;
  final VoidCallback onOpenWebView;
  final VoidCallback onOpenCampusCard;

  /// Phase 0 可发起绑定的平台。
  ///
  /// **不含** `ecard`（它走独立 OPENID 通道，入口在校园卡页），
  /// 也**不含** `cas`（那是一级身份源，不是可绑定的校园系统）。
  static const List<CampusPlatform> phase0Platforms = <CampusPlatform>[
    CampusPlatform.egate,
    CampusPlatform.cpdaily,
    CampusPlatform.techpie,
  ];

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        child: ListView(
          shrinkWrap: true,
          children: <Widget>[
            Text(
              '发起绑定',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeLg,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: colors.text,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '免口令通道优先（规格 §8.5 的硬要求）。Phase 0 不实现明文口令绑定 ——'
              '它阻塞于信息办对 U12 的书面回复（契约 §11.18-D）。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space3),
            for (final CampusPlatform platform in phase0Platforms) ...<Widget>[
              _PlatformRow(
                platform: platform,
                isMockRuntime: isMockRuntime,
                onBind: onBind,
              ),
              const SizedBox(height: KedaYaTokens.space2),
            ],
            const Divider(),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.public),
              title: const Text('校园系统直连（用户自己登录）'),
              subtitle: const Text('Phase 0 的推荐入口：我们不接触校园会话。'),
              onTap: onOpenWebView,
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.credit_card),
              title: const Text('校园卡（独立 OPENID 通道）'),
              subtitle: const Text('不依赖校园会话代持，零合规风险。'),
              onTap: onOpenCampusCard,
            ),
          ],
        ),
      ),
    );
  }
}

class _PlatformRow extends StatelessWidget {
  const _PlatformRow({
    required this.platform,
    required this.isMockRuntime,
    required this.onBind,
  });

  final CampusPlatform platform;
  final bool isMockRuntime;
  final Future<bool> Function(
      CampusPlatform platform, BindCredential credential) onBind;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            platform.label,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '需要校园系统授权码（免口令通道）。原生侧授权流程尚未实现，'
            '因此真实运行时这一项不可用 —— 我们不伪造授权码。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
          if (isMockRuntime) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            OutlinedButton(
              onPressed: () async {
                final bool ok = await onBind(
                  platform,
                  OAuthCodeCredential(code: 'mock-oauth-code-${platform.wire}'),
                );
                if (ok && context.mounted) Navigator.of(context).pop();
              },
              child: const Text('（mock）用模拟授权码绑定'),
            ),
          ],
        ],
      ),
    );
  }
}
