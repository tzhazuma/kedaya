import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from '../../common/errors/app-error';
import type { NotificationPort, NotifyInput } from '../../common/notifications/notification.port';
import { GroupbuyOrderService } from './groupbuy.service';
import type {
  GroupbuyOrderRepository,
  GroupbuyOrderView,
} from './domain/groupbuy.domain';

/**
 * 拼单的核心用例测试。
 *
 * 用假的 repository（不碰数据库），只验证用例编排与领域规则。
 * 服务用显式 token 注入，因此可以直接 `new GroupbuyOrderService(fake)`，
 * 不需要 Nest 的 DI 容器，也不需要 emitDecoratorMetadata。
 */

const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

const BASE_VIEW: GroupbuyOrderView = {
  id: 'order-1',
  title: '奶茶拼单',
  description: null,
  category: 'drink',
  initiatorId: 'user-owner',
  initiatorName: '发起人',
  priceFen: 1500,
  targetCount: 3,
  participants: [
    { id: 'user-owner', displayName: '发起人', quantity: 1, joinedAt: new Date('2026-10-01T00:00:00.000Z') },
  ],
  deadline: FUTURE,
  pickupPlace: '一号楼',
  status: 'open',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

interface FakeRepo {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  join: ReturnType<typeof vi.fn>;
  listMembers: ReturnType<typeof vi.fn>;
}

function makeRepo(): FakeRepo {
  return {
    list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    create: vi.fn().mockResolvedValue({
      id: 'order-1',
      ownerId: 'user-owner',
      title: '奶茶拼单',
      description: null,
      category: 'drink',
      targetCount: 3,
      unitPriceFen: 1500,
      status: 'open',
      deadline: FUTURE,
      pickupSpot: '一号楼',
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    }),
    findById: vi.fn().mockResolvedValue(BASE_VIEW),
    update: vi.fn().mockResolvedValue(BASE_VIEW),
    setStatus: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    join: vi.fn().mockResolvedValue({ memberId: 'member-1', quantity: 1 }),
    listMembers: vi.fn().mockResolvedValue([{ userId: 'user-owner', role: 'owner' }]),
  };
}

function makeNotifier(): { notify: ReturnType<typeof vi.fn>; port: NotificationPort } {
  const notify = vi.fn().mockResolvedValue(undefined);
  return { notify, port: { notify } as unknown as NotificationPort };
}

function makeService(repo: FakeRepo, notifier?: NotificationPort): GroupbuyOrderService {
  return new GroupbuyOrderService(repo as unknown as GroupbuyOrderRepository, notifier);
}

/** 便捷：构造一个"已参团 N 人"的视图 */
function viewWith(participantIds: readonly string[], status: GroupbuyOrderView['status'] = 'open'): GroupbuyOrderView {
  return {
    ...BASE_VIEW,
    status,
    participants: participantIds.map((id) => ({
      id,
      displayName: `同学 ${id}`,
      quantity: 1,
      joinedAt: new Date('2026-10-02T00:00:00.000Z'),
    })),
  };
}

describe('GroupbuyOrderService（拼单领域用例）', () => {
  let repo: FakeRepo;
  let notifier: ReturnType<typeof makeNotifier>;
  let service: GroupbuyOrderService;

  beforeEach(() => {
    repo = makeRepo();
    notifier = makeNotifier();
    service = makeService(repo, notifier.port);
  });

  describe('join（契约 §6.1 的 POST /items/:id/join）', () => {
    it('未达目标人数时保持 open，不写状态', async () => {
      repo.findById
        .mockResolvedValueOnce(viewWith(['user-owner'], 'open')) // 校验：1/3
        .mockResolvedValueOnce(viewWith(['user-owner', 'user-B'], 'open')); // 回读：2/3

      const result = await service.join('order-1', 'user-B', 1);

      expect(result.id).toBe('order-1');
      expect(repo.setStatus).not.toHaveBeenCalled();
      expect(repo.join).toHaveBeenCalledWith('order-1', 'user-B', 1);
    });

    it('达到目标人数时把内部状态推进为 grouped', async () => {
      repo.findById.mockResolvedValue(viewWith(['user-owner', 'user-A'], 'open')); // 2/3 份

      await service.join('order-1', 'user-B', 1); // → 3/3

      expect(repo.setStatus).toHaveBeenCalledWith('order-1', 'grouped');
    });

    it('已结束的拼单抛 CONFLICT，且不写入参团记录', async () => {
      repo.findById.mockResolvedValue(viewWith(['user-owner', 'user-A', 'user-B'], 'full'));

      await expect(service.join('order-1', 'user-C', 1)).rejects.toThrow(ConflictError);
      expect(repo.join).not.toHaveBeenCalled();
    });

    it('已过截止时间抛 CONFLICT', async () => {
      repo.findById.mockResolvedValue(viewWith(['user-owner'], 'closed'));
      await expect(service.join('order-1', 'user-C', 1)).rejects.toThrow(ConflictError);
    });

    it('不能参团自己发起的拼单', async () => {
      await expect(service.join('order-1', 'user-owner', 1)).rejects.toThrow(ValidationError);
      expect(repo.join).not.toHaveBeenCalled();
    });

    it('重复参团抛 CONFLICT（幂等由仓储 upsert 保证，但先明确告知用户）', async () => {
      repo.findById.mockResolvedValue(viewWith(['user-owner', 'user-A']));
      await expect(service.join('order-1', 'user-A', 1)).rejects.toThrow(ConflictError);
    });

    it('份数超过剩余名额时抛 CONFLICT', async () => {
      repo.findById.mockResolvedValue(viewWith(['user-owner', 'user-A'], 'open')); // 2/3，只剩 1
      await expect(service.join('order-1', 'user-B', 2)).rejects.toThrow(ConflictError);
    });

    it('订单不存在时抛 NOT_FOUND', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.join('missing', 'user-A', 1)).rejects.toThrow(NotFoundError);
    });

    it('把 quantity 原样传给仓储', async () => {
      repo.findById.mockResolvedValue(viewWith(['user-owner']));
      await service.join('order-1', 'user-A', 2);
      expect(repo.join).toHaveBeenCalledWith('order-1', 'user-A', 2);
    });
  });

  describe('join 的站内信（best-effort）', () => {
    it('有人参团时通知发起人，且带上可点开的详情页链接', async () => {
      // 第一次 findById 用于校验，第二次是参团后的回读 —— 假仓储不会自己改数据，
      // 因此显式给出两个快照，模拟"user-A 已参团"。
      repo.findById
        .mockResolvedValueOnce(viewWith(['user-owner']))
        .mockResolvedValueOnce(viewWith(['user-owner', 'user-A']));

      await service.join('order-1', 'user-A', 1);

      const first = (notifier.notify.mock.calls[0]?.[0] as NotifyInput[])[0];
      expect(first?.userId).toBe('user-owner');
      expect(first?.source).toBe('groupbuy');
      expect(first?.link).toContain('/presentation/pages/groupbuy/detail/index');
      expect(first?.link).toContain('order-1');
    });

    it('成团时通知全部参与者（含刚参团的人）', async () => {
      repo.findById
        .mockResolvedValueOnce(viewWith(['user-owner', 'user-A'], 'open')) // 校验时 2/3 份
        .mockResolvedValueOnce(viewWith(['user-owner', 'user-A', 'user-B'], 'full')); // 回读时 3/3

      await service.join('order-1', 'user-B', 1); // → 3/3

      const drafts = notifier.notify.mock.calls[0]?.[0] as NotifyInput[];
      expect(drafts.map((draft) => draft.userId).sort()).toEqual(['user-A', 'user-B', 'user-owner']);
      expect(drafts.every((draft) => draft.title.includes('成团'))).toBe(true);
    });

    it('通知抛错时会向上冒泡（吞异常是 NotificationPort 实现方的责任，见通知模块单测）', async () => {
      repo.findById.mockResolvedValue(viewWith(['user-owner']));
      notifier.notify.mockRejectedValue(new Error('db down'));

      // 这里刻意验证"服务层不自己吞异常"：真实实现（NotificationService）已经在
      // notify 内部吞掉并记日志，服务层再吞一层会让真正的 bug 彻底消失。
      await expect(service.join('order-1', 'user-A', 1)).rejects.toThrow('db down');
    });

    it('没有注入 notifier 时（纯领域单测）不报错', async () => {
      const bare = makeService(repo);
      repo.findById.mockResolvedValue(viewWith(['user-owner']));
      await expect(bare.join('order-1', 'user-A', 1)).resolves.toBeTruthy();
    });
  });

  describe('create（归属来自登录主体）', () => {
    const draft = {
      title: '咖啡拼单',
      category: 'drink',
      targetCount: 2,
      unitPriceFen: 2000,
      deadline: FUTURE,
    };

    it('未登录抛 UNAUTHENTICATED', async () => {
      await expect(service.create(draft)).rejects.toThrow(UnauthenticatedError);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('ownerId 一律取登录主体，忽略调用方可能传入的值', async () => {
      await service.create({ ...draft, ...({ ownerId: 'user-evil' } as object) }, 'user-A');
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'user-A' }));
    });

    it('标题为空 / 分类不在白名单 / 人数小于 2 / 截止时间已过 都抛 VALIDATION_FAILED', async () => {
      await expect(service.create({ ...draft, title: '  ' }, 'user-A')).rejects.toThrow(ValidationError);
      await expect(
        service.create({ ...draft, category: 'not-a-category' }, 'user-A'),
      ).rejects.toThrow(ValidationError);
      await expect(service.create({ ...draft, targetCount: 1 }, 'user-A')).rejects.toThrow(ValidationError);
      await expect(
        service.create({ ...draft, deadline: new Date(Date.now() - 1000) }, 'user-A'),
      ).rejects.toThrow(ValidationError);
    });

    it('创建后回读详情（前端可直接渲染 1/N 进度）', async () => {
      const result = await service.create(draft, 'user-A');
      expect(repo.findById).toHaveBeenCalledWith('order-1');
      expect(result.participants).toHaveLength(1);
    });
  });

  describe('update / cancel / remove（归属校验）', () => {
    it('非发起人改 / 删 / 取消都抛 FORBIDDEN', async () => {
      await expect(service.update('order-1', { title: 'x' }, 'user-B')).rejects.toThrow(ForbiddenError);
      await expect(service.cancel('order-1', 'user-B')).rejects.toThrow(ForbiddenError);
      await expect(service.remove('order-1', 'user-B')).rejects.toThrow(ForbiddenError);
    });

    it('未登录抛 UNAUTHENTICATED', async () => {
      await expect(service.update('order-1', { title: 'x' })).rejects.toThrow(UnauthenticatedError);
    });

    it('已成团的拼单不能再改', async () => {
      repo.findById.mockResolvedValue(viewWith(['user-owner', 'user-A', 'user-B'], 'full'));
      await expect(service.update('order-1', { title: 'x' }, 'user-owner')).rejects.toThrow(ConflictError);
    });

    it('取消走独立的 setStatus，且重复取消抛 CONFLICT', async () => {
      await service.cancel('order-1', 'user-owner');
      expect(repo.setStatus).toHaveBeenCalledWith('order-1', 'cancelled');

      repo.findById.mockResolvedValue({ ...BASE_VIEW, status: 'cancelled' });
      await expect(service.cancel('order-1', 'user-owner')).rejects.toThrow(ConflictError);
    });
  });

  describe('list（筛选归一化）', () => {
    it('mine 未登录时抛 UNAUTHENTICATED（而不是静默返回全部）', async () => {
      await expect(
        service.list({ mine: { userId: 'user-A', role: 'owner' } }),
      ).rejects.toThrow(UnauthenticatedError);
    });

    it('mine 的 userId 一律用登录主体覆盖', async () => {
      await service.list({ mine: { userId: 'user-evil', role: 'owner' }, actorId: 'user-A' });
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ mine: { userId: 'user-A', role: 'owner' } }));
    });

    it('分类与排序都要过白名单，脏值抛 VALIDATION_FAILED', async () => {
      await expect(service.list({ category: 'bogus' })).rejects.toThrow(ValidationError);
      await expect(service.list({ sort: 'bogus' as never })).rejects.toThrow(ValidationError);
    });

    it('默认按最新排序，limit 默认 20', async () => {
      await service.list();
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ sort: 'latest', limit: 20 }));
    });
  });
});
