import { describe, expect, it } from 'vitest';

import type { ApiError, Page } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import type { GroupBuyDetail, GroupBuyItem } from '@/domain/models/groupbuy';
import type { GroupBuyRepository } from '@/domain/ports/groupbuy';

import { loadGroupBuyDetail, joinGroupBuy, toGroupBuyDetailVM } from './getGroupBuyDetail';
import { loadGroupBuyList, toGroupBuyItemVM, toGroupBuyListVM } from './listGroupBuys';

const NOW = new Date('2026-10-16T10:00:00.000Z');

function makeItem(overrides: Partial<GroupBuyItem> = {}): GroupBuyItem {
  return {
    id: 'gb-1',
    title: '三食堂麻辣烫拼单',
    merchant: '三食堂',
    category: 'food',
    status: 'recruiting',
    targetCount: 10,
    joinedCount: 8,
    priceFen: 1680,
    originalPriceFen: 2100,
    initiator: { id: 'u_1', nickname: '鸭鸭先冲' },
    pickupSpot: '三食堂门口',
    deadlineAt: '2026-10-16T13:00:00.000Z',
    createdAt: '2026-10-16T05:00:00.000Z',
    note: '差 2 份',
    ...overrides,
  };
}

function makeDetail(overrides: Partial<GroupBuyDetail> = {}): GroupBuyDetail {
  return {
    ...makeItem(),
    rules: ['满 10 份成团'],
    participants: [
      {
        id: 'p-1',
        nickname: '鸭鸭先冲',
        quantity: 1,
        paidFen: 1680,
        joinedAt: '2026-10-16T05:00:00.000Z',
        anonymous: false,
      },
      {
        id: 'p-2',
        nickname: '匿名同学',
        quantity: 2,
        paidFen: 3360,
        joinedAt: '2026-10-16T07:00:00.000Z',
        anonymous: true,
      },
    ],
    ...overrides,
  };
}

function fakeRepository(overrides: Partial<GroupBuyRepository> = {}): GroupBuyRepository {
  return {
    list: async (): Promise<Result<Page<GroupBuyItem>, ApiError>> =>
      ok({ items: [], nextCursor: null, total: 0 }),
    detail: async (): Promise<Result<GroupBuyDetail, ApiError>> =>
      err({ code: 'NOT_FOUND', message: '不存在' }),
    join: async (): Promise<Result<GroupBuyDetail, ApiError>> =>
      err({ code: 'NOT_FOUND', message: '不存在' }),
    ...overrides,
  };
}

describe('toGroupBuyItemVM —— 展示层文案（金额分转元 / 时间本地化）', () => {
  it('金额、折扣、进度、名额、截止时间都被正确本地化', () => {
    const vm = toGroupBuyItemVM(makeItem(), NOW);
    expect(vm.priceLabel).toBe('¥16.80');
    expect(vm.originalPriceLabel).toBe('¥21.00');
    expect(vm.discountLabel).toBe('省 ¥4.20（20%）');
    expect(vm.progress).toBe(80);
    expect(vm.remainingSlots).toBe(2);
    expect(vm.joinedLabel).toBe('8/10 人');
    expect(vm.deadlineLabel).toBe('还有 3 小时');
    expect(vm.statusLabel).toBe('拼单中');
    expect(vm.categoryLabel).toBe('正餐');
    expect(vm.joinable).toBe(true);
  });

  it('无折扣 / 不可参团的情形', () => {
    const vm = toGroupBuyItemVM(
      makeItem({ priceFen: 2100, status: 'locked', joinedCount: 10 }),
      NOW,
    );
    expect(vm.discountLabel).toBe('无折扣');
    expect(vm.joinable).toBe(false);
    expect(vm.remainingSlots).toBe(0);
  });
});

describe('toGroupBuyListVM', () => {
  it('空列表时 isEmpty=true 且 joinableCount=0', () => {
    const vm = toGroupBuyListVM([], null, 0, NOW);
    expect(vm.isEmpty).toBe(true);
    expect(vm.items).toEqual([]);
    expect(vm.joinableCount).toBe(0);
  });

  it('统计可参团条目并保留游标', () => {
    const vm = toGroupBuyListVM(
      [makeItem(), makeItem({ id: 'gb-2', status: 'completed' })],
      'c_4',
      6,
      NOW,
    );
    expect(vm.isEmpty).toBe(false);
    expect(vm.nextCursor).toBe('c_4');
    expect(vm.total).toBe(6);
    expect(vm.joinableCount).toBe(1);
  });
});

describe('loadGroupBuyList（用例编排）', () => {
  it('把端口结果转成视图模型', async () => {
    const repository = fakeRepository({
      list: async (query) => {
        expect(query.limit).toBe(4);
        return ok({ items: [makeItem()], nextCursor: 'c_1', total: 9 });
      },
    });

    const result = await loadGroupBuyList(repository, { limit: 4 }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(1);
      expect(result.value.total).toBe(9);
      expect(result.value.nextCursor).toBe('c_1');
    }
  });

  it('端口错误原样向上传递（不吞错、不改码）', async () => {
    const repository = fakeRepository({
      list: async () => err({ code: 'UPSTREAM_UNAVAILABLE', message: '拼单服务不可用' }),
    });

    const result = await loadGroupBuyList(repository, {}, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(result.error.message).toBe('拼单服务不可用');
    }
  });
});

describe('详情用例', () => {
  it('toGroupBuyDetailVM 汇总参与者与已收款（整数分相加）', () => {
    const vm = toGroupBuyDetailVM(makeDetail(), NOW);
    expect(vm.participantCount).toBe(2);
    expect(vm.paidTotalLabel).toBe('¥50.40');
    expect(vm.participants[1]?.nickname).toBe('匿名同学');
    expect(vm.participants[1]?.anonymous).toBe(true);
    expect(vm.rules).toEqual(['满 10 份成团']);
  });

  it('loadGroupBuyDetail 传递 NOT_FOUND', async () => {
    const repository = fakeRepository();
    const result = await loadGroupBuyDetail(repository, 'gb-404', NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('joinGroupBuy 成功时返回最新视图模型', async () => {
    const repository = fakeRepository({
      join: async (id, quantity) => {
        expect(id).toBe('gb-1');
        expect(quantity).toBe(2);
        return ok(makeDetail({ joinedCount: 10, status: 'locked' }));
      },
    });

    const result = await joinGroupBuy(repository, 'gb-1', 2, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.statusLabel).toBe('已成团');
      expect(result.value.joinable).toBe(false);
    }
  });

  it('joinGroupBuy 传递 CONFLICT（名额已满）', async () => {
    const repository = fakeRepository({
      join: async () => err({ code: 'CONFLICT', message: '名额已满' }),
    });
    const result = await joinGroupBuy(repository, 'gb-1', 1, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CONFLICT');
  });
});
