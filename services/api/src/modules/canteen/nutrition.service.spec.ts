import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../common/errors/app-error';
import { NutritionService } from './nutrition.service';
import type { CanteenDishService } from './canteen.service';
import type { CanteenDishModel } from './domain/canteen.domain';
import type { MealRecordModel, MealRecordRepository } from './domain/meal.domain';
import type { NutritionTargetModel, NutritionTargetRepository } from './domain/nutrition-target.domain';

/**
 * 营养管家园 · 每日需求与推荐用例测试（ADR 0006）。
 *
 * 验证四件事：
 *   1. 需求由使用者提出 —— 没设置就明确报错，不悄悄用默认值
 *   2. 估算器只透传 shared 纯函数（同一份公式，三端一致）
 *   3. 推荐的原料 = 今日已吃（仓储）+ 菜品库（候选池），打分逻辑在 shared
 *   4. 今天已经吃过的菜不再出现在推荐里
 */

const TARGET: NutritionTargetModel = {
  id: 'target-1',
  userId: 'user-1',
  caloriesKcal: 2000,
  proteinG: 100,
  fatG: 60,
  carbG: 250,
  fiberG: 25,
  sodiumMg: 2000,
  sex: 'male',
  age: 20,
  heightCm: 175,
  weightKg: 70,
  activity: 'moderate',
  goal: 'maintain',
  avoidAllergens: [],
  updatedAt: new Date('2026-10-17T00:00:00.000Z'),
};

/** 只含六项营养的写入输入（身体档案可选） */
const TARGET_INPUT = {
  caloriesKcal: 2000,
  proteinG: 100,
  fatG: 60,
  carbG: 250,
  fiberG: 25,
  sodiumMg: 2000,
};

const DISHES: CanteenDishModel[] = [
  {
    id: 'dish-rice', canteen: '一食堂', name: '米饭', category: 'staple', servingG: 150,
    caloriesKcal: 174, proteinG: 4, fatG: 1, carbG: 38, fiberG: 1, sodiumMg: 5, priceFen: 200,
    source: '一食堂公告栏公示', lastVerifiedAt: new Date('2026-10-12T00:00:00.000Z'),
    allergens: [],
    deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 'dish-paigu', canteen: '一食堂', name: '红烧排骨', category: 'meat', servingG: 200,
    caloriesKcal: 520, proteinG: 28, fatG: 38, carbG: 10, fiberG: 0, sodiumMg: 900, priceFen: 1400,
    source: '一食堂公告栏公示', lastVerifiedAt: new Date('2026-10-12T00:00:00.000Z'),
    allergens: [],
    deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
  },
];

const MEALS: MealRecordModel[] = [
  {
    id: 'meal-1',
    userId: 'user-1',
    mealType: 'lunch',
    source: 'manual',
    eatenAt: new Date('2026-10-17T12:00:00.000Z'),
    note: null,
    clientRequestId: null,
    createdAt: new Date('2026-10-17T12:00:00.000Z'),
    items: [
      { dishId: 'dish-rice', dishName: '米饭', category: 'staple', servings: 1, caloriesKcal: 174, proteinG: 4, fatG: 1, carbG: 38, fiberG: 1, sodiumMg: 5 },
    ],
    totals: { caloriesKcal: 174, proteinG: 4, fatG: 1, carbG: 38, fiberG: 1, sodiumMg: 5 },
  },
];

function makeTargetRepo(): { getByUser: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> } {
  return {
    getByUser: vi.fn().mockResolvedValue(TARGET),
    upsert: vi.fn().mockResolvedValue(TARGET),
  };
}

function makeMealRepo(): { listByUser: ReturnType<typeof vi.fn> } {
  return { listByUser: vi.fn().mockResolvedValue(MEALS) };
}

function makeDishService(): {
  searchDishes: ReturnType<typeof vi.fn>;
  listForRecommendation: ReturnType<typeof vi.fn>;
} {
  return {
    searchDishes: vi.fn().mockResolvedValue({ items: DISHES, nextCursor: null }),
    listForRecommendation: vi.fn().mockResolvedValue(DISHES),
  };
}

function makeService(targets = makeTargetRepo()): {
  service: NutritionService;
  targets: ReturnType<typeof makeTargetRepo>;
  meals: ReturnType<typeof makeMealRepo>;
  dishes: ReturnType<typeof makeDishService>;
} {
  const meals = makeMealRepo();
  const dishes = makeDishService();
  return {
    service: new NutritionService(
      targets as unknown as NutritionTargetRepository,
      meals as unknown as MealRecordRepository,
      dishes as unknown as CanteenDishService,
    ),
    targets,
    meals,
    dishes,
  };
}

describe('NutritionService（每日需求与推荐）', () => {
  let service: NutritionService;

  beforeEach(() => {
    service = makeService().service;
  });

  describe('targets（每日需求）', () => {
    it('getTarget 直接透传仓储', async () => {
      await expect(service.getTarget('user-1')).resolves.toMatchObject({ caloriesKcal: 2000 });
    });

    it('upsert 前做健全性校验（热量区间）', async () => {
      await expect(service.upsertTarget('user-1', { ...TARGET_INPUT, caloriesKcal: 0 })).rejects.toThrow(
        ValidationError,
      );
      await expect(service.upsertTarget('user-1', { ...TARGET_INPUT, caloriesKcal: 99_999 })).rejects.toThrow(
        ValidationError,
      );
    });

    it('负营养值拒绝', async () => {
      await expect(service.upsertTarget('user-1', { ...TARGET_INPUT, proteinG: -1 })).rejects.toThrow(ValidationError);
    });

    it('身体档案超出合理区间拒绝', async () => {
      await expect(service.upsertTarget('user-1', { ...TARGET_INPUT, weightKg: 500 })).rejects.toThrow(ValidationError);
      await expect(service.upsertTarget('user-1', { ...TARGET_INPUT, age: 3 })).rejects.toThrow(ValidationError);
    });

    it('合法输入落库（身体档案一起存）', async () => {
      const made = makeService();
      await made.service.upsertTarget('user-1', { ...TARGET_INPUT, weightKg: 68, goal: 'lose' });
      expect(made.targets.upsert).toHaveBeenCalledWith('user-1', { ...TARGET_INPUT, weightKg: 68, goal: 'lose' });
    });

    it('估算器透传 shared 公式（男性中等活动维持）', () => {
      const estimated = service.estimate({
        sex: 'male',
        age: 20,
        heightCm: 175,
        weightKg: 70,
        activity: 'moderate',
        goal: 'maintain',
      });
      // BMR = 10*70 + 6.25*175 - 5*20 + 5 = 1698.75；TDEE = 1698.75*1.55 = 2633.1 → 2630
      expect(estimated.caloriesKcal).toBe(2630);
      expect(estimated.sodiumMg).toBe(2000);
    });
  });

  describe('recommendations（缺口 + 推荐）', () => {
    it('未设置需求时明确报错，且文案面向用户（不暴露内部路径）', async () => {
      const made = makeService();
      made.targets.getByUser.mockResolvedValue(null);

      const error = await made.service.recommendations('user-1').catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ValidationError);
      const message = (error as ValidationError).message;
      expect(message).not.toContain('PUT');
      expect(message).not.toContain('/canteen');
      expect(message).toContain('设置');
    });

    it('缺口 = 目标 − 今日已吃；推荐按缺口加权打分', async () => {
      const result = await service.recommendations('user-1');

      expect(result.consumed.caloriesKcal).toBe(174);
      expect(result.gaps.caloriesKcal).toBe(2000 - 174);
      expect(result.gaps.proteinG).toBe(100 - 4);
      expect(result.recommendations.length).toBeGreaterThan(0);
      const top = result.recommendations[0];
      expect(top).toBeDefined();
      if (top === undefined) return;
      expect(top.dish.id).toBe('dish-paigu');
      expect(top.reason).toContain('缺口');
    });

    it('今天已经吃过的菜不再被推荐（排除 dishId）', async () => {
      const made = makeService();
      const result = await made.service.recommendations('user-1');
      expect(result.recommendations.map((rec) => rec.dish.id)).not.toContain('dish-rice');
    });

    it('候选池走「最近维护优先」的专用查询，而不是 id 升序前 N 条', async () => {
      const made = makeService();
      await made.service.recommendations('user-1');
      expect(made.dishes.listForRecommendation).toHaveBeenCalled();
    });
  });

  describe('dashboard（首页聚合）', () => {
    it('一次返回汇总 / 需求 / 缺口 / 推荐', async () => {
      const result = await service.dashboard('user-1');
      expect(result.target?.caloriesKcal).toBe(2000);
      expect(result.consumed.caloriesKcal).toBe(174);
      expect(result.gaps?.proteinG).toBe(96);
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.meals).toHaveLength(1);
    });

    it('没设置需求时不报错（首页要能渲染「去设置」引导）', async () => {
      const made = makeService();
      made.targets.getByUser.mockResolvedValue(null);
      const result = await made.service.dashboard('user-1');
      expect(result.target).toBeNull();
      expect(result.gaps).toBeNull();
      expect(result.recommendations).toEqual([]);
      expect(result.consumed.caloriesKcal).toBe(174);
    });
  });
});
