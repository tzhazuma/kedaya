import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../common/errors/app-error';
import type { NotifyInput } from '../../common/notifications/notification.port';
import { NotificationService } from './notifications.service';
import type { NotificationModel, NotificationRepository } from './domain/notifications.domain';

/**
 * 站内信用例测试。
 *
 * 重点不在 CRUD，而在两条"不会报错但会静默坏事"的规则：
 *   1. 写通知失败**不能**影响主流程（best-effort）；
 *   2. 非法输入（缺字段 / source 拼错）必须被丢弃并告警，
 *      而不是静默写进去一个前端认不出、点了也没反应的脏通知。
 */

const BASE: NotificationModel = {
  id: 'nt-1',
  userId: 'user-A',
  title: '标题',
  body: '正文',
  channel: 'inapp',
  source: 'groupbuy',
  link: '/presentation/pages/groupbuy/detail/index?id=x',
  readAt: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
};

interface FakeRepo {
  list: ReturnType<typeof vi.fn>;
  unreadCount: ReturnType<typeof vi.fn>;
  markRead: ReturnType<typeof vi.fn>;
  markAllRead: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  createMany: ReturnType<typeof vi.fn>;
}

function makeRepo(): FakeRepo {
  return {
    list: vi.fn().mockResolvedValue({ items: [BASE], nextCursor: null }),
    unreadCount: vi.fn().mockResolvedValue(3),
    markRead: vi.fn().mockResolvedValue({ ...BASE, readAt: new Date() }),
    markAllRead: vi.fn().mockResolvedValue(2),
    create: vi.fn().mockResolvedValue(BASE),
    createMany: vi.fn().mockResolvedValue(2),
  };
}

function makeService(repo: FakeRepo): NotificationService {
  return new NotificationService(repo as unknown as NotificationRepository);
}

const VALID: NotifyInput = {
  userId: 'user-A',
  title: '有人参团了你的拼单',
  body: '「奶茶拼单」已有 2/4 份。',
  source: 'groupbuy',
  link: '/presentation/pages/groupbuy/detail/index?id=order-1',
};

describe('NotificationService', () => {
  let repo: FakeRepo;
  let service: NotificationService;

  beforeEach(() => {
    repo = makeRepo();
    service = makeService(repo);
  });

  describe('notify（写通知，best-effort）', () => {
    it('单条走 create，多条走 createMany（成团通知要一次发给全部成员）', async () => {
      await service.notify(VALID);
      expect(repo.create).toHaveBeenCalledTimes(1);

      await service.notify([VALID, { ...VALID, userId: 'user-B' }]);
      expect(repo.createMany).toHaveBeenCalledTimes(1);
      expect(repo.createMany.mock.calls[0]?.[0]).toHaveLength(2);
    });

    it('仓储报错时**不抛出**（主流程已成功，不能因为通知失败而 500）', async () => {
      repo.create.mockRejectedValue(new Error('db down'));
      await expect(service.notify(VALID)).resolves.toBeUndefined();
    });

    it('缺字段或 source 未登记的通知被丢弃，不写库', async () => {
      await service.notify({ ...VALID, userId: '  ' });
      await service.notify({ ...VALID, title: '' });
      await service.notify({ ...VALID, source: 'not-registered' });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('全部被丢弃时不调用仓储（空写入没有意义）', async () => {
      await service.notify([{ ...VALID, source: 'typo' }]);
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.createMany).not.toHaveBeenCalled();
    });

    it('标题/正文按码点截断，不把 emoji 截成半个', async () => {
      const long = '🦆'.repeat(60);
      await service.notify({ ...VALID, title: long, body: long });

      const written = repo.create.mock.calls[0]?.[0] as { title: string; body: string };
      expect([...written.title].length).toBeLessThanOrEqual(40);
      expect(written.title.endsWith('…')).toBe(true);
      // 截断后仍是合法字符串（没有落单的代理项）
      expect(written.title.includes('\uFFFD')).toBe(false);
    });

    it('保留 link（前端据此决定是否可点）', async () => {
      await service.notify(VALID);
      expect(repo.create.mock.calls[0]?.[0]).toMatchObject({ link: VALID.link, source: 'groupbuy' });
    });
  });

  describe('读接口', () => {
    it('list 恒按当前用户收窄，并透传 unreadOnly', async () => {
      await service.list('user-A', { limit: 20, unreadOnly: true });
      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-A', unreadOnly: true, limit: 20 }),
      );
    });

    it('unreadCount 直接透传', async () => {
      expect(await service.unreadCount('user-A')).toBe(3);
    });

    it('markRead 不属于自己时抛 NOT_FOUND（不透露"存在但不是你的"）', async () => {
      repo.markRead.mockResolvedValue(null);
      await expect(service.markRead('user-A', 'nt-other')).rejects.toThrow(NotFoundError);
    });

    it('markAllRead 返回本次实际标记条数', async () => {
      expect(await service.markAllRead('user-A')).toBe(2);
    });
  });
});
