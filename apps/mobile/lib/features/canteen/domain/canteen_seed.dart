/// 营养管家的演示菜品库（25 道菜，覆盖 7 个食堂与 6 个品类）。
///
/// ## 这些数字是怎么来的
///
/// 参照同类食堂菜的常见份量估算：热量、蛋白质、脂肪、碳水与钠都是**整数近似**，
/// 用于演示筛选、合计与缺口提示，**不是**实验室检测结果，也不来自某个食堂的
/// 官方营养表。页面必须显示 `canteenNutritionNotice`。
///
/// 过敏原只标四种常见项（坚果 / 海鲜 / 乳制品 / 麸质），且只代表「这道菜的
/// 常见做法里通常含有」；实际配料以窗口为准。
///
/// ## 为什么数据是常量
///
/// 菜品库不随时间变化，也不依赖后端；与 `teabreak` 的「相对 now 生成」不同，
/// 这里用常量最直观。钠阈值（600 mg/份）附近刻意留了几道菜，
/// 方便验证「超标后不推荐高钠菜」：例如紫菜蛋花汤 620 mg、红烧肉 950 mg。
library;

import '../../../domain/models/canteen_dish.dart';

const List<CanteenDish> canteenSeedDishes = <CanteenDish>[
  // ---------------- 一食堂 ----------------
  CanteenDish(
    id: 'cd-rice-white',
    name: '白米饭',
    canteen: CanteenName.first,
    category: DishCategory.staple,
    priceFen: 100,
    nutrition: NutritionFacts(
      kcal: 230,
      proteinG: 5,
      fatG: 1,
      carbsG: 50,
      sodiumMg: 2,
    ),
  ),
  CanteenDish(
    id: 'cd-braised-pork',
    name: '红烧肉',
    canteen: CanteenName.first,
    category: DishCategory.meat,
    priceFen: 1200,
    nutrition: NutritionFacts(
      kcal: 520,
      proteinG: 20,
      fatG: 42,
      carbsG: 10,
      sodiumMg: 950,
    ),
    allergens: <CommonAllergen>{CommonAllergen.gluten},
  ),
  CanteenDish(
    id: 'cd-stir-fried-greens',
    name: '清炒时蔬',
    canteen: CanteenName.first,
    category: DishCategory.vegetable,
    priceFen: 400,
    nutrition: NutritionFacts(
      kcal: 90,
      proteinG: 3,
      fatG: 5,
      carbsG: 8,
      sodiumMg: 320,
    ),
  ),
  CanteenDish(
    id: 'cd-tomato-egg-soup',
    name: '番茄蛋汤',
    canteen: CanteenName.first,
    category: DishCategory.soup,
    priceFen: 200,
    nutrition: NutritionFacts(
      kcal: 60,
      proteinG: 4,
      fatG: 3,
      carbsG: 4,
      sodiumMg: 480,
    ),
  ),

  // ---------------- 二食堂 ----------------
  CanteenDish(
    id: 'cd-beef-noodles',
    name: '牛肉拉面',
    canteen: CanteenName.second,
    category: DishCategory.staple,
    priceFen: 1400,
    nutrition: NutritionFacts(
      kcal: 620,
      proteinG: 28,
      fatG: 18,
      carbsG: 82,
      sodiumMg: 1450,
    ),
    allergens: <CommonAllergen>{CommonAllergen.gluten},
  ),
  CanteenDish(
    id: 'cd-kungpao-chicken',
    name: '宫保鸡丁',
    canteen: CanteenName.second,
    category: DishCategory.meat,
    priceFen: 1100,
    nutrition: NutritionFacts(
      kcal: 380,
      proteinG: 26,
      fatG: 24,
      carbsG: 16,
      sodiumMg: 880,
    ),
    allergens: <CommonAllergen>{
      CommonAllergen.nut,
      CommonAllergen.gluten,
    },
  ),
  CanteenDish(
    id: 'cd-garlic-broccoli',
    name: '蒜蓉西兰花',
    canteen: CanteenName.second,
    category: DishCategory.vegetable,
    priceFen: 500,
    nutrition: NutritionFacts(
      kcal: 110,
      proteinG: 5,
      fatG: 6,
      carbsG: 9,
      sodiumMg: 260,
    ),
  ),
  CanteenDish(
    id: 'cd-shengjian',
    name: '生煎包（4 只）',
    canteen: CanteenName.second,
    category: DishCategory.snack,
    priceFen: 600,
    nutrition: NutritionFacts(
      kcal: 420,
      proteinG: 14,
      fatG: 22,
      carbsG: 40,
      sodiumMg: 760,
    ),
    allergens: <CommonAllergen>{CommonAllergen.gluten},
  ),

  // ---------------- 三食堂 ----------------
  CanteenDish(
    id: 'cd-yangzhou-fried-rice',
    name: '扬州炒饭',
    canteen: CanteenName.third,
    category: DishCategory.staple,
    priceFen: 900,
    nutrition: NutritionFacts(
      kcal: 560,
      proteinG: 16,
      fatG: 20,
      carbsG: 76,
      sodiumMg: 980,
    ),
    allergens: <CommonAllergen>{CommonAllergen.gluten},
  ),
  CanteenDish(
    id: 'cd-steamed-fish',
    name: '清蒸鲈鱼',
    canteen: CanteenName.third,
    category: DishCategory.meat,
    priceFen: 1500,
    nutrition: NutritionFacts(
      kcal: 240,
      proteinG: 32,
      fatG: 10,
      carbsG: 2,
      sodiumMg: 450,
    ),
    allergens: <CommonAllergen>{CommonAllergen.seafood},
  ),
  CanteenDish(
    id: 'cd-cucumber-salad',
    name: '凉拌黄瓜',
    canteen: CanteenName.third,
    category: DishCategory.vegetable,
    priceFen: 350,
    nutrition: NutritionFacts(
      kcal: 45,
      proteinG: 1,
      fatG: 2,
      carbsG: 5,
      sodiumMg: 380,
    ),
  ),
  CanteenDish(
    id: 'cd-seaweed-egg-soup',
    name: '紫菜蛋花汤',
    canteen: CanteenName.third,
    category: DishCategory.soup,
    priceFen: 200,
    nutrition: NutritionFacts(
      kcal: 40,
      proteinG: 3,
      fatG: 2,
      carbsG: 3,
      sodiumMg: 620,
    ),
  ),

  // ---------------- 清真食堂 ----------------
  CanteenDish(
    id: 'cd-pilaf',
    name: '手抓饭',
    canteen: CanteenName.halal,
    category: DishCategory.staple,
    priceFen: 1200,
    nutrition: NutritionFacts(
      kcal: 610,
      proteinG: 22,
      fatG: 20,
      carbsG: 80,
      sodiumMg: 720,
    ),
  ),
  CanteenDish(
    id: 'cd-cumin-lamb',
    name: '孜然羊肉',
    canteen: CanteenName.halal,
    category: DishCategory.meat,
    priceFen: 1600,
    nutrition: NutritionFacts(
      kcal: 450,
      proteinG: 34,
      fatG: 30,
      carbsG: 6,
      sodiumMg: 690,
    ),
  ),
  CanteenDish(
    id: 'cd-vinegar-cabbage',
    name: '醋溜白菜',
    canteen: CanteenName.halal,
    category: DishCategory.vegetable,
    priceFen: 400,
    nutrition: NutritionFacts(
      kcal: 80,
      proteinG: 2,
      fatG: 4,
      carbsG: 9,
      sodiumMg: 410,
    ),
  ),
  CanteenDish(
    id: 'cd-naan',
    name: '烤馕',
    canteen: CanteenName.halal,
    category: DishCategory.snack,
    priceFen: 300,
    nutrition: NutritionFacts(
      kcal: 280,
      proteinG: 8,
      fatG: 6,
      carbsG: 48,
      sodiumMg: 350,
    ),
    allergens: <CommonAllergen>{CommonAllergen.gluten},
  ),

  // ---------------- 教工食堂 ----------------
  CanteenDish(
    id: 'cd-grain-rice',
    name: '杂粮饭',
    canteen: CanteenName.staff,
    category: DishCategory.staple,
    priceFen: 250,
    nutrition: NutritionFacts(
      kcal: 210,
      proteinG: 6,
      fatG: 2,
      carbsG: 44,
      sodiumMg: 5,
    ),
  ),
  CanteenDish(
    id: 'cd-pan-chicken-breast',
    name: '香煎鸡胸',
    canteen: CanteenName.staff,
    category: DishCategory.meat,
    priceFen: 1300,
    nutrition: NutritionFacts(
      kcal: 260,
      proteinG: 38,
      fatG: 9,
      carbsG: 2,
      sodiumMg: 420,
    ),
  ),
  CanteenDish(
    id: 'cd-wood-ear-yam',
    name: '木耳炒山药',
    canteen: CanteenName.staff,
    category: DishCategory.vegetable,
    priceFen: 600,
    nutrition: NutritionFacts(
      kcal: 130,
      proteinG: 3,
      fatG: 6,
      carbsG: 17,
      sodiumMg: 300,
    ),
  ),
  CanteenDish(
    id: 'cd-winter-melon-rib-soup',
    name: '冬瓜排骨汤',
    canteen: CanteenName.staff,
    category: DishCategory.soup,
    priceFen: 500,
    nutrition: NutritionFacts(
      kcal: 150,
      proteinG: 9,
      fatG: 10,
      carbsG: 5,
      sodiumMg: 540,
    ),
  ),

  // ---------------- 西餐厅 ----------------
  CanteenDish(
    id: 'cd-tomato-pasta',
    name: '番茄肉酱意面',
    canteen: CanteenName.western,
    category: DishCategory.staple,
    priceFen: 2200,
    nutrition: NutritionFacts(
      kcal: 680,
      proteinG: 24,
      fatG: 24,
      carbsG: 88,
      sodiumMg: 890,
    ),
    allergens: <CommonAllergen>{
      CommonAllergen.gluten,
      CommonAllergen.dairy,
    },
  ),
  CanteenDish(
    id: 'cd-fries',
    name: '薯条',
    canteen: CanteenName.western,
    category: DishCategory.snack,
    priceFen: 1000,
    nutrition: NutritionFacts(
      kcal: 380,
      proteinG: 5,
      fatG: 18,
      carbsG: 48,
      sodiumMg: 300,
    ),
  ),

  // ---------------- 咖啡厅 ----------------
  CanteenDish(
    id: 'cd-latte',
    name: '拿铁（中杯）',
    canteen: CanteenName.cafe,
    category: DishCategory.drink,
    priceFen: 1500,
    nutrition: NutritionFacts(
      kcal: 180,
      proteinG: 9,
      fatG: 9,
      carbsG: 14,
      sodiumMg: 120,
    ),
    allergens: <CommonAllergen>{CommonAllergen.dairy},
  ),
  CanteenDish(
    id: 'cd-cheesecake',
    name: '芝士蛋糕',
    canteen: CanteenName.cafe,
    category: DishCategory.snack,
    priceFen: 1800,
    nutrition: NutritionFacts(
      kcal: 350,
      proteinG: 6,
      fatG: 22,
      carbsG: 32,
      sodiumMg: 260,
    ),
    allergens: <CommonAllergen>{
      CommonAllergen.dairy,
      CommonAllergen.gluten,
    },
  ),
  CanteenDish(
    id: 'cd-soy-milk',
    name: '无糖豆浆',
    canteen: CanteenName.cafe,
    category: DishCategory.drink,
    priceFen: 400,
    nutrition: NutritionFacts(
      kcal: 80,
      proteinG: 7,
      fatG: 4,
      carbsG: 4,
      sodiumMg: 60,
    ),
  ),
];
