import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/takeout_report.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/takeout_guard_providers.dart';
import '../components/takeout_guard_intro.dart';
import '../components/takeout_report_card.dart';

/// 偷外卖报备列表（**本人可见**，不是公开举报墙）。
///
/// 固定提示「只有你自己能看到这些记录」在页首，空态也解释功能用途；
/// 排序、状态筛选、标记已解决与删除都走 `application` 层的仓库。
class TakeoutGuardPage extends ConsumerWidget {
  const TakeoutGuardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<TakeoutReport> visible =
        ref.watch(visibleTakeoutReportsProvider);
    final TakeoutReportStatus? filter =
        ref.watch(takeoutGuardStatusFilterProvider);
    final DateTime now = ref.watch(takeoutGuardClockProvider)();

    return KedaYaPageScaffold(
      title: '偷外卖报备',
      padding: EdgeInsets.zero,
      child: Column(
        children: <Widget>[
          const Padding(
            padding: EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space3,
              KedaYaTokens.space4,
              0,
            ),
            child: TakeoutGuardIntro(),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space3,
              KedaYaTokens.space4,
              0,
            ),
            child: Wrap(
              spacing: KedaYaTokens.space2,
              runSpacing: KedaYaTokens.space2,
              children: <Widget>[
                ChoiceChip(
                  label: const Text('全部'),
                  selected: filter == null,
                  onSelected: (bool _) => ref
                      .read(takeoutGuardStatusFilterProvider.notifier)
                      .select(null),
                ),
                for (final TakeoutReportStatus status
                    in TakeoutReportStatus.values)
                  ChoiceChip(
                    label: Text(status.label),
                    selected: filter == status,
                    onSelected: (bool _) => ref
                        .read(takeoutGuardStatusFilterProvider.notifier)
                        .select(status),
                  ),
              ],
            ),
          ),
          Expanded(
            child: visible.isEmpty
                ? TakeoutGuardEmpty(
                    hasFilter: filter != null,
                    onReset: filter == null
                        ? null
                        : () => ref
                            .read(takeoutGuardStatusFilterProvider.notifier)
                            .select(null),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(
                      KedaYaTokens.space4,
                      KedaYaTokens.space3,
                      KedaYaTokens.space4,
                      KedaYaTokens.space3,
                    ),
                    itemCount: visible.length,
                    separatorBuilder: (BuildContext context, int index) =>
                        const SizedBox(height: KedaYaTokens.space3),
                    itemBuilder: (BuildContext context, int index) {
                      final TakeoutReport report = visible[index];
                      return TakeoutReportCard(
                        report: report,
                        now: now,
                        onResolve: report.isResolved
                            ? null
                            : () => _resolve(context, ref, report),
                        onDelete: () => _confirmDelete(context, ref, report),
                      );
                    },
                  ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space2,
              KedaYaTokens.space4,
              KedaYaTokens.space4,
            ),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () => context.push('/takeout-guard/new'),
                icon: const Icon(Icons.add),
                label: const Text('新增报备'),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _resolve(BuildContext context, WidgetRef ref, TakeoutReport report) {
    ref.read(takeoutReportsProvider.notifier).resolve(report.id);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('已标记为已解决，记录仍会保留。')),
    );
  }

  Future<void> _confirmDelete(
    BuildContext context,
    WidgetRef ref,
    TakeoutReport report,
  ) async {
    final KedaYaColors colors = context.kedayaColors;
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('删除这条报备？'),
        content: const Text(
          '只会从你自己的记录里删除，删除后无法恢复。'
          '已经和楼管沟通的内容请自行保留。',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: colors.danger),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;

    ref.read(takeoutReportsProvider.notifier).delete(report.id);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('已删除这条报备。')),
    );
  }
}
