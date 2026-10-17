import { DEFAULT_PAGE_SIZE } from '@kedaya/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/compliance/audit.service';
import { ValidationError } from '../../common/errors/app-error';
import { encodeCursor } from '../../common/pagination/cursor';
import type { PrismaService } from '../../prisma/prisma.service';
import { CanteenController } from './canteen.controller';
import { CanteenDishService } from './canteen.service';
import { CanteenDishPrismaRepository } from './data/canteen.repository';
import type { CanteenDishModel, CanteenDishRepository } from './domain/canteen.domain';

/**
 * 营养管家「筛选 + 排序 + 汇总 + 软删除」的可执行规格。
 *
 * 这一层最容易出两类**不报错但会静默坏事**的问题：
 *   1. 筛选没进 `where` → 用户点了「第二食堂」却还是看到全部菜品；
 *   2. 排序没有 id 兜底 → 同一毫秒落库的两行在翻页时漏读 / 重读。
 * 因此断言直接落在仓储真正发给 Prisma 的参数上，而不是"看起来像"。
 *
 * 依赖一律用假仓储 / 假 Prisma delegate（参照 notifications.service.spec.ts），
 * 不连数据库、不起 Nest 容器。
 */

const BASE: CanteenDishModel = {
  id: 'dish-1',
  canteen: '第一食堂',
  name: '鸡腿饭',
  category: 'meat',
  servingG: 350,
  caloriesKcal: 700,
  proteinG: 32,
  fatG: 22,
  carbG: 88,
  fiberG: 2,
  sodiumMg: 900,
  priceFen: 1_500,
  source: '一食堂公告栏公示',
  lastVerifiedAt: new Date('2026-10-12T00:00:00.000Z'),
  allergens: [],
  deletedAt: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

interface FakeRepo {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  summarizeByCanteen: ReturnType<typeof vi.fn>;
  searchDishes: ReturnType<typeof vi.fn>;
  findByExactName: ReturnType<typeof vi.fn>;
  listForRecommendation: ReturnType<typeof vi.fn>;
  countActive: ReturnType<typeof vi.fn>;
}

function makeRepo(): FakeRepo {
  return {
    list: vi.fn().mockResolvedValue({ items: [BASE], nextCursor: null }),
    create: vi.fn().mockResolvedValue(BASE),
    findById: vi.fn().mockResolvedValue(BASE),
    update: vi.fn().mockResolvedValue(BASE),
    remove: vi.fn().mockResolvedValue(undefined),
    summarizeByCanteen: vi
      .fn()
      .mockResolvedValue({ dishes: 3, totalCaloriesKcal: 1_800, avgPriceFen: 600 }),
    searchDishes: vi.fn().mockResolvedValue({ items: [BASE], nextCursor: null }),
    findByExactName: vi.fn().mockResolvedValue(BASE),
    listForRecommendation: vi.fn().mockResolvedValue([BASE]),
    countActive: vi.fn().mockResolvedValue(1),
  };
}

function makeAudit() {
  return { recordQuietly: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

function makeService(repo: FakeRepo): CanteenDishService {
  return new CanteenDishService(repo as unknown as CanteenDishRepository, makeAudit());
}

/** 最小 Prisma 替身：只提供 canteenDish 上的 findMany / findFirst / update / count / aggregate */
function makePrisma() {
  const findMany = vi.fn().mockResolvedValue([]);
  const findFirst = vi.fn().mockResolvedValue(null);
  const update = vi.fn().mockResolvedValue(BASE);
  const count = vi.fn().mockResolvedValue(0);
  const aggregate = vi.fn().mockResolvedValue({
    _count: { _all: 0 },
    _sum: { caloriesKcal: null, priceFen: null },
  });
  const prisma = { canteenDish: { findMany, findFirst, update, count, aggregate } } as unknown as PrismaService;
  return { prisma, findMany, findFirst, update, count, aggregate };
}

describe('CanteenDishService.list（筛选透传）', () => {
  it('把 canteen / q 组装出的 filters 原样交给仓储，不吞不改', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await service.list({ limit: 10, filters: { canteen: '第二食堂', q: '豆腐' } });

    expect(repo.list).toHaveBeenCalledWith({
      limit: 10,
      filters: { canteen: '第二食堂', q: '豆腐' },
    });
  });

  it('没有筛选时不凭空造一个 filters', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await service.list({ limit: DEFAULT_PAGE_SIZE });

    expect(repo.list).toHaveBeenCalledWith({ limit: DEFAULT_PAGE_SIZE });
  });
});

describe('CanteenDishService.calories（食堂汇总）', () => {
  it('直接委托仓储的 summarizeByCanteen', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    const summary = await service.calories('第一食堂');

    expect(repo.summarizeByCanteen).toHaveBeenCalledWith('第一食堂');
    expect(summary).toEqual({ dishes: 3, totalCaloriesKcal: 1_800, avgPriceFen: 600 });
  });
});

describe('CanteenDishService.create（服务端再校验一遍 + 审计）', () => {
  it('缺省的每份克数/膳食纤维/钠被补齐成默认值（而不是落进 undefined）', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await service.create({
      canteen: '第一食堂',
      name: '鸡腿饭',
      category: 'meat',
      caloriesKcal: 700,
      proteinG: 32,
      fatG: 22,
      carbG: 88,
      priceFen: 1_500,
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ servingG: 100, fiberG: 0, sodiumMg: 0 }),
    );
  });

  it('热量与 4/4/9 推算值差得离谱时拒绝入库（人工少打一位数的典型症状）', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await expect(
      service.create({
        canteen: '第一食堂',
        name: '红烧排骨',
        category: 'meat',
        // 真实值约 520 kcal；少打一位 → 与宏量营养素完全不匹配
        caloriesKcal: 52,
        proteinG: 28,
        fatG: 38,
        carbG: 10,
        priceFen: 1_400,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('菜的种类不在枚举内时拒绝（品类是推荐与形象的依据）', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await expect(
      service.create({
        canteen: '第一食堂',
        name: '鸡腿饭',
        category: '荤菜',
        caloriesKcal: 700,
        proteinG: 32,
        fatG: 22,
        carbG: 88,
        priceFen: 1_500,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('CanteenController.list（查询参数 → filters 映射）', () => {
  function makeController() {
    const service = { list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) };
    const controller = new CanteenController(service as unknown as CanteenDishService);
    return { service, controller };
  }

  it('canteen + q 组装成 filters，limit 缺省用默认页大小', async () => {
    const { service, controller } = makeController();

    await controller.list({ canteen: '第一食堂', q: '鸡腿' });

    expect(service.list).toHaveBeenCalledWith({
      limit: DEFAULT_PAGE_SIZE,
      filters: { canteen: '第一食堂', q: '鸡腿' },
    });
  });

  it('只给 canteen 时不混入 q', async () => {
    const { service, controller } = makeController();

    await controller.list({ canteen: '教工食堂' });

    expect(service.list).toHaveBeenCalledWith({
      limit: DEFAULT_PAGE_SIZE,
      filters: { canteen: '教工食堂' },
    });
  });

  it('category 也走白名单（营养管家菜品选择器的品类 chip）', async () => {
    const { service, controller } = makeController();

    await controller.list({ category: 'vegetable' });

    expect(service.list).toHaveBeenCalledWith({
      limit: DEFAULT_PAGE_SIZE,
      filters: { category: 'vegetable' },
    });
  });

  it('没有任何筛选时连 filters 都不传（避免空对象进 where）', async () => {
    const { service, controller } = makeController();

    await controller.list({});

    expect(service.list).toHaveBeenCalledWith({ limit: DEFAULT_PAGE_SIZE });
  });

  it('cursor 与 limit 原样透传（游标分页靠它续页）', async () => {
    const { service, controller } = makeController();

    await controller.list({ cursor: 'abc', limit: 5 });

    expect(service.list).toHaveBeenCalledWith({ cursor: 'abc', limit: 5 });
  });
});

describe('CanteenDishPrismaRepository（where / orderBy / 汇总 / 软删除）', () => {
  it('canteen 精确 + q 模糊翻成 where，排序固定最新在前且带 id 兜底', async () => {
    const { prisma, findMany } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);

    await repository.list({ limit: 20, filters: { canteen: '第二食堂', q: '豆腐' } });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          canteen: '第二食堂',
          name: { contains: '豆腐', mode: 'insensitive' },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        // 多取一条用于判断"还有没有下一页"
        take: 21,
      }),
    );
  });

  it('只给 q 时只按菜名模糊匹配', async () => {
    const { prisma, findMany } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);

    await repository.list({ limit: 20, filters: { q: '  拉面  ' } });

    const args = findMany.mock.calls[0]?.[0] as { where: unknown; orderBy: unknown };
    expect(args.where).toEqual({ deletedAt: null, name: { contains: '拉面', mode: 'insensitive' } });
  });

  it('没有筛选时也要过滤下架菜品（软删除的可见性靠这里）', async () => {
    const { prisma, findMany } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);

    await repository.list({ limit: 20 });

    const args = findMany.mock.calls[0]?.[0] as { where?: unknown; orderBy: unknown };
    expect(args.where).toEqual({ deletedAt: null });
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('白名单之外的 key 与空白值都被忽略（不能变成任意字段查询）', async () => {
    const { prisma, findMany } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);

    await repository.list({
      limit: 20,
      // 混入未登记的键，以及被清空的 q
      filters: { canteen: '第一食堂', q: '   ', evil: 'drop table' },
    });

    const args = findMany.mock.calls[0]?.[0] as { where: unknown };
    expect(args.where).toEqual({ deletedAt: null, canteen: '第一食堂' });
  });

  it('游标解码后作为 Prisma cursor 并 skip 1', async () => {
    const { prisma, findMany } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);

    await repository.list({ cursor: encodeCursor('dish-42'), limit: 20 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'dish-42' }, skip: 1 }),
    );
  });

  it('详情查不到已下架的菜品（下架 = 对用户不存在）', async () => {
    const { prisma, findFirst } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);

    await repository.findById('dish-9');

    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'dish-9', deletedAt: null } });
  });

  it('remove 只写 deletedAt，不真删（历史餐记录仍要能回溯）', async () => {
    const { prisma, update } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);

    await repository.remove('dish-9');

    const args = update.mock.calls[0]?.[0] as { where: unknown; data: { deletedAt: unknown } };
    expect(args.where).toEqual({ id: 'dish-9' });
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it('searchDishes 同样排除下架菜品', async () => {
    const { prisma, findMany } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);

    await repository.searchDishes({ category: 'soup', limit: 20 });

    const args = findMany.mock.calls[0]?.[0] as { where: unknown };
    expect(args.where).toEqual({ deletedAt: null, category: 'soup' });
  });

  it('summarizeByCanteen：真实聚合 + 均价取整（只算未下架）', async () => {
    const { prisma, aggregate } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);
    aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: { caloriesKcal: 1_800, priceFen: 6_000 },
    });

    const summary = await repository.summarizeByCanteen('第一食堂');

    expect(aggregate).toHaveBeenCalledWith({
      where: { canteen: '第一食堂', deletedAt: null },
      _count: { _all: true },
      _sum: { caloriesKcal: true, priceFen: true },
    });
    expect(summary).toEqual({ dishes: 3, totalCaloriesKcal: 1_800, avgPriceFen: 2_000 });
  });

  it('空食堂返回 0，绝不除零得到 NaN', async () => {
    const { prisma, aggregate } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);
    aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { caloriesKcal: null, priceFen: null },
    });

    expect(await repository.summarizeByCanteen('清真食堂')).toEqual({
      dishes: 0,
      totalCaloriesKcal: 0,
      avgPriceFen: 0,
    });
  });

  it('均价四舍五入到分', async () => {
    const { prisma, aggregate } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);
    aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: { caloriesKcal: 100, priceFen: 1_000 },
    });

    const summary = await repository.summarizeByCanteen('其他');

    expect(summary.avgPriceFen).toBe(333);
  });
});
