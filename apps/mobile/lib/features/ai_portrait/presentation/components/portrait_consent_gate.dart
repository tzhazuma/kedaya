import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../application/consent_controller.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/ai_portrait_providers.dart';

/// AI 校园画像的二次同意门（契约 §9）。
///
/// 与 wellbeing 的同意门同构：未同意时不 build 内容，画像一次都不读。
class PortraitConsentGate extends ConsumerStatefulWidget {
  const PortraitConsentGate({required this.builder, super.key});

  final WidgetBuilder builder;

  @override
  ConsumerState<PortraitConsentGate> createState() =>
      _PortraitConsentGateState();
}

class _PortraitConsentGateState extends ConsumerState<PortraitConsentGate> {
  bool _granting = false;

  Future<void> _grant() async {
    setState(() => _granting = true);
    try {
      await ref
          .read(consentControllerProvider.notifier)
          .grant(aiPortraitModuleId);
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('同意没有保存成功：$error')),
      );
    } finally {
      if (mounted) setState(() => _granting = false);
    }
  }

  /// 未同意时也允许删除本机画像：删除永远不该被同意门挡住。
  Future<void> _deleteWithoutConsent() async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('删除本机画像？'),
        content: const Text('不需要同意也可以删除；删除后回到空态，无法恢复。'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await ref.read(campusPortraitProvider.notifier).delete();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已删除本机画像')),
      );
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('删除失败：$error')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<Set<String>> consent =
        ref.watch(consentControllerProvider);
    return consent.when(
      loading: () => const KedaYaLoadingState(
        message: '正在读取本机的同意状态…',
      ),
      error: (Object error, StackTrace stackTrace) => KedaYaErrorState(
        error: error,
        onRetry: () => ref.invalidate(consentControllerProvider),
      ),
      data: (Set<String> granted) {
        if (granted.contains(aiPortraitModuleId)) {
          return widget.builder(context);
        }
        return _PortraitConsentBody(
          granting: _granting,
          onGrant: _grant,
          onDeleteWithoutConsent: _deleteWithoutConsent,
        );
      },
    );
  }
}

class _PortraitConsentBody extends StatelessWidget {
  const _PortraitConsentBody({
    required this.granting,
    required this.onGrant,
    required this.onDeleteWithoutConsent,
  });

  final bool granting;
  final VoidCallback onGrant;
  final VoidCallback onDeleteWithoutConsent;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return ListView(
      padding: EdgeInsets.zero,
      children: <Widget>[
        Icon(Icons.lock_outline, size: 36, color: colors.brandStrong),
        const SizedBox(height: KedaYaTokens.space3),
        Text(
          '画像属于高敏数据，先确认再查看',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeLg,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space3),
        const _PortraitConsentPoint(
          text: '画像只读：只展示已有画像，不生成、不推断，也不会为了填满而编造标签；'
              '删除只删除本机数据。',
        ),
        const _PortraitConsentPoint(
          text: '数据只存本机、随时可删；同意后才会读取本机已有的画像。',
        ),
        const _PortraitConsentPoint(
          text: '心理支持与宿舍矛盾不参与画像；这两类数据不会被本页读取。',
        ),
        const SizedBox(height: KedaYaTokens.space4),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: granting ? null : onGrant,
            child: granting
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('我同意，查看画像'),
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        Text(
          '可在模块详情页撤回同意；撤回后本页立即停止读取画像。',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            height: KedaYaTokens.lineHeightNormal,
            color: colors.textMuted,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        Center(
          child: TextButton(
            onPressed: onDeleteWithoutConsent,
            child: const Text('删除本机画像（不需要同意）'),
          ),
        ),
      ],
    );
  }
}

class _PortraitConsentPoint extends StatelessWidget {
  const _PortraitConsentPoint({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Padding(
      padding: const EdgeInsets.only(bottom: KedaYaTokens.space2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.check_circle_outline, size: 16, color: colors.success),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
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
