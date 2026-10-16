import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RolePort } from '../../common/auth/role.port';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { ForumService } from './forum.service';
import {
  anonHandleFor,
  anonThreadScope,
  type CreateForumPostInput,
  type ForumBoardModel,
  type ForumBoardRepository,
  type ForumPostModel,
  type ForumPostRepository,
  type ForumReportModel,
  type ForumReportRepository,
  type ForumReplyModel,
  type ForumUserDirectoryPort,
} from './domain/forum.domain';

/**
 * forum 用例层测试（契约 §9 匿名解耦 / §11.1 Merge Patch / §11.2 report / 状态机）。
 *
 * 用假仓储（不碰数据库）—— 服务用显式 token 注入，因此可以直接 new，
 * 不需要 Nest DI，也不需要 emitDecoratorMetadata（与 groupbuy.service.spec.ts 同风格）。
 */

const SECRET = 'unit-test-anon-secret';
const ACTOR = 'user-A';
const STRANGER = 'user-B';
const MODERATOR = 'user-mod';

const BOARD: ForumBoardModel = {
  id: 'board-1',
  slug: 'campus',
  name: '校园',
  description: null,
  visibility: 'public',
  postCount: 1,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

function makePost(overrides: Partial<ForumPostModel> = {}): ForumPostModel {
  return {
    id: 'post-1',
    boardId: 'board-1',
    authorId: ACTOR,
    anonHandle: null,
    title: '食堂推荐',
    body: '一食堂的牛肉面不错',
    status: 'PUBLISHED',
    tags: ['food'],
    replyCount: 0,
    likeCount: 0,
    pinnedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeReport(overrides: Partial<ForumReportModel> = {}): ForumReportModel {
  return {
    id: 'report-1',
    targetType: 'POST',
    targetId: 'post-1',
    reason: 'spam',
    detail: null,
    status: 'PENDING',
    reporterId: ACTOR,
    reporterKey: `user:${ACTOR}`,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeReply(overrides: Partial<ForumReplyModel> = {}): ForumReplyModel {
  return {
    id: 'reply-1',
    postId: 'post-1',
    parentReplyId: null,
    authorId: ACTOR,
    anonHandle: null,
    body: '同意',
    status: 'PUBLISHED',
    likeCount: 0,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

type MockFn = ReturnType<typeof vi.fn>;

interface Fakes {
  posts: {
    list: MockFn;
    listFiltered: MockFn;
    create: MockFn;
    findById: MockFn;
    update: MockFn;
    remove: MockFn;
    addReply: MockFn;
    listReplies: MockFn;
    findReplyById: MockFn;
    updateReply: MockFn;
    adjustReplyCount: MockFn;
  };
  boards: {
    listBoards: MockFn;
    findBoardByIdOrSlug: MockFn;
    createBoard: MockFn;
    adjustBoardPostCount: MockFn;
    latestPostAtByBoard: MockFn;
  };
  reports: {
    createReport: MockFn;
    findReportByReporter: MockFn;
    countDistinctReporters: MockFn;
    listReports: MockFn;
    setReportStatus: MockFn;
  };
  roles: { hasRole: MockFn };
  users: { displayNamesFor: MockFn };
}

function makeFakes(): Fakes {
  return {
    posts: {
      list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listFiltered: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      create: vi.fn().mockImplementation(async (input: CreateForumPostInput) => makePost(input)),
      findById: vi.fn().mockResolvedValue(makePost()),
      update: vi.fn().mockImplementation(async (id: string, data: Partial<ForumPostModel>) =>
        makePost({ id, ...data }),
      ),
      remove: vi.fn().mockResolvedValue(undefined),
      addReply: vi.fn().mockImplementation(async (input: Partial<ForumReplyModel>) => makeReply(input)),
      listReplies: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      findReplyById: vi.fn().mockResolvedValue(null),
      updateReply: vi.fn(),
      adjustReplyCount: vi.fn().mockResolvedValue(undefined),
    },
    boards: {
      listBoards: vi.fn().mockResolvedValue({ items: [BOARD], nextCursor: null }),
      findBoardByIdOrSlug: vi.fn().mockResolvedValue(BOARD),
      createBoard: vi.fn().mockResolvedValue(BOARD),
      adjustBoardPostCount: vi.fn().mockResolvedValue(undefined),
      latestPostAtByBoard: vi.fn().mockResolvedValue(new Map()),
    },
    reports: {
      createReport: vi.fn().mockImplementation(async (input: Partial<ForumReportModel>) => makeReport(input)),
      findReportByReporter: vi.fn().mockResolvedValue(null),
      countDistinctReporters: vi.fn().mockResolvedValue(1),
      listReports: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      setReportStatus: vi.fn().mockImplementation(async (id: string, status: string) =>
        makeReport({ id, status }),
      ),
    },
    roles: { hasRole: vi.fn().mockResolvedValue(false) },
    users: {
      displayNamesFor: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `昵称-${id}`]))),
    },
  };
}

function makeService(fakes: Fakes, bannedKeywords = ''): ForumService {
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'ANON_HANDLE_SECRET') return SECRET;
      if (key === 'JWT_SECRET') return 'jwt-secret';
      if (key === 'FORUM_BANNED_KEYWORDS') return bannedKeywords;
      return undefined;
    }),
  } as unknown as ConfigService;

  return new ForumService(
    fakes.posts as unknown as ForumPostRepository,
    fakes.boards as unknown as ForumBoardRepository,
    fakes.reports as unknown as ForumReportRepository,
    fakes.users as unknown as ForumUserDirectoryPort,
    fakes.roles as unknown as RolePort,
    config,
  );
}

describe('ForumService · 发帖与匿名解耦（契约 §9）', () => {
  let fakes: Fakes;
  let service: ForumService;

  beforeEach(() => {
    fakes = makeFakes();
    service = makeService(fakes);
  });

  it('实名发帖：authorId 是实名 id，anonHandle 为 null', async () => {
    const result = await service.createPost({ boardId: 'board-1', title: '标题', body: '正文' }, ACTOR);

    expect(fakes.posts.create).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: ACTOR, anonHandle: null, boardId: 'board-1', status: 'PUBLISHED' }),
    );
    expect(result.piiWarning).toBe(false);
    expect(fakes.boards.adjustBoardPostCount).toHaveBeenCalledWith('board-1', 1);
  });

  it('匿名发帖：authorId 落库为 null，只留 HMAC handle（实名身份不落库）', async () => {
    await service.createPost({ boardId: 'board-1', title: '标题', body: '正文', anonymous: true }, ACTOR);

    const input = fakes.posts.create.mock.calls[0]?.[0] as CreateForumPostInput;
    expect(input.authorId).toBeNull();
    expect(input.anonHandle).toBe(anonHandleFor(ACTOR, anonThreadScope(input.id), SECRET));
    // 落库输入里**任何字段**都不含实名 id
    expect(JSON.stringify(input)).not.toContain(ACTOR);
  });

  it('同一人两次匿名发帖 → handle 不同（跨帖不可关联）', async () => {
    await service.createPost({ boardId: 'board-1', title: 'a', body: 'a', anonymous: true }, ACTOR);
    await service.createPost({ boardId: 'board-1', title: 'b', body: 'b', anonymous: true }, ACTOR);

    const first = fakes.posts.create.mock.calls[0]?.[0] as CreateForumPostInput;
    const second = fakes.posts.create.mock.calls[1]?.[0] as CreateForumPostInput;
    expect(first.id).not.toBe(second.id);
    expect(first.anonHandle).not.toBe(second.anonHandle);
  });

  it('版块不存在 → VALIDATION_FAILED，且不写库', async () => {
    fakes.boards.findBoardByIdOrSlug.mockResolvedValue(null);

    await expect(service.createPost({ boardId: 'nope', title: 't', body: 'b' }, ACTOR)).rejects.toThrow(ValidationError);
    expect(fakes.posts.create).not.toHaveBeenCalled();
  });

  it('未登录 → UNAUTHENTICATED（匿名 ≠ 未登录）', async () => {
    await expect(service.createPost({ boardId: 'board-1', title: 't', body: 'b', anonymous: true })).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  it('正文疑似含 PII → piiWarning=true，但**不拦截**（只是提示）', async () => {
    const result = await service.createPost(
      { boardId: 'board-1', title: '失物', body: '捡到一张卡，联系 13800138000' },
      ACTOR,
    );

    expect(result.piiWarning).toBe(true);
    expect(fakes.posts.create).toHaveBeenCalledTimes(1);
  });

  it('命中敏感词 → VALIDATION_FAILED 且不静默改写', async () => {
    const guarded = makeService(fakes, '代写,刷单');

    await expect(
      guarded.createPost({ boardId: 'board-1', title: '代写作业', body: '正文' }, ACTOR),
    ).rejects.toThrow(ValidationError);
    expect(fakes.posts.create).not.toHaveBeenCalled();
  });

  it('标题超长 → VALIDATION_FAILED', async () => {
    await expect(
      service.createPost({ boardId: 'board-1', title: 'x'.repeat(101), body: '正文' }, ACTOR),
    ).rejects.toThrow(ValidationError);
  });
});

describe('ForumService · 详情与可见性', () => {
  let fakes: Fakes;
  let service: ForumService;

  beforeEach(() => {
    fakes = makeFakes();
    service = makeService(fakes);
  });

  it('被隐藏的主题对陌生人返回 NOT_FOUND（不确认其存在）', async () => {
    fakes.posts.findById.mockResolvedValue(makePost({ status: 'HIDDEN' }));

    await expect(service.detail('post-1', STRANGER)).rejects.toThrow(NotFoundError);
    await expect(service.detail('post-1')).rejects.toThrow(NotFoundError);
  });

  it('被隐藏的主题对版主可见（治理需要）', async () => {
    fakes.posts.findById.mockResolvedValue(makePost({ status: 'HIDDEN' }));
    fakes.roles.hasRole.mockResolvedValue(true);

    await expect(service.detail('post-1', MODERATOR)).resolves.toMatchObject({ status: 'HIDDEN' });
  });

  it('已软删除的主题对任何人都返回 NOT_FOUND', async () => {
    fakes.posts.findById.mockResolvedValue(makePost({ status: 'DELETED' }));
    fakes.roles.hasRole.mockResolvedValue(true);

    await expect(service.detail('post-1', MODERATOR)).rejects.toThrow(NotFoundError);
  });

  it('列表默认只暴露 published + locked（草稿/隐藏/删除不泄漏）', async () => {
    await service.listPosts({ limit: 20, boardId: 'board-1' });

    expect(fakes.posts.listFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: 'board-1', status: ['PUBLISHED', 'LOCKED'] }),
    );
  });
});

describe('ForumService · 编辑（JSON Merge Patch，契约 §11.1）与状态机', () => {
  let fakes: Fakes;
  let service: ForumService;

  beforeEach(() => {
    fakes = makeFakes();
    service = makeService(fakes);
  });

  it('匿名作者可以编辑自己的帖子（靠重算 handle 证明身份）', async () => {
    const handle = anonHandleFor(ACTOR, anonThreadScope('post-1'), SECRET);
    fakes.posts.findById.mockResolvedValue(makePost({ authorId: null, anonHandle: handle }));

    await service.patchPost('post-1', { title: '新标题' }, ACTOR);

    expect(fakes.posts.update).toHaveBeenCalledWith('post-1', { title: '新标题' });
  });

  it('陌生人编辑 → FORBIDDEN', async () => {
    await expect(service.patchPost('post-1', { title: '改' }, STRANGER)).rejects.toThrow(ForbiddenError);
    expect(fakes.posts.update).not.toHaveBeenCalled();
  });

  it('作者自己隐藏主题 → FORBIDDEN（隐藏是版主权限）', async () => {
    await expect(service.patchPost('post-1', { status: 'HIDDEN' }, ACTOR)).rejects.toThrow(ForbiddenError);
  });

  it('版主隐藏主题 → 写入 status=hidden', async () => {
    fakes.roles.hasRole.mockResolvedValue(true);

    await service.patchPost('post-1', { status: 'HIDDEN' }, MODERATOR);

    expect(fakes.posts.update).toHaveBeenCalledWith('post-1', { status: 'HIDDEN' });
  });

  it('版主恢复主题（hidden → published）', async () => {
    fakes.posts.findById.mockResolvedValue(makePost({ status: 'HIDDEN' }));
    fakes.roles.hasRole.mockResolvedValue(true);

    await service.patchPost('post-1', { status: 'PUBLISHED' }, MODERATOR);

    expect(fakes.posts.update).toHaveBeenCalledWith('post-1', { status: 'PUBLISHED' });
  });

  it('状态图之外的迁移 → CONFLICT（draft → locked）', async () => {
    fakes.posts.findById.mockResolvedValue(makePost({ status: 'DRAFT' }));
    fakes.roles.hasRole.mockResolvedValue(true);

    await expect(service.patchPost('post-1', { status: 'LOCKED' }, MODERATOR)).rejects.toThrow(ConflictError);
  });

  it('Merge Patch：显式 null 清空 tags，未出现的字段不写', async () => {
    await service.patchPost('post-1', { tags: null }, ACTOR);

    expect(fakes.posts.update).toHaveBeenCalledWith('post-1', { tags: [] });
  });

  it('Merge Patch：title 不允许清空', async () => {
    await expect(service.patchPost('post-1', { title: null }, ACTOR)).rejects.toThrow(ValidationError);
  });

  it('空 patch → VALIDATION_FAILED', async () => {
    await expect(service.patchPost('post-1', {}, ACTOR)).rejects.toThrow(ValidationError);
  });

  it('版主不能改写他人正文，只能隐藏/删除', async () => {
    fakes.roles.hasRole.mockResolvedValue(true);

    await expect(service.patchPost('post-1', { body: '改写' }, MODERATOR)).rejects.toThrow(ForbiddenError);
  });

  it('作者删除自己的帖子 → 软删除 + 版块计数 -1（不做物理删除）', async () => {
    await service.remove('post-1', ACTOR);

    expect(fakes.posts.update).toHaveBeenCalledWith('post-1', { status: 'DELETED' });
    expect(fakes.posts.remove).not.toHaveBeenCalled();
    expect(fakes.boards.adjustBoardPostCount).toHaveBeenCalledWith('board-1', -1);
  });

  it('陌生人删除 → FORBIDDEN', async () => {
    await expect(service.remove('post-1', STRANGER)).rejects.toThrow(ForbiddenError);
  });
});

describe('ForumService · 举报与阈值治理（契约 §11.2）', () => {
  let fakes: Fakes;
  let service: ForumService;

  beforeEach(() => {
    fakes = makeFakes();
    service = makeService(fakes);
  });

  it('首次举报：落库、返回报告人数 1、未触发自动隐藏', async () => {
    const result = await service.reportPost('post-1', { reason: 'spam' }, ACTOR);

    expect(fakes.reports.createReport).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'POST', targetId: 'post-1', reason: 'spam', reporterId: ACTOR }),
    );
    expect(result).toMatchObject({ duplicate: false, reportCount: 1, autoHidden: false });
  });

  it('同一人重复举报 → duplicate=true，不再新增记录（阈值不能被一个人刷出来）', async () => {
    fakes.reports.findReportByReporter.mockResolvedValue(makeReport());

    const result = await service.reportPost('post-1', { reason: 'spam' }, ACTOR);

    expect(fakes.reports.createReport).not.toHaveBeenCalled();
    expect(result.duplicate).toBe(true);
  });

  it('第 3 个不同举报人 → 自动隐藏并进人工队列（报告保持 PENDING）', async () => {
    fakes.reports.countDistinctReporters.mockResolvedValue(3);

    const result = await service.reportPost('post-1', { reason: 'abuse' }, STRANGER);

    expect(result).toMatchObject({ duplicate: false, reportCount: 3, autoHidden: true });
    expect(fakes.posts.update).toHaveBeenCalledWith('post-1', { status: 'HIDDEN' });
  });

  it('已隐藏的主题再次被举报不再重复隐藏', async () => {
    fakes.posts.findById.mockResolvedValue(makePost({ status: 'HIDDEN' }));
    fakes.reports.countDistinctReporters.mockResolvedValue(5);

    const result = await service.reportPost('post-1', { reason: 'abuse' }, STRANGER);

    expect(result.autoHidden).toBe(false);
    expect(fakes.posts.update).not.toHaveBeenCalled();
  });

  it('02-domain-model 的旧枚举 privacy 被归一化为 pii', async () => {
    await service.reportPost('post-1', { reason: 'privacy' }, ACTOR);

    expect(fakes.reports.createReport).toHaveBeenCalledWith(expect.objectContaining({ reason: 'pii' }));
  });

  it('非法举报原因 → VALIDATION_FAILED，不写库', async () => {
    await expect(service.reportPost('post-1', { reason: 'harassment' }, ACTOR)).rejects.toThrow(ValidationError);
    expect(fakes.reports.createReport).not.toHaveBeenCalled();
  });

  it('匿名举报：reporterId 为 null，reporterKey 是 anon: 前缀（与实名解耦）', async () => {
    await service.reportPost('post-1', { reason: 'pii', anonymous: true }, ACTOR);

    const input = fakes.reports.createReport.mock.calls[0]?.[0] as { reporterId: string | null; reporterKey: string };
    expect(input.reporterId).toBeNull();
    expect(input.reporterKey.startsWith('anon:')).toBe(true);
    expect(input.reporterKey).not.toContain(ACTOR);
  });

  it('匿名举报的 key 与匿名发帖的 handle 作用域不同（不可互推身份）', async () => {
    await service.reportPost('post-1', { reason: 'pii', anonymous: true }, ACTOR);

    const reporterKey = (fakes.reports.createReport.mock.calls[0]?.[0] as { reporterKey: string }).reporterKey;
    const authorHandle = anonHandleFor(ACTOR, anonThreadScope('post-1'), SECRET);
    expect(reporterKey).not.toBe(`anon:${authorHandle}`);
  });

  it('举报裁决需要版主权限', async () => {
    await expect(service.setReportStatus('report-1', 'UPHELD', ACTOR)).rejects.toThrow(ForbiddenError);

    fakes.roles.hasRole.mockResolvedValue(true);
    await expect(service.setReportStatus('report-1', 'UPHELD', MODERATOR)).resolves.toMatchObject({
      status: 'UPHELD',
    });
  });
});

describe('ForumService · 回复子资源', () => {
  let fakes: Fakes;
  let service: ForumService;

  beforeEach(() => {
    fakes = makeFakes();
    service = makeService(fakes);
  });

  it('锁定主题拒绝新回复 → CONFLICT', async () => {
    fakes.posts.findById.mockResolvedValue(makePost({ status: 'LOCKED' }));

    await expect(service.createReply('post-1', { body: '还有吗' }, ACTOR)).rejects.toThrow(ConflictError);
    expect(fakes.posts.addReply).not.toHaveBeenCalled();
  });

  it('匿名回复与同一人的匿名主题共享 handle（同帖同人一致）', async () => {
    await service.createPost({ boardId: 'board-1', title: 't', body: 'b', anonymous: true }, ACTOR);
    const postInput = fakes.posts.create.mock.calls[0]?.[0] as CreateForumPostInput;
    fakes.posts.findById.mockResolvedValue(makePost({ id: postInput.id, authorId: null, anonHandle: postInput.anonHandle }));

    await service.createReply(postInput.id, { body: '自问自答', anonymous: true }, ACTOR);

    const replyInput = fakes.posts.addReply.mock.calls[0]?.[0] as { authorId: string | null; anonHandle: string };
    expect(replyInput.authorId).toBeNull();
    expect(replyInput.anonHandle).toBe(postInput.anonHandle);
  });

  it('二级回复必须属于同一主题', async () => {
    fakes.posts.findReplyById.mockResolvedValue(makeReply({ postId: 'other-post' }));

    await expect(service.createReply('post-1', { body: 'x', parentReplyId: 'reply-9' }, ACTOR)).rejects.toThrow(
      ValidationError,
    );
  });

  it('回复列表：版主能看到被隐藏的回复，普通用户不能', async () => {
    await service.listReplies('post-1', { limit: 20 }, STRANGER);
    expect(fakes.posts.listReplies).toHaveBeenCalledWith(expect.objectContaining({ includeHidden: false }));

    fakes.roles.hasRole.mockResolvedValue(true);
    await service.listReplies('post-1', { limit: 20 }, MODERATOR);
    expect(fakes.posts.listReplies).toHaveBeenLastCalledWith(expect.objectContaining({ includeHidden: true }));
  });
});

describe('ForumService · 版块治理', () => {
  it('非版主建版块 → FORBIDDEN；版主建版块会用 slugify 生成 slug', async () => {
    const fakes = makeFakes();
    const service = makeService(fakes);
    fakes.boards.findBoardByIdOrSlug.mockResolvedValue(null);

    await expect(service.createBoard({ name: 'Campus Life' }, ACTOR)).rejects.toThrow(ForbiddenError);

    fakes.roles.hasRole.mockResolvedValue(true);
    await service.createBoard({ name: 'Campus Life' }, MODERATOR);

    expect(fakes.boards.createBoard).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'campus-life', name: 'Campus Life', visibility: 'public' }),
    );
  });

  it('中文版块名 slugify 为空时用 ULID 兜底（slug 唯一约束不会撞空串）', async () => {
    const fakes = makeFakes();
    const service = makeService(fakes);
    fakes.roles.hasRole.mockResolvedValue(true);
    fakes.boards.findBoardByIdOrSlug.mockResolvedValue(null);

    await service.createBoard({ name: '校园生活' }, MODERATOR);

    const input = fakes.boards.createBoard.mock.calls[0]?.[0] as { slug: string };
    expect(input.slug).toMatch(/^[0-9a-z]{26}$/);
  });

  it('slug 已存在 → CONFLICT', async () => {
    const fakes = makeFakes();
    const service = makeService(fakes);
    fakes.roles.hasRole.mockResolvedValue(true);

    await expect(service.createBoard({ slug: 'campus', name: '校园' }, MODERATOR)).rejects.toThrow(ConflictError);
  });
});
