import { describe, expect, it } from 'vitest';

import {
  canTransition,
  countByStatus,
  discountFen,
  discountPercent,
  formatFen,
  isJoinable,
  progressPercent,
  remainingSlots,
  sortByDeadline,
  statusAfterJoin,
  totalFen,
  transitionStatus,
  validateGroupBuyItem,
  type GroupBuyItem,
} from './groupbuy';

const NOW = new Date('2026-10-16T10:00:00.000Z');

function makeItem(overrides: Partial<GroupBuyItem> = {}): GroupBuyItem {
  return {
    id: 'gb-test',
    title: '测试拼单',
    merchant: '测试商家',
    category: 'food',
    status: 'recruiting',
    targetCount: 10,
    joinedCount: 4,
    priceFen: 1200,
    originalPriceFen: 2000,
    initiator: { id: 'u_1', nickname: '鸭鸭' },
    pickupSpot: '三食堂门口',
    deadlineAt: '2026-10-16T12:00:00.000Z',
    createdAt: '2026-10-16T06:00:00.000Z',
    ...overrides,
  };
}

describe('拼单名额与进度', () => {
  it('remainingSlots 返回剩余名额且不为负', () => {
    expect(remainingSlots(makeItem())).toBe(6);
    expect(remainingSlots(makeItem({ joinedCount: 12 }))).toBe(0);
  });

  it('progressPercent 是 0–100 的整数并做钳制', () => {
    expect(progressPercent(makeItem())).toBe(40);
    expect(progressPercent(makeItem({ joinedCount: 10 }))).toBe(100);
    expect(progressPercent(makeItem({ joinedCount: 99 }))).toBe(100);
    expect(progressPercent(makeItem({ targetCount: 0 }))).toBe(0);
  });
});

describe('参团资格（isJoinable）', () => {
  it('拼单中 + 有名额 + 未过截止 → 可参团', () => {
    expect(isJoinable(makeItem(), NOW)).toBe(true);
  });

  it('已过截止时间 → 不可参团', () => {
    expect(isJoinable(makeItem({ deadlineAt: '2026-10-16T09:00:00.000Z' }), NOW)).toBe(false);
  });

  it('非拼单中状态 → 不可参团', () => {
    expect(isJoinable(makeItem({ status: 'locked' }), NOW)).toBe(false);
    expect(isJoinable(makeItem({ status: 'completed' }), NOW)).toBe(false);
  });

  it('名额已满 → 不可参团', () => {
    expect(isJoinable(makeItem({ joinedCount: 10 }), NOW)).toBe(false);
  });

  it('非法截止时间 → 不可参团（不抛异常）', () => {
    expect(isJoinable(makeItem({ deadlineAt: 'not-a-date' }), NOW)).toBe(false);
  });
});

describe('状态机', () => {
  it('允许的迁移', () => {
    expect(canTransition('recruiting', 'locked')).toBe(true);
    expect(canTransition('recruiting', 'cancelled')).toBe(true);
    expect(canTransition('locked', 'completed')).toBe(true);
  });

  it('禁止的迁移', () => {
    expect(canTransition('completed', 'recruiting')).toBe(false);
    expect(canTransition('cancelled', 'locked')).toBe(false);
    expect(canTransition('recruiting', 'completed')).toBe(false);
  });

  it('transitionStatus 合法时返回新对象（不可变），非法时返回 null', () => {
    const item = makeItem();
    const locked = transitionStatus(item, 'locked');
    expect(locked?.status).toBe('locked');
    expect(item.status).toBe('recruiting');
    expect(transitionStatus(item, 'completed')).toBeNull();
  });

  it('statusAfterJoin：够人数自动成团', () => {
    expect(statusAfterJoin(makeItem())).toBe('recruiting');
    expect(statusAfterJoin(makeItem({ joinedCount: 9 }))).toBe('locked');
    expect(statusAfterJoin(makeItem({ status: 'cancelled' }))).toBe('cancelled');
  });
});

describe('金额（整数分）', () => {
  it('discountFen / discountPercent', () => {
    expect(discountFen(makeItem())).toBe(800);
    expect(discountPercent(makeItem())).toBe(40);
    expect(discountFen(makeItem({ priceFen: 2500 }))).toBe(0);
    expect(discountPercent(makeItem({ originalPriceFen: 0 }))).toBe(0);
  });

  it('formatFen 用 @kedaya/shared 的分转元', () => {
    expect(formatFen(1200)).toBe('¥12.00');
    expect(formatFen(12345)).toBe('¥123.45');
    expect(formatFen(5)).toBe('¥0.05');
  });

  it('totalFen 忽略非法份数', () => {
    expect(totalFen(1200, 3)).toBe(3600);
    expect(totalFen(1200, 0)).toBe(0);
    expect(totalFen(1200, -2)).toBe(0);
  });
});

describe('排序、计数与领域校验', () => {
  it('sortByDeadline 按截止时间升序，非法时间排最后', () => {
    const a = makeItem({ id: 'a', deadlineAt: '2026-10-16T12:00:00.000Z' });
    const b = makeItem({ id: 'b', deadlineAt: '2026-10-16T11:00:00.000Z' });
    const c = makeItem({ id: 'c', deadlineAt: 'bad' });
    expect(sortByDeadline([a, b, c]).map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('countByStatus 统计各状态', () => {
    const counts = countByStatus([
      makeItem({ status: 'recruiting' }),
      makeItem({ status: 'recruiting' }),
      makeItem({ status: 'locked' }),
    ]);
    expect(counts.recruiting).toBe(2);
    expect(counts.locked).toBe(1);
    expect(counts.completed).toBe(0);
  });

  it('validateGroupBuyItem 接受合法数据', () => {
    expect(validateGroupBuyItem(makeItem())).toEqual([]);
  });

  it('validateGroupBuyItem 抓出非法金额与人数', () => {
    const problems = validateGroupBuyItem(
      makeItem({ priceFen: -1, targetCount: 0, joinedCount: 3, deadlineAt: 'bad' }),
    );
    expect(problems).toContain('priceFen 必须是非负整数分');
    expect(problems).toContain('targetCount 必须为正整数');
    expect(problems).toContain('deadlineAt 非法');
  });

  it('validateGroupBuyItem 抓出 joinedCount 超过 targetCount', () => {
    expect(validateGroupBuyItem(makeItem({ targetCount: 2, joinedCount: 5 }))).toContain(
      'joinedCount 不能超过 targetCount',
    );
  });
});
