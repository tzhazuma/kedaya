import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../common/errors/app-error';
import { GroupbuyOrderService } from './groupbuy.service';
import type { GroupbuyOrderModel, GroupbuyOrderRepository } from './domain/groupbuy.domain';

const BASE_ORDER: GroupbuyOrderModel = {
  id: 'order-1', ownerId: 'user-owner', title: '奶茶拼单', description: null,
  category: 'drink', itemSpec: '拿铁/份', itemOptions: ['拿铁/份'], targetCount: 3, unitPriceFen: 1500,
  status: 'open', deadline: new Date(Date.now() + 86_400_000), pickupSpot: '三号楼',
  kind: 'ordinary', merchantName: null, membershipDeclaration: false, cancelReason: null, pickupNotice: null,
  createdAt: new Date(), updatedAt: new Date(), members: [], joinedQuantity: 0, participantCount: 0,
};

function makeService() {
  const repo = {
    list: vi.fn().mockResolvedValue({ items: [BASE_ORDER], nextCursor: null }),
    create: vi.fn().mockResolvedValue(BASE_ORDER),
    findById: vi.fn().mockResolvedValue(BASE_ORDER),
    updateOwned: vi.fn().mockResolvedValue(BASE_ORDER),
    cancelOwned: vi.fn().mockResolvedValue({ ...BASE_ORDER, status: 'cancelled' }),
    changeMember: vi.fn().mockResolvedValue(BASE_ORDER),
    expireDue: vi.fn().mockResolvedValue(0),
  };
  return { repo, service: new GroupbuyOrderService(repo as unknown as GroupbuyOrderRepository) };
}

describe('GroupbuyOrderService', () => {
  it('发起人由登录身份决定，截止时间固定为 24 小时', async () => {
    const { repo, service } = makeService();
    const before = Date.now();
    await service.create({ title: '纸巾', category: 'daily', targetCount: 4, pickupSpot: '宿舍楼', kind: 'ordinary' }, 'user-A');
    const input = repo.create.mock.calls[0]?.[0] as { ownerId: string; deadline: Date };
    expect(input.ownerId).toBe('user-A');
    expect(input.deadline.getTime()).toBeGreaterThanOrEqual(before + 86_400_000);
  });

  it('会员代购必须确认持卡并填写商家', async () => {
    const { service } = makeService();
    await expect(service.create({ title: '纸巾', category: 'daily', targetCount: 4, pickupSpot: '宿舍楼', kind: 'membership' }, 'user-A'))
      .rejects.toThrow(ValidationError);
  });

  it('登记份数原样交给原子仓储处理', async () => {
    const { repo, service } = makeService();
    await service.join('order-1', 'user-A', { quantity: 2, displayName: '小王' });
    expect(repo.changeMember).toHaveBeenCalledWith('order-1', 'user-A', { quantity: 2, displayName: '小王' });
  });
});
