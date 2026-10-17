import { DEFAULT_PAGE_SIZE } from '@kedaya/contracts';
import { describe, expect, it, vi } from 'vitest';
import { encodeCursor } from '../../common/pagination/cursor';
import type { PrismaService } from '../../prisma/prisma.service';
import { CanteenController } from './canteen.controller';
import { CanteenDishService } from './canteen.service';
import { CanteenDishPrismaRepository } from './data/canteen.repository';
import type { CanteenDishModel, CanteenDishRepository } from './domain/canteen.domain';

/**
 * 食堂营养「筛选 + 排序 + 汇总」的可执行规格。
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
  caloriesKcal: 700,
  proteinG: 32,
  fatG: 22,
  carbG: 88,
  priceFen: 1_500,
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
  };
}

function makeService(repo: FakeRepo): CanteenDishService {
  return new CanteenDishService(repo as unknown as CanteenDishRepository);
}

/** 最小 Prisma 替身：只提供 canteenDish 上的 findMany / aggregate */
function makePrisma() {
  const findMany = vi.fn().mockResolvedValue([]);
  const aggregate = vi.fn().mockResolvedValue({
    _count: { _all: 0 },
    _sum: { caloriesKcal: null, priceFen: null },
  });
  const prisma = { canteenDish: { findMany, aggregate } } as unknown as PrismaService;
  return { prisma, findMany, aggregate };
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

describe('CanteenDishPrismaRepository（where / orderBy / 汇总）', () => {
  it('canteen 精确 + q 模糊翻成 where，排序固定最新在前且带 id 兜底', async () => {
    const { prisma, findMany } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);

    await repository.list({ limit: 20, filters: { canteen: '第二食堂', q: '豆腐' } });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
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
    expect(args.where).toEqual({ name: { contains: '拉面', mode: 'insensitive' } });
  });

  it('没有筛选时不下发 where，但排序仍是 createdAt desc + id desc', async () => {
    const { prisma, findMany } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);

    await repository.list({ limit: 20 });

    const args = findMany.mock.calls[0]?.[0] as { where?: unknown; orderBy: unknown };
    expect(args.where).toBeUndefined();
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
    expect(args.where).toEqual({ canteen: '第一食堂' });
  });

  it('游标解码后作为 Prisma cursor 并 skip 1', async () => {
    const { prisma, findMany } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);

    await repository.list({ cursor: encodeCursor('dish-42'), limit: 20 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'dish-42' }, skip: 1 }),
    );
  });

  it('summarizeByCanteen：真实聚合 + 均价取整', async () => {
    const { prisma, aggregate } = makePrisma();
    const repository = new CanteenDishPrismaRepository(prisma);
    aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: { caloriesKcal: 1_800, priceFen: 6_000 },
    });

    const summary = await repository.summarizeByCanteen('第一食堂');

    expect(aggregate).toHaveBeenCalledWith({
      where: { canteen: '第一食堂' },
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
