import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../domain/models/campus_web_entry.dart';
import '../../../../domain/models/techpie_link.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/mock_state_menu.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/techpie_providers.dart';
import '../components/techpie_cards.dart';

/// 校园系统直连页（路由 `/techpie/webview`）。
///
/// 流程（规格 §8.4）：
///
/// ```
/// 客户端预校验 targetUrl（fail-closed）
///   → POST /techpie/webview-session   换一次性票据（30 秒）
///   → GET  /techpie/webview-session/:ticket  换一次性中转 URL
///   → 交给 WebView 宿主打开
/// ```
///
/// ⚠️ **票据与中转 URL 都不进这个页面的状态**：它们只活在
/// `TechpieWebViewLauncher.open()` 的栈上，返回的 outcome 里也没有它们。
/// 页面状态里只有"结局 + 原因"。
class TechpieWebViewPage extends ConsumerStatefulWidget {
  const TechpieWebViewPage({super.key});

  @override
  ConsumerState<TechpieWebViewPage> createState() => _TechpieWebViewPageState();
}

class _TechpieWebViewPageState extends ConsumerState<TechpieWebViewPage> {
  WebViewLaunchOutcome? _lastOutcome;
  String? _busyEntryId;

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<TechpieLink>> links = ref.watch(
      techpieLinksControllerProvider,
    );
    final List<CampusWebEntry> entries = ref.watch(campusWebEntriesProvider);
    final MockControls? mockControls = ref.watch(mockControlsProvider);

    return KedaYaPageScaffold(
      title: '校园系统直连',
      padding: EdgeInsets.zero,
      actions: <Widget>[
        if (mockControls != null)
          MockStateMenu(
            controls: mockControls,
            onChanged: () => ref.invalidate(techpieLinksControllerProvider),
          ),
        IconButton(
          tooltip: '刷新绑定状态',
          onPressed: () => ref.invalidate(techpieLinksControllerProvider),
          icon: const Icon(Icons.refresh),
        ),
      ],
      child: AsyncStateView<List<TechpieLink>>(
        value: links,
        loadingMessage: '正在读取绑定状态…',
        onRetry: () => ref.invalidate(techpieLinksControllerProvider),
        builder: (BuildContext context, List<TechpieLink> linkList) => ListView(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          children: <Widget>[
            const _WebViewSemanticsNotice(),
            if (campusDomainAllowlistIsPlaceholder) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space3),
              const _AllowlistPlaceholderNotice(),
            ],
            if (_lastOutcome != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space3),
              _OutcomeNotice(outcome: _lastOutcome!),
            ],
            const SizedBox(height: KedaYaTokens.space4),
            for (final CampusWebEntry entry in entries) ...<Widget>[
              _EntryTile(
                entry: entry,
                platformUsable: _platformUsable(entry, linkList),
                busy: _busyEntryId != null,
                onOpen: () => unawaited(_open(entry)),
                onGoBind: () => context.push('/techpie/bindings'),
              ),
              const SizedBox(height: KedaYaTokens.space3),
            ],
            const SizedBox(height: KedaYaTokens.space2),
            const CredentialFreeNotice(
              extra: '票据是**引用**而不是凭证：客户端从头到尾没有拿到校园会话，'
                  '也没有能力注入任何网站凭据。',
            ),
          ],
        ),
      ),
    );
  }

  bool _platformUsable(CampusWebEntry entry, List<TechpieLink> links) {
    final DateTime now = DateTime.now();
    for (final TechpieLink link in links) {
      if (link.platform == entry.platform) return link.isUsableAt(now);
    }
    return false;
  }

  Future<void> _open(CampusWebEntry entry) async {
    setState(() {
      _busyEntryId = entry.id;
      _lastOutcome = null;
    });
    try {
      final WebViewLaunchOutcome outcome = await ref
          .read(techpieWebViewLauncherProvider)
          .open(entry);
      if (!mounted) return;
      setState(() => _lastOutcome = outcome);
    } on Object {
      // 异常详情**刻意不带上屏**：错误信息有可能夹带一次性中转链接，
      // 而票据绝不能进入 UI 状态或日志（规格 §10.3）。
      if (mounted) {
        setState(
          () => _lastOutcome = WebViewLaunchOutcome(
            status: WebViewLaunchStatus.handoffFailed,
            entry: entry,
            problem: '打开过程出现异常（详情已省略，避免票据信息进入界面）',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busyEntryId = null);
    }
  }
}

/// 票据语义（把规格 §8.4 的表格搬到界面上，用户与评审都能核对）。
class _WebViewSemanticsNotice extends StatelessWidget {
  const _WebViewSemanticsNotice();

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            '直连是怎么工作的',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '1. 客户端先按白名单**拒绝**非法地址（只允许 https、精确域名、443 端口）；\n'
            '2. 换一张**一次性**票据（30 秒时效，用后即焚，**不含**任何校园会话）；\n'
            '3. 用票据换**一次性**中转 URL，立刻交给系统 WebView 打开；\n'
            '4. 校园系统页面里请**自己登录** —— Phase 0 不做会话注入（规格 §8.4 的 W4）。\n'
            '票据与中转 URL 不进日志、不进页面状态（规格 §10.3）。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightLoose,
              color: colors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}

/// 白名单占位提示（契约 §11.18-B 第 2 条要求"占位"在代码/响应/文档里机器可见）。
class _AllowlistPlaceholderNotice extends StatelessWidget {
  const _AllowlistPlaceholderNotice();

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.warning.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.warning.withValues(alpha: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.report_gmailerrorred, size: 18, color: colors.warning),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              '域名白名单内容是**占位**（未决问题 U11 未关闭：'
              '`*.shanghaitech.edu.cn` 下的实际域名尚未列举）。'
              '当前列表共 ${campusDomainAllowlist.length} 个精确域名，'
              '**不做后缀通配**；服务端必须再校验一次。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.text,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 上一次打开的结果（**不含票据、不含中转 URL**）。
class _OutcomeNotice extends StatelessWidget {
  const _OutcomeNotice({required this.outcome});

  final WebViewLaunchOutcome outcome;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color tone = outcome.isOpened ? colors.success : colors.warning;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: tone.withValues(alpha: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            outcome.isOpened ? Icons.check_circle_outline : Icons.info_outline,
            size: 18,
            color: tone,
          ),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              outcome.isOpened
                  ? '已交给系统 WebView 打开「${outcome.entry.title}」。'
                        '票据已用掉，不会再次使用。'
                  : '「${outcome.entry.title}」未能打开：'
                        '${outcome.problem ?? outcome.status.wire}',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.text,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EntryTile extends StatelessWidget {
  const _EntryTile({
    required this.entry,
    required this.platformUsable,
    required this.busy,
    required this.onOpen,
    required this.onGoBind,
  });

  final CampusWebEntry entry;
  final bool platformUsable;
  final bool busy;
  final VoidCallback onOpen;
  final VoidCallback onGoBind;

  /// 该入口**需要绑定但当前不可用** —— 只有这种情况才显示"去绑定"。
  bool get _needsBinding => entry.requiresBinding && !platformUsable;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final String? problem = entry.targetUrlProblem;
    return Container(
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
              Expanded(
                child: Text(
                  entry.title,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeMd,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
              TechpieBadge(
                label: entry.requiresBinding
                    ? (platformUsable ? '已绑定' : '需绑定')
                    : '无需绑定',
                tone: entry.requiresBinding
                    ? (platformUsable ? colors.success : colors.warning)
                    : colors.info,
                icon: entry.requiresBinding
                    ? (platformUsable
                          ? Icons.check_circle_outline
                          : Icons.link)
                    : Icons.public,
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            entry.description,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '目标地址：${entry.targetUrl}',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
          if (problem != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '客户端已拒绝该地址：$problem',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.danger,
              ),
            ),
          ],
          if (_needsBinding) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '该入口需要先绑定 ${entry.platform.label}。'
              '「已登录但未绑定」是**合法状态**：完成绑定后即可使用，'
              '不需要重新登录（契约 §5 硬规则 3）。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.warning,
              ),
            ),
          ],
          if (!entry.requiresBinding) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '这个入口**不需要绑定**：它是外部链接，进入后请用学校账号自行登录'
              '（Phase 0 的 W4 直连，我们不接触任何校园会话）。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
          ],
          const SizedBox(height: KedaYaTokens.space3),
          Row(
            children: <Widget>[
              FilledButton(
                onPressed: busy || problem != null || _needsBinding ? null : onOpen,
                child: const Text('打开'),
              ),
              if (_needsBinding) ...<Widget>[
                const SizedBox(width: KedaYaTokens.space2),
                OutlinedButton(onPressed: onGoBind, child: const Text('去绑定')),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
