import 'package:flutter/material.dart';

import '../../../../domain/models/deadline_item.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 统计条：「未完成 N 条 · 最近一条还有 X」。
///
/// 统计的是**全部** DDL，不受筛选 chips 影响 —— 切到「已完成」时，
/// 顶部仍然告诉你还剩几条没做完。
class DeadlineStatsBar extends StatelessWidget {
  const DeadlineStatsBar({required this.stats, required this.now, super.key});

  /// `null` = 首屏还在加载。
  final DeadlineStats? stats;

  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final DeadlineStats? value = stats;
    final bool allClear = value?.allClear ?? false;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Row(
        children: <Widget>[
          Icon(
            allClear
                ? Icons.check_circle_outline
                : Icons.pending_actions_outlined,
            size: 18,
            color: allClear ? colors.success : colors.brandStrong,
          ),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              value?.summaryAt(now) ?? '未完成 — 条 · 正在统计…',
              key: const Key('deadline-stats-text'),
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                fontWeight: KedaYaTokens.fontWeightMedium,
                color: colors.text,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 筛选 chips：全部 / 未完成 / 已逾期 / 已完成。
class DeadlineFilterBar extends StatelessWidget {
  const DeadlineFilterBar({
    required this.selected,
    required this.onSelected,
    super.key,
  });

  final DeadlineFilter selected;
  final ValueChanged<DeadlineFilter> onSelected;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space4,
        vertical: KedaYaTokens.space1,
      ),
      child: Row(
        children: <Widget>[
          for (int index = 0;
              index < DeadlineFilter.values.length;
              index++) ...<Widget>[
            if (index > 0) const SizedBox(width: KedaYaTokens.space2),
            ChoiceChip(
              label: Text(DeadlineFilter.values[index].label),
              selected: selected == DeadlineFilter.values[index],
              onSelected: (bool _) => onSelected(DeadlineFilter.values[index]),
              materialTapTargetSize: MaterialTapTargetSize.padded,
            ),
          ],
        ],
      ),
    );
  }
}
