/**
 * 营养管家园 · 每日需求与推荐用例（ADR 0006）
 *
 * 用例层（契约 §7）：只编排，不含 IO。
 * 「缺口怎么算、推荐怎么打分」全部委托 shared/nutrition.ts ——
 * 后端 / 小程序 / Web 三端共用同一份实现，任何端不得另写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  computeGaps,
  estimateDailyTargets,
  recommendDishes,
  sumItems,
  type DishRecommendation,
  type EstimateTargetsInput,
  type NutritionGaps,
  type NutritionTarget,
  type NutritionTotals,
} from '@kedaya/shared';
import { ValidationError } from '../../common/errors/app-error';
import { appDayRange } from '../../common/time/app-day';
import { CanteenDishService } from './canteen.service';
import type { CanteenDishModel } from './domain/canteen.domain';
import { MEAL_RECORD_REPOSITORY } from './domain/meal.domain';
import type { MealRecordModel, MealRecordRepository } from './domain/meal.domain';
import { NUTRITION_TARGET_REPOSITORY } from './domain/nutrition-target.domain';
import type {
  NutritionTargetModel,
  NutritionTargetRepository,
  UpsertTargetInput,
} from './domain/nutrition-target.domain';

/** 推荐候选池大小（未下架菜品，按最近维护优先取前 N 道参与打分） */
const CANDIDATE_POOL_SIZE = 200;

/** 单次推荐的条数 */
const RECOMMENDATION_LIMIT = 5;

/** 身体档案的取值范围（与估算器公式的适用区间一致） */
const BODY_RANGES = {
  age: [10, 100],
  heightCm: [100, 250],
  weightKg: [20, 300],
} as const;

/** 首页一次要的数据（少一次往返，也不会出现「进度与推荐不是同一时刻」） */
export interface NutritionDashboard {
  date: string;
  target: NutritionTargetModel | null;
  consumed: NutritionTotals;
  gaps: NutritionGaps | null;
  recommendations: DishRecommendation[];
  meals: MealRecordModel[];
}

@Injectable()
export class NutritionService {
  constructor(
    @Inject(NUTRITION_TARGET_REPOSITORY) private readonly targets: NutritionTargetRepository,
    @Inject(MEAL_RECORD_REPOSITORY) private readonly meals: MealRecordRepository,
    @Inject(CanteenDishService) private readonly dishes: CanteenDishService,
  ) {}

  /** 我的每日需求（没设置过返回 null，由前端引导去设置） */
  async getTarget(userId: string): Promise<NutritionTargetModel | null> {
    return this.targets.getByUser(userId);
  }

  /**
   * 设置/更新每日需求。健全性下限：热量不低于 shared 的保底值。
   * 身体档案随需求一起保存（下一次重新估算不用重填）。
   */
  async upsertTarget(userId: string, input: UpsertTargetInput): Promise<NutritionTargetModel> {
    if (input.caloriesKcal < 1 || input.caloriesKcal > 10000) {
      throw new ValidationError('热量目标需在 1-10000 kcal 之间', { caloriesKcal: input.caloriesKcal });
    }
    for (const key of ['proteinG', 'fatG', 'carbG', 'fiberG', 'sodiumMg'] as const) {
      if (!Number.isInteger(input[key]) || input[key] < 0) {
        throw new ValidationError(`${{ proteinG: '蛋白质', fatG: '脂肪', carbG: '碳水', fiberG: '膳食纤维', sodiumMg: '钠' }[key]} 必须是非负整数`, {
          [key]: input[key],
        });
      }
    }
    this.assertBodyProfile(input);
    return this.targets.upsert(userId, input);
  }

  /** 估算器：纯函数、不落库。使用者拿它预填，再自行修改保存 */
  estimate(input: EstimateTargetsInput): NutritionTarget {
    return estimateDailyTargets(input);
  }

  /**
   * 今日缺口 + 「还需要吃什么」推荐。
   * 没设置每日需求时明确报错引导去设置，不悄悄用默认值。
   * 错误文案面向用户（不出现 `PUT /canteen/targets` 这类内部路径）。
   */
  async recommendations(
    userId: string,
    now: Date = new Date(),
  ): Promise<{
    target: NutritionTargetModel;
    consumed: NutritionTotals;
    gaps: NutritionGaps;
    recommendations: DishRecommendation[];
  }> {
    const target = await this.targets.getByUser(userId);
    if (!target) {
      throw new ValidationError('还没有设置每日营养需求。先花一分钟设一下，我们才能算出今天还差什么。', {
        action: 'SET_NUTRITION_TARGET',
      });
    }

    const { from, to } = appDayRange(now);
    const meals: MealRecordModel[] = await this.meals.listByUser(userId, from, to);
    const eatenItems = meals.flatMap((meal) => meal.items);
    const consumed = sumItems(eatenItems);

    return {
      target,
      consumed,
      gaps: computeGaps(target, consumed),
      recommendations: await this.buildRecommendations(target, consumed, eatenItems),
    };
  }

  /**
   * 首页聚合端点：今日汇总 + 需求 + 缺口 + 推荐，一次拿全。
   * 没设置需求时**不报错**（首页要能正常显示「去设置需求」的引导）。
   */
  async dashboard(userId: string, now: Date = new Date()): Promise<NutritionDashboard> {
    const { key, from, to } = appDayRange(now);
    const meals = await this.meals.listByUser(userId, from, to);
    const eatenItems = meals.flatMap((meal) => meal.items);
    const consumed = sumItems(eatenItems);
    const target = await this.targets.getByUser(userId);

    if (target === null) {
      return { date: key, target: null, consumed, gaps: null, recommendations: [], meals };
    }

    return {
      date: key,
      target,
      consumed,
      gaps: computeGaps(target, consumed),
      recommendations: await this.buildRecommendations(target, consumed, eatenItems),
      meals,
    };
  }

  /** 候选池取「未下架 + 最近维护」，并**排除今天已经吃过的菜品** */
  private async buildRecommendations(
    target: NutritionTargetModel,
    consumed: NutritionTotals,
    eatenItems: readonly { dishId: string | null; category: string }[],
  ): Promise<DishRecommendation[]> {
    const rows: CanteenDishModel[] = await this.dishes.listForRecommendation(CANDIDATE_POOL_SIZE);
    // 领域模型里 lastVerifiedAt 是 Date，推荐用的 DishLike 要 ISO 字符串（与 JSON 出口一致）
    const candidates = rows.map((dish) => ({
      ...dish,
      lastVerifiedAt: dish.lastVerifiedAt === null ? null : dish.lastVerifiedAt.toISOString(),
    }));
    return recommendDishes(candidates, target, consumed, {
      limit: RECOMMENDATION_LIMIT,
      eatenCategories: eatenItems.map((item) => item.category),
      eatenDishIds: eatenItems
        .map((item) => item.dishId)
        .filter((id): id is string => id !== null && id !== undefined),
      // 忌口/过敏原：硬过滤（用户的偏好存在 NutritionTarget 上，一人一份）
      excludeAllergens: target.avoidAllergens ?? [],
    });
  }

  /** 身体档案：要么不传，传了就必须在合理区间内（估算器不接受离谱输入） */
  private assertBodyProfile(input: UpsertTargetInput): void {
    for (const key of ['age', 'heightCm', 'weightKg'] as const) {
      const value = input[key];
      if (value === undefined) continue;
      const [min, max] = BODY_RANGES[key];
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new ValidationError(`${key} 需在 ${min}-${max} 之间`, { [key]: value });
      }
    }
  }
}
