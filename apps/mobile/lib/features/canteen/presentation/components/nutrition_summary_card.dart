import 'package:flutter/material.dart';

import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../domain/canteen_rules.dart';

/// 今日汇总卡：热量 / 蛋白质 / 脂肪 / 碳水按目标展示，钠按**上限**展示。
///
/// 钠的进度条满格后变红并写明超出多少；其余四项只表示完成度，
/// 不把「超过目标」当成错误（目标本身只是演示参考）。
class CanteenNutritionSummaryCard extends StatelessWidget {
  const CanteenNutritionSummaryCard({
    required this.summary,
    required this.date,
    required this.hasRecords,
    super.key,
  });

  final DailyNutritionSummary summary;
  final DateTime date;
  final bool hasRecords;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(
                  Icons.insights_outlined,
                  size: KedaYaTokens.fontSizeLg,
                  color: colors.brandStrong,
                ),
                const SizedBox(width: KedaYaTokens.space2),
                Expanded(
                  child: Text(
                    '今日汇总',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeMd,
                      fontWeight: KedaYaTokens.fontWeightSemibold,
                      color: colors.text,
                    ),
                  ),
                ),
                Text(
                  '${date.month} 月 ${date.day} 日',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: KedaYaTokens.space3),
            _MetricRow(
              label: '热量',
              value: summary.intake.kcal,
              target: summary.target.kcal,
              unit: 'kcal',
              progress: summary.energyProgress,
            ),
            const SizedBox(height: KedaYaTokens.space3),
            _MetricRow(
              label: '蛋白质',
              value: summary.intake.proteinG,
              target: summary.target.proteinG,
              unit: 'g',
              progress: summary.proteinProgress,
            ),
            const SizedBox(height: KedaYaTokens.space3),
            _MetricRow(
              label: '脂肪',
              value: summary.intake.fatG,
              target: summary.target.fatG,
              unit: 'g',
              progress: summary.fatProgress,
            ),
            const SizedBox(height: KedaYaTokens.space3),
            _MetricRow(
              label: '碳水',
              value: summary.intake.carbsG,
              target: summary.target.carbsG,
              unit: 'g',
              progress: summary.carbsProgress,
            ),
            const SizedBox(height: KedaYaTokens.space3),
            _MetricRow(
              label: '钠（上限）',
              value: summary.intake.sodiumMg,
              target: summary.target.sodiumLimitMg,
              unit: 'mg',
              progress: summary.sodiumProgress,
              overBy: summary.sodiumOverMg,
            ),
            if (!hasRecords) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space3),
              Text(
                '今天还没有记录。先「记一餐」，这里才会变成你自己的数据。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.textMuted,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MetricRow extends StatelessWidget {
  const _MetricRow({
    required this.label,
    required this.value,
    required this.target,
    required this.unit,
    required this.progress,
    this.overBy = 0,
  });

  final String label;
  final int value;
  final int target;
  final String unit;
  final double progress;

  /// 仅钠使用：已超出上限多少（0 表示未超）。
  final int overBy;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final bool over = overBy > 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Text(
              label,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                fontWeight: KedaYaTokens.fontWeightMedium,
                color: colors.text,
              ),
            ),
            const Spacer(),
            Text(
              '$value / $target $unit',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                fontWeight: over
                    ? KedaYaTokens.fontWeightSemibold
                    : KedaYaTokens.fontWeightRegular,
                color: over ? colors.danger : colors.textMuted,
              ),
            ),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space1),
        ClipRRect(
          borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
          child: LinearProgressIndicator(
            value: progress,
            minHeight: 6,
            backgroundColor: colors.surfaceAlt,
            color: over ? colors.danger : colors.brandStrong,
          ),
        ),
        if (over) ...<Widget>[
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '已超过上限 $overBy $unit',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.danger,
            ),
          ),
        ],
      ],
    );
  }
}
