import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { anonymousHandle } from '../auth/domain/verification-code';
import { ForumPostService } from './forum.service';
import { FORUM_BOARDS } from './domain/forum.domain';
import type {
  ForumPostModel,
  ForumPostRepository,
  ForumReplyModel,
} from './domain/forum.domain';

/**
 * forum 的核心用例测试：**版块白名单 + 匿名解耦 + 作者判定**。
 *
 * 重点验证「匿名内容不得泄漏 userId」：匿名帖 / 匿名回复落库时 authorId 为 null，
 * 且返回实体里也拿不到实名 id。
 */

const AUTHOR = 'user-author';
const OTHER = 'user-other';

const BASE_POST: ForumPostModel = {
  id: 'post-1',
  board: 'campus',
  authorId: AUTHOR,
  anonHandle: null,
  title: '选课求建议',
  body: '想问问专业选修怎么选',
  status: 'published',
  pinnedRank: 0,
  replyCount: 0,
  lastReplyAt: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

const BASE_REPLY: ForumReplyModel = {
  id: 'reply-1',
  postId: 'post-1',
  authorId: AUTHOR,
  anonHandle: null,
  body: '同问',
  status: 'published',
  createdAt: new Date('2026-10-01T01:00:00.000Z'),
};

interface FakeRepo {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  boardCounts: ReturnType<typeof vi.fn>;
  listReplies: ReturnType<typeof vi.fn>;
  addReply: ReturnType<typeof vi.fn>;
  updateReply: ReturnType<typeof vi.fn>;
}

function makeRepo(): FakeRepo {
  return {
    list: vi.fn().mockResolvedValue({ items: [BASE_POST], nextCursor: null }),
    create: vi.fn().mockImplementation(async (data: object) => ({ ...BASE_POST, ...data })),
    findById: vi.fn().mockResolvedValue(BASE_POST),
    update: vi.fn().mockImplementation(async (_id: string, patch: object) => ({ ...BASE_POST, ...patch })),
    remove: vi.fn(),
    boardCounts: vi.fn().mockResolvedValue([
      { board: 'campus', postCount: 3 },
      { board: 'treehole', postCount: 5 },
    ]),
    listReplies: vi.fn().mockResolvedValue({ items: [BASE_REPLY], nextCursor: null }),
    addReply: vi.fn().mockImplementation(async (data: object) => ({ ...BASE_REPLY, ...data })),
    updateReply: vi.fn().mockImplementation(async (id: string, patch: object) => ({ ...BASE_REPLY, id, ...patch })),
  };
}

function makeService(repo: FakeRepo): ForumPostService {
  return new ForumPostService(repo as unknown as ForumPostRepository);
}

describe('ForumPostService（论坛领域用例）', () => {
  let repo: FakeRepo;
  let service: ForumPostService;

  beforeEach(() => {
    repo = makeRepo();
    service = makeService(repo);
  });

  describe('boards', () => {
    it('按契约顺序补齐，且只调用一次 groupBy 统计', async () => {
      const result = await service.boards();

      expect(result.map((r) => r.board)).toEqual([...FORUM_BOARDS]);
      expect(result.find((r) => r.board === 'campus')?.postCount).toBe(3);
      expect(result.find((r) => r.board === 'treehole')?.postCount).toBe(5);
      // 没有帖子的版块补 0
      expect(result.find((r) => r.board === 'study')?.postCount).toBe(0);
      expect(repo.boardCounts).toHaveBeenCalledTimes(1);
    });
  });

  describe('create（发帖）', () => {
    const draft = { board: 'campus', title: '求拼车', body: '周六去浦东机场' };

    it('实名发帖：authorId 来自 JWT，不补写 handle', async () => {
      const result = await service.create(draft, AUTHOR);

      expect(repo.create).toHaveBeenCalledWith({
        board: 'campus',
        authorId: AUTHOR,
        anonHandle: null,
        title: '求拼车',
        body: '周六去浦东机场',
      });
      expect(result.authorId).toBe(AUTHOR);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('匿名发帖：authorId 落库为 null，并补写不含实名的 anonHandle', async () => {
      repo.update.mockImplementation(async (_id: string, patch: object) => ({
        ...BASE_POST,
        authorId: null,
        ...patch,
      }));

      const result = await service.create({ ...draft, anonymous: true }, AUTHOR);

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ authorId: null, anonHandle: null }));
      expect(repo.update).toHaveBeenCalledWith('post-1', {
        anonHandle: anonymousHandle(`post-1:${AUTHOR}`),
      });
      // 返回实体里拿不到实名 id
      expect(result.authorId).toBeNull();
      expect(result.anonHandle).toBe(anonymousHandle(`post-1:${AUTHOR}`));
    });

    it('未登录 → UNAUTHENTICATED', async () => {
      await expect(service.create(draft)).rejects.toThrow(UnauthenticatedError);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('版块不在白名单 → VALIDATION_FAILED', async () => {
      await expect(service.create({ ...draft, board: 'nope' }, AUTHOR)).rejects.toThrow(
        ValidationError,
      );
    });

    it('标题超过 80 字 → VALIDATION_FAILED', async () => {
      await expect(service.create({ ...draft, title: 'x'.repeat(81) }, AUTHOR)).rejects.toThrow(
        ValidationError,
      );
    });

    it('正文为空 → VALIDATION_FAILED', async () => {
      await expect(service.create({ ...draft, body: '   ' }, AUTHOR)).rejects.toThrow(ValidationError);
    });
  });

  describe('reply（回复）', () => {
    it('实名回复：authorId 来自 JWT', async () => {
      await service.reply('post-1', { body: '我也有同样的问题' }, AUTHOR);

      expect(repo.addReply).toHaveBeenCalledWith({
        postId: 'post-1',
        authorId: AUTHOR,
        anonHandle: null,
        body: '我也有同样的问题',
      });
      expect(repo.updateReply).not.toHaveBeenCalled();
    });

    it('匿名回复：authorId 落库为 null 并补写 handle', async () => {
      repo.updateReply.mockImplementation(async (id: string, patch: object) => ({
        ...BASE_REPLY,
        authorId: null,
        id,
        ...patch,
      }));

      const result = await service.reply('post-1', { body: '匿名说一句', anonymous: true }, AUTHOR);

      expect(repo.addReply).toHaveBeenCalledWith(expect.objectContaining({ authorId: null, anonHandle: null }));
      expect(repo.updateReply).toHaveBeenCalledWith('reply-1', {
        anonHandle: anonymousHandle(`reply-1:${AUTHOR}`),
      });
      expect(result.authorId).toBeNull();
    });

    it('已关闭的主题不能回复 → CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...BASE_POST, status: 'closed' });

      await expect(service.reply('post-1', { body: '在吗' }, AUTHOR)).rejects.toThrow(ConflictError);
      expect(repo.addReply).not.toHaveBeenCalled();
    });

    it('未登录 → UNAUTHENTICATED', async () => {
      await expect(service.reply('post-1', { body: '在吗' })).rejects.toThrow(UnauthenticatedError);
    });

    it('回复超长 → VALIDATION_FAILED', async () => {
      await expect(
        service.reply('post-1', { body: 'x'.repeat(2001) }, AUTHOR),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('close / remove（作者判定）', () => {
    it('匿名帖不可关闭 → FORBIDDEN，文案明确说明原因', async () => {
      repo.findById.mockResolvedValue({ ...BASE_POST, authorId: null, anonHandle: '鸭友ABCDEF' });

      const error = await service.close('post-1', AUTHOR).catch((e: Error) => e);
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as Error).message).toContain('匿名');
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('匿名帖不可删除 → FORBIDDEN', async () => {
      repo.findById.mockResolvedValue({ ...BASE_POST, authorId: null, anonHandle: '鸭友ABCDEF' });

      await expect(service.remove('post-1', AUTHOR)).rejects.toThrow(ForbiddenError);
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('非作者关闭 → FORBIDDEN', async () => {
      await expect(service.close('post-1', OTHER)).rejects.toThrow(ForbiddenError);
    });

    it('作者关闭 → closed', async () => {
      const result = await service.close('post-1', AUTHOR);
      expect(result.status).toBe('closed');
      expect(repo.update).toHaveBeenCalledWith('post-1', { status: 'closed' });
    });

    it('已关闭再关闭 → CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...BASE_POST, status: 'closed' });
      await expect(service.close('post-1', AUTHOR)).rejects.toThrow(ConflictError);
    });

    it('作者删除 → remove', async () => {
      await service.remove('post-1', AUTHOR);
      expect(repo.remove).toHaveBeenCalledWith('post-1');
    });

    it('未登录关闭 → UNAUTHENTICATED', async () => {
      await expect(service.close('post-1')).rejects.toThrow(UnauthenticatedError);
    });
  });

  describe('list / detail', () => {
    it('默认只查 published', async () => {
      await service.list({});
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'published' }));
    });

    it('mine 由控制器翻译成 authorId 后透传', async () => {
      await service.list({ authorId: AUTHOR, sort: 'hot' });
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ authorId: AUTHOR, sort: 'hot' }));
    });

    it('详情返回帖子 + 一页回复，回复上限 50', async () => {
      const result = await service.detail('post-1', { limit: 999 });

      expect(result.post.id).toBe('post-1');
      expect(result.replies.items).toHaveLength(1);
      expect(repo.listReplies).toHaveBeenCalledWith(
        expect.objectContaining({ postId: 'post-1', limit: 50 }),
      );
    });

    it('详情不存在 → NOT_FOUND', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.detail('missing')).rejects.toThrow(NotFoundError);
    });
  });
});
