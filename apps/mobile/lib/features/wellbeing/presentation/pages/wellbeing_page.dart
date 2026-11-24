import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../application/consent_controller.dart';
import '../../../../domain/models/api_error.dart';
import '../../../../domain/models/wellbeing_booking.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/wellbeing_providers.dart';
import '../components/wellbeing_booking_card.dart';
import '../components/wellbeing_consent_gate.dart';
import '../components/wellbeing_crisis_card.dart';

/// 心理支持首页（契约 §4.1 `wellbeing`，敏感级 critical）。
///
/// 页面顺序是产品红线的一部分：
///   1. **最上方永远是热线卡**，且不依赖任何数据 / 同意状态；
///   2. 同意门未通过时，本机数据一次都不读；
///   3. 只做倾听与预约，不做诊断、不做治疗、不做量表评分。
class WellbeingPage extends StatelessWidget {
  const WellbeingPage({super.key});

  @override
  Widget build(BuildContext context) {
    return KedaYaPageScaffold(
      title: '心理支持',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const WellbeingCrisisCard(),
          const SizedBox(height: KedaYaTokens.space3),
          Expanded(
            child: WellbeingConsentGate(
              builder: (BuildContext context) => const _WellbeingContent(),
            ),
          ),
        ],
      ),
    );
  }
}

class _WellbeingContent extends ConsumerWidget {
  const _WellbeingContent();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final AsyncValue<List<WellbeingBooking>> value =
        ref.watch(wellbeingBookingsProvider);
    final List<WellbeingBooking>? bookings = value.valueOrNull;

    return ListView(
      padding: EdgeInsets.zero,
      children: <Widget>[
        Container(
          padding: const EdgeInsets.all(KedaYaTokens.space3),
          decoration: BoxDecoration(
            color: colors.brandSoft,
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                '只做倾听与预约',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space1),
              Text(
                '这里不做诊断、不做治疗，也不做量表评分。'
                '你可以只说想聊什么，也可以什么都不写；预约记录只留在本机。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.text,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: KedaYaTokens.space4),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: () => context.push('/wellbeing/booking'),
            icon: const Icon(Icons.event_outlined, size: 18),
            label: const Text('预约一次谈话'),
          ),
        ),
        const SizedBox(height: KedaYaTokens.space5),
        Row(
          children: <Widget>[
            Text(
              '我的预约',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeMd,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: colors.text,
              ),
            ),
            const Spacer(),
            if (bookings != null && bookings.isNotEmpty)
              Text(
                '${bookings.length} 条',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: colors.textMuted,
                ),
              ),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space2),
        value.when(
          data: (List<WellbeingBooking> items) {
            if (items.isEmpty) {
              return const KedaYaEmptyState(
                title: '还没有预约',
                icon: Icons.event_available,
                description: '预约只保存在这台设备上。'
                    '提交后会出现在这里，状态是「已提交（演示）」，'
                    '不是真实排班确认。',
              );
            }
            return Column(
              children: <Widget>[
                for (int index = 0; index < items.length; index++) ...<Widget>[
                  if (index > 0) const SizedBox(height: KedaYaTokens.space2),
                  WellbeingBookingCard(booking: items[index]),
                ],
              ],
            );
          },
          loading: () => const KedaYaLoadingState(
            message: '正在读取本机预约…',
          ),
          error: (Object error, StackTrace stackTrace) => KedaYaErrorState(
            error: error,
            onRetry: () =>
                ref.read(wellbeingBookingsProvider.notifier).refresh(),
          ),
        ),
        const SizedBox(height: KedaYaTokens.space5),
        _LocalDataNotice(
          hasBookings: bookings?.isNotEmpty ?? false,
          onClear: () => _confirmClear(context, ref),
          onRevoke: () => _confirmRevoke(context, ref),
        ),
        const SizedBox(height: KedaYaTokens.space4),
      ],
    );
  }

  Future<void> _confirmClear(BuildContext context, WidgetRef ref) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('清空我的记录？'),
        content: const Text(
          '本机保存的预约记录会被删除，无法恢复。热线信息不受影响。',
        ),
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
    if (confirmed != true || !context.mounted) return;
    try {
      await ref.read(wellbeingBookingsProvider.notifier).clearAll();
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已清空本机预约记录')),
      );
    } on Object catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_messageOf(error))),
      );
    }
  }

  Future<void> _confirmRevoke(BuildContext context, WidgetRef ref) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('撤回同意并清空？'),
        content: const Text(
          '撤回后会立即停止读取本机记录。'
          '已经保存的预约会被删除，无法恢复；之后需要重新同意才能使用预约。',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('撤回并清空'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      await ref.read(wellbeingBookingsProvider.notifier).clearAll();
      if (!context.mounted) return;
      await ref
          .read(consentControllerProvider.notifier)
          .revoke(wellbeingModuleId);
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已撤回同意，并清空本机记录')),
      );
    } on Object catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_messageOf(error))),
      );
    }
  }

  String _messageOf(Object error) =>
      error is ApiException ? error.error.userMessage : '$error';
}

class _LocalDataNotice extends StatelessWidget {
  const _LocalDataNotice({
    required this.hasBookings,
    required this.onClear,
    required this.onRevoke,
  });

  final bool hasBookings;
  final VoidCallback onClear;
  final VoidCallback onRevoke;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            '本机数据',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '预约记录只存这台设备，不会进入 AI 校园画像，也不会在找搭子、'
            '宿舍矛盾或论坛里出现。清空后无法恢复。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Wrap(
            spacing: KedaYaTokens.space2,
            runSpacing: KedaYaTokens.space2,
            children: <Widget>[
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: colors.danger,
                  side: BorderSide(color: colors.danger),
                ),
                onPressed: hasBookings ? onClear : null,
                icon: const Icon(Icons.delete_outline, size: 18),
                label: const Text('清空我的记录'),
              ),
              TextButton(
                onPressed: onRevoke,
                child: const Text('撤回同意并清空'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
