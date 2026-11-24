/// 食堂菜品与营养快照（`canteen` 营养管家）。
///
/// ## 营养值是演示估算
///
/// 菜品来自公开常见的食堂菜式，数值按常见份量**估算**
/// （见 `features/canteen/domain/canteen_seed.dart`），**不是**实验室检测结果。
/// 页面必须原样展示 [canteenNutritionNotice]：把估算写成「检测值」会让人
/// 误以为可以拿它做健康决策。
///
/// ## 过敏原只是提示
///
/// 食堂菜品的实际配料随厨师和当天备料变化，[CanteenDish.allergens] 只覆盖
/// 四种常见过敏原（坚果 / 海鲜 / 乳制品 / 麸质）。忌口严重时仍需现场确认。
library;

import 'json_read.dart';
import 'money.dart';

/// 营养数据的来源说明 —— 所有涉及营养值的页面都会显示这句话。
const String canteenNutritionNotice = '演示估算，非实验室数据';

/// 单份钠含量达到该值即视为「高钠」。
///
/// 600 mg/份 是一个便于演示的阈值：一份菜就占掉每日 2000 mg 上限的 30%。
/// 钠已经超标时，缺口建议会**排除**这些菜品。
const int highSodiumDishSodiumMg = 600;

/// 校内食堂（7 个）。
enum CanteenName {
  first('一食堂'),
  second('二食堂'),
  third('三食堂'),
  halal('清真食堂'),
  staff('教工食堂'),
  western('西餐厅'),
  cafe('咖啡厅');

  const CanteenName(this.label);

  /// 面向用户的名字（与校园里的叫法一致）。
  final String label;
}

/// 菜品品类（仅用于筛选与展示，不是营养分类）。
enum DishCategory {
  staple('主食'),
  meat('荤菜'),
  vegetable('素菜'),
  soup('汤'),
  drink('饮品'),
  snack('小吃');

  const DishCategory(this.label);

  final String label;
}

/// 四种常见过敏原。
///
/// 刻意**不**罗列全部过敏原：数据是演示估算，写全反而让人以为它可靠。
enum CommonAllergen {
  nut('坚果'),
  seafood('海鲜'),
  dairy('乳制品'),
  gluten('麸质');

  const CommonAllergen(this.label);

  final String label;
}

/// 一份菜的营养值（整数单位：kcal / g / mg）。
///
/// 乘以份数时**先放大再四舍五入**：1.5 份的 133 kcal 得到 200 kcal，
/// 而不是把 133 先取整再乘。合计以「条目合计」相加，因此界面上的
/// 每一行数字相加一定等于总计，不会出现「行加起来对不上」。
final class NutritionFacts {
  const NutritionFacts({
    required this.kcal,
    required this.proteinG,
    required this.fatG,
    required this.carbsG,
    required this.sodiumMg,
  });

  /// 全零（空餐次 / 汇总初值）。
  static const NutritionFacts zero = NutritionFacts(
    kcal: 0,
    proteinG: 0,
    fatG: 0,
    carbsG: 0,
    sodiumMg: 0,
  );

  final int kcal;
  final int proteinG;
  final int fatG;
  final int carbsG;
  final int sodiumMg;

  /// 按份数线性放大，四舍五入到整数。
  NutritionFacts scaled(num servings) => NutritionFacts(
        kcal: (kcal * servings).round(),
        proteinG: (proteinG * servings).round(),
        fatG: (fatG * servings).round(),
        carbsG: (carbsG * servings).round(),
        sodiumMg: (sodiumMg * servings).round(),
      );

  NutritionFacts operator +(NutritionFacts other) => NutritionFacts(
        kcal: kcal + other.kcal,
        proteinG: proteinG + other.proteinG,
        fatG: fatG + other.fatG,
        carbsG: carbsG + other.carbsG,
        sodiumMg: sodiumMg + other.sodiumMg,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'kcal': kcal,
        'proteinG': proteinG,
        'fatG': fatG,
        'carbsG': carbsG,
        'sodiumMg': sodiumMg,
      };

  factory NutritionFacts.fromJson(Map<String, Object?> json) => NutritionFacts(
        kcal: readInt(json, 'kcal'),
        proteinG: readInt(json, 'proteinG'),
        fatG: readInt(json, 'fatG'),
        carbsG: readInt(json, 'carbsG'),
        sodiumMg: readInt(json, 'sodiumMg'),
      );

  @override
  bool operator ==(Object other) =>
      other is NutritionFacts &&
      other.kcal == kcal &&
      other.proteinG == proteinG &&
      other.fatG == fatG &&
      other.carbsG == carbsG &&
      other.sodiumMg == sodiumMg;

  @override
  int get hashCode =>
      Object.hash(kcal, proteinG, fatG, carbsG, sodiumMg);

  @override
  String toString() => 'NutritionFacts(kcal: $kcal, protein: $proteinG g, '
      'fat: $fatG g, carbs: $carbsG g, sodium: $sodiumMg mg)';
}

/// 菜品库中的一道菜。
///
/// 价格用**整数分**（与全项目 `Money` 约定一致），避免浮点金额。
final class CanteenDish {
  const CanteenDish({
    required this.id,
    required this.name,
    required this.canteen,
    required this.category,
    required this.priceFen,
    required this.nutrition,
    this.allergens = const <CommonAllergen>{},
  });

  final String id;
  final String name;
  final CanteenName canteen;
  final DishCategory category;
  final int priceFen;

  /// 一份（不是一盘、不是 100 g）的营养估算。
  final NutritionFacts nutrition;

  /// 配料中**常见**过敏原；空集合表示没有标注。
  final Set<CommonAllergen> allergens;

  String get priceLabel => '¥${Money.fenToYuan(priceFen)}';

  bool get isHighSodium => nutrition.sodiumMg >= highSodiumDishSodiumMg;

  /// 例：「含坚果、麸质」；没有标注时返回空串，由调用方决定是否隐藏。
  String get allergenLabel => allergens.isEmpty
      ? ''
      : '含${allergens.map((CommonAllergen item) => item.label).join('、')}';

  @override
  String toString() => 'CanteenDish($id, $name)';
}
