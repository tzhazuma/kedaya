import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { FleaItemService } from './flea-market.service';
import {
  FLEA_MAX_PRICE_FEN,
  type FleaItemListQuery,
  type FleaItemModel,
  type FleaItemRepository,
} from './domain/flea-market.domain';

/**
 * 跳蚤市场用例层规格 —— 六模块的**参考实现**，因此测得更细。
 *
 * 三组不变量：
 *   1. **归属**：sellerId 永远来自登录主体（忽略请求体），改 / 删 / 售出只有卖家能调；
 *   2. **状态机**：on-sale → reserved → sold，非法跃迁一律 CONFLICT，
 *      并且状态只能通过 `applyState` 变更（客户端碰不到 `update`）；
 *   3. **校验**：标题 / 价格 / 分类 / 成色在服务层归一化，
 *      脏数据不会落库，错误信息带 `field` 便于前端定位。
 *
 * 用假仓储 + `new FleaItemService(fake)`（显式 token 注入，无需 DI 容器）。
 */

const SELLER = 'user-seller';
const BUYER = 'user-buyer';

const BASE: FleaItemModel = {
  id: 'item-1',
  sellerId: SELLER,
  title: '机械键盘',
  description: '用了半年',
  priceFen: 12_800,
  category: 'electronics',
  condition: 'good',
  campusSpot: '二号宿舍楼下',
  status: 'on-sale',
  reservedById: null,
  soldAt: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

type FakeRepo = {
  [K in keyof FleaItemRepository]: ReturnType<typeof vi.fn>;
};

function makeRepo(overrides: Partial<FleaItemModel> = {}): FakeRepo {
  const item: FleaItemModel = { ...BASE, ...overrides };

  return {
    list: vi.fn().mockResolvedValue({ items: [item], nextCursor: null }),
    create: vi.fn().mockImplementation(async (input: object) => ({ ...item, ...input })),
    findById: vi.fn().mockResolvedValue(item),
    update: vi.fn().mockImplementation(async (_id: string, patch: object) => ({ ...item, ...patch })),
    applyState: vi
      .fn()
      .mockImplementation(async (_id: string, patch: object) => ({ ...item, ...patch })),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function makeService(repo: FakeRepo): FleaItemService {
  return new FleaItemService(repo as unknown as FleaItemRepository);
}

describe('列表', () => {
  let repo: FakeRepo;

  beforeEach(() => {
    repo = makeRepo();
  });

  it('默认 limit=20、sort=latest，并不传任何筛选', async () => {
    await makeService(repo).list();

    expect(repo.list).toHaveBeenCalledWith({ limit: 20, sort: 'latest' });
  });

  it('关键词去空白并截断到 60 字（防止超长 LIKE 拖垮数据库）', async () => {
    await makeService(repo).list({ keyword: `  ${'长'.repeat(80)}  ` });

    const arg = repo.list.mock.calls[0]?.[0] as { keyword: string };
    expect(arg.keyword).toHaveLength(60);
    expect(arg.keyword.startsWith(' ')).toBe(false);
  });

  it('sellerId 直接透传（controller 负责把 mine=1 翻译成当前用户）', async () => {
    await makeService(repo).list({ sellerId: SELLER });

    expect(repo.list).toHaveBeenCalledWith({ limit: 20, sort: 'latest', sellerId: SELLER });
  });

  it('分类 / 成色 / 状态合法时原样下传', async () => {
    await makeService(repo).list({
      category: 'books',
      condition: 'like-new',
      status: 'reserved',
      sort: 'price-asc',
    });

    expect(repo.list).toHaveBeenCalledWith({
      limit: 20,
      category: 'books',
      condition: 'like-new',
      status: 'reserved',
      sort: 'price-asc',
    });
  });

  it('分类 / 成色 / 排序不在白名单内 → ValidationError（带 allowed 便于前端提示）', async () => {
    const service = makeService(repo);
    // 这几个值在类型上不可达，模拟的是「查询串绕过了编译期类型」的真实情况：
    // controller 用 Zod 收字符串，脏值一定会到服务层，因此服务层必须自己再判一次。
    const dirty = (patch: Record<string, unknown>): Partial<FleaItemListQuery> =>
      patch as unknown as Partial<FleaItemListQuery>;

    await expect(service.list(dirty({ category: 'nope' }))).rejects.toBeInstanceOf(ValidationError);
    await expect(service.list(dirty({ condition: 'broken' }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(service.list(dirty({ sort: 'cheapest' }))).rejects.toBeInstanceOf(ValidationError);

    expect(repo.list).not.toHaveBeenCalled();
  });

  it('sort 为空串视为未指定 → latest（前端清空筛选时不该报错）', async () => {
    await makeService(repo).list({ sort: '' } as unknown as Partial<FleaItemListQuery>);

    expect(repo.list).toHaveBeenCalledWith({ limit: 20, sort: 'latest' });
  });
});

describe('发布', () => {
  let repo: FakeRepo;

  beforeEach(() => {
    repo = makeRepo();
  });

  const valid = {
    title: '九成新台灯',
    priceFen: 3_000,
    category: 'daily',
  };

  it('未登录 → UnauthenticatedError（不能靠请求体伪造 sellerId）', async () => {
    await expect(makeService(repo).create(valid)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('sellerId 取登录主体，忽略请求体里的同名字段', async () => {
    await makeService(repo).create({ ...valid, sellerId: 'attacker' }, SELLER);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId: SELLER, title: '九成新台灯' }),
    );
  });

  it('标题去空白；空标题 / 超 60 字 → ValidationError', async () => {
    const service = makeService(repo);

    await expect(service.create({ ...valid, title: '   ' }, SELLER)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      service.create({ ...valid, title: '长'.repeat(61) }, SELLER),
    ).rejects.toBeInstanceOf(ValidationError);

    await service.create({ ...valid, title: '  九成新台灯  ' }, SELLER);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ title: '九成新台灯' }));
  });

  it('价格必须是「分」的整数：小数 / 负数 / 超上限 / 非数字都拒绝，0 允许', async () => {
    const service = makeService(repo);

    for (const priceFen of [12.8, -1, FLEA_MAX_PRICE_FEN + 1, Number.NaN]) {
      await expect(service.create({ ...valid, priceFen }, SELLER)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }

    // 免费赠送是合法场景
    await service.create({ ...valid, priceFen: 0 }, SELLER);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ priceFen: 0 }));
  });

  it('成色缺省为 good，非法成色拒绝', async () => {
    const service = makeService(repo);

    await service.create(valid, SELLER);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ condition: 'good' }));

    await expect(service.create({ ...valid, condition: 'mint' }, SELLER)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('描述与交易地点：未提供 / 空串 → null，超长 → ValidationError', async () => {
    const service = makeService(repo);

    await service.create({ ...valid, description: '   ', campusSpot: undefined }, SELLER);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: null, campusSpot: null }),
    );

    await expect(
      service.create({ ...valid, description: 'x'.repeat(2001) }, SELLER),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.create({ ...valid, campusSpot: 'y'.repeat(61) }, SELLER),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('详情', () => {
  it('不存在 → NotFoundError（含可读文案）', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);

    await expect(makeService(repo).detail('ghost')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('修改', () => {
  it('未登录 / 非发布者 → 拒绝', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await expect(service.update('item-1', { title: 'x' })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(service.update('item-1', { title: 'x' }, BUYER)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('已售出的商品不能再改 → ConflictError', async () => {
    const repo = makeRepo({ status: 'sold' });

    await expect(makeService(repo).update('item-1', { title: 'x' }, SELLER)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('只把**显式提供**的字段写进 patch（未提供的字段不被清空）', async () => {
    const repo = makeRepo();

    await makeService(repo).update('item-1', { priceFen: 9_900 }, SELLER);

    expect(repo.update).toHaveBeenCalledWith('item-1', { priceFen: 9_900 });
  });

  it('改价同样走整数分校验', async () => {
    const repo = makeRepo();

    await expect(
      makeService(repo).update('item-1', { priceFen: 1.5 }, SELLER),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('显式传 null 描述会被归一化成 null（允许清空描述）', async () => {
    const repo = makeRepo();

    await makeService(repo).update('item-1', { description: null }, SELLER);

    expect(repo.update).toHaveBeenCalledWith('item-1', { description: null });
  });
});

describe('删除', () => {
  it('非发布者 / 未登录 → 拒绝，且不调用仓储', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await expect(service.remove('item-1', BUYER)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.remove('item-1')).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('发布者本人可以删除', async () => {
    const repo = makeRepo();

    await makeService(repo).remove('item-1', SELLER);

    expect(repo.remove).toHaveBeenCalledWith('item-1');
  });
});

describe('预定（买家「我想要」）', () => {
  it('未登录 → UnauthenticatedError；不能预定自己的商品 → ValidationError', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await expect(service.reserve('item-1')).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(service.reserve('item-1', SELLER)).rejects.toBeInstanceOf(ValidationError);
    expect(repo.applyState).not.toHaveBeenCalled();
  });

  it('已被预定 / 已售出 → ConflictError，且两种情况文案不同', async () => {
    const reserved = makeRepo({ status: 'reserved', reservedById: 'other' });
    await expect(makeService(reserved).reserve('item-1', BUYER)).rejects.toThrow('该商品已被预定');

    const sold = makeRepo({ status: 'sold' });
    await expect(makeService(sold).reserve('item-1', BUYER)).rejects.toThrow('该商品已售出');
  });

  it('在售时预定：状态转 reserved 并把预定者写成登录主体', async () => {
    const repo = makeRepo();

    const result = await makeService(repo).reserve('item-1', BUYER);

    expect(repo.applyState).toHaveBeenCalledWith('item-1', {
      status: 'reserved',
      reservedById: BUYER,
    });
    expect(result.status).toBe('reserved');
  });
});

describe('解除预定（卖家）', () => {
  it('只有卖家可以调用', async () => {
    const repo = makeRepo({ status: 'reserved', reservedById: BUYER });

    await expect(makeService(repo).release('item-1', BUYER)).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.applyState).not.toHaveBeenCalled();
  });

  it('当前不是「已预定」状态 → ConflictError', async () => {
    const repo = makeRepo();

    await expect(makeService(repo).release('item-1', SELLER)).rejects.toBeInstanceOf(ConflictError);
  });

  it('成功后回到在售并清空预定者', async () => {
    const repo = makeRepo({ status: 'reserved', reservedById: BUYER });

    await makeService(repo).release('item-1', SELLER);

    expect(repo.applyState).toHaveBeenCalledWith('item-1', {
      status: 'on-sale',
      reservedById: null,
    });
  });
});

describe('标记售出（卖家，终态）', () => {
  it('只有卖家可以调用', async () => {
    const repo = makeRepo();

    await expect(makeService(repo).markSold('item-1', BUYER)).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.applyState).not.toHaveBeenCalled();
  });

  it('重复标记 → ConflictError', async () => {
    const repo = makeRepo({ status: 'sold' });

    await expect(makeService(repo).markSold('item-1', SELLER)).rejects.toBeInstanceOf(ConflictError);
  });

  it('从在售或已预定都能售出，并写入 soldAt', async () => {
    const repo = makeRepo({ status: 'reserved', reservedById: BUYER });

    await makeService(repo).markSold('item-1', SELLER);

    const patch = repo.applyState.mock.calls[0]?.[1] as { status: string; soldAt: Date };
    expect(patch.status).toBe('sold');
    expect(patch.soldAt).toBeInstanceOf(Date);
  });
});
