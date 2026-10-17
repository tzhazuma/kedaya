import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { ErrandTaskService } from './errand.service';
import { ERRAND_MAX_REWARD_FEN, type ErrandTaskModel, type ErrandTaskRepository } from './domain/errand.domain';

/**
 * errand 的核心用例测试：**归属 + 状态机 + 校验**。
 *
 * 用假的 repository（不碰数据库），只验证用例编排与领域规则。
 * 服务用显式 token 注入，因此可以直接 `new ErrandTaskService(fake)`。
 */

const REQUESTER = 'user-requester';
const RUNNER = 'user-runner';

const BASE_TASK: ErrandTaskModel = {
  id: 'task-1',
  requesterId: REQUESTER,
  runnerId: null,
  title: '帮忙取快递',
  detail: '菜鸟驿站 3 号柜',
  rewardFen: 500,
  fromPlace: '菜鸟驿站',
  toPlace: '3 号楼 502',
  deadline: new Date('2099-01-01T00:00:00.000Z'),
  status: 'open',
  acceptedAt: null,
  deliveredAt: null,
  settledAt: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

interface FakeRepo {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  applyState: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function makeRepo(): FakeRepo {
  return {
    list: vi.fn().mockResolvedValue({ items: [BASE_TASK], nextCursor: null }),
    create: vi.fn().mockImplementation(async (input: object) => ({ ...BASE_TASK, ...input })),
    findById: vi.fn().mockResolvedValue(BASE_TASK),
    update: vi.fn().mockImplementation(async (_id: string, patch: object) => ({ ...BASE_TASK, ...patch })),
    applyState: vi.fn().mockImplementation(async (_id: string, patch: object) => ({ ...BASE_TASK, ...patch })),
    remove: vi.fn(),
  };
}

function makeService(repo: FakeRepo): ErrandTaskService {
  return new ErrandTaskService(repo as unknown as ErrandTaskRepository);
}

describe('ErrandTaskService（跑腿领域用例）', () => {
  let repo: FakeRepo;
  let service: ErrandTaskService;

  beforeEach(() => {
    repo = makeRepo();
    service = makeService(repo);
  });

  describe('create', () => {
    const draft = {
      title: '帮忙带咖啡',
      rewardFen: 800,
      fromPlace: '二食堂',
      toPlace: '图书馆',
      deadline: new Date('2099-01-01T00:00:00.000Z'),
    };

    it('requesterId 以登录主体为准，忽略请求体里传入的值', async () => {
      await service.create({ ...draft, requesterId: 'attacker' }, REQUESTER);

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ requesterId: REQUESTER }));
    });

    it('未登录 → UNAUTHENTICATED，不落库', async () => {
      await expect(service.create({ ...draft })).rejects.toThrow(UnauthenticatedError);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('悬赏必须是以分为单位的整数', async () => {
      await expect(service.create({ ...draft, rewardFen: 1.5 }, REQUESTER)).rejects.toThrow(
        ValidationError,
      );
    });

    it('悬赏超过上限 → VALIDATION_FAILED', async () => {
      await expect(
        service.create({ ...draft, rewardFen: ERRAND_MAX_REWARD_FEN + 1 }, REQUESTER),
      ).rejects.toThrow(ValidationError);
    });

    it('截止时间早于当前时间 → VALIDATION_FAILED', async () => {
      await expect(
        service.create({ ...draft, deadline: new Date(Date.now() - 1000) }, REQUESTER),
      ).rejects.toThrow(ValidationError);
    });

    it('标题为空 → VALIDATION_FAILED', async () => {
      await expect(service.create({ ...draft, title: '   ' }, REQUESTER)).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe('accept（接单）', () => {
    it('不能接自己发布的单', async () => {
      await expect(service.accept('task-1', REQUESTER)).rejects.toThrow(ValidationError);
      expect(repo.applyState).not.toHaveBeenCalled();
    });

    it('未登录不能接单', async () => {
      await expect(service.accept('task-1')).rejects.toThrow(UnauthenticatedError);
    });

    it('只有 open 可接，已接单的任务 → CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...BASE_TASK, status: 'accepted', runnerId: 'someone-else' });

      await expect(service.accept('task-1', RUNNER)).rejects.toThrow(ConflictError);
    });

    it('自己已是 runner 时重复接单 → CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...BASE_TASK, status: 'accepted', runnerId: RUNNER });

      await expect(service.accept('task-1', RUNNER)).rejects.toThrow(ConflictError);
    });

    it('接单成功写入 runnerId / acceptedAt / status', async () => {
      await service.accept('task-1', RUNNER);

      expect(repo.applyState).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'accepted', runnerId: RUNNER, acceptedAt: expect.any(Date) }),
      );
    });

    it('任务不存在 → NOT_FOUND', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.accept('missing', RUNNER)).rejects.toThrow(NotFoundError);
    });
  });

  describe('deliver（送达）', () => {
    it('非接单者 → FORBIDDEN', async () => {
      repo.findById.mockResolvedValue({ ...BASE_TASK, status: 'accepted', runnerId: RUNNER });

      await expect(service.deliver('task-1', 'someone-else')).rejects.toThrow(ForbiddenError);
    });

    it('状态不是 accepted → CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...BASE_TASK, status: 'open', runnerId: RUNNER });

      await expect(service.deliver('task-1', RUNNER)).rejects.toThrow(ConflictError);
    });

    it('接单者送达成功 → delivered + deliveredAt', async () => {
      repo.findById.mockResolvedValue({ ...BASE_TASK, status: 'accepted', runnerId: RUNNER });

      await service.deliver('task-1', RUNNER);

      expect(repo.applyState).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'delivered', deliveredAt: expect.any(Date) }),
      );
    });
  });

  describe('complete（确认完成）', () => {
    it('非发布者 → FORBIDDEN', async () => {
      repo.findById.mockResolvedValue({ ...BASE_TASK, status: 'delivered', runnerId: RUNNER });

      await expect(service.complete('task-1', RUNNER)).rejects.toThrow(ForbiddenError);
    });

    it('状态不是 delivered → CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...BASE_TASK, status: 'accepted', runnerId: RUNNER });

      await expect(service.complete('task-1', REQUESTER)).rejects.toThrow(ConflictError);
    });

    it('发布者确认完成 → completed + settledAt', async () => {
      repo.findById.mockResolvedValue({ ...BASE_TASK, status: 'delivered', runnerId: RUNNER });

      await service.complete('task-1', REQUESTER);

      expect(repo.applyState).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'completed', settledAt: expect.any(Date) }),
      );
    });
  });

  describe('cancel（取消）', () => {
    it('非发布者不能取消', async () => {
      await expect(service.cancel('task-1', RUNNER)).rejects.toThrow(ForbiddenError);
    });

    it('open / accepted 可取消', async () => {
      await service.cancel('task-1', REQUESTER);
      expect(repo.applyState).toHaveBeenCalledWith('task-1', { status: 'cancelled' });

      repo.findById.mockResolvedValue({ ...BASE_TASK, status: 'accepted', runnerId: RUNNER });
      await service.cancel('task-1', REQUESTER);
      expect(repo.applyState).toHaveBeenCalledTimes(2);
    });

    it('completed 后不可取消 → CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...BASE_TASK, status: 'completed' });

      await expect(service.cancel('task-1', REQUESTER)).rejects.toThrow(ConflictError);
    });
  });

  describe('update / remove（发布者专属，终态锁定）', () => {
    it('非发布者修改 → FORBIDDEN', async () => {
      await expect(service.update('task-1', { title: '改标题' }, RUNNER)).rejects.toThrow(
        ForbiddenError,
      );
    });

    it('已完成的任务不可修改 → CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...BASE_TASK, status: 'completed' });

      await expect(service.update('task-1', { title: '改标题' }, REQUESTER)).rejects.toThrow(
        ConflictError,
      );
    });

    it('已取消的任务不可删除 → CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...BASE_TASK, status: 'cancelled' });

      await expect(service.remove('task-1', REQUESTER)).rejects.toThrow(ConflictError);
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('发布者可删除进行中的任务', async () => {
      await service.remove('task-1', REQUESTER);
      expect(repo.remove).toHaveBeenCalledWith('task-1');
    });
  });

  describe('list（筛选归一化）', () => {
    it('默认按 latest 排序并补齐 limit', async () => {
      await service.list({});
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, sort: 'latest' }));
    });

    it('非法状态被拒绝', async () => {
      await expect(service.list({ status: 'unknown' })).rejects.toThrow(ValidationError);
    });

    it('mine / role 由控制器翻译为 requesterId / runnerId 后透传', async () => {
      await service.list({ requesterId: REQUESTER, sort: 'reward-desc' });
      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({ requesterId: REQUESTER, sort: 'reward-desc' }),
      );

      await service.list({ runnerId: RUNNER });
      expect(repo.list).toHaveBeenLastCalledWith(expect.objectContaining({ runnerId: RUNNER }));
    });
  });
});
