/// 营养管家的**纯规则层**：筛选、目标对比、缺口建议。
///
/// 这里没有 IO、没有 Flutter、没有 Riverpod —— 页面和控制器只调用这些函数，
/// 因此「份数怎么算」「什么时候算钠超标」「什么菜能被推荐」都只有一份实现，
/// 单测也不需要起 widget。
library;

import '../../../domain/models/canteen_dish.dart';
import '../../../domain/models/meal_record.dart';

/* ------------------------------------------------------------------ *
 * 1. 菜品筛选（食堂 + 品类 + 关键词，叠加）
 * ------------------------------------------------------------------ */

/// 菜品库的筛选条件。三个条件同时成立才保留（AND）。
final class DishQuery {
  const DishQuery({this.canteen, this.category, this.keyword = ''});

  /// `null` 表示「全部食堂」。
  final CanteenName? canteen;

  /// `null` 表示「全部品类」。
  final DishCategory? category;

  /// 空格分隔的多个关键词需要**全部**出现在菜名里（忽略大小写）。
  final String keyword;

  bool get isEmpty =>
      canteen == null && category == null && keyword.trim().isEmpty;
}

/// 按 [DishQuery] 过滤菜品；保持原列表顺序。
List<CanteenDish> filterCanteenDishes(
  Iterable<CanteenDish> dishes,
  DishQuery query,
) {
  final List<String> terms = query.keyword
      .trim()
      .toLowerCase()
      .split(RegExp(r'\s+'))
      .where((String term) => term.isNotEmpty)
      .toList(growable: false);
  return dishes.where((CanteenDish dish) {
    if (query.canteen != null && dish.canteen != query.canteen) {
      return false;
    }
    if (query.category != null && dish.category != query.category) {
      return false;
    }
    if (terms.isEmpty) return true;
    final String name = dish.name.toLowerCase();
    return terms.every(name.contains);
  }).toList(growable: false);
}

/* ------------------------------------------------------------------ *
 * 2. 每日目标与今日汇总
 * ------------------------------------------------------------------ */

/// 每日营养参考值。
///
/// 默认值是常见成人的**演示参考**（不是个性化处方）：
/// 2000 kcal、60 g 蛋白、60 g 脂肪、250 g 碳水；钠是**上限** 2000 mg。
final class CanteenNutritionTarget {
  const CanteenNutritionTarget({
    required this.kcal,
    required this.proteinG,
    required this.fatG,
    required this.carbsG,
    required this.sodiumLimitMg,
  });

  static const CanteenNutritionTarget defaults = CanteenNutritionTarget(
    kcal: 2000,
    proteinG: 60,
    fatG: 60,
    carbsG: 250,
    sodiumLimitMg: 2000,
  );

  final int kcal;
  final int proteinG;
  final int fatG;
  final int carbsG;

  /// 钠的**上限**：超过它才提示，而不是「还差多少」。
  final int sodiumLimitMg;
}

/// 今日已摄入 vs 目标。
final class DailyNutritionSummary {
  const DailyNutritionSummary({required this.intake, required this.target});

  final NutritionFacts intake;
  final CanteenNutritionTarget target;

  int get energyGap =>
      target.kcal > intake.kcal ? target.kcal - intake.kcal : 0;

  int get proteinGapG =>
      target.proteinG > intake.proteinG ? target.proteinG - intake.proteinG : 0;

  int get fatGapG =>
      target.fatG > intake.fatG ? target.fatG - intake.fatG : 0;

  int get carbsGapG =>
      target.carbsG > intake.carbsG ? target.carbsG - intake.carbsG : 0;

  /// 剩余钠额度；负数表示已超过上限。
  int get sodiumHeadroomMg => target.sodiumLimitMg - intake.sodiumMg;

  bool get sodiumExceeded => sodiumHeadroomMg < 0;

  int get sodiumOverMg =>
      sodiumHeadroomMg < 0 ? -sodiumHeadroomMg : 0;

  bool get hasGap =>
      energyGap > 0 || proteinGapG > 0 || fatGapG > 0 || carbsGapG > 0;

  double get energyProgress => _progress(intake.kcal, target.kcal);
  double get proteinProgress => _progress(intake.proteinG, target.proteinG);
  double get fatProgress => _progress(intake.fatG, target.fatG);
  double get carbsProgress => _progress(intake.carbsG, target.carbsG);
  double get sodiumProgress => _progress(intake.sodiumMg, target.sodiumLimitMg);
}

/// 把若干条记录汇成今日摄入。
DailyNutritionSummary summarizeDay(
  Iterable<MealRecord> records, {
  CanteenNutritionTarget target = CanteenNutritionTarget.defaults,
}) =>
    DailyNutritionSummary(
      intake: records.fold(
        NutritionFacts.zero,
        (NutritionFacts sum, MealRecord record) => sum + record.total,
      ),
      target: target,
    );

double _progress(int value, int target) {
  if (target <= 0) return 0;
  final double ratio = value / target;
  if (ratio <= 0) return 0;
  return ratio >= 1 ? 1 : ratio;
}

/* ------------------------------------------------------------------ *
 * 3. 缺口建议
 * ------------------------------------------------------------------ */

/// 建议条数。页面按这个数展示「3 条参考」。
const int canteenSuggestionLimit = 3;

/// 建议主要补哪一项。
enum NutritionFocus {
  energy('热量'),
  protein('蛋白质'),
  fat('脂肪'),
  carbs('碳水');

  const NutritionFocus(this.label);

  final String label;
}

/// 一条菜品建议：菜 + 它最擅长的缺口。
final class DishSuggestion {
  const DishSuggestion({required this.dish, required this.focus});

  final CanteenDish dish;
  final NutritionFocus focus;

  int get amount => switch (focus) {
        NutritionFocus.energy => dish.nutrition.kcal,
        NutritionFocus.protein => dish.nutrition.proteinG,
        NutritionFocus.fat => dish.nutrition.fatG,
        NutritionFocus.carbs => dish.nutrition.carbsG,
      };

  String get unit => focus == NutritionFocus.energy ? 'kcal' : 'g';

  /// 页面上的理由，例如「可补蛋白质约 26 g」（按 1 份估算）。
  String get reason => '可补${focus.label}约 $amount $unit';
}

/// 按今日剩余缺口挑最多 [limit] 个菜品。
///
/// 规则：
///   1. 只有**还有缺口**的营养项参与打分；四项都达标时返回空列表
///      （不为了凑 3 条而劝人加餐）。
///   2. 钠已超过 [CanteenNutritionTarget.sodiumLimitMg] 时，
///      **排除**所有高钠菜品（[CanteenDish.isHighSodium]）—— 这是硬过滤，
///      不是排序偏好。
///   3. 其余情况按「对缺口的覆盖度」加权排序；覆盖度相同时低钠优先。
///
/// 结果是确定性的：同输入同输出，方便单测与复现。
List<DishSuggestion> suggestDishesForGaps({
  required Iterable<CanteenDish> dishes,
  required DailyNutritionSummary summary,
  int limit = canteenSuggestionLimit,
}) {
  if (limit <= 0) return const <DishSuggestion>[];

  final List<_Gap> gaps = <_Gap>[];
  void addGap(NutritionFocus focus, int remaining, int target) {
    if (remaining <= 0 || target <= 0) return;
    gaps.add(_Gap(
      focus: focus,
      remaining: remaining,
      ratio: remaining / target,
    ));
  }

  addGap(NutritionFocus.energy, summary.energyGap, summary.target.kcal);
  addGap(NutritionFocus.protein, summary.proteinGapG,
      summary.target.proteinG);
  addGap(NutritionFocus.fat, summary.fatGapG, summary.target.fatG);
  addGap(NutritionFocus.carbs, summary.carbsGapG, summary.target.carbsG);
  if (gaps.isEmpty) return const <DishSuggestion>[];

  final double totalRatio =
      gaps.fold<double>(0, (double sum, _Gap gap) => sum + gap.ratio);
  final List<CanteenDish> pool = dishes
      .where((CanteenDish dish) =>
          !summary.sodiumExceeded || !dish.isHighSodium)
      .toList(growable: false);
  if (pool.isEmpty) return const <DishSuggestion>[];

  final int sodiumLimit = summary.target.sodiumLimitMg;
  final List<_ScoredDish> scored = <_ScoredDish>[];
  for (final CanteenDish dish in pool) {
    double score = 0;
    NutritionFocus focus = gaps.first.focus;
    double bestCoverage = -1;
    double bestRatio = -1;
    for (final _Gap gap in gaps) {
      final double coverage = _coverage(gap, dish);
      score += coverage * (gap.ratio / totalRatio);
      if (coverage > bestCoverage ||
          (coverage == bestCoverage && gap.ratio > bestRatio)) {
        bestCoverage = coverage;
        bestRatio = gap.ratio;
        focus = gap.focus;
      }
    }
    if (sodiumLimit > 0) {
      // 钠不是缺口；同分时低钠优先。超标时高钠菜已被硬过滤。
      score -= (dish.nutrition.sodiumMg / sodiumLimit) * 0.05;
    }
    scored.add(_ScoredDish(dish: dish, focus: focus, score: score));
  }

  scored.sort((_ScoredDish a, _ScoredDish b) {
    final int byScore = b.score.compareTo(a.score);
    if (byScore != 0) return byScore;
    final int bySodium =
        a.dish.nutrition.sodiumMg.compareTo(b.dish.nutrition.sodiumMg);
    if (bySodium != 0) return bySodium;
    return a.dish.id.compareTo(b.dish.id);
  });

  return scored
      .take(limit)
      .map((_ScoredDish item) =>
          DishSuggestion(dish: item.dish, focus: item.focus))
      .toList(growable: false);
}

double _coverage(_Gap gap, CanteenDish dish) {
  final int amount = switch (gap.focus) {
    NutritionFocus.energy => dish.nutrition.kcal,
    NutritionFocus.protein => dish.nutrition.proteinG,
    NutritionFocus.fat => dish.nutrition.fatG,
    NutritionFocus.carbs => dish.nutrition.carbsG,
  };
  if (amount <= 0) return 0;
  if (gap.focus == NutritionFocus.energy) {
    // 热量既不要远超剩余额度，也不要用一份小菜「凑数」。
    return amount <= gap.remaining
        ? amount / gap.remaining
        : gap.remaining / amount;
  }
  final double ratio = amount / gap.remaining;
  return ratio >= 1 ? 1 : ratio;
}

final class _Gap {
  const _Gap({
    required this.focus,
    required this.remaining,
    required this.ratio,
  });

  final NutritionFocus focus;
  final int remaining;
  final double ratio;
}

final class _ScoredDish {
  const _ScoredDish({
    required this.dish,
    required this.focus,
    required this.score,
  });

  final CanteenDish dish;
  final NutritionFocus focus;
  final double score;
}
