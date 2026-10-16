import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import { GroupbuyOrderService } from './groupbuy.service';
import type { GroupbuyOrderModel, GroupbuyOrderRepository } from './domain/groupbuy.domain';

/**
 * groupbuy 的核心用例测试：**参团 → 成团状态推进**。
 *
 * 用假的 repository（不碰数据库），只验证用例编排与领域规则。
 * 注意：服务用显式 token 注入，因此可以直接 `new GroupbuyOrderService(fake)`，
 * 不需要 Nest 的 DI 容器，也不需要 emitDecoratorMetadata。
 */

const BASE_ORDER: GroupbuyOrderModel = {
  id: 'order-1',
  ownerId: 'user-owner',
  title: '奶茶拼单',
  description: null,
  category: 'drink',
  targetCount: 3,
  unitPriceFen: 1500,
  status: 'open',
  deadline: new Date('2026-11-01T00:00:00.000Z'),
  pickupSpot: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

interface FakeRepo {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  join: ReturnType<typeof vi.fn>;
  memberCount: ReturnType<typeof vi.fn>;
}

function makeRepo(): FakeRepo {
  return {
    list: vi.fn(),
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(BASE_ORDER),
    update: vi.fn().mockImplementation((_id: string, data: unknown) => ({ ...BASE_ORDER, ...(data as object) })),
    remove: vi.fn(),
    join: vi.fn().mockResolvedValue({ memberId: 'member-1', quantity: 1 }),
    memberCount: vi.fn().mockResolvedValue(1),
  };
}

function makeService(repo: FakeRepo): GroupbuyOrderService {
  return new GroupbuyOrderService(repo as unknown as GroupbuyOrderRepository);
}

describe('GroupbuyOrderService（拼单领域用例）', () => {
  let repo: FakeRepo;
  let service: GroupbuyOrderService;

  beforeEach(() => {
    repo = makeRepo();
    service = makeService(repo);
  });

  describe('join（契约 §6.1 的 POST /items/:id/join）', () => {
    it('未达目标人数时保持 open，不写状态', async () => {
      repo.memberCount.mockResolvedValue(2); // targetCount = 3

      const result = await service.join('order-1', 'user-A', 1);

      expect(result).toMatchObject({
        orderId: 'order-1',
        memberId: 'member-1',
        totalMembers: 2,
        targetCount: 3,
        status: 'open',
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('达到目标人数时把状态推进为 grouped', async () => {
      repo.memberCount.mockResolvedValue(3); // == targetCount

      const result = await service.join('order-1', 'user-A', 1);

      expect(result.status).toBe('grouped');
      expect(repo.update).toHaveBeenCalledWith('order-1', { status: 'grouped' });
    });

    it('超过目标人数同样成团', async () => {
      repo.memberCount.mockResolvedValue(5);
      expect((await service.join('order-1', 'user-A', 1)).status).toBe('grouped');
    });

    it('已结束的拼单抛 CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...BASE_ORDER, status: 'grouped' });

      await expect(service.join('order-1', 'user-A', 1)).rejects.toThrow(ConflictError);
      // 冲突时不应写入参团记录
      expect(repo.join).not.toHaveBeenCalled();
    });

    it('订单不存在时抛 NOT_FOUND', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.join('missing', 'user-A', 1)).rejects.toThrow(NotFoundError);
    });

    it('把 quantity 原样传给仓储', async () => {
      await service.join('order-1', 'user-A', 4);
      expect(repo.join).toHaveBeenCalledWith('order-1', 'user-A', 4);
    });
  });

  describe('create（归属字段补全）', () => {
    const draft = {
      title: '咖啡拼单',
      category: 'drink',
      targetCount: 2,
      unitPriceFen: 2000,
      deadline: new Date('2026-12-01T00:00:00.000Z'),
    };

    it('未提供 ownerId 时用请求主体补全', async () => {
      repo.create.mockResolvedValue({ ...BASE_ORDER, ownerId: 'user-A' });

      await service.create({ ...draft }, 'user-A');

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'user-A' }));
    });

    it('显式提供的 ownerId 优先于请求主体', async () => {
      repo.create.mockResolvedValue(BASE_ORDER);

      await service.create({ ...draft, ownerId: 'user-B' }, 'user-A');

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'user-B' }));
    });

    it('既未登录也未提供 ownerId 时抛 VALIDATION_FAILED', async () => {
      await expect(service.create({ ...draft })).rejects.toThrow(ValidationError);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });
});
