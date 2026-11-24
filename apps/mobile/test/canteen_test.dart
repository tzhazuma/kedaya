import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/data/mock/in_memory_stores.dart';
import 'package:kedaya/domain/models/canteen_dish.dart';
import 'package:kedaya/domain/models/meal_record.dart';
import 'package:kedaya/features/canteen/application/canteen_providers.dart';
import 'package:kedaya/features/canteen/domain/canteen_rules.dart';
import 'package:kedaya/features/canteen/domain/canteen_seed.dart';

/// 营养管家的纯逻辑与控制器测试。
///
/// 全部用固定「现在」（2026-11-24 12:30）与内存缓存，因此「今日」、
/// 份数合计和删除后的汇总都是确定性的。
void main() {
  final DateTime fixedNow = DateTime(2026, 11, 24, 12, 30);

  CanteenDish dish(String id) =>
      canteenSeedDishes.firstWhere((CanteenDish item) => item.id == id);

  MealEntry entry(CanteenDish item, {double servings = 1}) => MealEntry(
        dishId: item.id,
        dishName: item.name,
        servings: servings,
        nutritionPerServing: item.nutrition,
      );

  ProviderContainer containerWith(InMemoryCacheStore cache) {
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        localCacheProvider.overrideWithValue(cache),
        canteenClockProvider.overrideWithValue(() => fixedNow),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  group('份数合计：线性放大 + 四舍五入', () {
    test('1.5 份按「先乘再取整」得到整数', () {
      const NutritionFacts perServing = NutritionFacts(
        kcal: 133,
        proteinG: 13,
        fatG: 7,
        carbsG: 21,
        sodiumMg: 301,
      );
      final NutritionFacts scaled = perServing.scaled(1.5);
      expect(scaled.kcal, 200); // 199.5 -> 200
      expect(scaled.proteinG, 20); // 19.5 -> 20
      expect(scaled.fatG, 11); // 10.5 -> 11
      expect(scaled.carbsG, 32); // 31.5 -> 32
      expect(scaled.sodiumMg, 452); // 451.5 -> 452
    });

    test('一餐多条目的合计 = 每条目合计之和', () {
      final MealRecord record = MealRecord(
        id: 'meal-1',
        date: canteenDateOnly(fixedNow),
        slot: MealSlot.lunch,
        entries: <MealEntry>[
          entry(dish('cd-rice-white'), servings: 2),
          entry(dish('cd-braised-pork'), servings: 0.5),
        ],
      );
      expect(
        record.total,
        const NutritionFacts(
          kcal: 720, // 230*2 + 520*0.5
          proteinG: 20, // 5*2 + 20*0.5
          fatG: 23, // 1*2 + 42*0.5
          carbsG: 105, // 50*2 + 10*0.5
          sodiumMg: 479, // 2*2 + 950*0.5
        ),
      );
    });

    test('每日汇总 = 各条记录合计相加', () {
      final MealRecord lunch = MealRecord(
        id: 'meal-lunch',
        date: canteenDateOnly(fixedNow),
        slot: MealSlot.lunch,
        entries: <MealEntry>[entry(dish('cd-rice-white'), servings: 2)],
      );
      final MealRecord snack = MealRecord(
        id: 'meal-snack',
        date: canteenDateOnly(fixedNow),
        slot: MealSlot.snack,
        entries: <MealEntry>[entry(dish('cd-soy-milk'))],
      );
      final DailyNutritionSummary summary =
          summarizeDay(<MealRecord>[lunch, snack]);
      expect(summary.intake, lunch.total + snack.total);
      expect(summary.intake.kcal, 540);
    });
  });

  group('菜品筛选：食堂 + 品类 + 关键词叠加', () {
    test('种子菜品覆盖全部 7 个食堂与 6 个品类', () {
      expect(canteenSeedDishes, hasLength(25));
      expect(
        canteenSeedDishes
            .map((CanteenDish item) => item.canteen)
            .toSet(),
        unorderedEquals(CanteenName.values),
      );
      expect(
        canteenSeedDishes
            .map((CanteenDish item) => item.category)
            .toSet(),
        unorderedEquals(DishCategory.values),
      );
    });

    test('单条件：食堂 / 品类 / 关键词各自生效', () {
      final List<CanteenDish> firstCanteen = filterCanteenDishes(
        canteenSeedDishes,
        const DishQuery(canteen: CanteenName.first),
      );
      expect(firstCanteen, hasLength(4));
      expect(
        firstCanteen.every(
            (CanteenDish item) => item.canteen == CanteenName.first),
        isTrue,
      );

      final List<CanteenDish> soups = filterCanteenDishes(
        canteenSeedDishes,
        const DishQuery(category: DishCategory.soup),
      );
      expect(soups, hasLength(3));
      expect(
        soups.every(
            (CanteenDish item) => item.category == DishCategory.soup),
        isTrue,
      );

      final List<CanteenDish> chicken = filterCanteenDishes(
        canteenSeedDishes,
        const DishQuery(keyword: ' 鸡 '),
      );
      expect(chicken, hasLength(2));
      expect(
        chicken.every((CanteenDish item) => item.name.contains('鸡')),
        isTrue,
      );
    });

    test('三个条件同时成立才保留（AND）', () {
      final List<CanteenDish> narrowed = filterCanteenDishes(
        canteenSeedDishes,
        const DishQuery(
          canteen: CanteenName.first,
          category: DishCategory.staple,
          keyword: '饭',
        ),
      );
      expect(
        narrowed.map((CanteenDish item) => item.id),
        <String>['cd-rice-white'],
      );

      // 三食堂没有饮品：食堂 + 品类已经矛盾，关键词救不回来。
      final List<CanteenDish> impossible = filterCanteenDishes(
        canteenSeedDishes,
        const DishQuery(
          canteen: CanteenName.third,
          category: DishCategory.drink,
        ),
      );
      expect(impossible, isEmpty);

      // 叠加只会收窄，不会变多。
      final List<CanteenDish> canteenOnly = filterCanteenDishes(
        canteenSeedDishes,
        const DishQuery(canteen: CanteenName.first),
      );
      expect(canteenOnly.length, greaterThan(narrowed.length));
    });
  });

  group('缺口建议与钠上限', () {
    const DailyNutritionSummary overSodium = DailyNutritionSummary(
      intake: NutritionFacts(
        kcal: 1200,
        proteinG: 25,
        fatG: 20,
        carbsG: 80,
        sodiumMg: 2600,
      ),
      target: CanteenNutritionTarget.defaults,
    );

    test('钠超标时给出 3 条建议，且一条高钠菜都没有', () {
      expect(overSodium.sodiumExceeded, isTrue);
      expect(overSodium.sodiumOverMg, 600);

      final List<DishSuggestion> suggestions = suggestDishesForGaps(
        dishes: canteenSeedDishes,
        summary: overSodium,
      );
      expect(suggestions, hasLength(3));
      expect(
        suggestions.every(
            (DishSuggestion item) => !item.dish.isHighSodium),
        isTrue,
      );
      expect(
        suggestions.every((DishSuggestion item) =>
            item.dish.nutrition.sodiumMg < highSodiumDishSodiumMg),
        isTrue,
      );
      // 推荐必须来自菜品库，不能凭空造菜。
      expect(
        suggestions.every((DishSuggestion item) =>
            canteenSeedDishes.contains(item.dish)),
        isTrue,
      );
    });

    test('高钠菜即使在蛋白质上更突出也会被排除', () {
      const CanteenDish highSodium = CanteenDish(
        id: 'test-high-sodium',
        name: '高钠鸡胸',
        canteen: CanteenName.staff,
        category: DishCategory.meat,
        priceFen: 1000,
        nutrition: NutritionFacts(
          kcal: 300,
          proteinG: 60,
          fatG: 5,
          carbsG: 0,
          sodiumMg: 1300,
        ),
      );
      const CanteenDish lowSodium = CanteenDish(
        id: 'test-low-sodium',
        name: '低钠鸡胸',
        canteen: CanteenName.staff,
        category: DishCategory.meat,
        priceFen: 1000,
        nutrition: NutritionFacts(
          kcal: 300,
          proteinG: 30,
          fatG: 5,
          carbsG: 0,
          sodiumMg: 200,
        ),
      );
      final List<DishSuggestion> over = suggestDishesForGaps(
        dishes: const <CanteenDish>[highSodium, lowSodium],
        summary: overSodium,
      );
      expect(
        over.map((DishSuggestion item) => item.dish.id),
        isNot(contains('test-high-sodium')),
      );
      expect(
        over.map((DishSuggestion item) => item.dish.id),
        contains('test-low-sodium'),
      );

      // 钠未超标时不过滤，证明这是条件规则而不是永远禁用。
      const DailyNutritionSummary underSodium = DailyNutritionSummary(
        intake: NutritionFacts(
          kcal: 1200,
          proteinG: 25,
          fatG: 20,
          carbsG: 80,
          sodiumMg: 1000,
        ),
        target: CanteenNutritionTarget.defaults,
      );
      final List<DishSuggestion> under = suggestDishesForGaps(
        dishes: const <CanteenDish>[highSodium, lowSodium],
        summary: underSodium,
      );
      expect(
        under.map((DishSuggestion item) => item.dish.id),
        contains('test-high-sodium'),
      );
    });

    test('四项都达标时不再为凑数而推荐加餐', () {
      const DailyNutritionSummary full = DailyNutritionSummary(
        intake: NutritionFacts(
          kcal: 2100,
          proteinG: 70,
          fatG: 65,
          carbsG: 260,
          sodiumMg: 1200,
        ),
        target: CanteenNutritionTarget.defaults,
      );
      expect(full.hasGap, isFalse);
      expect(
        suggestDishesForGaps(dishes: canteenSeedDishes, summary: full),
        isEmpty,
      );
    });
  });

  group('今日记录：删除后汇总更新', () {
    test('删除整条记录后，今日汇总同步减少', () async {
      final InMemoryCacheStore cache = InMemoryCacheStore();
      final ProviderContainer container = containerWith(cache);
      final MealRecordsController controller = container.read(
        mealRecordsControllerProvider.notifier,
      );

      final MealRecord lunch = controller.addMeal(
        slot: MealSlot.lunch,
        entries: <MealEntry>[entry(dish('cd-rice-white'), servings: 2)],
      );
      final MealRecord snack = controller.addMeal(
        slot: MealSlot.snack,
        entries: <MealEntry>[entry(dish('cd-soy-milk'))],
      );
      await Future<void>.delayed(Duration.zero);

      expect(
        container.read(todayMealRecordsProvider),
        hasLength(2),
      );
      expect(
        container.read(dailyNutritionSummaryProvider).intake.kcal,
        540,
      );

      expect(controller.removeRecord(snack.id), isTrue);
      expect(
        container.read(todayMealRecordsProvider),
        hasLength(1),
      );
      expect(
        container.read(dailyNutritionSummaryProvider).intake,
        lunch.total,
      );
      expect(
        container.read(dailyNutritionSummaryProvider).intake.kcal,
        460,
      );

      // 不存在的 id 不会误删。
      expect(controller.removeRecord('missing'), isFalse);
    });

    test('删掉餐里最后一个菜品时整条记录消失', () {
      final InMemoryCacheStore cache = InMemoryCacheStore();
      final ProviderContainer container = containerWith(cache);
      final MealRecordsController controller = container.read(
        mealRecordsControllerProvider.notifier,
      );

      final MealRecord dinner = controller.addMeal(
        slot: MealSlot.dinner,
        entries: <MealEntry>[
          entry(dish('cd-rice-white')),
          entry(dish('cd-soy-milk')),
        ],
      );
      expect(
        container.read(dailyNutritionSummaryProvider).intake.kcal,
        310,
      );

      expect(controller.removeEntry(dinner.id, 0), isTrue);
      expect(
        container.read(todayMealRecordsProvider).single.entries.single.dishId,
        'cd-soy-milk',
      );
      expect(
        container.read(dailyNutritionSummaryProvider).intake.kcal,
        80,
      );

      expect(controller.removeEntry(dinner.id, 0), isTrue);
      expect(container.read(todayMealRecordsProvider), isEmpty);
      expect(
        container.read(dailyNutritionSummaryProvider).intake,
        NutritionFacts.zero,
      );
    });

    test('只汇总「今天」：昨天的记录不进入首页汇总', () {
      final InMemoryCacheStore cache = InMemoryCacheStore();
      final ProviderContainer container = containerWith(cache);
      final MealRecordsController controller = container.read(
        mealRecordsControllerProvider.notifier,
      );

      controller.addMeal(
        slot: MealSlot.dinner,
        date: fixedNow.subtract(const Duration(days: 1)),
        entries: <MealEntry>[entry(dish('cd-rice-white'))],
      );
      expect(container.read(todayMealRecordsProvider), isEmpty);
      expect(
        container.read(dailyNutritionSummaryProvider).intake.kcal,
        0,
      );
    });
  });

  group('保存校验', () {
    test('空餐次不能保存：校验与控制器都拒绝，状态不变', () {
      expect(
        validateMealDraft(const <MealEntry>[]),
        contains(MealDraftProblem.empty),
      );

      final InMemoryCacheStore cache = InMemoryCacheStore();
      final ProviderContainer container = containerWith(cache);
      final MealRecordsController controller = container.read(
        mealRecordsControllerProvider.notifier,
      );

      expect(
        () => controller.addMeal(
          slot: MealSlot.lunch,
          entries: const <MealEntry>[],
        ),
        throwsA(isA<MealDraftException>()),
      );
      expect(container.read(mealRecordsControllerProvider), isEmpty);
    });

    test('份数不大于 0 不能保存', () {
      final MealEntry invalid = entry(dish('cd-rice-white'), servings: 0);
      expect(
        validateMealDraft(<MealEntry>[invalid]),
        contains(MealDraftProblem.invalidServings),
      );

      final InMemoryCacheStore cache = InMemoryCacheStore();
      final ProviderContainer container = containerWith(cache);
      final MealRecordsController controller = container.read(
        mealRecordsControllerProvider.notifier,
      );
      expect(
        () => controller.addMeal(
          slot: MealSlot.lunch,
          entries: <MealEntry>[invalid],
        ),
        throwsA(isA<MealDraftException>()),
      );
      expect(container.read(mealRecordsControllerProvider), isEmpty);
    });
  });

  test('记录写入本机缓存，新容器重开仍能读回', () async {
    final InMemoryCacheStore cache = InMemoryCacheStore();
    final ProviderContainer first = containerWith(cache);
    first.read(mealRecordsControllerProvider.notifier).addMeal(
          slot: MealSlot.lunch,
          entries: <MealEntry>[entry(dish('cd-rice-white'), servings: 1.5)],
        );
    await Future<void>.delayed(Duration.zero);

    final ProviderContainer second = containerWith(cache);
    final List<MealRecord> restored =
        second.read(todayMealRecordsProvider);
    expect(restored, hasLength(1));
    expect(restored.single.entries.single.dishName, '白米饭');
    expect(restored.single.entries.single.servings, 1.5);
    expect(restored.single.total.kcal, 345);
  });
}
