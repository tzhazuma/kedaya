import { describe, expect, it } from 'vitest';
import {
  checkDishEnergyConsistency,
  computeGaps,
  computeStreak,
  computeDietPersonas,
  formatPersonaShare,
  DISH_CATEGORY_LABELS,
  EMPTY_TOTALS,
  energyFromMacros,
  estimateDailyTargets,
  formatAllergenList,
  inferAllergensFromName,
  isDishCategory,
  isGoalsMet,
  matchAvoidedAllergens,
  MEAL_TYPE_LABELS,
  NUTRIENT_LABELS,
  recommendDishes,
  suggestMealType,
  sumByMealType,
  sumItems,
  summarizeWeek,
  type DishLike,
  type MealItemLike,
  type NutritionTarget,
} from './nutrition';

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

describe('sumItems', () => {
  it('按份数乘入每份营养', () => {
    const totals = sumItems([
      {
        dishName: '米饭',
        servings: 2,
        caloriesKcal: 200,
        proteinG: 4,
        fatG: 1,
        carbG: 44,
        fiberG: 1,
        sodiumMg: 5,
      },
      {
        dishName: '红烧肉',
        servings: 1,
        caloriesKcal: 450,
        proteinG: 18,
        fatG: 32,
        carbG: 8,
        fiberG: 0,
        sodiumMg: 600,
      },
    ]);
    expect(totals.caloriesKcal).toBe(850);
    expect(totals.proteinG).toBe(26);
    expect(totals.fiberG).toBe(2);
    expect(totals.sodiumMg).toBe(610);
  });

  it('空列表返回全零', () => {
    expect(sumItems([])).toEqual(EMPTY_TOTALS);
  });

  it('缺省的可选字段按 0 处理', () => {
    const totals = sumItems([{ dishName: 'x', servings: 1, caloriesKcal: 100, proteinG: 1, fatG: 1, carbG: 1 }]);
    expect(totals.fiberG).toBe(0);
    expect(totals.sodiumMg).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 缺口
 * ------------------------------------------------------------------ */

describe('computeGaps', () => {
  const target: NutritionTarget = {
    caloriesKcal: 2000,
    proteinG: 100,
    fatG: 60,
    carbG: 250,
    fiberG: 25,
    sodiumMg: 2000,
  };

  it('未摄入时缺口等于目标', () => {
    const gaps = computeGaps(target);
    expect(gaps.caloriesKcal).toBe(2000);
    expect(gaps.proteinG).toBe(100);
  });

  it('超标时为负', () => {
    const gaps = computeGaps(target, { ...EMPTY_TOTALS, caloriesKcal: 2300, proteinG: 120 });
    expect(gaps.caloriesKcal).toBe(-300);
    expect(gaps.proteinG).toBe(-20);
    expect(isGoalsMet(gaps)).toBe(false);
  });

  it('目标全部达成', () => {
    const gaps = computeGaps(target, {
      caloriesKcal: 2000,
      proteinG: 100,
      fatG: 60,
      carbG: 250,
      fiberG: 25,
      sodiumMg: 2000,
    });
    expect(isGoalsMet(gaps)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 估算器
 * ------------------------------------------------------------------ */

describe('estimateDailyTargets', () => {
  it('男性中等活动维持：BMR×1.55，宏量比 15/25/60', () => {
    const t = estimateDailyTargets({
      sex: 'male',
      age: 20,
      heightCm: 175,
      weightKg: 70,
      activity: 'moderate',
      goal: 'maintain',
    });
    // BMR = 10*70 + 6.25*175 - 5*20 + 5 = 1698.75；TDEE = 1698.75*1.55 = 2633.1 → 取整到十位 2630
    expect(t.caloriesKcal).toBe(2630);
    expect(t.proteinG).toBe(Math.round((2630 * 0.15) / 4));
    expect(t.fatG).toBe(Math.round((2630 * 0.25) / 9));
    expect(t.carbG).toBe(Math.round((2630 * 0.6) / 4));
    expect(t.fiberG).toBe(Math.round((2630 / 1000) * 14));
    expect(t.sodiumMg).toBe(2000);
  });

  it('女性与男性同参数时热量更低', () => {
    const base = { age: 20, heightCm: 165, weightKg: 55, activity: 'light', goal: 'maintain' } as const;
    const male = estimateDailyTargets({ ...base, sex: 'male' });
    const female = estimateDailyTargets({ ...base, sex: 'female' });
    expect(female.caloriesKcal).toBeLessThan(male.caloriesKcal);
  });

  it('减脂有热量折扣且蛋白质不低于 1g/kg', () => {
    const t = estimateDailyTargets({
      sex: 'female',
      age: 22,
      heightCm: 160,
      weightKg: 50,
      activity: 'sedentary',
      goal: 'lose',
    });
    // BMR = 500 + 1000 - 110 - 161 = 1229；TDEE = 1474.8；×0.85 ≈ 1254，但保底 1200 不触发
    expect(t.caloriesKcal).toBeGreaterThanOrEqual(1200);
    expect(t.proteinG).toBeGreaterThanOrEqual(50);
  });

  it('热量保底 1200 kcal', () => {
    const t = estimateDailyTargets({
      sex: 'female',
      age: 60,
      heightCm: 150,
      weightKg: 40,
      activity: 'sedentary',
      goal: 'lose',
    });
    expect(t.caloriesKcal).toBe(1200);
    expect(t.proteinG).toBeGreaterThanOrEqual(40);
  });

  it('增肌系数高于维持', () => {
    const base = { sex: 'male', age: 20, heightCm: 175, weightKg: 70, activity: 'moderate' } as const;
    expect(estimateDailyTargets({ ...base, goal: 'gain' }).caloriesKcal).toBeGreaterThan(
      estimateDailyTargets({ ...base, goal: 'maintain' }).caloriesKcal,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 推荐
 * ------------------------------------------------------------------ */

const target: NutritionTarget = {
  caloriesKcal: 2000,
  proteinG: 100,
  fatG: 60,
  carbG: 250,
  fiberG: 25,
  sodiumMg: 2000,
};

const dishes: DishLike[] = [
  { id: 'd1', name: '米饭', category: 'staple', caloriesKcal: 200, proteinG: 4, fatG: 1, carbG: 44, fiberG: 1, sodiumMg: 5 },
  { id: 'd2', name: '番茄炒蛋', category: 'vegetable', caloriesKcal: 180, proteinG: 8, fatG: 12, carbG: 6, fiberG: 2, sodiumMg: 300 },
  { id: 'd3', name: '红烧排骨', category: 'meat', caloriesKcal: 520, proteinG: 28, fatG: 38, carbG: 10, fiberG: 0, sodiumMg: 900 },
  { id: 'd4', name: '清炒菠菜', category: 'vegetable', caloriesKcal: 90, proteinG: 3, fatG: 5, carbG: 4, fiberG: 3, sodiumMg: 200 },
  { id: 'd5', name: '奶茶', category: 'drink', caloriesKcal: 300, proteinG: 2, fatG: 10, carbG: 45, fiberG: 0, sodiumMg: 60 },
];

describe('recommendDishes', () => {
  it('蛋白质缺口大时优先推荐高蛋白菜品', () => {
    const consumed = { ...EMPTY_TOTALS, caloriesKcal: 1500, carbG: 220, proteinG: 20 };
    const recs = recommendDishes(dishes, target, consumed, { limit: 3 });
    expect(recs.length).toBeGreaterThan(0);
    const top = recs[0];
    expect(top).toBeDefined();
    if (top === undefined) return;
    expect(top.dish.id).toBe('d3'); // 红烧排骨：蛋白 28g 远超其他
    // 理由说「这份补上了什么」：排骨单项贡献最大的是脂肪（38g/份），
    // 实现按最大贡献选理由，不断言具体营养名，只要求可解释
    expect(top.reason).toContain('缺口');
  });

  it('热量接近打顶时不为高热量菜品加分', () => {
    const consumed = { ...EMPTY_TOTALS, caloriesKcal: 1950, proteinG: 95, carbG: 245 };
    const recs = recommendDishes(dishes, target, consumed, { limit: 5 });
    // 剩余热量只有 50：红烧排骨（520）被重罚垫底，清炒菠菜（90）相对占优
    const top = recs[0];
    const last = recs[recs.length - 1];
    expect(top).toBeDefined();
    expect(last).toBeDefined();
    if (top === undefined || last === undefined) return;
    expect(top.dish.id).toBe('d4');
    expect(last.dish.id).toBe('d3');
  });

  it('尊重 limit', () => {
    const recs = recommendDishes(dishes, target, EMPTY_TOTALS, { limit: 2 });
    expect(recs).toHaveLength(2);
  });

  it('钠超标后高钠菜品被扣分', () => {
    const consumed = { ...EMPTY_TOTALS, caloriesKcal: 1800, sodiumMg: 2600 };
    const recs = recommendDishes(dishes, target, consumed, { limit: 5 });
    const ribs = recs.find((r) => r.dish.id === 'd3');
    const rice = recs.find((r) => r.dish.id === 'd1');
    expect(ribs).toBeDefined();
    expect(rice).toBeDefined();
    expect(ribs!.score).toBeLessThan(rice!.score);
  });

  it('品类均衡：未吃过的品类获得加成并写入理由', () => {
    const recs = recommendDishes(dishes, target, EMPTY_TOTALS, {
      limit: 5,
      eatenCategories: ['staple', 'meat'],
    });
    const veg = recs.find((r) => r.dish.category === 'vegetable');
    expect(veg).toBeDefined();
    expect(veg!.reason).toContain('素菜');
  });
});

/* ------------------------------------------------------------------ *
 * 杂项
 * ------------------------------------------------------------------ */

describe('suggestMealType', () => {
  it('按小时推测餐型', () => {
    expect(suggestMealType(new Date('2026-10-16T08:00:00'))).toBe('breakfast');
    expect(suggestMealType(new Date('2026-10-16T12:00:00'))).toBe('lunch');
    expect(suggestMealType(new Date('2026-10-16T18:00:00'))).toBe('dinner');
    expect(suggestMealType(new Date('2026-10-16T22:00:00'))).toBe('snack');
  });
});

describe('isDishCategory / 标签', () => {
  it('识别合法品类', () => {
    expect(isDishCategory('staple')).toBe(true);
    expect(isDishCategory('nope')).toBe(false);
    expect(isDishCategory(42)).toBe(false);
  });

  it('标签齐全', () => {
    expect(DISH_CATEGORY_LABELS.vegetable).toBe('素菜');
    expect(MEAL_TYPE_LABELS.lunch).toBe('午餐');
    expect(NUTRIENT_LABELS.sodiumMg).toBe('钠');
    expect(NUTRIENT_LABELS.caloriesKcal).toBe('热量');
  });
});

/* ------------------------------------------------------------------ *
 * 份数小数（半份 / 一勺饭）
 * ------------------------------------------------------------------ */

describe('sumItems · 小数份数', () => {
  it('0.5 份按一半计入，不再被截断成 0', () => {
    const totals = sumItems([
      { dishName: '米饭', servings: 0.5, caloriesKcal: 200, proteinG: 4, fatG: 1, carbG: 44, fiberG: 1, sodiumMg: 5 },
    ]);
    expect(totals.caloriesKcal).toBe(100);
    expect(totals.proteinG).toBe(2);
    expect(totals.carbG).toBe(22);
  });

  it('0.25 + 0.25 累加不出现浮点噪声', () => {
    const item = { dishName: '粥', servings: 0.25, caloriesKcal: 100, proteinG: 3, fatG: 0, carbG: 20 };
    expect(sumItems([item, item]).caloriesKcal).toBe(50);
  });

  it('负数份数按 0 处理（不出现负摄入）', () => {
    expect(
      sumItems([{ dishName: 'x', servings: -3, caloriesKcal: 100, proteinG: 1, fatG: 1, carbG: 1 }]).caloriesKcal,
    ).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 推荐：不推荐今天已经吃过的菜
 * ------------------------------------------------------------------ */

describe('recommendDishes · 已吃菜品排除', () => {
  it('eatenDishIds 里的菜品不再出现在推荐里', () => {
    const recs = recommendDishes(dishes, target, EMPTY_TOTALS, {
      limit: 5,
      eatenDishIds: ['d3'],
    });
    expect(recs.map((rec) => rec.dish.id)).not.toContain('d3');
  });

  it('排除后仍返回足量候选（不是简单截断）', () => {
    const all = recommendDishes(dishes, target, EMPTY_TOTALS, { limit: 5 });
    const filtered = recommendDishes(dishes, target, EMPTY_TOTALS, { limit: 5, eatenDishIds: ['d1'] });
    expect(all).toHaveLength(5);
    expect(filtered).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------ *
 * 数据卫生：4 / 4 / 9 能量一致性
 * ------------------------------------------------------------------ */

describe('checkDishEnergyConsistency', () => {
  it('三大营养素与热量自洽时返回 null', () => {
    expect(energyFromMacros({ proteinG: 10, fatG: 10, carbG: 40 })).toBe(290);
    expect(checkDishEnergyConsistency({ caloriesKcal: 300, proteinG: 10, fatG: 10, carbG: 40 })).toBeNull();
  });

  it('热量与推算值差太多时给出中文告警', () => {
    const warning = checkDishEnergyConsistency({ caloriesKcal: 900, proteinG: 5, fatG: 1, carbG: 10 });
    expect(warning).toContain('复核录入');
  });

  it('热量为 0 时不判为异常（水 / 茶）', () => {
    expect(checkDishEnergyConsistency({ caloriesKcal: 0, proteinG: 0, fatG: 0, carbG: 0 })).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 过敏原 / 忌口
 * ------------------------------------------------------------------ */

describe('过敏原推断与硬过滤', () => {
  it('菜名关键词推断常见过敏原', () => {
    expect(inferAllergensFromName('宫保鸡丁')).toContain('peanut');
    expect(inferAllergensFromName('水煮鱼')).toEqual(expect.arrayContaining(['seafood', 'chili']));
    expect(inferAllergensFromName('豆浆')).toContain('soy');
    expect(inferAllergensFromName('清炒菠菜')).toEqual([]);
  });

  it('命中忌口才返回，未标注的菜不会被误伤', () => {
    expect(matchAvoidedAllergens(['peanut', 'egg'], ['peanut'])).toEqual(['peanut']);
    expect(matchAvoidedAllergens(['egg'], ['peanut'])).toEqual([]);
    expect(matchAvoidedAllergens(undefined, ['peanut'])).toEqual([]);
    expect(matchAvoidedAllergens(['peanut'], [])).toEqual([]);
  });

  it('中文串用于界面展示', () => {
    expect(formatAllergenList(['peanut', 'seafood'])).toBe('花生、海鲜');
    expect(formatAllergenList([])).toBe('');
  });

  it('推荐会整道排除命中忌口的菜（不是扣分）', () => {
    const withAllergens: DishLike[] = [
      {
        id: 'd3',
        name: '红烧排骨',
        category: 'meat',
        caloriesKcal: 520,
        proteinG: 28,
        fatG: 38,
        carbG: 10,
        fiberG: 0,
        sodiumMg: 900,
        allergens: ['pork'],
      },
      {
        id: 'd4',
        name: '清炒菠菜',
        category: 'vegetable',
        caloriesKcal: 90,
        proteinG: 3,
        fatG: 5,
        carbG: 4,
        fiberG: 3,
        sodiumMg: 200,
        allergens: [],
      },
    ];
    const recs = recommendDishes(withAllergens, target, EMPTY_TOTALS, {
      limit: 5,
      excludeAllergens: ['pork'],
    });
    expect(recs.map((rec) => rec.dish.id)).not.toContain('d3');
    expect(recs.map((rec) => rec.dish.id)).toContain('d4');
  });
});

/* ------------------------------------------------------------------ *
 * 餐型维度汇总
 * ------------------------------------------------------------------ */

describe('sumByMealType', () => {
  const item = (caloriesKcal: number, proteinG = 0): MealItemLike => ({
    dishName: 'x',
    servings: 1,
    caloriesKcal,
    proteinG,
    fatG: 0,
    carbG: 0,
  });

  it('四类恒定返回，没记的给全零', () => {
    const rows = sumByMealType([{ mealType: 'lunch', items: [item(500, 20)] }]);
    expect(rows.map((row) => row.mealType)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    expect(rows[0]?.totals.caloriesKcal).toBe(0);
    expect(rows[0]?.meals).toBe(0);
    expect(rows[1]?.totals.caloriesKcal).toBe(500);
    expect(rows[1]?.totals.proteinG).toBe(20);
    expect(rows[1]?.meals).toBe(1);
  });

  it('同一餐型多顿会累加', () => {
    const rows = sumByMealType([
      { mealType: 'lunch', items: [item(300)] },
      { mealType: 'lunch', items: [item(200)] },
    ]);
    expect(rows[1]?.totals.caloriesKcal).toBe(500);
    expect(rows[1]?.meals).toBe(2);
  });

  it('未知餐型归入加餐（不让它在汇总里消失）', () => {
    const rows = sumByMealType([{ mealType: 'brunch', items: [item(400)] }]);
    expect(rows[3]?.totals.caloriesKcal).toBe(400);
  });
});

describe('summarizeWeek', () => {
  const target: NutritionTarget = {
    caloriesKcal: 2000,
    proteinG: 100,
    fatG: 60,
    carbG: 250,
    fiberG: 25,
    sodiumMg: 2000,
  };

  const day = (date: string, totals: Partial<typeof EMPTY_TOTALS>, meals = 1) => ({
    date,
    totals: { ...EMPTY_TOTALS, ...totals },
    meals,
  });

  it('没有记录时给一句引导，不报错', () => {
    const summary = summarizeWeek([day('2026-10-17', {}, 0)], target, 0);
    expect(summary.recordedDays).toBe(0);
    expect(summary.average).toBeNull();
    expect(summary.headline).toContain('还没有记录');
  });

  it('热量 80%~110% 算达标，蛋白 ≥90% 算达标，钠超上限算超标', () => {
    const summary = summarizeWeek(
      [
        day('2026-10-15', { caloriesKcal: 1800, proteinG: 95, sodiumMg: 1500 }),
        day('2026-10-16', { caloriesKcal: 2400, proteinG: 60, sodiumMg: 2600 }),
        day('2026-10-17', { caloriesKcal: 2000, proteinG: 100, sodiumMg: 1900 }),
      ],
      target,
      3,
    );

    expect(summary.recordedDays).toBe(3);
    expect(summary.calorieOnTargetDays).toBe(2); // 1800（0.9）与 2000（1.0）
    expect(summary.proteinMetDays).toBe(2); // 95 与 100
    expect(summary.sodiumOverDays).toBe(1); // 2600
    expect(summary.streak).toBe(3);
    expect(summary.headline).toContain('记录 3 天');
  });

  it('平均摄入按有记录的天数算（不受 0 餐的天干扰）', () => {
    const summary = summarizeWeek(
      [day('2026-10-16', { caloriesKcal: 2000 }), day('2026-10-17', {}, 0)],
      target,
      0,
    );
    expect(summary.average?.caloriesKcal).toBe(2000);
  });
});

describe('computeStreak', () => {
  it('从今天往回连续计数', () => {
    expect(computeStreak(['2026-10-17', '2026-10-16', '2026-10-15'], '2026-10-17')).toBe(3);
  });

  it('今天还没记录时不清零（从昨天开始数）', () => {
    expect(computeStreak(['2026-10-16', '2026-10-15'], '2026-10-17')).toBe(2);
  });

  it('中间断一天就停', () => {
    expect(computeStreak(['2026-10-17', '2026-10-15'], '2026-10-17')).toBe(1);
  });

  it('没有记录返回 0', () => {
    expect(computeStreak([], '2026-10-17')).toBe(0);
  });

  it('跨月连续也正确', () => {
    expect(computeStreak(['2026-10-01', '2026-09-30', '2026-09-29'], '2026-10-01')).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * 季度饮食形象
 * ------------------------------------------------------------------ */

describe('computeDietPersonas', () => {
  const target: NutritionTarget = {
    caloriesKcal: 2000,
    proteinG: 100,
    fatG: 60,
    carbG: 250,
    fiberG: 25,
    sodiumMg: 2000,
  };

  function makeDay(overrides: {
    date?: string;
    totals?: Partial<NutritionTarget>;
    meals?: number;
    mealCounts?: Record<string, number>;
    itemsByCategory?: Record<string, number>;
  } = {}) {
    return {
      date: overrides.date ?? '2026-10-01',
      totals: { ...EMPTY_TOTALS, ...(overrides.totals ?? {}) },
      meals: overrides.meals ?? 2,
      mealCounts: overrides.mealCounts ?? { lunch: 1, dinner: 1 },
      itemsByCategory: overrides.itemsByCategory ?? { staple: 1, meat: 1 },
    };
  }

  it('记录太少时只给「新人驾到」，不硬凑其他标签', () => {
    const result = computeDietPersonas([makeDay({ meals: 1 })], target, 90);
    expect(result.primary?.key).toBe('rookie');
    expect(result.primary?.title).toBe('新人驾到');
    expect(result.tags).toHaveLength(1);
  });

  it('饮品/甜品占比高 → 奶茶妹', () => {
    const day = makeDay({
      totals: { caloriesKcal: 1900, proteinG: 90 },
      itemsByCategory: { drink: 2, dessert: 1, staple: 1 },
    });
    const result = computeDietPersonas([day, day, day], target, 90);
    expect(result.tags.map((tag) => tag.key)).toContain('milk-tea');
    expect(result.tags.find((tag) => tag.key === 'milk-tea')?.title).toBe('奶茶妹');
  });

  it('蛋白长期达标 → 蛋白猎人', () => {
    const day = makeDay({
      totals: { caloriesKcal: 2000, proteinG: 110, sodiumMg: 1500 },
      mealCounts: { breakfast: 1, lunch: 1, dinner: 1 },
      itemsByCategory: { staple: 1, meat: 1, vegetable: 1 },
    });
    const result = computeDietPersonas([day, day, day, day], target, 90);
    expect(result.tags.map((tag) => tag.key)).toContain('protein-hunter');
  });

  it('几乎不吃荤 → 素食主义者', () => {
    const day = makeDay({
      totals: { caloriesKcal: 1800, proteinG: 70, sodiumMg: 1200 },
      itemsByCategory: { staple: 2, vegetable: 3, soy: 1 },
    });
    const result = computeDietPersonas([day, day, day], target, 90);
    expect(result.tags.map((tag) => tag.key)).toContain('vegetarian');
    expect(result.tags.find((tag) => tag.key === 'vegetarian')?.title).toBe('素食主义者');
  });

  it('荤多菜少 → 肉食主义者', () => {
    const day = makeDay({
      totals: { caloriesKcal: 2200, proteinG: 80, sodiumMg: 2600 },
      itemsByCategory: { staple: 1, meat: 4, vegetable: 0.0001 },
    });
    const result = computeDietPersonas([day, day, day], target, 90);
    expect(result.tags.map((tag) => tag.key)).toContain('meat-lover');
    expect(result.tags.find((tag) => tag.key === 'meat-lover')?.title).toBe('肉食主义者');
  });

  it('钠超标过半 → 重口战士', () => {
    const day = makeDay({
      totals: { caloriesKcal: 2100, proteinG: 60, sodiumMg: 3200 },
      mealCounts: { breakfast: 1, lunch: 1, dinner: 1 },
      itemsByCategory: { staple: 1, meat: 1, vegetable: 1 },
    });
    const result = computeDietPersonas([day, day, day], target, 90);
    expect(result.tags.map((tag) => tag.key)).toContain('salt-warrior');
  });

  it('三餐规律且热量贴目标 → 自律达人（与新名字对得上）', () => {
    const day = makeDay({
      totals: { caloriesKcal: 2000, proteinG: 80, sodiumMg: 1600, fiberG: 20 },
      mealCounts: { breakfast: 1, lunch: 1, dinner: 1 },
      itemsByCategory: { staple: 1, meat: 1, vegetable: 1 },
    });
    const result = computeDietPersonas([day, day, day, day, day], target, 90);
    const tag = result.tags.find((item) => item.key === 'self-disciplined');
    expect(tag?.title).toBe('自律达人');
  });

  it('一个人可以同时有多个形象（奶茶妹 + 自律达人）', () => {
    const day = makeDay({
      totals: { caloriesKcal: 2000, proteinG: 85, sodiumMg: 1500 },
      mealCounts: { breakfast: 1, lunch: 1, dinner: 1 },
      itemsByCategory: { drink: 1, dessert: 1, staple: 2, meat: 2, vegetable: 2 },
    });
    const result = computeDietPersonas([day, day, day, day], target, 90);
    expect(result.tags.length).toBeGreaterThan(1);
    expect(result.tags.map((tag) => tag.key)).toEqual(
      expect.arrayContaining(['milk-tea', 'self-disciplined']),
    );
    // 主形象是强度最高的那个
    expect(result.primary).not.toBeNull();
    expect(result.tags[0]?.key).toBe(result.primary?.key);
  });

  it('菜品覆盖率 > 80% 才给食堂探索家', () => {
    const day = makeDay({
      totals: { caloriesKcal: 1800, proteinG: 70, sodiumMg: 1900 },
      itemsByCategory: { staple: 1, meat: 1, vegetable: 1 },
    });
    const low = computeDietPersonas([day, day, day], target, 90, {
      triedDishCount: 5,
      dishCount: 20,
      rate: 0.25,
    });
    expect(low.tags.map((tag) => tag.key)).not.toContain('explorer');

    const high = computeDietPersonas([day, day, day], target, 90, {
      triedDishCount: 18,
      dishCount: 20,
      rate: 0.9,
    });
    expect(high.tags.map((tag) => tag.key)).toContain('explorer');
    expect(high.stats.dishCoverageRate).toBeCloseTo(0.9);
  });

  it('分享文案包含主形象与其他标签', () => {
    const day = makeDay({
      totals: { caloriesKcal: 2000, proteinG: 85, sodiumMg: 1500 },
      mealCounts: { breakfast: 1, lunch: 1, dinner: 1 },
      itemsByCategory: { drink: 1, dessert: 1, staple: 2, meat: 2, vegetable: 2 },
    });
    const result = computeDietPersonas([day, day, day, day], target, 90);
    const text = formatPersonaShare(result, '本季度');
    expect(text).toContain('本季度饮食形象');
    expect(text).toContain('依据：');
  });
});
