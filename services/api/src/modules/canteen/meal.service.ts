/**
 * 营养管家园 · 当餐用例（ADR 0006）
 *
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 *
 * 两条记录路径对应用户需求的两种入口：
 *   · photo  —— 拍照识别：recognize() 出候选 → 用户勾选 → record()
 *   · manual —— 输入菜名：前端搜菜品库 → 用户点选 → record()
 * 两条路径最终都落到 record()，营养一律从菜品库快照。
 *
 * 本文件还负责「记错了要能改」：
 *   update() 改餐型 / 备注 / 份数（换菜请删除重记），remove() 删除，
 *   stats() 给出近 N 日趋势。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  MEAL_TYPES,
  NUTRIENT_KEYS,
  computeStreak,
  isMealType,
  sumItems,
  type MealType,
  type NutritionTotals,
} from '@kedaya/shared';
import { ValidationError } from '../../common/errors/app-error';
import { appDateKey, appDayRange, parseAppDateKey } from '../../common/time/app-day';
import { CanteenDishService } from './canteen.service';
import type { CanteenDishModel } from './domain/canteen.domain';
import { MEAL_RECORD_REPOSITORY } from './domain/meal.domain';
import type {
  DailyMealSummary,
  MealItemModel,
  MealRecordModel,
  MealRecordRepository,
  MealTrend,
  RecordMealInput,
  UpdateMealInput,
} from './domain/meal.domain';
import { DISH_RECOGNITION } from './domain/recognition.domain';
import type { DishRecognitionCandidate, DishRecognitionPort } from './domain/recognition.domain';

/** 记录来源（与 Prisma 默认值一致） */
const MEAL_SOURCES = ['manual', 'photo'] as const;

/** 份数：0.5 步进、上限 20 份（食堂里「半份」是常态，整数不够用） */
const SERVING_STEP = 0.5;
const MAX_SERVINGS = 20;

/** 单餐最多记多少道菜 */
const MAX_ITEMS = 30;

/** 允许的时钟偏差：超过「现在 + 5 分钟」的用餐时间视为录错（防止把明天的饭记进今天） */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** 补记窗口：超过 30 天前的不允许（历史可以补，但不能无限往回改） */
const BACKFILL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** 趋势图默认天数（含今天） */
const DEFAULT_TREND_DAYS = 7;

@Injectable()
export class MealService {
  constructor(
    @Inject(MEAL_RECORD_REPOSITORY) private readonly meals: MealRecordRepository,
    @Inject(CanteenDishService) private readonly dishes: CanteenDishService,
    @Inject(DISH_RECOGNITION) private readonly recognition: DishRecognitionPort,
  ) {}

  /**
   * 记录当餐。营养不在请求里——service 按 dishId / 菜名从菜品库
   * 解析出当餐的营养成分并**快照**进明细（菜品日后改营养不改写历史）。
   *
   * 幂等：带 `clientRequestId` 且已有同一 key 的记录时，直接返回那条记录
   * （弱网重试 / 双击不会记成两餐）。
   */
  async record(userId: string, input: RecordMealInput): Promise<MealRecordModel> {
    if (!(MEAL_TYPES as readonly string[]).includes(input.mealType)) {
      throw new ValidationError(`mealType 必须是 ${MEAL_TYPES.join(' / ')}`, { mealType: input.mealType });
    }
    if (!(MEAL_SOURCES as readonly string[]).includes(input.source)) {
      throw new ValidationError(`source 必须是 ${MEAL_SOURCES.join(' / ')}`, { source: input.source });
    }
    if (input.items.length === 0) {
      throw new ValidationError('至少记录一道菜');
    }
    if (input.items.length > MAX_ITEMS) {
      throw new ValidationError(`一餐最多记录 ${MAX_ITEMS} 道菜`);
    }

    const clientRequestId = input.clientRequestId?.trim();
    if (clientRequestId !== undefined && clientRequestId !== '') {
      const existing = await this.meals.findByClientRequestId(userId, clientRequestId);
      if (existing !== null) return existing; // 重复提交：原样返回第一次的结果
    }

    const eatenAt = this.normalizeEatenAt(input.eatenAt);

    const items: MealItemModel[] = [];
    for (const item of input.items) {
      const dish = await this.resolveDish(item);
      if (!dish) {
        throw new ValidationError(
          `菜品库中找不到「${item.dishName}」。请先联系管理员补录这道菜的营养成分，或从候选列表里选一道`,
          { dishName: item.dishName },
        );
      }
      items.push({
        dishId: dish.id,
        dishName: dish.name,
        category: dish.category,
        servings: normalizeServings(item.servings ?? 1),
        caloriesKcal: dish.caloriesKcal,
        proteinG: dish.proteinG,
        fatG: dish.fatG,
        carbG: dish.carbG,
        fiberG: dish.fiberG,
        sodiumMg: dish.sodiumMg,
      });
    }

    return this.meals.create(userId, { ...input, eatenAt, clientRequestId }, items);
  }

  /** 某一天的餐记录（默认今天，项目时区口径） */
  async list(userId: string, dateKey?: string): Promise<{ date: string; meals: MealRecordModel[] }> {
    const base = this.parseDateKey(dateKey);
    const { key, from, to } = appDayRange(base);
    const meals = await this.meals.listByUser(userId, from, to);
    return { date: key, meals };
  }

  /** 今日营养汇总（进度环的数据源） */
  async today(userId: string, now: Date = new Date()): Promise<{
    date: string;
    meals: MealRecordModel[];
    totals: NutritionTotals;
  }> {
    const { key, from, to } = appDayRange(now);
    const meals = await this.meals.listByUser(userId, from, to);
    const totals = sumItems(meals.flatMap((meal) => meal.items));
    return { date: key, meals, totals };
  }

  /**
   * 修改当餐：餐型 / 备注 / 份数。
   * 换菜不在本接口里 —— 营养是快照，换菜等于重记（调用方先删再记）。
   */
  async update(userId: string, id: string, input: UpdateMealInput): Promise<MealRecordModel> {
    const existing = await this.meals.findById(userId, id);
    if (existing === null) {
      throw new ValidationError('这条用餐记录不存在，或不属于当前账号', { id });
    }

    if (input.mealType !== undefined && !(MEAL_TYPES as readonly string[]).includes(input.mealType)) {
      throw new ValidationError(`mealType 必须是 ${MEAL_TYPES.join(' / ')}`, { mealType: input.mealType });
    }
    if (input.note !== undefined && input.note !== null && (input.note as string).length > 500) {
      throw new ValidationError('备注最多 500 字');
    }
    if (input.note !== undefined && input.note !== null && input.note.trim() === '') {
      throw new ValidationError('备注不能是空白字符串；要清空请传 null');
    }

    let items = existing.items;
    if (input.servings !== undefined) {
      if (input.servings.length !== existing.items.length) {
        throw new ValidationError('份数数组长度必须与当餐菜品数量一致', {
          expected: existing.items.length,
          actual: input.servings.length,
        });
      }
      items = existing.items.map((item, index) => ({
        ...item,
        servings: normalizeServings(input.servings?.[index] ?? item.servings),
      }));
    }

    return this.meals.update(userId, id, input, items);
  }

  /** 删除当餐（营养是用户自己的数据，必须能撤回） */
  async remove(userId: string, id: string): Promise<{ id: string; deleted: true }> {
    const existing = await this.meals.findById(userId, id);
    if (existing === null) {
      throw new ValidationError('这条用餐记录不存在，或不属于当前账号', { id });
    }
    await this.meals.remove(userId, id);
    return { id, deleted: true };
  }

  /**
   * 近 N 日营养趋势（含今天），末尾补齐没有记录的天。
   * 缺口/达标率由前端用同一份 shared 纯函数算，这里只给「每天吃了多少」。
   */
  async stats(userId: string, days: number = DEFAULT_TREND_DAYS, now: Date = new Date()): Promise<MealTrend> {
    // 上限放到 92 天：季度形象要「近 90 天」，比趋势图的 7 天窗口长得多
    const span = Number.isInteger(days) && days >= 1 && days <= 92 ? days : DEFAULT_TREND_DAYS;
    const today = appDayRange(now);

    // 从 (span-1) 天前的零点开始，到今天的结束
    const from = new Date(today.from.getTime() - (span - 1) * 24 * 60 * 60 * 1000);
    const meals = await this.meals.listByUser(userId, from, today.to);

    const byDay = new Map<string, MealRecordModel[]>();
    for (const meal of meals) {
      const key = appDateKey(meal.eatenAt);
      const bucket = byDay.get(key);
      if (bucket === undefined) byDay.set(key, [meal]);
      else bucket.push(meal);
    }

    const dayList: DailyMealSummary[] = [];
    for (let offset = span - 1; offset >= 0; offset -= 1) {
      const date = new Date(today.from.getTime() - offset * 24 * 60 * 60 * 1000);
      const key = appDateKey(date);
      const dayMeals = byDay.get(key) ?? [];
      // 形象判定需要的两个维度：餐型条数、品类条数（都由当天的记录现算，不落库）
      const mealCounts: Partial<Record<MealType, number>> = {};
      const itemsByCategory: Record<string, number> = {};
      for (const meal of dayMeals) {
        if (isMealType(meal.mealType)) {
          mealCounts[meal.mealType] = (mealCounts[meal.mealType] ?? 0) + 1;
        }
        for (const item of meal.items) {
          itemsByCategory[item.category] = (itemsByCategory[item.category] ?? 0) + 1;
        }
      }
      dayList.push({
        date: key,
        totals: sumItems(dayMeals.flatMap((meal) => meal.items)),
        meals: dayMeals.length,
        mealCounts,
        itemsByCategory,
      });
    }

    const recorded = dayList.filter((day) => day.meals > 0);
    // 菜品覆盖率：窗口内吃过的**不同**菜品 / 菜品库（未下架）总数
    const triedDishIds = new Set<string>();
    for (const meal of meals) {
      for (const item of meal.items) {
        if (item.dishId !== null) triedDishIds.add(item.dishId);
      }
    }
    const dishCount = await this.dishes.countActiveDishes();
    return {
      days: dayList,
      streak: computeStreak(recorded.map((day) => day.date), today.key),
      recordedDays: recorded.length,
      average: recorded.length === 0 ? null : averageTotals(recorded.map((day) => day.totals)),
      coverage: {
        triedDishCount: triedDishIds.size,
        dishCount,
        rate: dishCount === 0 ? 0 : triedDishIds.size / dishCount,
      },
    };
  }

  /**
   * 拍照识别：端口出候选 → 拿名字去菜品库精确匹配 → 附上当餐营养。
   * 没匹配上的候选**原样返回**（dish 为 null），由 UI 诚实提示
   * 「识别到但菜品库还没有」，不编造营养数据。
   */
  async recognize(imageUrl: string): Promise<{
    mode: DishRecognitionCandidate['mode'];
    candidates: Array<DishRecognitionCandidate & { dish: CanteenDishModel | null }>;
  }> {
    const candidates = await this.recognition.recognize(imageUrl);
    const enriched = await Promise.all(
      candidates.map(async (candidate) => ({
        ...candidate,
        dish: await this.dishes.findByExactName(candidate.name),
      })),
    );
    return { mode: candidates[0]?.mode ?? 'mock', candidates: enriched };
  }

  /** dishId 优先；否则按菜名**精确**匹配（模糊匹配不用于记录，防记错） */
  private async resolveDish(item: { dishId?: string | null; dishName: string }): Promise<CanteenDishModel | null> {
    if (item.dishId) {
      return this.dishes.detail(item.dishId).catch(() => null);
    }
    return this.dishes.findByExactName(item.dishName);
  }

  /** 用餐时间：允许补记 30 天内，拒绝未来时间（时钟偏差留 5 分钟） */
  private normalizeEatenAt(eatenAt?: Date): Date {
    const now = new Date();
    if (eatenAt === undefined) return now;
    if (Number.isNaN(eatenAt.getTime())) {
      throw new ValidationError('eatenAt 不是合法时间');
    }
    if (eatenAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
      throw new ValidationError('用餐时间不能晚于当前时间', { eatenAt: eatenAt.toISOString() });
    }
    if (eatenAt.getTime() < now.getTime() - BACKFILL_WINDOW_MS) {
      throw new ValidationError('只能补记最近 30 天的饮食');
    }
    return eatenAt;
  }

  /** `YYYY-MM-DD` → 该项目时区当天零点；非法格式/不存在的日期报 400（不静默按今天处理） */
  private parseDateKey(dateKey?: string): Date {
    if (!dateKey) return new Date();
    const parsed = parseAppDateKey(dateKey);
    if (parsed === null) throw new ValidationError('date 格式应为 YYYY-MM-DD 且必须是真实存在的日期', { date: dateKey });
    return parsed;
  }
}

/** 份数校验：0.5 的整数倍，1 ≤ 份数 ≤ 20 */
function normalizeServings(servings: number): number {
  if (!Number.isFinite(servings) || servings <= 0 || servings > MAX_SERVINGS) {
    throw new ValidationError(`份数必须在 0.5 - ${MAX_SERVINGS} 之间`, { servings });
  }
  if (Math.abs(servings / SERVING_STEP - Math.round(servings / SERVING_STEP)) > 1e-9) {
    throw new ValidationError('份数必须是 0.5 的整数倍（如 0.5 / 1 / 1.5）', { servings });
  }
  return Math.round(servings * 2) / 2;
}

/** 多天平均（按天平均，不是按餐平均） */
function averageTotals(list: readonly NutritionTotals[]): NutritionTotals {
  const out = {} as NutritionTotals;
  const days = Math.max(list.length, 1);
  for (const key of NUTRIENT_KEYS) {
    const total = list.reduce((sum, day) => sum + day[key], 0);
    out[key] = Math.round((total / days) * 10) / 10;
  }
  return out;
}
