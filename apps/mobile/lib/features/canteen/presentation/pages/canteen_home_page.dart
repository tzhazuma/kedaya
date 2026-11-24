import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/canteen_dish.dart';
import '../../../../domain/models/meal_record.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/canteen_providers.dart';
import '../../canteen_routes.dart';
import '../../domain/canteen_rules.dart';
import '../components/canteen_disclaimer.dart';
import '../components/canteen_dish_tile.dart';
import '../components/nutrition_summary_card.dart';

/// 营养管家首页：今日汇总 → 钠上限提醒 → 3 条缺口参考 → 三个入口。
///
/// 首页只读本机记录，不发任何网络请求；「今日」由 `canteenClockProvider`
/// 决定，测试里可以固定。
class CanteenHomePage extends ConsumerWidget {
  const CanteenHomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final DailyNutritionSummary summary =
        ref.watch(dailyNutritionSummaryProvider);
    final List<DishSuggestion> suggestions =
        ref.watch(canteenSuggestionsProvider);
    final List<MealRecord> today = ref.watch(todayMealRecordsProvider);
    final DateTime now = ref.read(canteenClockProvider)();

    final String suggestionsCaption = suggestions.isNotEmpty
        ? (today.isEmpty
            ? '今天还没记录，先按一天目标挑的 ${suggestions.length} 个参考'
            : '按今日剩余缺口挑的 ${suggestions.length} 个菜品')
        : (summary.hasGap ? '当前没有符合条件的低钠参考' : '今天没有需要按缺口补的菜');

    return KedaYaPageScaffold(
      title: '营养管家',
      padding: EdgeInsets.zero,
      actions: <Widget>[
        IconButton(
          tooltip: '今日记录',
          onPressed: () => context.push(CanteenRoutes.records),
          icon: const Icon(Icons.receipt_long_outlined),
        ),
      ],
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          KedaYaTokens.space4,
          KedaYaTokens.space3,
          KedaYaTokens.space4,
          KedaYaTokens.space6,
        ),
        children: <Widget>[
          const _IntroBanner(),
          const SizedBox(height: KedaYaTokens.space3),
          CanteenNutritionSummaryCard(
            summary: summary,
            date: now,
            hasRecords: today.isNotEmpty,
          ),
          if (summary.sodiumExceeded) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            _SodiumWarning(summary: summary),
          ],
          const SizedBox(height: KedaYaTokens.space5),
          _SectionHeader(
            title: '缺口参考',
            caption: suggestionsCaption,
          ),
          const SizedBox(height: KedaYaTokens.space2),
          if (suggestions.isEmpty)
            _NoGapCard(summary: summary)
          else ...<Widget>[
            for (int i = 0; i < suggestions.length; i++) ...<Widget>[
              if (i > 0) const SizedBox(height: KedaYaTokens.space2),
              _SuggestionCard(suggestion: suggestions[i]),
            ],
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '按 1 份估算；吃不吃、吃多少由你决定。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: context.kedayaColors.textMuted,
              ),
            ),
          ],
          const SizedBox(height: KedaYaTokens.space5),
          _SectionHeader(title: '继续'),
          const SizedBox(height: KedaYaTokens.space2),
          _ActionCard(
            icon: Icons.storefront_outlined,
            title: '按食堂看菜品',
            description:
                '${CanteenName.values.length} 个食堂 · 可按品类筛选、按菜名搜索',
            onTap: () => context.push(CanteenRoutes.dishes),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          _ActionCard(
            icon: Icons.add_circle_outline,
            title: '记一餐',
            description: '选餐次、加菜品、调份数，保存到本机',
            onTap: () => context.push(CanteenRoutes.mealCompose),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          _ActionCard(
            icon: Icons.receipt_long_outlined,
            title: '今日记录',
            description: today.isEmpty
                ? '还没有记录'
                : '${today.length} 条记录 · 合计 ${summary.intake.kcal} kcal',
            onTap: () => context.push(CanteenRoutes.records),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          const CanteenNutritionNotice(),
        ],
      ),
    );
  }
}

class _IntroBanner extends StatelessWidget {
  const _IntroBanner();

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.brandSoft,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            Icons.restaurant_menu,
            size: KedaYaTokens.fontSizeXl,
            color: colors.brandStrong,
          ),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  '先看今天，再决定下一餐',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space1),
                Text(
                  '按食堂和品类找菜、记录这一餐，再用今日缺口挑下一道。'
                  '所有营养值都是「$canteenNutritionNotice」，仅供选餐参考；'
                  '记录只保存在本机。',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.text,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SodiumWarning extends StatelessWidget {
  const _SodiumWarning({required this.summary});

  final DailyNutritionSummary summary;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.danger.withAlpha(20),
        border: Border.all(color: colors.danger.withAlpha(80)),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            Icons.water_drop_outlined,
            size: KedaYaTokens.fontSizeLg,
            color: colors.danger,
          ),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              '今日钠已摄入 ${summary.intake.sodiumMg} mg，超过 '
              '${summary.target.sodiumLimitMg} mg 上限 '
              '${summary.sodiumOverMg} mg。下面的参考不含高钠菜品'
              '（每份 ≥ $highSodiumDishSodiumMg mg）。',
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

class _SuggestionCard extends StatelessWidget {
  const _SuggestionCard({required this.suggestion});

  final DishSuggestion suggestion;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return CanteenDishTile(
      dish: suggestion.dish,
      footnote: Text(
        '参考：${suggestion.reason}（按 1 份估算）',
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          fontWeight: KedaYaTokens.fontWeightMedium,
          color: colors.brandStrong,
        ),
      ),
    );
  }
}

class _NoGapCard extends StatelessWidget {
  const _NoGapCard({required this.summary});

  final DailyNutritionSummary summary;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final bool goalsMet = !summary.hasGap;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(KedaYaTokens.space3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              goalsMet ? Icons.check_circle_outline : Icons.search_off,
              size: KedaYaTokens.fontSizeLg,
              color: goalsMet ? colors.success : colors.textMuted,
            ),
            const SizedBox(width: KedaYaTokens.space2),
            Expanded(
              child: Text(
                goalsMet
                    ? '今天的热量、蛋白质、脂肪和碳水都达到了参考目标，'
                        '暂时没有需要按缺口加的菜。钠上限仍然有效。'
                    : '今天还有营养缺口，但当前没有符合条件的低钠菜品可参考。'
                        '可以先去菜品库看看，或等下一餐再调整。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.text,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.caption});

  final String title;
  final String? caption;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: <Widget>[
        Text(
          title,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeLg,
            fontWeight: KedaYaTokens.fontWeightBold,
            color: colors.text,
          ),
        ),
        if (caption != null) ...<Widget>[
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              caption!,
              textAlign: TextAlign.right,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String description;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        onTap: onTap,
        leading: Container(
          width: KedaYaTokens.space10,
          height: KedaYaTokens.space10,
          decoration: BoxDecoration(
            color: colors.brandSoft,
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
          ),
          child: Icon(
            icon,
            size: KedaYaTokens.fontSizeXl,
            color: colors.brandStrong,
          ),
        ),
        title: Text(
          title,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        subtitle: Text(
          description,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            color: colors.textMuted,
          ),
        ),
        trailing: Icon(Icons.chevron_right, color: colors.textMuted),
      ),
    );
  }
}
