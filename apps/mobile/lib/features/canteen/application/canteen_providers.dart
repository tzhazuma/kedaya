import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../domain/models/canteen_dish.dart';
import '../../../domain/models/meal_record.dart';
import '../domain/canteen_rules.dart';
import '../domain/canteen_seed.dart';
import 'canteen_meal_store.dart';

/// 菜品库（当前是 25 道演示菜；将来接后端时只换这个 provider 的装配）。
final canteenDishesProvider =
    Provider<List<CanteenDish>>((ref) => canteenSeedDishes);

/// 「现在」的注入点：默认餐次、今日筛选都依赖它。
///
/// 测试里 override 成固定时刻，就能对「今日」做确定性断言。
final canteenClockProvider =
    Provider<DateTime Function()>((ref) => DateTime.now);

/// 每日参考目标（钠是上限）。默认值见 [CanteenNutritionTarget.defaults]。
final canteenTargetProvider = Provider<CanteenNutritionTarget>(
  (ref) => CanteenNutritionTarget.defaults,
);

/// 本机餐次记录。
///
/// 与后端无关：状态来自 `LocalCachePort` 的同步快照，写操作只会回写本机缓存。
/// **不做**乐观的「已同步」提示 —— 页面反馈必须写明「保存在本机」。
final mealRecordsControllerProvider =
    NotifierProvider<MealRecordsController, List<MealRecord>>(
  MealRecordsController.new,
);

final class MealRecordsController extends Notifier<List<MealRecord>> {
  CanteenMealStore? _store;
  int _sequence = 0;

  CanteenMealStore get store =>
      _store ??= CanteenMealStore(ref.read(localCacheProvider));

  @override
  List<MealRecord> build() {
    ref.watch(localCacheProvider);
    // 缓存实现被替换（测试 override / 热重载）时，store 也要跟着换。
    _store = null;
    return store.read();
  }

  /// 保存一餐；空餐次或非法份数会抛 [MealDraftException]（状态不变）。
  MealRecord addMeal({
    required MealSlot slot,
    required List<MealEntry> entries,
    DateTime? date,
  }) {
    final List<MealDraftProblem> problems = validateMealDraft(entries);
    if (problems.isNotEmpty) {
      throw MealDraftException(problems);
    }
    final DateTime now = ref.read(canteenClockProvider)();
    final MealRecord record = MealRecord(
      id: 'canteen-meal-${now.microsecondsSinceEpoch}-${_sequence++}',
      date: canteenDateOnly(date ?? now),
      slot: slot,
      entries: List<MealEntry>.unmodifiable(entries),
    );
    state = <MealRecord>[...state, record];
    unawaited(store.write(state));
    return record;
  }

  /// 删除一整条记录；返回是否真的删掉了。
  bool removeRecord(String id) {
    final List<MealRecord> next =
        state.where((MealRecord record) => record.id != id).toList();
    if (next.length == state.length) return false;
    state = next;
    unawaited(store.write(state));
    return true;
  }

  /// 删除某条记录里的一个菜品；删掉最后一条时整条记录一起消失。
  bool removeEntry(String recordId, int entryIndex) {
    final int recordIndex =
        state.indexWhere((MealRecord record) => record.id == recordId);
    if (recordIndex < 0) return false;
    final MealRecord record = state[recordIndex];
    if (entryIndex < 0 || entryIndex >= record.entries.length) return false;

    final List<MealEntry> entries = <MealEntry>[...record.entries]
      ..removeAt(entryIndex);
    final List<MealRecord> next = state
        .map((MealRecord item) => item.id == recordId
            ? (entries.isEmpty ? null : record.copyWith(entries: entries))
            : item)
        .whereType<MealRecord>()
        .toList(growable: false);
    state = next;
    unawaited(store.write(state));
    return true;
  }
}

/// 只含今天的记录（按本地年月日）。
final todayMealRecordsProvider = Provider<List<MealRecord>>((ref) {
  final DateTime now = ref.read(canteenClockProvider)();
  return mealRecordsOn(ref.watch(mealRecordsControllerProvider), now);
});

/// 今日摄入 vs 目标。记录被删除后会随 provider 自动重算。
final dailyNutritionSummaryProvider = Provider<DailyNutritionSummary>((ref) {
  return summarizeDay(
    ref.watch(todayMealRecordsProvider),
    target: ref.watch(canteenTargetProvider),
  );
});

/// 首页的 3 条缺口建议（钠超标时自动排除高钠菜）。
final canteenSuggestionsProvider = Provider<List<DishSuggestion>>((ref) {
  return suggestDishesForGaps(
    dishes: ref.watch(canteenDishesProvider),
    summary: ref.watch(dailyNutritionSummaryProvider),
  );
});
