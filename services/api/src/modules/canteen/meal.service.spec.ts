import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../common/errors/app-error';
import { MealService } from './meal.service';
import type { CanteenDishService } from './canteen.service';
import type { CanteenDishModel } from './domain/canteen.domain';
import type {
  MealItemModel,
  MealRecordModel,
  MealRecordRepository,
  RecordMealInput,
} from './domain/meal.domain';
import type { DishRecognitionPort } from './domain/recognition.domain';

/**
 * 营养管家园 · 当餐用例测试（ADR 0006）。
 *
 * 用假仓储 / 假识别端口，只验证用例编排与领域规则：
 *   · 营养必须从菜品库**快照**（客户端传不了营养值）
 *   · 菜品库没有的菜明确拒绝，不编造数据
 *   · 识别候选与菜品库匹配后回填，未匹配的诚实留空
 *   · 记错了能改（份数 / 餐型）与能删；重复提交只落一条
 */

const DISH: CanteenDishModel = {
  id: 'dish-1',
  canteen: '第一食堂',
  name: '红烧排骨',
  category: 'meat',
  servingG: 200,
  caloriesKcal: 520,
  proteinG: 28,
  fatG: 38,
  carbG: 10,
  fiberG: 0,
  sodiumMg: 900,
  priceFen: 1400,
  source: '第一食堂公告栏公示',
  lastVerifiedAt: new Date('2026-10-12T00:00:00.000Z'),
  allergens: ['pork'],
  deletedAt: null,
  createdAt: new Date('2026-10-17T00:00:00.000Z'),
  updatedAt: new Date('2026-10-17T00:00:00.000Z'),
};

const ITEM: MealItemModel = {
  dishId: 'dish-1',
  dishName: '红烧排骨',
  category: 'meat',
  servings: 1,
  caloriesKcal: 520,
  proteinG: 28,
  fatG: 38,
  carbG: 10,
  fiberG: 0,
  sodiumMg: 900,
};

function makeRecord(overrides: Partial<MealRecordModel> = {}): MealRecordModel {
  return {
    id: 'meal-1',
    userId: 'user-1',
    mealType: 'lunch',
    source: 'manual',
    eatenAt: new Date('2026-10-17T12:00:00.000Z'),
    note: null,
    clientRequestId: null,
    createdAt: new Date('2026-10-17T12:00:00.000Z'),
    items: [ITEM],
    totals: { caloriesKcal: 520, proteinG: 28, fatG: 38, carbG: 10, fiberG: 0, sodiumMg: 900 },
    ...overrides,
  };
}

interface DishServiceFake {
  detail: ReturnType<typeof vi.fn>;
  searchDishes: ReturnType<typeof vi.fn>;
  findByExactName: ReturnType<typeof vi.fn>;
  listForRecommendation: ReturnType<typeof vi.fn>;
  countActiveDishes: ReturnType<typeof vi.fn>;
}

function makeDishService(): DishServiceFake {
  return {
    detail: vi.fn().mockResolvedValue(DISH),
    searchDishes: vi.fn().mockResolvedValue({ items: [DISH], nextCursor: null }),
    findByExactName: vi.fn().mockImplementation((name: string) => Promise.resolve(name === DISH.name ? DISH : null)),
    listForRecommendation: vi.fn().mockResolvedValue([DISH]),
    countActiveDishes: vi.fn().mockResolvedValue(20),
  };
}

function makeMealRepo(): {
  create: ReturnType<typeof vi.fn>;
  listByUser: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  findByClientRequestId: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn().mockImplementation((_userId: string, input: RecordMealInput, items: MealItemModel[]) =>
      Promise.resolve<MealRecordModel>(
        makeRecord({
          mealType: input.mealType,
          source: input.source,
          clientRequestId: input.clientRequestId ?? null,
          items,
          totals: {
            caloriesKcal: items.reduce((sum: number, item: MealItemModel) => sum + item.caloriesKcal * item.servings, 0),
            proteinG: 0,
            fatG: 0,
            carbG: 0,
            fiberG: 0,
            sodiumMg: 0,
          },
        }),
      ),
    ),
    listByUser: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(makeRecord()),
    findByClientRequestId: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockImplementation((_userId: string, _id: string, _input: unknown, items: MealItemModel[]) =>
      Promise.resolve(makeRecord({ items })),
    ),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRecognition(): { recognize: ReturnType<typeof vi.fn> } {
  return {
    recognize: vi.fn().mockResolvedValue([
      { dishId: null, name: '红烧排骨', category: 'meat', confidence: 0.95, mode: 'mock' },
      { dishId: null, name: '惠灵顿牛排', category: 'meat', confidence: 0.42, mode: 'mock' },
    ]),
  };
}

function makeService(repo = makeMealRepo()): {
  service: MealService;
  repo: ReturnType<typeof makeMealRepo>;
  dishes: DishServiceFake;
} {
  const dishes = makeDishService();
  return {
    service: new MealService(
      repo as unknown as MealRecordRepository,
      dishes as unknown as CanteenDishService,
      makeRecognition() as unknown as DishRecognitionPort,
    ),
    repo,
    dishes,
  };
}

describe('MealService（营养管家园 · 当餐用例）', () => {
  let service: MealService;
  let repo: ReturnType<typeof makeMealRepo>;

  beforeEach(() => {
    const made = makeService();
    service = made.service;
    repo = made.repo;
  });

  describe('record（记录当餐）', () => {
    it('营养从菜品库快照进明细，客户端传不了营养值', async () => {
      const record = await service.record('user-1', {
        mealType: 'lunch',
        source: 'manual',
        items: [{ dishId: 'dish-1', dishName: '红烧排骨', servings: 2 }],
      });

      expect(record.items).toHaveLength(1);
      expect(record.items[0]).toMatchObject({
        dishId: 'dish-1',
        dishName: '红烧排骨',
        servings: 2,
        caloriesKcal: 520,
        proteinG: 28,
        sodiumMg: 900,
      });
    });

    it('dishId 优先；按菜名时走精确匹配接口（不再靠 20 条搜索窗口）', async () => {
      const made = makeService();
      const record = await made.service.record('user-1', {
        mealType: 'lunch',
        source: 'manual',
        items: [{ dishName: '红烧排骨' }],
      });
      const first = record.items[0];
      expect(first).toBeDefined();
      if (first === undefined) return;
      expect(first.dishId).toBe('dish-1');
      expect(made.dishes.findByExactName).toHaveBeenCalledWith('红烧排骨');
      expect(made.dishes.searchDishes).not.toHaveBeenCalled();
    });

    it('菜品库没有的菜明确拒绝，不编造营养', async () => {
      await expect(
        service.record('user-1', {
          mealType: 'lunch',
          source: 'manual',
          items: [{ dishName: '翡翠虾饺皇' }],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('非法餐型 / 来源 / 空明细一律拒绝', async () => {
      await expect(
        service.record('user-1', { mealType: 'brunch', source: 'manual', items: [{ dishName: '米饭' }] }),
      ).rejects.toThrow(ValidationError);
      await expect(
        service.record('user-1', { mealType: 'lunch', source: 'telepathy', items: [{ dishName: '米饭' }] }),
      ).rejects.toThrow(ValidationError);
      await expect(
        service.record('user-1', { mealType: 'lunch', source: 'manual', items: [] }),
      ).rejects.toThrow(ValidationError);
    });

    it('支持半份（0.5 步进），非 0.5 倍数拒绝', async () => {
      const record = await service.record('user-1', {
        mealType: 'lunch',
        source: 'manual',
        items: [{ dishId: 'dish-1', dishName: '红烧排骨', servings: 0.5 }],
      });
      expect(record.items[0]?.servings).toBe(0.5);

      await expect(
        service.record('user-1', {
          mealType: 'lunch',
          source: 'manual',
          items: [{ dishId: 'dish-1', dishName: '红烧排骨', servings: 0.3 }],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('未来时间拒绝（防止把明天的饭记进今天）', async () => {
      await expect(
        service.record('user-1', {
          mealType: 'lunch',
          source: 'manual',
          eatenAt: new Date(Date.now() + 60 * 60 * 1000),
          items: [{ dishId: 'dish-1', dishName: '红烧排骨' }],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('带幂等键重复提交只落一条：命中已有记录直接返回', async () => {
      const made = makeService();
      const existing = makeRecord({ id: 'meal-existing', clientRequestId: 'req-1' });
      made.repo.findByClientRequestId.mockResolvedValue(existing);

      const result = await made.service.record('user-1', {
        mealType: 'lunch',
        source: 'manual',
        clientRequestId: 'req-1',
        items: [{ dishId: 'dish-1', dishName: '红烧排骨' }],
      });

      expect(result.id).toBe('meal-existing');
      expect(made.repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update（改份数 / 餐型 / 备注）', () => {
    it('份数按明细顺序改写，营养快照不变', async () => {
      const made = makeService();
      const result = await made.service.update('user-1', 'meal-1', { servings: [2.5] });

      expect(made.repo.update).toHaveBeenCalledTimes(1);
      expect(result.items[0]?.servings).toBe(2.5);
      expect(result.items[0]?.caloriesKcal).toBe(520);
    });

    it('份数数组长度与菜品数量不一致时拒绝（不做部分对齐）', async () => {
      await expect(service.update('user-1', 'meal-1', { servings: [1, 2] })).rejects.toThrow(ValidationError);
    });

    it('不是自己的记录当不存在', async () => {
      const made = makeService();
      made.repo.findById.mockResolvedValue(null);
      await expect(made.service.update('user-1', 'meal-x', { note: 'hi' })).rejects.toThrow(ValidationError);
    });

    it('非法餐型拒绝', async () => {
      await expect(service.update('user-1', 'meal-1', { mealType: 'brunch' })).rejects.toThrow(ValidationError);
    });
  });

  describe('remove（删除当餐）', () => {
    it('只能删自己的：查不到就直接拒绝，不调用删除', async () => {
      const made = makeService();
      made.repo.findById.mockResolvedValue(null);
      await expect(made.service.remove('user-1', 'meal-x')).rejects.toThrow(ValidationError);
      expect(made.repo.remove).not.toHaveBeenCalled();
    });

    it('删自己的记录会调用仓储删除', async () => {
      const result = await service.remove('user-1', 'meal-1');
      expect(result).toEqual({ id: 'meal-1', deleted: true });
      expect(repo.remove).toHaveBeenCalledWith('user-1', 'meal-1');
    });
  });

  describe('stats（趋势）', () => {
    it('补齐没有记录的天，并给出连续天数', async () => {
      const now = new Date();
      const todayKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);

      const made = makeService();
      made.repo.listByUser.mockResolvedValue([
        makeRecord({ id: 'meal-a', eatenAt: new Date(now.getTime() - 1000) }),
      ]);

      const trend = await made.service.stats('user-1', 7, now);
      expect(trend.days).toHaveLength(7);
      expect(trend.days.at(-1)?.date).toBe(todayKey);
      expect(trend.recordedDays).toBe(1);
      expect(trend.streak).toBe(1);
      expect(trend.average?.caloriesKcal).toBe(520);
      // 菜品覆盖率：吃过的不同菜品 / 菜品库总数
      expect(trend.coverage.triedDishCount).toBe(1);
      expect(trend.coverage.dishCount).toBe(20);
      expect(trend.coverage.rate).toBeCloseTo(0.05);
    });

    it('一天都没记时平均值为 null（不伪造 0）', async () => {
      const made = makeService();
      made.repo.listByUser.mockResolvedValue([]);
      const trend = await made.service.stats('user-1', 7);
      expect(trend.recordedDays).toBe(0);
      expect(trend.average).toBeNull();
      expect(trend.streak).toBe(0);
      expect(trend.coverage.triedDishCount).toBe(0);
    });
  });

  describe('today（今日汇总）', () => {
    it('汇总当天全部餐记录', async () => {
      const now = new Date('2026-10-17T12:30:00.000Z');
      const meals: MealRecordModel[] = [makeRecord({ eatenAt: now, items: [ITEM] })];
      const made = makeService();
      made.repo.listByUser.mockResolvedValue(meals);

      const today = await made.service.today('user-1', now);
      expect(today.meals).toHaveLength(1);
      expect(today.totals.caloriesKcal).toBe(520);
    });
  });

  describe('recognize（拍照识别）', () => {
    it('命中的候选回填菜品库数据；未匹配的 dish 为 null', async () => {
      const result = await service.recognize('demo://photo/1');

      expect(result.candidates).toHaveLength(2);
      const first = result.candidates[0];
      const second = result.candidates[1];
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      if (first === undefined || second === undefined) return;
      expect(first.dish?.id).toBe('dish-1');
      expect(first.dish?.caloriesKcal).toBe(520);
      expect(second.dish).toBeNull();
      expect(second.name).toBe('惠灵顿牛排');
    });
  });
});
