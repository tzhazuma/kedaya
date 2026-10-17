import { describe, expect, it } from 'vitest';

import {
  clampLimit,
  createMockGroupBuyRepository,
  decodeCursor,
  encodeCursor,
  filterGroupBuyItems,
} from './groupbuy.repository';
import { createGroupBuySeed, toGroupBuyItem } from './fixtures/groupbuy';

const NOW = new Date('2026-10-16T10:00:00.000Z');

function repo() {
  return createMockGroupBuyRepository({ now: () => NOW, latencyMs: 0 });
}

describe('游标工具', () => {
  it('encode/decode 往返，非法游标退化为 0', () => {
    expect(decodeCursor(encodeCursor(4))).toBe(4);
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor('garbage')).toBe(0);
    expect(decodeCursor('c_-3')).toBe(0);
  });

  it('clampLimit 限制在 1..100', () => {
    expect(clampLimit(undefined, 20)).toBe(20);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(500)).toBe(100);
    expect(clampLimit(4)).toBe(4);
  });
});

describe('mock 数据集（无后端可跑）', () => {
  it('种子数据覆盖 4 种状态，且都能通过领域校验', () => {
    const seed = createGroupBuySeed(NOW);
    expect(seed.length).toBeGreaterThanOrEqual(6);
    const statuses = new Set(seed.map((item) => item.status));
    expect(statuses).toEqual(new Set(['recruiting', 'locked', 'completed', 'cancelled']));
    for (const detail of seed) {
      expect(detail.rules.length).toBeGreaterThan(0);
      expect(detail.deadlineAt.endsWith('Z')).toBe(true);
    }
  });

  it('toGroupBuyItem 去掉参与者与规则', () => {
    const detail = createGroupBuySeed(NOW)[0]!;
    const item = toGroupBuyItem(detail);
    expect('participants' in item).toBe(false);
    expect('rules' in item).toBe(false);
    expect(item.id).toBe(detail.id);
  });

  it('filterGroupBuyItems 支持状态与关键词', () => {
    const items = createGroupBuySeed(NOW).map(toGroupBuyItem);
    expect(filterGroupBuyItems(items, { status: 'recruiting' })).toHaveLength(3);
    expect(filterGroupBuyItems(items, { keyword: '奶茶' })).toHaveLength(1);
    expect(filterGroupBuyItems(items, { keyword: '不存在的关键词' })).toHaveLength(0);
  });
});

describe('mock 拼单仓储（契约形状）', () => {
  it('list 使用游标分页', async () => {
    const repository = repo();
    const first = await repository.list({ limit: 4 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.value.items).toHaveLength(4);
    expect(first.value.nextCursor).toBe('c_4');
    expect(first.value.total).toBe(6);

    const second = await repository.list({ limit: 4, cursor: first.value.nextCursor ?? undefined });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.items).toHaveLength(2);
    expect(second.value.nextCursor).toBeNull();

    // 两页不重叠
    const firstIds = first.value.items.map((item) => item.id);
    const secondIds = second.value.items.map((item) => item.id);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });

  it('list 支持状态过滤', async () => {
    const repository = repo();
    const result = await repository.list({ status: 'recruiting' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(3);
    expect(result.value.items.every((item) => item.status === 'recruiting')).toBe(true);
  });

  it('detail 命中与 NOT_FOUND', async () => {
    const repository = repo();
    const hit = await repository.detail('gb-1001');
    expect(hit.ok).toBe(true);
    if (hit.ok) {
      expect(hit.value.participants.length).toBeGreaterThan(0);
      expect(hit.value.rules.length).toBeGreaterThan(0);
    }

    const miss = await repository.detail('gb-9999');
    expect(miss.ok).toBe(false);
    if (!miss.ok) {
      expect(miss.error.code).toBe('NOT_FOUND');
      expect(miss.error.message).toContain('gb-9999');
    }
  });

  it('join 累加人数，满员后自动成团并拒绝继续参团', async () => {
    const repository = repo();
    const first = await repository.join('gb-1002', 1);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.joinedCount).toBe(5);
      expect(first.value.status).toBe('recruiting');
    }

    const second = await repository.join('gb-1002', 1);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.joinedCount).toBe(6);
      expect(second.value.status).toBe('locked');
    }

    const third = await repository.join('gb-1002', 1);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe('CONFLICT');
  });

  it('join 校验份数上界与非法输入', async () => {
    const repository = repo();
    const tooMany = await repository.join('gb-1001', 99);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.error.code).toBe('CONFLICT');
      expect(tooMany.error.message).toContain('最多只能参团');
    }

    const invalid = await repository.join('gb-1001', 0);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('VALIDATION_FAILED');
  });

  it('join 对已取消的拼单返回 CONFLICT', async () => {
    const repository = repo();
    const result = await repository.join('gb-1006', 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CONFLICT');
  });

  it('故障演练模式让所有请求返回 UPSTREAM_UNAVAILABLE（三态之 error）', async () => {
    const repository = repo();
    expect(repository.getFailureMode()).toBe('none');

    repository.setFailureMode('error');
    const list = await repository.list({});
    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.error.code).toBe('UPSTREAM_UNAVAILABLE');

    const detail = await repository.detail('gb-1001');
    expect(detail.ok).toBe(false);

    repository.setFailureMode('none');
    const recovered = await repository.list({});
    expect(recovered.ok).toBe(true);
  });

  it('reset 恢复初始数据集', async () => {
    const repository = repo();
    await repository.join('gb-1002', 1);
    repository.reset();
    const detail = await repository.detail('gb-1002');
    expect(detail.ok).toBe(true);
    if (detail.ok) expect(detail.value.joinedCount).toBe(4);
  });
});
