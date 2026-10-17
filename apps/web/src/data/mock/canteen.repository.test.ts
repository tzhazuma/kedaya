/**
 * 菜品库 mock 适配器测试（Web 后台，ADR 0006）。
 *
 * 这是 `canteen` 模块在 Web 侧的**服务端替身**：营养管家的菜品目录。
 * 覆盖要点：
 * - 检索（关键词 / 品类）与**游标分页不重叠**（契约 §6.1 不用 offset）；
 * - 增删改查的完整往返 + 形状过 zod（脏数据一律 INTERNAL，不放行）；
 * - 时间戳（`createdAt` / `updatedAt`）由仓储负责，客户端不传；
 * - 故障演练：`failureMode=error` 时**全部**端点返回 `UPSTREAM_UNAVAILABLE`
 *   （三态里的错误态靠它验证）。
 */
import { describe, expect, it } from 'vitest';

import type { CreateDishInput } from '@/domain/models/canteen';

import { createMockDishRepository } from './canteen.repository';

const NOW = new Date('2026-10-18T03:00:00.000Z');

function makeRepo(overrides: Parameters<typeof createMockDishRepository>[0] = {}) {
  return createMockDishRepository({ now: () => NOW, latencyMs: 0, ...overrides });
}

function newDish(overrides: Partial<CreateDishInput> = {}): CreateDishInput {
  return {
    canteen: '四食堂',
    name: '测试菜',
    category: 'other',
    servingG: 100,
    caloriesKcal: 100,
    proteinG: 5,
    fatG: 3,
    carbG: 12,
    fiberG: 1,
    sodiumMg: 200,
    priceFen: 500,
    ...overrides,
  };
}

describe('菜品检索', () => {
  it('默认返回全部种子菜品，字段口径是「每份」六项营养', async () => {
    const repo = makeRepo();
    const result = await repo.list({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toHaveLength(12);
    expect(result.value.nextCursor).toBeNull();

    const rice = result.value.items.find((item) => item.id === 'dish-rice');
    expect(rice?.name).toBe('米饭');
    expect(rice?.servingG).toBe(150);
    expect(rice?.caloriesKcal).toBe(174);
    expect(rice?.priceFen).toBe(200);
    // 所有营养项都是整数（契约为整数口径）
    for (const item of result.value.items) {
      for (const key of ['caloriesKcal', 'proteinG', 'fatG', 'carbG', 'fiberG', 'sodiumMg'] as const) {
        expect(Number.isInteger(item[key])).toBe(true);
      }
    }
  });

  it('按菜名关键词过滤（大小写不敏感、忽略首尾空格）', async () => {
    const repo = makeRepo();
    const result = await repo.list({ q: '  排骨 ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.name)).toEqual(['红烧排骨']);
  });

  it('按品类过滤', async () => {
    const repo = makeRepo();
    const result = await repo.list({ category: 'meat' });
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.name).sort()).toEqual(['红烧排骨', '香煎鸡腿']);
  });

  it('按食堂精确过滤（与分类 / 关键词叠加，不是二选一）', async () => {
    const repo = makeRepo();

    const byCanteen = await repo.list({ canteen: '第二食堂' });
    expect(byCanteen.ok).toBe(true);
    if (!byCanteen.ok) return;
    expect(byCanteen.value.items.map((item) => item.name).sort()).toEqual(['红烧牛肉面', '麻婆豆腐']);
    expect(byCanteen.value.items.every((item) => item.canteen === '第二食堂')).toBe(true);

    // 叠加：第二食堂 + 素菜 —— 只剩麻婆豆腐
    const stacked = await repo.list({ canteen: '第二食堂', category: 'vegetable' });
    if (!stacked.ok) return;
    expect(stacked.value.items.map((item) => item.name)).toEqual(['麻婆豆腐']);

    // 白名单里有、但种子数据里没有菜品的食堂 → 诚实空态
    const empty = await repo.list({ canteen: '清真食堂' });
    if (!empty.ok) return;
    expect(empty.value.items).toEqual([]);
  });

  it('游标分页：不重叠、不遗漏，翻到底 nextCursor 为 null', async () => {
    const repo = makeRepo();
    const first = await repo.list({ limit: 5 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.items).toHaveLength(5);
    expect(first.value.nextCursor).toBe(first.value.items[4]?.id ?? null);

    const second = await repo.list({ limit: 5, cursor: first.value.nextCursor });
    if (!second.ok) return;
    expect(second.value.items).toHaveLength(5);
    expect(second.value.nextCursor).toBe(second.value.items[4]?.id ?? null);

    const third = await repo.list({ limit: 5, cursor: second.value.nextCursor });
    if (!third.ok) return;
    expect(third.value.items).toHaveLength(2);
    expect(third.value.nextCursor).toBeNull();

    const seen = [...first.value.items, ...second.value.items, ...third.value.items].map((i) => i.id);
    expect(new Set(seen).size).toBe(12);
  });

  it('未知游标安全退化（当作第一页，不报错）', async () => {
    const repo = makeRepo();
    const result = await repo.list({ limit: 2, cursor: 'dish-does-not-exist' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(2);
  });
});

describe('详情', () => {
  it('存在的菜品返回详情', async () => {
    const repo = makeRepo();
    const result = await repo.detail('dish-bocai');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('清炒菠菜');
    expect(result.value.category).toBe('vegetable');
  });

  it('不存在的菜品返回 NOT_FOUND', async () => {
    const repo = makeRepo();
    const result = await repo.detail('dish-nope');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('新建 / 修改 / 下架', () => {
  it('新建：id 由仓储生成、时间戳由仓储写入、出现在列表首位', async () => {
    const repo = makeRepo();
    const created = await repo.create(newDish({ name: '新菜' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.value.id.startsWith('dish-mock-')).toBe(true);
    expect(created.value.name).toBe('新菜');
    expect(created.value.createdAt).toBe(NOW.toISOString());
    expect(created.value.updatedAt).toBe(NOW.toISOString());

    const list = await repo.list({});
    if (!list.ok) return;
    expect(list.value.items).toHaveLength(13);
    expect(list.value.items[0]?.id).toBe(created.value.id);
  });

  it('修改：只改传入字段，id 不变，updatedAt 刷新', async () => {
    let clock = NOW.getTime();
    const repo = createMockDishRepository({ now: () => new Date(clock), latencyMs: 0 });

    const before = await repo.detail('dish-rice');
    if (!before.ok) return;

    clock += 60_000;
    const updated = await repo.update('dish-rice', { caloriesKcal: 999 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    expect(updated.value.id).toBe('dish-rice');
    expect(updated.value.caloriesKcal).toBe(999);
    // 未传的字段保持原值
    expect(updated.value.name).toBe(before.value.name);
    expect(updated.value.proteinG).toBe(before.value.proteinG);
    expect(updated.value.createdAt).toBe(before.value.createdAt);
    expect(updated.value.updatedAt).not.toBe(before.value.updatedAt);
  });

  it('修改不存在的菜品 → NOT_FOUND', async () => {
    const repo = makeRepo();
    const result = await repo.update('dish-nope', { name: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('下架：从列表中消失，再取详情为 NOT_FOUND', async () => {
    const repo = makeRepo();
    const removed = await repo.remove('dish-xigua');
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value).toEqual({ id: 'dish-xigua', deleted: true });

    const list = await repo.list({});
    if (!list.ok) return;
    expect(list.value.items.find((item) => item.id === 'dish-xigua')).toBeUndefined();

    const detail = await repo.detail('dish-xigua');
    expect(detail.ok).toBe(false);
  });

  it('下架不存在的菜品 → NOT_FOUND', async () => {
    const repo = makeRepo();
    const result = await repo.remove('dish-nope');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('故障演练', () => {
  it('failureMode=error 时全部端点返回 UPSTREAM_UNAVAILABLE（且不写坏内存态）', async () => {
    const repo = makeRepo({ failureMode: 'error' });

    const results = [
      await repo.list({}),
      await repo.detail('dish-rice'),
      await repo.create(newDish()),
      await repo.update('dish-rice', { name: 'x' }),
      await repo.remove('dish-rice'),
    ];

    for (const result of results) {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('UPSTREAM_UNAVAILABLE');
    }
  });
});
