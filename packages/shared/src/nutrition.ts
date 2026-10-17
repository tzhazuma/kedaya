/**
 * 营养管家园 · 共享计算核心（ADR 0006）
 *
 * 后端 / 小程序 / Web 三端共用本文件 —— 「缺口怎么算、推荐怎么打分、
 * 每日需求怎么估算」在全仓库只有这一份实现，任何端不得另写一套。
 *
 * 本文件是**纯函数**：不依赖框架、不碰 IO，可被单元测试完整覆盖。
 *
 * 口径约定：
 *   · 菜品营养字段 = **每份**（不是每 100g），`servingG` 只是说明一份多大
 *   · 份数在汇总时乘入：一餐营养 = Σ(单项每份营养 × servings)
 *   · proteinG / fatG / carbG / fiberG 为**目标**（越多越好，到目标为止）
 *   · sodiumMg 为**上限**（超过即扣分）
 */

/* ------------------------------------------------------------------ *
 * 菜的种类与餐型
 * ------------------------------------------------------------------ */

/** 菜的种类。识别、推荐（品类均衡）、统计都依赖它 */
export const DISH_CATEGORIES = [
  'staple', // 主食
  'meat', // 荤菜
  'vegetable', // 素菜
  'soup', // 汤
  'dessert', // 甜品
  'drink', // 饮品
  'fruit', // 水果
  'other', // 其他
] as const;

export type DishCategory = (typeof DISH_CATEGORIES)[number];

export const DISH_CATEGORY_LABELS: Record<DishCategory, string> = {
  staple: '主食',
  meat: '荤菜',
  vegetable: '素菜',
  soup: '汤',
  dessert: '甜品',
  drink: '饮品',
  fruit: '水果',
  other: '其他',
};

export function isDishCategory(value: unknown): value is DishCategory {
  return typeof value === 'string' && (DISH_CATEGORIES as readonly string[]).includes(value);
}

/** 餐型 */
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

/** 按小时推测餐型（记录当餐时默认选中，用户可改） */
export function suggestMealType(at: Date): MealType {
  const hour = at.getHours();
  if (hour < 10) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

/**
 * 份数的取值边界（三端共用）。
 *
 * 为什么是 0.5 步进：食堂里「半份」「一勺饭」是常态，只允许整数会让
 * 用户要么记多、要么放弃记录 —— 而记录成本决定这个功能能不能活。
 * 上限 20 份是为了挡住误输入（把「2 份」打成「20 份」）。
 */
export const SERVING_LIMITS = { min: 0.5, max: 20, step: 0.5 } as const;

/** 份数步进（UI 的「−」「+」一次跳多少） */
export const SERVING_STEP = SERVING_LIMITS.step;

/** 份数是否合法（0.5 的整数倍，落在 [min, max]） */
export function isValidServings(servings: number): boolean {
  if (!Number.isFinite(servings)) return false;
  if (servings < SERVING_LIMITS.min || servings > SERVING_LIMITS.max) return false;
  const steps = servings / SERVING_LIMITS.step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/* ------------------------------------------------------------------ *
 * 过敏原 / 忌口
 * ------------------------------------------------------------------ */

/**
 * 过敏原与常见忌口词表（机器值 → 中文）。
 *
 * 口径：只收「吃错会出事」或「食堂点菜高频忌口」的类别，不追求营养学完整性。
 * 菜品的 `allergens` 用这里的机器值；用户勾选忌口也用同一套值，于是过滤是**精确集合相交**，
 * 不依赖任何模糊匹配。
 */
export const ALLERGENS = [
  'peanut', // 花生
  'tree-nut', // 坚果（核桃/杏仁/腰果）
  'seafood', // 海鲜（鱼虾蟹贝）
  'egg', // 蛋
  'milk', // 奶
  'soy', // 大豆
  'gluten', // 小麦/麸质
  'beef', // 牛肉
  'pork', // 猪肉
  'chili', // 辣
  'cilantro', // 香菜
  'sesame', // 芝麻
] as const;

export type Allergen = (typeof ALLERGENS)[number];

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  peanut: '花生',
  'tree-nut': '坚果',
  seafood: '海鲜',
  egg: '蛋',
  milk: '奶',
  soy: '大豆',
  gluten: '麸质',
  beef: '牛肉',
  pork: '猪肉',
  chili: '辣',
  cilantro: '香菜',
  sesame: '芝麻',
};

export function isAllergen(value: unknown): value is Allergen {
  return typeof value === 'string' && (ALLERGENS as readonly string[]).includes(value);
}

/**
 * 菜名 → 过敏原/忌口标签的**启发式**推断。
 *
 * 为什么需要：菜品营养与配料都是录入的，一次性给 70+ 道菜人工打标不现实；
 * 先用关键词初标，再让管理员在后台修正，是唯一能落地的方式。
 *
 * ⚠️ 推断必然有漏（例如「兰州拉面」的牛肉不在菜名里），所以界面必须同时标注
 * 「过敏原信息为自动推断，可能不全，请以食堂公示为准」——**不许假装完整**。
 */
const ALLERGEN_KEYWORDS: ReadonlyArray<readonly [Allergen, readonly string[]]> = [
  ['peanut', ['花生', '宫保']],
  ['tree-nut', ['核桃', '杏仁', '腰果', '坚果']],
  ['seafood', ['鱼', '虾', '蟹', '贝', '蛤', '鱿鱼', '海参', '生蚝', '扇贝']],
  ['egg', ['蛋', '鸡蛋', '鸭蛋', '皮蛋', '咸蛋']],
  ['milk', ['奶', '芝士', '奶酪', '黄油', '奶油', '布丁', '拿铁']],
  ['soy', ['豆腐', '豆浆', '豆干', '腐竹', '豆皮', '黄豆']],
  ['gluten', ['面', '馒头', '包', '饺', '饼', '蛋糕', '面包', '意面', '拉面', '凉皮', '油条']],
  ['beef', ['牛肉', '牛腩', '牛排', '肥牛']],
  ['pork', ['猪', '排骨', '里脊', '肉包', '卤肉', '红烧肉', '五花', '腊肉', '肘子']],
  ['chili', ['辣', '麻婆', '水煮', '剁椒', '麻辣', '干锅', '香辣']],
  ['cilantro', ['香菜', '芫荽']],
  ['sesame', ['芝麻', '麻酱']],
];

/** 由菜名推断过敏原/忌口（返回去重后的机器值，可能为空数组） */
export function inferAllergensFromName(name: string): Allergen[] {
  const hits = new Set<Allergen>();
  for (const [allergen, keywords] of ALLERGEN_KEYWORDS) {
    if (keywords.some((keyword) => name.includes(keyword))) hits.add(allergen);
  }
  // 「花生」也属于坚果类，但两者分开标注，避免用户同时勾选时重复报
  return ALLERGENS.filter((allergen) => hits.has(allergen));
}

/** 命中用户忌口的过敏原（空数组 = 安全） */
export function matchAvoidedAllergens(
  dishAllergens: readonly string[] | undefined,
  avoided: readonly string[] | undefined,
): Allergen[] {
  if (dishAllergens === undefined || dishAllergens.length === 0) return [];
  if (avoided === undefined || avoided.length === 0) return [];
  const avoidedSet = new Set(avoided);
  return dishAllergens.filter((item): item is Allergen => isAllergen(item) && avoidedSet.has(item));
}

/** 把机器值列表转成「花生、海鲜」这样的中文串 */
export function formatAllergenList(list: readonly string[] | undefined): string {
  if (list === undefined || list.length === 0) return '';
  return list
    .map((item) => (isAllergen(item) ? ALLERGEN_LABELS[item] : item))
    .filter((label) => label !== '')
    .join('、');
}

/* ------------------------------------------------------------------ *
 * 餐型维度汇总
 * ------------------------------------------------------------------ */

/** 汇总输入：一餐（只需要餐型 + 明细） */
export interface MealLike {
  mealType: string;
  items: readonly MealItemLike[];
}

export interface MealTypeTotals {
  mealType: MealType;
  totals: NutritionTotals;
  /** 该餐型的记录条数（0 = 没记） */
  meals: number;
}

/**
 * 按餐型汇总（早餐/午餐/晚餐/加餐），**四类恒定返回**（没记的给全零），
 * 于是 UI 不用自己补空行，也不会因为「今天没记加餐」而少一列。
 */
export function sumByMealType(meals: readonly MealLike[]): MealTypeTotals[] {
  const buckets = new Map<MealType, { items: MealItemLike[]; count: number }>();
  for (const mealType of MEAL_TYPES) buckets.set(mealType, { items: [], count: 0 });

  for (const meal of meals) {
    const bucket = isMealType(meal.mealType) ? buckets.get(meal.mealType) : buckets.get('snack');
    if (bucket === undefined) continue;
    bucket.items.push(...meal.items);
    bucket.count += 1;
  }

  return MEAL_TYPES.map((mealType) => {
    const bucket = buckets.get(mealType);
    return {
      mealType,
      totals: sumItems(bucket?.items ?? []),
      meals: bucket?.count ?? 0,
    };
  });
}

export function isMealType(value: unknown): value is MealType {
  return typeof value === 'string' && (MEAL_TYPES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * 营养数值模型
 * ------------------------------------------------------------------ */

/** 六项营养的汇总值。菜品、餐次、每日汇总都用这个形状 */
export interface NutritionTotals {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG: number;
  sodiumMg: number;
}

export const EMPTY_TOTALS: NutritionTotals = {
  caloriesKcal: 0,
  proteinG: 0,
  fatG: 0,
  carbG: 0,
  fiberG: 0,
  sodiumMg: 0,
};

/** 个人每日需求。protein/fat/carb/fiber 为目标，sodium 为上限 */
export interface NutritionTarget extends NutritionTotals {}

/** 当餐明细的最小形状（后端 Prisma 行、小程序 mock 都结构兼容） */
export interface MealItemLike {
  dishName: string;
  category?: string;
  servings: number;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG?: number;
  sodiumMg?: number;
}

export const NUTRIENT_KEYS = [
  'caloriesKcal',
  'proteinG',
  'fatG',
  'carbG',
  'fiberG',
  'sodiumMg',
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/** 六项营养的中文名（三端共用，禁止各端再写一份） */
export const NUTRIENT_LABELS: Record<NutrientKey, string> = {
  caloriesKcal: '热量',
  proteinG: '蛋白质',
  fatG: '脂肪',
  carbG: '碳水',
  fiberG: '膳食纤维',
  sodiumMg: '钠',
};

/** 六项营养的单位（与字段名后缀一致） */
export const NUTRIENT_UNITS: Record<NutrientKey, string> = {
  caloriesKcal: 'kcal',
  proteinG: 'g',
  fatG: 'g',
  carbG: 'g',
  fiberG: 'g',
  sodiumMg: 'mg',
};

/** 保留两位小数，避免 0.5 份累加出现 12.299999999 这类浮点噪声 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 一餐（或一天）的营养汇总：Σ(每份营养 × 份数)。
 *
 * 份数支持**小数**（半份 / 一勺饭）：食堂里「半份」是常态，
 * 之前用 `Math.trunc` 会把 0.5 份静默变成 0 份。
 */
export function sumItems(items: readonly MealItemLike[]): NutritionTotals {
  const totals: NutritionTotals = { ...EMPTY_TOTALS };
  for (const item of items) {
    const servings = Number.isFinite(item.servings) ? Math.max(0, item.servings) : 0;
    totals.caloriesKcal += item.caloriesKcal * servings;
    totals.proteinG += item.proteinG * servings;
    totals.fatG += item.fatG * servings;
    totals.carbG += item.carbG * servings;
    totals.fiberG += (item.fiberG ?? 0) * servings;
    totals.sodiumMg += (item.sodiumMg ?? 0) * servings;
  }
  return {
    caloriesKcal: round2(totals.caloriesKcal),
    proteinG: round2(totals.proteinG),
    fatG: round2(totals.fatG),
    carbG: round2(totals.carbG),
    fiberG: round2(totals.fiberG),
    sodiumMg: round2(totals.sodiumMg),
  };
}

/* ------------------------------------------------------------------ *
 * 缺口
 * ------------------------------------------------------------------ */

/**
 * 每日缺口。
 *  · 目标型营养（热量/蛋白/脂肪/碳水/纤维）= 目标 − 已摄入，负数表示已超标
 *  · 上限型营养（钠）= 上限 − 已摄入，负数表示已超上限
 */
export interface NutritionGaps extends NutritionTotals {}

/** 计算缺口。consumed 缺省按 0 处理（还没吃任何东西时） */
export function computeGaps(target: NutritionTarget, consumed?: NutritionTotals): NutritionGaps {
  const eaten = consumed ?? EMPTY_TOTALS;
  return {
    caloriesKcal: target.caloriesKcal - eaten.caloriesKcal,
    proteinG: target.proteinG - eaten.proteinG,
    fatG: target.fatG - eaten.fatG,
    carbG: target.carbG - eaten.carbG,
    fiberG: target.fiberG - eaten.fiberG,
    sodiumMg: target.sodiumMg - eaten.sodiumMg,
  };
}

/** 目标型营养是否全部达标（钠是上限，不参与「达标」判定） */
export function isGoalsMet(gaps: NutritionGaps): boolean {
  return gaps.caloriesKcal <= 0 && gaps.proteinG <= 0 && gaps.fatG <= 0 && gaps.carbG <= 0 && gaps.fiberG <= 0;
}

/** 相对缺口最大的目标型营养（推荐理由的素材） */
const GOAL_KEYS = ['proteinG', 'fiberG', 'carbG', 'fatG'] as const;
type GoalKey = (typeof GOAL_KEYS)[number];

/* ------------------------------------------------------------------ *
 * 每日需求估算器（Mifflin-St Jeor）
 * ------------------------------------------------------------------ */

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'high';
export type NutritionGoal = 'lose' | 'maintain' | 'gain';

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: '久坐（几乎不运动）',
  light: '轻度（每周 1-3 次）',
  moderate: '中度（每周 3-5 次）',
  high: '高强度（每周 6-7 次）',
};

export const GOAL_LABELS: Record<NutritionGoal, string> = {
  lose: '减脂',
  maintain: '维持',
  gain: '增肌',
};

const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
};

/** 目标热量调整系数与三大营养素供能比（按目标区分） */
const GOAL_PLAN: Record<NutritionGoal, { calorieFactor: number; protein: number; fat: number; carb: number }> = {
  lose: { calorieFactor: 0.85, protein: 0.25, fat: 0.3, carb: 0.45 },
  maintain: { calorieFactor: 1.0, protein: 0.15, fat: 0.25, carb: 0.6 },
  gain: { calorieFactor: 1.15, protein: 0.2, fat: 0.25, carb: 0.55 },
};

export interface EstimateTargetsInput {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  goal: NutritionGoal;
}

export const CALORIE_FLOOR_KCAL = 1200;

/**
 * 估算每日需求（Mifflin-St Jeor 公式）。
 *
 * 估算器**只负责预填** —— 最终值永远由使用者自己提出/修改（ADR 0006 决策 4）。
 * 安全底线：热量不低于 1200 kcal，蛋白质不低于 1 g/kg 体重。
 */
export function estimateDailyTargets(input: EstimateTargetsInput): NutritionTarget {
  const { sex, age, heightCm, weightKg, activity, goal } = input;

  const bmr =
    sex === 'male'
      ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;

  const tdee = bmr * ACTIVITY_FACTOR[activity];
  const caloriesKcal = Math.max(CALORIE_FLOOR_KCAL, Math.round((tdee * GOAL_PLAN[goal].calorieFactor) / 10) * 10);

  const plan = GOAL_PLAN[goal];
  const proteinG = Math.max(Math.round(weightKg), Math.round((caloriesKcal * plan.protein) / 4));
  const fatG = Math.round((caloriesKcal * plan.fat) / 9);
  const carbG = Math.round((caloriesKcal * plan.carb) / 4);

  return {
    caloriesKcal,
    proteinG,
    fatG,
    carbG,
    // 膳食纤维：每 1000 kcal 14 g（膳食指南推荐量）
    fiberG: Math.round((caloriesKcal / 1000) * 14),
    // 钠上限 2000 mg（约 5 g 食盐）
    sodiumMg: 2000,
  };
}

/* ------------------------------------------------------------------ *
 * 菜品录入校验（小程序 mock / Web 后台共用）
 * ------------------------------------------------------------------ */

/** 菜品录入输入的最小形状（category 放宽为 string，由本函数校验） */
export interface DishInputLike {
  name: string;
  canteen: string;
  category: string;
  servingG: number;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG: number;
  sodiumMg: number;
  priceFen: number;
}

const DISH_FIELD_LABELS: Record<string, string> = {
  name: '菜名',
  canteen: '食堂',
  category: '菜的种类',
  servingG: '每份克数',
  caloriesKcal: '热量',
  proteinG: '蛋白质',
  fatG: '脂肪',
  carbG: '碳水',
  fiberG: '膳食纤维',
  sodiumMg: '钠',
  priceFen: '价格',
};

/**
 * 校验菜品录入。返回 null 表示合法，否则返回面向用户的中文原因。
 * 规则只写这一份：小程序 mock 与 Web 后台的表单都走它。
 */
export function validateDishInput(input: DishInputLike): string | null {
  if (input.name.trim() === '') return '菜名不能为空';
  if (input.canteen.trim() === '') return '请填写食堂';
  if (!isDishCategory(input.category)) return '请选择菜的种类';
  if (!Number.isInteger(input.servingG) || input.servingG <= 0) return '每份克数必须是正整数';
  if (!Number.isInteger(input.caloriesKcal) || input.caloriesKcal < 0) {
    return '热量必须是非负整数';
  }
  for (const key of ['proteinG', 'fatG', 'carbG', 'fiberG', 'sodiumMg'] as const) {
    if (!Number.isInteger(input[key]) || input[key] < 0) {
      return `${DISH_FIELD_LABELS[key]}必须是非负整数`;
    }
  }
  if (!Number.isInteger(input.priceFen) || input.priceFen < 0) return '价格必须是非负整数（分）';
  return null;
}

/* ------------------------------------------------------------------ *
 * 推荐
 * ------------------------------------------------------------------ */

/** 参与推荐的菜品最小形状（后端 / 小程序 / Web 的菜品模型都结构兼容） */
export interface DishLike extends NutritionTotals {
  id: string;
  name: string;
  category?: string;
  /** 营养数据来源（可空）：推荐卡片上展示「来源 · 更新于」，回答「这个数字凭什么可信」 */
  source?: string | null;
  /** 营养数据最后核对时间（ISO 字符串，可空） */
  lastVerifiedAt?: string | null;
  /** 过敏原/忌口（机器值，见 ALLERGENS）。空或缺省表示「未标注」 */
  allergens?: readonly string[];
}

export interface DishRecommendation {
  dish: DishLike;
  /** 综合得分，越高越优先 */
  score: number;
  /** 面向用户的推荐理由（可解释，不写「算法推荐」） */
  reason: string;
  /** 该菜品每份对当前缺口的贡献（用于 UI 展示） */
  fills: Partial<Record<NutrientKey, number>>;
}

export interface RecommendOptions {
  /** 返回条数，默认 5 */
  limit?: number;
  /** 今日已吃过的品类（用于品类均衡加成；缺省不加成） */
  eatenCategories?: readonly string[];
  /** 今日已吃过菜品的 id：**硬过滤**，避免推荐「刚吃完的红烧肉」 */
  eatenDishIds?: readonly string[];
  /**
   * 用户忌口/过敏原：**硬过滤**，命中即整道菜不出现（不是扣分）。
   * 过敏是安全问题，扣分意味着「还是会出现在列表里」—— 不可接受。
   * ⚠️ 只对**已标注**过敏原的菜品生效；未标注的菜不会被误伤，但界面要提示「可能未标注完整」。
   */
  excludeAllergens?: readonly string[];
}

/**
 * 基于缺口给菜品打分排序。
 *
 * 打分规则（刻意保持简单可解释）：
 *   1. 目标型营养按**相对缺口**加权：缺口越大权重越高，
 *      菜品对该营养的贡献 = 含量 / max(目标, 1)
 *   2. 热量预算惩罚：一份的热量超过剩余热量预算 10% 以上开始扣分
 *   3. 上限惩罚：钠**会把当日推过上限**的菜品按超出比例扣分（0.2 封顶）；
 *      已经吃在今日餐里的菜品直接排除（`eatenDishIds`）
 *   4. 品类均衡加成：今天还没吃过该品类的菜品小幅加分（例如「还没吃蔬菜」）
 *   5. **忌口/过敏硬过滤**：命中 `excludeAllergens` 的菜品整道不出现（安全问题不打分）
 */
export function recommendDishes(
  dishes: readonly DishLike[],
  target: NutritionTarget,
  consumed: NutritionTotals,
  options: RecommendOptions = {},
): DishRecommendation[] {
  const limit = options.limit ?? 5;
  const gaps = computeGaps(target, consumed);
  const eatenCategories = new Set(options.eatenCategories ?? []);
  const eatenDishIds = new Set(options.eatenDishIds ?? []);
  const avoidedAllergens = options.excludeAllergens ?? [];

  // 相对缺口 → 权重（已达标/超标的营养权重为 0）
  const weights: Record<GoalKey, number> = {
    proteinG: Math.max(0, gaps.proteinG) / Math.max(target.proteinG, 1),
    carbG: Math.max(0, gaps.carbG) / Math.max(target.carbG, 1),
    fatG: Math.max(0, gaps.fatG) / Math.max(target.fatG, 1),
    fiberG: Math.max(0, gaps.fiberG) / Math.max(target.fiberG, 1),
  };

  const remainingCalories = Math.max(0, gaps.caloriesKcal);

  const scored = dishes
    .filter((dish) => !eatenDishIds.has(dish.id))
    // 忌口/过敏：命中即整道排除（安全问题不打分）
    .filter((dish) => matchAvoidedAllergens(dish.allergens, avoidedAllergens).length === 0)
    .map((dish) => {
      const fills: Partial<Record<NutrientKey, number>> = {};
      let score = 0;

      for (const key of GOAL_KEYS) {
        const contribution = dish[key] / Math.max(target[key], 1);
        if (contribution > 0) fills[key] = contribution;
        score += contribution * weights[key];
      }

      // 热量预算惩罚（超出剩余预算 10% 以上的部分线性扣分）
      if (dish.caloriesKcal > remainingCalories * 1.1) {
        score -= (dish.caloriesKcal - remainingCalories * 1.1) / Math.max(remainingCalories, 1);
      }

      // 上限惩罚：把钠推过上限（或已经超了还继续加钠）的菜品按超出比例扣分，0.2 封顶。
      // 刻意封顶：钠只是「上限型」约束，不该盖过蛋白质/纤维的缺口驱动。
      if (dish.sodiumMg > 0) {
        const overflow = dish.sodiumMg - Math.max(0, gaps.sodiumMg);
        if (overflow > 0) score -= 0.2 * Math.min(1, overflow / Math.max(target.sodiumMg, 1));
      }

      // 品类均衡加成
      if (dish.category && !eatenCategories.has(dish.category)) {
        score += 0.05;
      }

      return { dish, score, fills };
    });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ dish, score, fills }) => ({
    dish,
    score: Math.round(score * 1000) / 1000,
    reason: buildReason(dish, gaps, fills, eatenCategories),
    fills,
  }));
}

/** 生成推荐理由：优先说「补最大的缺口」，其次说品类均衡 */
function buildReason(
  dish: DishLike,
  gaps: NutritionGaps,
  fills: Partial<Record<NutrientKey, number>>,
  eatenCategories: ReadonlySet<string>,
): string {
  const reasons: string[] = [];

  // 找出该菜品贡献最大、且缺口尚未填补的营养
  let bestKey: GoalKey | null = null;
  let bestContribution = 0;
  for (const key of GOAL_KEYS) {
    const contribution = fills[key] ?? 0;
    if (contribution > bestContribution && gaps[key] > 0) {
      bestContribution = contribution;
      bestKey = key;
    }
  }
  if (bestKey !== null) {
    // GOAL_KEYS 里没有热量，单位恒为 g
    reasons.push(`补${NUTRIENT_LABELS[bestKey]}缺口（还差 ${Math.round(gaps[bestKey])}g，这份含 ${Math.round(dish[bestKey])}g）`);
  }

  if (dish.category && !eatenCategories.has(dish.category)) {
    reasons.push(`今天还没吃${DISH_CATEGORY_LABELS[dish.category as DishCategory] ?? dish.category}`);
  }

  if (reasons.length === 0) {
    reasons.push('营养结构与当前缺口较匹配');
  }
  return reasons.join('；');
}

/* ------------------------------------------------------------------ *
 * 周报：把「每天吃了多少」压成几句人话
 * ------------------------------------------------------------------ */

/** 单日汇总（与后端 `GET /canteen/stats` 的 days[] 同形） */
export interface DailyTotalsLike {
  /** YYYY-MM-DD */
  date: string;
  totals: NutritionTotals;
  /** 当天餐数（0 = 没记录） */
  meals: number;
  /** 各餐型条数（可选：老数据没有，形象判定会降级） */
  mealCounts?: Partial<Record<MealType, number>>;
  /** 各品类菜品条数（可选：用于判断「喝奶茶多」「蔬菜少」） */
  itemsByCategory?: Record<string, number>;
}

export interface WeekSummary {
  /** 统计窗口内有记录的天数 */
  recordedDays: number;
  /** 热量落在目标 80%~110% 的天数（「吃够了」） */
  calorieOnTargetDays: number;
  /** 蛋白质达到目标 90% 的天数 */
  proteinMetDays: number;
  /** 钠超过上限的天数 */
  sodiumOverDays: number;
  /** 有记录天的平均摄入（没有记录为 null） */
  average: NutritionTotals | null;
  /** 连续记录天数（透传） */
  streak: number;
  /** 一句中文结论（可直接分享/复制） */
  headline: string;
}

/** 周报的达标口径（写在这里，避免三端各写一套阈值） */
export const WEEK_RULES = {
  /** 热量「吃够了」的区间：目标 ×0.8 ~ ×1.1 */
  calorieMinRatio: 0.8,
  calorieMaxRatio: 1.1,
  /** 蛋白「吃够了」：目标 ≥ 90% */
  proteinRatio: 0.9,
} as const;

/**
 * 汇总近 N 日趋势。
 *
 * 只做**事实陈述**，不做健康评价（不写「你吃得不健康」）：
 * 「记录 4 天 · 热量达标 3 天 · 蛋白达标 2 天 · 钠超标 1 天」。
 */
export function summarizeWeek(
  days: readonly DailyTotalsLike[],
  target: NutritionTarget,
  streak = 0,
): WeekSummary {
  const recorded = days.filter((day) => day.meals > 0);

  let calorieOnTargetDays = 0;
  let proteinMetDays = 0;
  let sodiumOverDays = 0;
  let sum: NutritionTotals = { ...EMPTY_TOTALS };

  for (const day of recorded) {
    const kcal = day.totals.caloriesKcal;
    const ratio = target.caloriesKcal > 0 ? kcal / target.caloriesKcal : 0;
    if (ratio >= WEEK_RULES.calorieMinRatio && ratio <= WEEK_RULES.calorieMaxRatio) calorieOnTargetDays += 1;
    if (target.proteinG > 0 && day.totals.proteinG >= target.proteinG * WEEK_RULES.proteinRatio) {
      proteinMetDays += 1;
    }
    if (day.totals.sodiumMg > target.sodiumMg) sodiumOverDays += 1;
    sum = {
      caloriesKcal: sum.caloriesKcal + day.totals.caloriesKcal,
      proteinG: sum.proteinG + day.totals.proteinG,
      fatG: sum.fatG + day.totals.fatG,
      carbG: sum.carbG + day.totals.carbG,
      fiberG: sum.fiberG + day.totals.fiberG,
      sodiumMg: sum.sodiumMg + day.totals.sodiumMg,
    };
  }

  const count = recorded.length;
  const average = count === 0 ? null : averageOf(sum, count);

  const headline =
    count === 0
      ? '这一周还没有记录，记两餐就能看到趋势'
      : `记录 ${count} 天 · 热量达标 ${calorieOnTargetDays} 天 · 蛋白达标 ${proteinMetDays} 天 · 钠超标 ${sodiumOverDays} 天`;

  return {
    recordedDays: count,
    calorieOnTargetDays,
    proteinMetDays,
    sodiumOverDays,
    average,
    streak,
    headline,
  };
}

/** 按天数取平均（保留一位小数，展示用） */
function averageOf(sum: NutritionTotals, days: number): NutritionTotals {
  const divide = (value: number): number => Math.round((value / days) * 10) / 10;
  return {
    caloriesKcal: divide(sum.caloriesKcal),
    proteinG: divide(sum.proteinG),
    fatG: divide(sum.fatG),
    carbG: divide(sum.carbG),
    fiberG: divide(sum.fiberG),
    sodiumMg: divide(sum.sodiumMg),
  };
}

/* ------------------------------------------------------------------ *
 * 季度饮食形象：把「长期吃法」归纳成可分享的人设
 *
 * 一个人可以**同时是**「奶茶妹」和「自律达人」—— 所以这里返回一组标签
 * （按强度排序），主形象只是最强的那一个。强行只给一个标签会把信息丢掉，
 * 而且用户一眼就知道自己既有好习惯也有坏习惯。
 * ------------------------------------------------------------------ */

export type DietPersonaKey =
  | 'rookie' // 记录太少
  | 'milk-tea' // 饮品/甜品多
  | 'protein-hunter' // 蛋白达标多
  | 'vegetarian' // 几乎不吃肉
  | 'meat-lover' // 蔬菜少、荤菜多
  | 'salt-warrior' // 钠超标多
  | 'breakfast-absentee' // 早餐记录少
  | 'self-disciplined' // 三餐规律、热量贴目标
  | 'explorer'; // 菜品覆盖率高

export interface DishCoverageLike {
  triedDishCount: number;
  dishCount: number;
  /** 0~1，triedDishCount / dishCount */
  rate: number;
}

export interface DietPersonaStats {
  /** 统计窗口天数（如 90） */
  windowDays: number;
  recordedDays: number;
  /** 有记录天的平均热量（0 = 没有记录） */
  avgCaloriesKcal: number;
  /** 热量达标率（0~1） */
  calorieOnTargetRate: number;
  /** 蛋白达标率（0~1） */
  proteinMetRate: number;
  /** 钠超标率（0~1） */
  sodiumOverRate: number;
  /** 早餐记录率（0~1） */
  breakfastRate: number;
  /** 蔬菜类菜品占比（0~1） */
  vegetableShare: number;
  /** 荤菜类菜品占比（0~1） */
  meatShare: number;
  /** 饮品+甜品类菜品占比（0~1） */
  drinkDessertShare: number;
  /** 有喝饮料/吃甜品的天数占比（0~1） */
  drinkDessertDayRate: number;
  /** 有加餐的天数占比（0~1） */
  snackRate: number;
  /** 菜品覆盖率（0~1；没有菜品总数时为 0） */
  dishCoverageRate: number;
}

/** 一个形象标签：自带判定依据，界面必须展示 evidence */
export interface DietPersonaTag {
  key: DietPersonaKey;
  emoji: string;
  title: string;
  /** 一句话人设 */
  subtitle: string;
  /** 一条可执行建议 */
  advice: string;
  /** 这个标签的判定依据（1~2 条） */
  evidence: string[];
  /** 命中强度（0~1，越大越靠前；主形象取最大） */
  strength: number;
}

export interface DietPersonaResult {
  /** 最强的那一个（没有记录时为 null） */
  primary: DietPersonaTag | null;
  /** 命中的全部标签，按 strength 降序 */
  tags: DietPersonaTag[];
  stats: DietPersonaStats;
}

/** 形象判定的阈值（集中在这里，便于调参与测试） */
export const PERSONA_RULES = {
  /** 记录天数少于这个数，只给「新人驾到」，不硬凑其他标签 */
  minRecordedDays: 3,
  /** 饮料+甜品占比超过它 → 奶茶妹 */
  drinkDessertShare: 0.18,
  /** 喝饮料/吃甜品的天数占比超过它 → 奶茶妹（比「菜品占比」更贴近真实习惯） */
  drinkDessertDayRate: 0.25,
  /** 蛋白达标率超过它 → 蛋白猎人 */
  proteinMetRate: 0.6,
  /** 荤菜占比不超过它 → 素食主义者 */
  meatShareMax: 0.08,
  /** 荤菜占比至少它、且蔬菜少 → 肉食主义者 */
  meatShareMin: 0.35,
  /** 蔬菜占比低于它 → 肉食主义者 */
  vegetableShare: 0.15,
  /** 钠超标率超过它 → 重口战士 */
  sodiumOverRate: 0.5,
  /** 早餐记录率低于它 → 早餐逃兵 */
  breakfastRate: 0.3,
  /** 热量达标率超过它 → 自律达人 */
  calorieOnTargetRate: 0.6,
  /** 加餐天数占比（仅作统计，不单独成标签） */
  snackRate: 0.4,
  /** 菜品覆盖率超过它 → 食堂探索家 */
  dishCoverageRate: 0.8,
} as const;

const pct = (value: number): number => Math.round(value * 100);

/**
 * 根据一段时间（默认一个季度 90 天）的记录归纳「饮食形象」。
 *
 * 设计约束（与项目原则一致）：
 *  1. **纯函数 + 规则可读**：不用黑盒打分，阈值都在 `PERSONA_RULES` 里，
 *     每个标签都能给出证据（`evidence`），界面必须把证据一起展示；
 *  2. **允许多个标签共存**：一个人既可能「奶茶妹」也可能「自律达人」，
 *     标签按强度排序，主形象只是最强的一个；
 *  3. **不评价健康好坏**：只描述「吃法」，建议也只给一条轻量可执行的；
 *  4. 数据不足时**明确说数据不足**，不硬凑。
 */
export function computeDietPersonas(
  days: readonly DailyTotalsLike[],
  target: NutritionTarget,
  windowDays = 90,
  coverage?: DishCoverageLike,
): DietPersonaResult {
  const recorded = days.filter((day) => day.meals > 0);
  const recordedDays = recorded.length;

  const sum = recorded.reduce<NutritionTotals>(
    (acc, day) => {
      for (const key of NUTRIENT_KEYS) acc[key] += day.totals[key];
      return acc;
    },
    { ...EMPTY_TOTALS },
  );

  let calorieOnTargetDays = 0;
  let proteinMetDays = 0;
  let sodiumOverDays = 0;
  let breakfastDays = 0;
  let snackDays = 0;
  let vegetableItems = 0;
  let meatItems = 0;
  let drinkDessertItems = 0;
  let drinkDessertDays = 0;
  let totalItems = 0;

  for (const day of recorded) {
    const ratio = target.caloriesKcal > 0 ? day.totals.caloriesKcal / target.caloriesKcal : 0;
    if (ratio >= WEEK_RULES.calorieMinRatio && ratio <= WEEK_RULES.calorieMaxRatio) calorieOnTargetDays += 1;
    if (target.proteinG > 0 && day.totals.proteinG >= target.proteinG * WEEK_RULES.proteinRatio) proteinMetDays += 1;
    if (day.totals.sodiumMg > target.sodiumMg) sodiumOverDays += 1;

    if ((day.mealCounts?.breakfast ?? 0) > 0) breakfastDays += 1;
    if ((day.mealCounts?.snack ?? 0) > 0) snackDays += 1;

    let dayDrinkDessert = 0;
    for (const [category, count] of Object.entries(day.itemsByCategory ?? {})) {
      totalItems += count;
      if (category === 'vegetable') vegetableItems += count;
      if (category === 'meat') meatItems += count;
      if (category === 'drink' || category === 'dessert') dayDrinkDessert += count;
    }
    drinkDessertItems += dayDrinkDessert;
    if (dayDrinkDessert > 0) drinkDessertDays += 1;
  }

  const rate = (value: number): number => (recordedDays === 0 ? 0 : value / recordedDays);
  const stats: DietPersonaStats = {
    windowDays,
    recordedDays,
    avgCaloriesKcal: recordedDays === 0 ? 0 : Math.round(sum.caloriesKcal / recordedDays),
    calorieOnTargetRate: rate(calorieOnTargetDays),
    proteinMetRate: rate(proteinMetDays),
    sodiumOverRate: rate(sodiumOverDays),
    breakfastRate: rate(breakfastDays),
    vegetableShare: totalItems === 0 ? 0 : vegetableItems / totalItems,
    meatShare: totalItems === 0 ? 0 : meatItems / totalItems,
    drinkDessertShare: totalItems === 0 ? 0 : drinkDessertItems / totalItems,
    drinkDessertDayRate: rate(drinkDessertDays),
    snackRate: rate(snackDays),
    dishCoverageRate: coverage?.rate ?? 0,
  };

  // 记录太少：只给「新人驾到」，不硬凑其他标签（数据不足说什么都不准）
  if (recordedDays < PERSONA_RULES.minRecordedDays) {
    const rookie: DietPersonaTag = {
      key: 'rookie',
      emoji: '🌱',
      title: '新人驾到',
      subtitle: `只记了 ${recordedDays} 天，还看不出你的吃法`,
      advice: '再记几天（尤其把早餐记上），形象会准很多。',
      evidence: [`${windowDays} 天里记录了 ${recordedDays} 天`],
      strength: 1 - recordedDays / PERSONA_RULES.minRecordedDays,
    };
    return { primary: rookie, tags: [rookie], stats };
  }

  const tags: DietPersonaTag[] = [];

  // 两个口径任一命中即可：喝的天数占比高（习惯），或菜品占比高（量大）
  if (
    stats.drinkDessertDayRate >= PERSONA_RULES.drinkDessertDayRate ||
    stats.drinkDessertShare >= PERSONA_RULES.drinkDessertShare
  ) {
    tags.push({
      key: 'milk-tea',
      emoji: '🧋',
      title: '奶茶妹',
      subtitle: '饮品与甜品在你的餐盘里存在感很强',
      advice: '把每天的一杯换成无糖茶或白水，一个月能省下好几千 kcal。',
      evidence: [
        `喝饮料/吃甜品的天数占 ${pct(stats.drinkDessertDayRate)}%，菜品占 ${pct(
          stats.drinkDessertShare,
        )}%`,
      ],
      strength: Math.min(
        1,
        Math.max(
          stats.drinkDessertDayRate / 0.5,
          stats.drinkDessertShare / 0.4,
        ),
      ),
    });
  }

  if (stats.proteinMetRate >= PERSONA_RULES.proteinMetRate) {
    tags.push({
      key: 'protein-hunter',
      emoji: '💪',
      title: '蛋白猎人',
      subtitle: '大多数日子蛋白都吃够了，像在认真练',
      advice: '蛋白已经够了，可以把注意力放到蔬菜和膳食纤维上。',
      evidence: [`蛋白质达标 ${pct(stats.proteinMetRate)}% 的日子`],
      strength: stats.proteinMetRate,
    });
  }

  if (totalItems >= 3 && stats.meatShare <= PERSONA_RULES.meatShareMax) {
    tags.push({
      key: 'vegetarian',
      emoji: '🥬',
      title: '素食主义者',
      subtitle: '餐盘里几乎见不到荤菜',
      advice: '植物蛋白要凑够：豆制品、鸡蛋、坚果换着吃，别只靠青菜。',
      evidence: [`荤菜只占菜品数的 ${pct(stats.meatShare)}%`],
      strength: Math.min(1, 1 - stats.meatShare / PERSONA_RULES.meatShareMax),
    });
  }

  if (
    totalItems >= 3 &&
    stats.vegetableShare < PERSONA_RULES.vegetableShare &&
    stats.meatShare >= PERSONA_RULES.meatShareMin
  ) {
    tags.push({
      key: 'meat-lover',
      emoji: '🥩',
      title: '肉食主义者',
      subtitle: '荤菜是主角，蔬菜只是点缀',
      advice: '每餐固定加一份素菜，纤维缺口基本能补上。',
      evidence: [`蔬菜只占菜品数的 ${pct(stats.vegetableShare)}%，荤菜占 ${pct(stats.meatShare)}%`],
      strength: Math.min(1, stats.meatShare),
    });
  }

  if (stats.sodiumOverRate >= PERSONA_RULES.sodiumOverRate) {
    tags.push({
      key: 'salt-warrior',
      emoji: '🧂',
      title: '重口战士',
      subtitle: '钠超标的日子超过一半',
      advice: '点菜时优先清蒸/白灼，汤少喝两口，钠很容易降下来。',
      evidence: [`钠超标 ${pct(stats.sodiumOverRate)}% 的日子`],
      strength: stats.sodiumOverRate,
    });
  }

  if (stats.breakfastRate < PERSONA_RULES.breakfastRate) {
    tags.push({
      key: 'breakfast-absentee',
      emoji: '🥱',
      title: '早餐逃兵',
      subtitle: '大部分日子没记早餐（也可能真的没吃）',
      advice: '早上加一份豆浆+包子就有 15g 蛋白，比补剂便宜。',
      evidence: [`只有 ${pct(stats.breakfastRate)}% 的日子记了早餐`],
      strength: Math.min(1, 1 - stats.breakfastRate / PERSONA_RULES.breakfastRate),
    });
  }

  if (stats.calorieOnTargetRate >= PERSONA_RULES.calorieOnTargetRate) {
    tags.push({
      key: 'self-disciplined',
      emoji: '🍚',
      title: '自律达人',
      subtitle: '三餐规律、热量长期贴着目标走',
      advice: '维持住就好，可以开始盯钠与纤维这两个细节。',
      evidence: [`热量贴目标 ${pct(stats.calorieOnTargetRate)}% 的日子`],
      strength: stats.calorieOnTargetRate,
    });
  }

  if (coverage !== undefined && coverage.dishCount > 0 && coverage.rate > PERSONA_RULES.dishCoverageRate) {
    tags.push({
      key: 'explorer',
      emoji: '🍽️',
      title: '食堂探索家',
      subtitle: '菜品库里大部分菜你都尝过了',
      advice: '尝鲜是好事，注意别总是往高油高盐的窗口走。',
      evidence: [`已尝试 ${coverage.triedDishCount}/${coverage.dishCount} 道菜（${pct(coverage.rate)}%）`],
      strength: coverage.rate,
    });
  }

  if (tags.length === 0) {
    // 一个标签都没命中：给一个不冒犯的默认形象，而不是空白
    const fallback: DietPersonaTag = {
      key: 'explorer',
      emoji: '🍽️',
      title: '食堂探索家',
      subtitle: '吃得比较随性，没有明显偏向',
      advice: '先把「记录」变成习惯，形象会随数据越来越准。',
      evidence: [`${windowDays} 天里记录了 ${recordedDays} 天，平均每天 ${stats.avgCaloriesKcal} kcal`],
      strength: 0,
    };
    return { primary: fallback, tags: [fallback], stats };
  }

  tags.sort((a, b) => b.strength - a.strength);
  return { primary: tags[0] ?? null, tags, stats };
}

/** 形象文案（复制/分享用）：主形象 + 其他标签 + 依据 + 建议 */
export function formatPersonaShare(persona: DietPersonaResult, windowLabel = '本季度'): string {
  const primary = persona.primary;
  if (primary === null) return `【可达鸭 · ${windowLabel}饮食形象】还没有足够数据`;
  const others = persona.tags.slice(1, 4).map((tag) => tag.title);
  const lines = [
    `【可达鸭 · ${windowLabel}饮食形象】${primary.emoji} ${primary.title}`,
    others.length === 0 ? primary.subtitle : `${primary.subtitle}（还有：${others.join('、')}）`,
    `依据：${primary.evidence.join('；')}`,
    `建议：${primary.advice}`,
  ];
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * 数据卫生：能量一致性（4 / 4 / 9 法则）
 * ------------------------------------------------------------------ */

/** 三大营养素的理论产能（kcal/g）：蛋白 4、碳水 4、脂肪 9（Atwater 系数） */
export const KCAL_PER_G = { proteinG: 4, carbG: 4, fatG: 9 } as const;

/** 由三大营养素推算热量（4×蛋白 + 4×碳水 + 9×脂肪） */
export function energyFromMacros(input: { proteinG: number; fatG: number; carbG: number }): number {
  return input.proteinG * KCAL_PER_G.proteinG + input.carbG * KCAL_PER_G.carbG + input.fatG * KCAL_PER_G.fatG;
}

/** 一致性告警的默认容差（±35%：食堂菜含纤维/酒精/有机酸，不可能完全吻合） */
export const ENERGY_TOLERANCE = 0.35;

/**
 * 校验录入的「热量」与三大营养素是否自洽。
 *
 * 为什么需要：菜品营养是**人工录入**的，热量多打一个 0、蛋白少填一位，
 * 都会让「缺口」和「推荐」全盘错掉，而用户很难察觉。这里只做**告警**
 * （返回中文提示），不做硬拒绝 —— 真实菜品的偏差属于正常现象，
 * 是否拦住由调用方（后台表单 / API 兜底）决定。
 *
 * @returns null 表示自洽；否则返回面向用户的中文告警
 */
export function checkDishEnergyConsistency(
  input: { caloriesKcal: number; proteinG: number; fatG: number; carbG: number },
  tolerance: number = ENERGY_TOLERANCE,
): string | null {
  const kcal = input.caloriesKcal;
  if (!Number.isFinite(kcal) || kcal <= 0) return null;
  const estimated = energyFromMacros(input);
  const diff = Math.abs(kcal - estimated);
  if (diff / kcal <= tolerance) return null;
  return `热量 ${Math.round(kcal)} kcal 与三大营养素推算值 ${Math.round(
    estimated,
  )} kcal 相差 ${Math.round((diff / kcal) * 100)}%，请复核录入`;
}

/* ------------------------------------------------------------------ *
 * 连续记录天数（趋势页的 streak）
 * ------------------------------------------------------------------ */

/**
 * 连续记录天数：从 `todayKey` 往回数，连续出现记录的天数。
 *
 * 口径：**今天没记**不打断 streak（用户可能只是还没吃饭），
 * 从昨天开始往回数；昨天也没记才归零。这样早上打开 App 不会看到 streak 被清零。
 */
export function computeStreak(recordedDayKeys: Iterable<string>, todayKey: string): number {
  const days = new Set(recordedDayKeys);
  const cursor = new Date(`${todayKey}T00:00:00`);
  if (Number.isNaN(cursor.getTime())) return 0;

  // 今天没记录 → 从昨天开始数
  if (!days.has(todayKey)) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  for (;;) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
      cursor.getDate(),
    ).padStart(2, '0')}`;
    if (!days.has(key)) return streak;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
    if (streak > 3650) return streak; // 防御：数据异常时不死循环
  }
}
