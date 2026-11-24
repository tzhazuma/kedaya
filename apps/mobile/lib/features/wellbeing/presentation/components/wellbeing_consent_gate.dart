import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../application/consent_controller.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/wellbeing_providers.dart';

/// 二次同意门（契约 §9）。
///
/// 关键点：它用 [builder] 而不是 `child`，未同意时被包住的内容**根本不会 build**，
/// 因此列表 provider 也不会被订阅、本机数据更不会被读取。
class WellbeingConsentGate extends ConsumerStatefulWidget {
  const WellbeingConsentGate({required this.builder, super.key});

  final WidgetBuilder builder;

  @override
  ConsumerState<WellbeingConsentGate> createState() =>
      _WellbeingConsentGateState();
}

class _WellbeingConsentGateState extends ConsumerState<WellbeingConsentGate> {
  bool _granting = false;

  Future<void> _grant() async {
    setState(() => _granting = true);
    try {
      await ref
          .read(consentControllerProvider.notifier)
          .grant(wellbeingModuleId);
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('同意没有保存成功：$error')),
      );
    } finally {
      if (mounted) setState(() => _granting = false);
    }
  }

  /// 未同意时也允许删除本机记录：删除永远不该被同意门挡住。
  Future<void> _clearWithoutConsent() async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('清空本机预约记录？'),
        content: const Text('不需要同意也可以删除；删除后无法恢复。'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('清空'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await ref.read(wellbeingBookingsProvider.notifier).clearAll();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已清空本机预约记录')),
      );
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('清空失败：$error')),
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
        if (granted.contains(wellbeingModuleId)) {
          return widget.builder(context);
        }
        return _ConsentBody(
          granting: _granting,
          onGrant: _grant,
          onClearWithoutConsent: _clearWithoutConsent,
        );
      },
    );
  }
}

class _ConsentBody extends StatelessWidget {
  const _ConsentBody({
    required this.granting,
    required this.onGrant,
    required this.onClearWithoutConsent,
  });

  final bool granting;
  final VoidCallback onGrant;
  final VoidCallback onClearWithoutConsent;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return ListView(
      padding: EdgeInsets.zero,
      children: <Widget>[
        Icon(
          Icons.lock_outline,
          size: 36,
          color: colors.brandStrong,
        ),
        const SizedBox(height: KedaYaTokens.space3),
        Text(
          '开始前，先确认这几件事',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeLg,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space3),
        const _ConsentPoint(
          text: '这里只做倾听与预约：不做诊断、不做治疗，也不做量表评分。',
        ),
        const _ConsentPoint(
          text: '数据只存本机、随时可删；预约记录不会上传，也不会进入 AI 校园画像。',
        ),
        const _ConsentPoint(
          text: '同意后才会读取本机的预约与历史数据；不同意就看不到，也不会在后台偷偷加载。',
        ),
        const _ConsentPoint(
          text: '如果你现在有伤害自己的想法，请先看页面最上方的热线，不需要先同意任何东西。',
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
                : const Text('我同意，继续'),
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        Text(
          '可随时撤回同意；撤回后本页立即停止读取本机记录，并可以清空已保存的预约。',
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
            onPressed: onClearWithoutConsent,
            child: const Text('清空本机预约记录（不需要同意）'),
          ),
        ),
      ],
    );
  }
}

class _ConsentPoint extends StatelessWidget {
  const _ConsentPoint({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Padding(
      padding: const EdgeInsets.only(bottom: KedaYaTokens.space2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            Icons.check_circle_outline,
            size: 16,
            color: colors.success,
          ),
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
