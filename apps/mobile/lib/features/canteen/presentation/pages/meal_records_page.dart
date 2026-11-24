import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/canteen_dish.dart';
import '../../../../domain/models/meal_record.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/canteen_providers.dart';
import '../../canteen_routes.dart';
import '../../domain/canteen_rules.dart';
import '../components/canteen_disclaimer.dart';

/// 今日记录：按餐次分组，显示每餐的条目、营养与当日合计。
///
/// 删除单条**菜品**或整条记录后，首页的今日汇总与缺口参考会随 provider
/// 自动重算；这里不做本地拼接，避免「删了但数字没变」。
class MealRecordsPage extends ConsumerWidget {
  const MealRecordsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final List<MealRecord> records = ref.watch(todayMealRecordsProvider);
    final DailyNutritionSummary summary =
        ref.watch(dailyNutritionSummaryProvider);
    final DateTime today = ref.read(canteenClockProvider)();

    void deleteRecord(MealRecord record) {
      final bool removed = ref
          .read(mealRecordsControllerProvider.notifier)
          .removeRecord(record.id);
      if (!removed) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('已删除一条${record.slot.label}记录')),
      );
    }

    void deleteEntry(MealRecord record, int entryIndex) {
      final MealEntry entry = record.entries[entryIndex];
      final bool wasLast = record.entries.length == 1;
      final bool removed = ref
          .read(mealRecordsControllerProvider.notifier)
          .removeEntry(record.id, entryIndex);
      if (!removed) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            wasLast
                ? '已删除「${entry.dishName}」，这条${record.slot.label}已清空'
                : '已删除「${entry.dishName}」',
          ),
        ),
      );
    }

    final Map<MealSlot, List<MealRecord>> grouped =
        <MealSlot, List<MealRecord>>{
      for (final MealSlot slot in MealSlot.values) slot: <MealRecord>[],
    };
    for (final MealRecord record in records) {
      grouped[record.slot]!.add(record);
    }

    return KedaYaPageScaffold(
      title: '今日记录',
      padding: EdgeInsets.zero,
      actions: <Widget>[
        IconButton(
          tooltip: '记一餐',
          onPressed: () => context.push(CanteenRoutes.mealCompose),
          icon: const Icon(Icons.add),
        ),
      ],
      child: records.isEmpty
          ? Column(
              children: <Widget>[
                const Padding(
                  padding: EdgeInsets.fromLTRB(
                    KedaYaTokens.space4,
                    KedaYaTokens.space3,
                    KedaYaTokens.space4,
                    0,
                  ),
                  child: CanteenNutritionNotice(showDetail: false),
                ),
                Expanded(
                  child: KedaYaEmptyState(
                    title: '今天还没有记录',
                    description: '「记一餐」会先让你选餐次，再从菜品库挑菜、调份数。'
                        '保存后，首页的今日汇总和缺口参考会跟着更新；'
                        '记录只保存在本机。',
                    icon: Icons.restaurant_outlined,
                    onRetry: () => context.push(CanteenRoutes.mealCompose),
                    retryLabel: '去记一餐',
                  ),
                ),
              ],
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(
                KedaYaTokens.space4,
                KedaYaTokens.space3,
                KedaYaTokens.space4,
                KedaYaTokens.space6,
              ),
              children: <Widget>[
                const CanteenNutritionNotice(showDetail: false),
                const SizedBox(height: KedaYaTokens.space3),
                _DayTotalCard(
                  summary: summary,
                  date: today,
                  recordCount: records.length,
                ),
                const SizedBox(height: KedaYaTokens.space5),
                for (final MealSlot slot in MealSlot.values)
                  if (grouped[slot]!.isNotEmpty) ...<Widget>[
                    _SlotSection(
                      slot: slot,
                      records: grouped[slot]!,
                      onDeleteRecord: deleteRecord,
                      onDeleteEntry: deleteEntry,
                    ),
                    const SizedBox(height: KedaYaTokens.space4),
                  ],
                Text(
                  '记录只保存在本机，不会上传；卸载应用或清理数据后会丢失。'
                  '营养值为演示估算，仅供选餐参考。',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
    );
  }
}

class _DayTotalCard extends StatelessWidget {
  const _DayTotalCard({
    required this.summary,
    required this.date,
    required this.recordCount,
  });

  final DailyNutritionSummary summary;
  final DateTime date;
  final int recordCount;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.brandSoft,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.calendar_today_outlined,
                size: KedaYaTokens.fontSizeSm,
                color: colors.brandStrong,
              ),
              const SizedBox(width: KedaYaTokens.space1),
              Text(
                '${date.month} 月 ${date.day} 日',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.text,
                ),
              ),
              const Spacer(),
              Text(
                '$recordCount 条记录',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: colors.text,
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '合计 ${summary.intake.kcal} kcal · '
            '蛋白 ${summary.intake.proteinG} g · '
            '脂肪 ${summary.intake.fatG} g · '
            '碳水 ${summary.intake.carbsG} g',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.text,
            ),
          ),
          Text(
            '钠 ${summary.intake.sodiumMg} mg / 上限 '
            '${summary.target.sodiumLimitMg} mg'
            '${summary.sodiumExceeded ? '（已超出 ${summary.sodiumOverMg} mg）' : ''}',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              fontWeight: summary.sodiumExceeded
                  ? KedaYaTokens.fontWeightSemibold
                  : KedaYaTokens.fontWeightRegular,
              color: summary.sodiumExceeded ? colors.danger : colors.text,
            ),
          ),
        ],
      ),
    );
  }
}

class _SlotSection extends StatelessWidget {
  const _SlotSection({
    required this.slot,
    required this.records,
    required this.onDeleteRecord,
    required this.onDeleteEntry,
  });

  final MealSlot slot;
  final List<MealRecord> records;
  final ValueChanged<MealRecord> onDeleteRecord;
  final void Function(MealRecord record, int entryIndex) onDeleteEntry;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final NutritionFacts subtotal = records.fold(
      NutritionFacts.zero,
      (NutritionFacts sum, MealRecord record) => sum + record.total,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Text(
              slot.label,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeMd,
                fontWeight: KedaYaTokens.fontWeightBold,
                color: colors.text,
              ),
            ),
            const SizedBox(width: KedaYaTokens.space2),
            Text(
              '${subtotal.kcal} kcal',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
            const Spacer(),
            Text(
              '${records.length} 条',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space2),
        for (int i = 0; i < records.length; i++) ...<Widget>[
          if (i > 0) const SizedBox(height: KedaYaTokens.space2),
          _RecordCard(
            record: records[i],
            onDeleteRecord: () => onDeleteRecord(records[i]),
            onDeleteEntry: (int entryIndex) =>
                onDeleteEntry(records[i], entryIndex),
          ),
        ],
      ],
    );
  }
}

class _RecordCard extends StatelessWidget {
  const _RecordCard({
    required this.record,
    required this.onDeleteRecord,
    required this.onDeleteEntry,
  });

  final MealRecord record;
  final VoidCallback onDeleteRecord;
  final ValueChanged<int> onDeleteEntry;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final NutritionFacts total = record.total;
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          KedaYaTokens.space3,
          KedaYaTokens.space1,
          KedaYaTokens.space1,
          KedaYaTokens.space2,
        ),
        child: Column(
          children: <Widget>[
            for (int i = 0; i < record.entries.length; i++) ...<Widget>[
              if (i > 0) const Divider(height: 1),
              _EntryRow(
                entry: record.entries[i],
                onDelete: () => onDeleteEntry(i),
              ),
            ],
            const Divider(height: KedaYaTokens.space3),
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    '合计 ${total.kcal} kcal',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeSm,
                      fontWeight: KedaYaTokens.fontWeightSemibold,
                      color: colors.text,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: '删除这条${record.slot.label}记录',
                  visualDensity: VisualDensity.compact,
                  onPressed: onDeleteRecord,
                  icon: Icon(
                    Icons.delete_outline,
                    size: KedaYaTokens.fontSizeLg,
                    color: colors.danger,
                  ),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.only(right: KedaYaTokens.space2),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  '蛋白 ${total.proteinG} g · 脂肪 ${total.fatG} g · '
                  '碳水 ${total.carbsG} g · 钠 ${total.sodiumMg} mg',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.textMuted,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EntryRow extends StatelessWidget {
  const _EntryRow({required this.entry, required this.onDelete});

  final MealEntry entry;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final NutritionFacts total = entry.total;
    return Row(
      children: <Widget>[
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(
              vertical: KedaYaTokens.space1,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  entry.dishName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightMedium,
                    color: colors.text,
                  ),
                ),
                Text(
                  '${entry.servingsLabel} · ${total.kcal} kcal · '
                  '蛋白 ${total.proteinG} g · 钠 ${total.sodiumMg} mg',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ),
        IconButton(
          tooltip: '删除 ${entry.dishName}',
          visualDensity: VisualDensity.compact,
          onPressed: onDelete,
          icon: Icon(Icons.close, color: colors.textMuted),
        ),
      ],
    );
  }
}
