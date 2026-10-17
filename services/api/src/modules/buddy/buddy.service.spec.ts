import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { BuddyGroupService } from './buddy.service';
import type {
  BuddyGroupModel,
  BuddyGroupRepository,
  BuddyMemberModel,
} from './domain/buddy.domain';

/**
 * buddy 的核心用例测试：**容量 + 成员关系 + 状态机**。
 * 用假 repository（不碰数据库），服务用显式 token 注入，直接 new。
 */

const OWNER = 'user-owner';
const MEMBER = 'user-member';
const STRANGER = 'user-stranger';

const BASE_GROUP: BuddyGroupModel = {
  id: 'group-1',
  ownerId: OWNER,
  activity: 'study',
  title: '一起去图书馆自习',
  description: null,
  campusSpot: '图书馆一楼',
  startsAt: new Date('2099-01-01T09:00:00.000Z'),
  capacity: 3,
  status: 'recruiting',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

function membership(userId: string, role: string): BuddyMemberModel {
  return { id: `m-${userId}`, groupId: 'group-1', userId, role, joinedAt: new Date('2026-10-01T00:00:00.000Z') };
}

interface FakeRepo {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  applyState: ReturnType<typeof vi.fn>;
  listMembers: ReturnType<typeof vi.fn>;
  findMembership: ReturnType<typeof vi.fn>;
  addMember: ReturnType<typeof vi.fn>;
  removeMember: ReturnType<typeof vi.fn>;
  countMembers: ReturnType<typeof vi.fn>;
}

function makeRepo(): FakeRepo {
  return {
    list: vi.fn().mockResolvedValue({ items: [BASE_GROUP], nextCursor: null }),
    create: vi.fn().mockImplementation(async (input: object) => ({ ...BASE_GROUP, ...input })),
    findById: vi.fn().mockResolvedValue(BASE_GROUP),
    applyState: vi.fn().mockImplementation(async (_id: string, status: string) => ({ ...BASE_GROUP, status })),
    listMembers: vi.fn().mockResolvedValue([
      { userId: OWNER, role: 'owner', joinedAt: new Date(), displayName: '组长', avatarUrl: null },
    ]),
    findMembership: vi.fn().mockResolvedValue(null),
    addMember: vi.fn().mockImplementation(async (_g: string, userId: string, role: string) => membership(userId, role)),
    removeMember: vi.fn(),
    countMembers: vi.fn().mockResolvedValue(1),
  };
}

function makeService(repo: FakeRepo): BuddyGroupService {
  return new BuddyGroupService(repo as unknown as BuddyGroupRepository);
}

describe('BuddyGroupService（找搭子领域用例）', () => {
  let repo: FakeRepo;
  let service: BuddyGroupService;

  beforeEach(() => {
    repo = makeRepo();
    service = makeService(repo);
  });

  describe('create', () => {
    const draft = {
      activity: 'sport',
      title: '打羽毛球',
      campusSpot: '体育馆',
      startsAt: new Date('2099-01-01T09:00:00.000Z'),
      capacity: 4,
    };

    it('ownerId 以登录主体为准，忽略请求体', async () => {
      await service.create({ ...draft, ownerId: 'attacker' }, OWNER);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ ownerId: OWNER }));
    });

    it('未登录 → UNAUTHENTICATED', async () => {
      await expect(service.create({ ...draft })).rejects.toThrow(UnauthenticatedError);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('活动类型不在白名单 → VALIDATION_FAILED', async () => {
      await expect(service.create({ ...draft, activity: 'shopping' }, OWNER)).rejects.toThrow(
        ValidationError,
      );
    });

    it('容量小于 2 或大于 50 → VALIDATION_FAILED', async () => {
      await expect(service.create({ ...draft, capacity: 1 }, OWNER)).rejects.toThrow(ValidationError);
      await expect(service.create({ ...draft, capacity: 51 }, OWNER)).rejects.toThrow(ValidationError);
    });

    it('开始时间早于当前时间 → VALIDATION_FAILED', async () => {
      await expect(
        service.create({ ...draft, startsAt: new Date(Date.now() - 1000) }, OWNER),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('join（加入）', () => {
    it('不能加入自己创建的搭子', async () => {
      await expect(service.join('group-1', OWNER)).rejects.toThrow(ValidationError);
    });

    it('重复加入 → CONFLICT', async () => {
      repo.findMembership.mockResolvedValue(membership(MEMBER, 'member'));
      await expect(service.join('group-1', MEMBER)).rejects.toThrow(ConflictError);
    });

    it('已满员（状态 full）→ CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...BASE_GROUP, status: 'full' });
      await expect(service.join('group-1', MEMBER)).rejects.toThrow(ConflictError);
    });

    it('人数已达容量（状态未同步）→ CONFLICT，不写成员', async () => {
      repo.countMembers.mockResolvedValue(3); // capacity = 3
      await expect(service.join('group-1', MEMBER)).rejects.toThrow(ConflictError);
      expect(repo.addMember).not.toHaveBeenCalled();
    });

    it('加入后未满 → 保持 recruiting', async () => {
      repo.countMembers.mockResolvedValue(1);

      const result = await service.join('group-1', MEMBER);

      expect(repo.addMember).toHaveBeenCalledWith('group-1', MEMBER, 'member');
      expect(result.status).toBe('recruiting');
      expect(repo.applyState).not.toHaveBeenCalled();
    });

    it('加入后刚好满员 → 自动推进为 full', async () => {
      repo.countMembers.mockResolvedValue(2); // 2 + 1 === capacity 3

      const result = await service.join('group-1', MEMBER);

      expect(result.status).toBe('full');
      expect(repo.applyState).toHaveBeenCalledWith('group-1', 'full');
    });

    it('并发下 addMember 返回 null（唯一约束兜底）→ CONFLICT', async () => {
      repo.addMember.mockResolvedValue(null);
      await expect(service.join('group-1', MEMBER)).rejects.toThrow(ConflictError);
    });

    it('搭子不存在 → NOT_FOUND', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.join('missing', MEMBER)).rejects.toThrow(NotFoundError);
    });
  });

  describe('leave（退出）', () => {
    it('组长不能退出 → CONFLICT（提示走 cancel）', async () => {
      repo.findMembership.mockResolvedValue(membership(OWNER, 'owner'));

      const error = await service.leave('group-1', OWNER).catch((e: Error) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as Error).message).toContain('取消');
      expect(repo.removeMember).not.toHaveBeenCalled();
    });

    it('未加入的用户退出 → VALIDATION_FAILED', async () => {
      await expect(service.leave('group-1', STRANGER)).rejects.toThrow(ValidationError);
    });

    it('普通成员退出，满员回落到 recruiting', async () => {
      repo.findById.mockResolvedValue({ ...BASE_GROUP, status: 'full' });
      repo.findMembership.mockResolvedValue(membership(MEMBER, 'member'));
      repo.countMembers.mockResolvedValue(2); // 退出后 2 < capacity 3

      const result = await service.leave('group-1', MEMBER);

      expect(repo.removeMember).toHaveBeenCalledWith('group-1', MEMBER);
      expect(result.status).toBe('recruiting');
      expect(repo.applyState).toHaveBeenCalledWith('group-1', 'recruiting');
    });

    it('普通成员退出，人数仍满 → 状态不回落', async () => {
      repo.findById.mockResolvedValue({ ...BASE_GROUP, status: 'full' });
      repo.findMembership.mockResolvedValue(membership(MEMBER, 'member'));
      repo.countMembers.mockResolvedValue(5); // 仍然 >= capacity

      const result = await service.leave('group-1', MEMBER);

      expect(result.status).toBe('full');
      expect(repo.applyState).not.toHaveBeenCalled();
    });
  });

  describe('close / cancel（组长专属）', () => {
    it('非组长关闭 → FORBIDDEN', async () => {
      await expect(service.close('group-1', MEMBER)).rejects.toThrow(ForbiddenError);
    });

    it('招募中的搭子可关闭 → closed', async () => {
      const result = await service.close('group-1', OWNER);
      expect(result.status).toBe('closed');
      expect(repo.applyState).toHaveBeenCalledWith('group-1', 'closed');
    });

    it('已满员的搭子不能走 close（走 cancel）→ CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...BASE_GROUP, status: 'full' });
      await expect(service.close('group-1', OWNER)).rejects.toThrow(ConflictError);
    });

    it('非组长取消 → FORBIDDEN', async () => {
      await expect(service.cancel('group-1', MEMBER)).rejects.toThrow(ForbiddenError);
    });

    it('组长可取消 → cancelled', async () => {
      const result = await service.cancel('group-1', OWNER);
      expect(result.status).toBe('cancelled');
    });

    it('已结束的搭子不能重复取消 → CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...BASE_GROUP, status: 'cancelled' });
      await expect(service.cancel('group-1', OWNER)).rejects.toThrow(ConflictError);
    });
  });

  describe('detail（含成员）', () => {
    it('返回小组 + 成员列表', async () => {
      const result = await service.detail('group-1');
      expect(result.id).toBe('group-1');
      expect(result.members).toHaveLength(1);
      expect(result.members[0]).toMatchObject({ userId: OWNER, role: 'owner' });
    });

    it('不存在 → NOT_FOUND', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.detail('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('list（筛选归一化）', () => {
    it('默认 latest 并补齐 limit', async () => {
      await service.list({});
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, sort: 'latest' }));
    });

    it('joined=1 由控制器翻译成 joinedUserId 透传', async () => {
      await service.list({ joinedUserId: MEMBER });
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ joinedUserId: MEMBER }));
    });

    it('非法活动类型被拒绝', async () => {
      await expect(service.list({ activity: 'nope' })).rejects.toThrow(ValidationError);
    });
  });
});
