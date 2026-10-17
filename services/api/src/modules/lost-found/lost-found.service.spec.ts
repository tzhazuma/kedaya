import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { LostFoundItemService } from './lost-found.service';
import type { LostFoundItemModel, LostFoundItemRepository } from './domain/lost-found.domain';

/**
 * lost-found 的核心用例测试：**归属 + open↔resolved 状态机 + 校验**。
 */

const REPORTER = 'user-reporter';
const OTHER = 'user-other';

const BASE_ITEM: LostFoundItemModel = {
  id: 'lf-1',
  reporterId: REPORTER,
  kind: 'lost',
  title: '黑色雨伞',
  description: '手柄上有个小黄鸭贴纸',
  place: '图书馆一楼大厅',
  happenedAt: new Date('2026-10-15T10:00:00.000Z'),
  contactHint: '站内私信',
  status: 'open',
  resolvedAt: null,
  createdAt: new Date('2026-10-15T10:05:00.000Z'),
  updatedAt: new Date('2026-10-15T10:05:00.000Z'),
};

interface FakeRepo {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  applyStatus: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function makeRepo(): FakeRepo {
  return {
    list: vi.fn().mockResolvedValue({ items: [BASE_ITEM], nextCursor: null }),
    create: vi.fn().mockImplementation(async (input: object) => ({ ...BASE_ITEM, ...input })),
    findById: vi.fn().mockResolvedValue(BASE_ITEM),
    update: vi.fn().mockImplementation(async (_id: string, patch: object) => ({ ...BASE_ITEM, ...patch })),
    applyStatus: vi.fn().mockImplementation(async (_id: string, patch: object) => ({ ...BASE_ITEM, ...patch })),
    remove: vi.fn(),
  };
}

function makeService(repo: FakeRepo): LostFoundItemService {
  return new LostFoundItemService(repo as unknown as LostFoundItemRepository);
}

describe('LostFoundItemService（失物招领领域用例）', () => {
  let repo: FakeRepo;
  let service: LostFoundItemService;

  beforeEach(() => {
    repo = makeRepo();
    service = makeService(repo);
  });

  describe('create', () => {
    const draft = {
      kind: 'found',
      title: '捡到一张校园卡',
      place: '二食堂',
      happenedAt: new Date('2026-10-16T12:00:00.000Z'),
    };

    it('reporterId 以登录主体为准，忽略请求体', async () => {
      await service.create({ ...draft, reporterId: 'attacker' }, REPORTER);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ reporterId: REPORTER }));
    });

    it('未登录 → UNAUTHENTICATED', async () => {
      await expect(service.create({ ...draft })).rejects.toThrow(UnauthenticatedError);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('kind 不在白名单 → VALIDATION_FAILED', async () => {
      await expect(service.create({ ...draft, kind: 'borrow' }, REPORTER)).rejects.toThrow(
        ValidationError,
      );
    });

    it('事发时间在 5 分钟偏差之外 → VALIDATION_FAILED', async () => {
      await expect(
        service.create({ ...draft, happenedAt: new Date(Date.now() + 6 * 60 * 1000) }, REPORTER),
      ).rejects.toThrow(ValidationError);
    });

    it('事发时间在 5 分钟偏差之内 → 通过（手机时钟略快）', async () => {
      await expect(
        service.create({ ...draft, happenedAt: new Date(Date.now() + 60 * 1000) }, REPORTER),
      ).resolves.toMatchObject({ id: 'lf-1' });
    });
  });

  describe('resolve（标记已解决）', () => {
    it('已 resolved 再 resolve → CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...BASE_ITEM, status: 'resolved', resolvedAt: new Date() });

      await expect(service.resolve('lf-1', REPORTER)).rejects.toThrow(ConflictError);
    });

    it('发布者标记 → resolved + resolvedAt', async () => {
      await service.resolve('lf-1', REPORTER);
      expect(repo.applyStatus).toHaveBeenCalledWith(
        'lf-1',
        expect.objectContaining({ status: 'resolved', resolvedAt: expect.any(Date) }),
      );
    });

    it('非发布者 → FORBIDDEN', async () => {
      await expect(service.resolve('lf-1', OTHER)).rejects.toThrow(ForbiddenError);
    });

    it('未登录 → UNAUTHENTICATED', async () => {
      await expect(service.resolve('lf-1')).rejects.toThrow(UnauthenticatedError);
    });
  });

  describe('reopen（重新开放）', () => {
    it('不是 resolved 时 reopen → CONFLICT', async () => {
      await expect(service.reopen('lf-1', REPORTER)).rejects.toThrow(ConflictError);
    });

    it('resolved → open，且清空 resolvedAt', async () => {
      repo.findById.mockResolvedValue({ ...BASE_ITEM, status: 'resolved', resolvedAt: new Date() });

      await service.reopen('lf-1', REPORTER);

      expect(repo.applyStatus).toHaveBeenCalledWith('lf-1', { status: 'open', resolvedAt: null });
    });
  });

  describe('update / remove（发布者专属）', () => {
    it('非发布者修改 → FORBIDDEN', async () => {
      await expect(service.update('lf-1', { title: '改个名' }, OTHER)).rejects.toThrow(ForbiddenError);
    });

    it('发布者可修改标题', async () => {
      await service.update('lf-1', { title: '黑色折叠伞' }, REPORTER);
      expect(repo.update).toHaveBeenCalledWith('lf-1', { title: '黑色折叠伞' });
    });

    it('发布者可删除', async () => {
      await service.remove('lf-1', REPORTER);
      expect(repo.remove).toHaveBeenCalledWith('lf-1');
    });

    it('不存在 → NOT_FOUND', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.remove('missing', REPORTER)).rejects.toThrow(NotFoundError);
    });
  });

  describe('list（筛选归一化）', () => {
    it('默认按 happenedAt 最新排序', async () => {
      await service.list({});
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, sort: 'latest' }));
    });

    it('非法 kind 被拒绝', async () => {
      await expect(service.list({ kind: 'nope' })).rejects.toThrow(ValidationError);
    });

    it('mine 由控制器翻译成 reporterId 后透传', async () => {
      await service.list({ reporterId: REPORTER, sort: 'oldest' });
      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({ reporterId: REPORTER, sort: 'oldest' }),
      );
    });
  });
});
