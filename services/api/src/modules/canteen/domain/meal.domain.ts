/**
 * 营养管家园 · 当餐记录（ADR 0006）
 *
 * domain 层不 import Prisma，字段与 Prisma 行一一对应。
 *
 * **快照约定**：营养值在记录当餐时从菜品库拷一份存下来——
 * 菜品日后改了营养成分，历史餐记录不跟着变（否则「上周吃了多少」
 * 会被悄悄改写）。dishId 仍保留关联，用于跳转菜品详情。
 */
import type { MealType, NutritionTotals } from '@kedaya/shared';

/** 当餐明细（营养快照，六项口径见 shared/nutrition.ts） */
export interface MealItemModel {
  dishId: string | null;
  dishName: string;
  category: string;
  /** 份数，支持 0.5（半份） */
  servings: number;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG: number;
  sodiumMg: number;
}

/** 当餐记录（含明细与汇总） */
export interface MealRecordModel {
  id: string;
  userId: string;
  /** breakfast / lunch / dinner / snack（取值集合见 shared MEAL_TYPES） */
  mealType: string;
  /** manual 菜名选择 / photo 拍照识别 */
  source: string;
  eatenAt: Date;
  note: string | null;
  /** 客户端幂等键（弱网重试 / 双击只落一次库） */
  clientRequestId: string | null;
  createdAt: Date;
  items: MealItemModel[];
  /** 本餐营养汇总（快照值之和，由 shared sumItems 计算） */
  totals: NutritionTotals;
}

/** 记录当餐的输入。营养由 service 从菜品库解析后快照，客户端传不了营养值 */
export interface RecordMealInput {
  mealType: string;
  source: string;
  eatenAt?: Date;
  note?: string;
  /** 客户端生成的幂等键：同一用户重复提交只落一条 */
  clientRequestId?: string;
  items: Array<{
    dishId?: string | null;
    dishName: string;
    servings?: number;
  }>;
}

/**
 * 修改当餐。
 *
 * 刻意**不支持**改菜品：换菜意味着换营养快照，等同于重记一餐；
 * 让客户端「删掉再记」比让服务端猜用户意图更安全（与 ADR 0006 D7 同一条原则）。
 * 允许改的是「记错了份数 / 餐型 / 备注」这三类高频错误。
 */
export interface UpdateMealInput {
  mealType?: string;
  note?: string | null;
  /** 与 items 等长的份数数组；长度不一致直接 400，不做部分对齐 */
  servings?: number[];
}

/** 某一天的营养汇总（趋势图的一个点） */
export interface DailyMealSummary {
  /** YYYY-MM-DD（项目时区口径） */
  date: string;
  totals: NutritionTotals;
  meals: number;
  /** 各餐型条数（形象判定用：早餐记录率 / 加餐频率） */
  mealCounts: Partial<Record<MealType, number>>;
  /** 各品类菜品条数（形象判定用：蔬菜占比 / 饮品甜品占比） */
  itemsByCategory: Record<string, number>;
}

/** 近 N 日趋势 */
export interface MealTrend {
  days: DailyMealSummary[];
  /** 连续记录天数（今天还没记不算断） */
  streak: number;
  /** 有记录的天数 */
  recordedDays: number;
  /** 有记录天的平均摄入；一天都没记时为 null */
  average: NutritionTotals | null;
  /** 菜品覆盖率（季度形象判定用）：窗口内吃过的不同菜品 / 菜品库总数 */
  coverage: {
    triedDishCount: number;
    dishCount: number;
    rate: number;
  };
}

/** 端口：service 只依赖本类型，实现见 data/meal.prisma-repository.ts */
export interface MealRecordRepository {
  create(userId: string, input: RecordMealInput, items: MealItemModel[]): Promise<MealRecordModel>;
  /** 按用户 + 时间范围列出餐记录（新的在前） */
  listByUser(userId: string, from: Date, to: Date): Promise<MealRecordModel[]>;
  /** 按 id 取（**必须带 userId**，避免越权读别人的记录） */
  findById(userId: string, id: string): Promise<MealRecordModel | null>;
  /** 幂等键查询：命中即视为重复提交 */
  findByClientRequestId(userId: string, clientRequestId: string): Promise<MealRecordModel | null>;
  update(userId: string, id: string, input: UpdateMealInput, items: MealItemModel[]): Promise<MealRecordModel>;
  /** 删除（明细随 `onDelete: Cascade` 一起删） */
  remove(userId: string, id: string): Promise<void>;
}

export const MEAL_RECORD_REPOSITORY = Symbol('KEDAYA_MEAL_RECORD_REPOSITORY');
