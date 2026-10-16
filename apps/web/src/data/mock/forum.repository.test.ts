import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from './cursor';
import { createForumSeed } from './fixtures/forum';
import { createMockForumRepository, filterForumPosts } from './forum.repository';

const NOW = new Date('2026-10-16T10:00:00.000Z');

function repo() {
  return createMockForumRepository({ now: () => NOW, latencyMs: 0 });
}

function draft(overrides: Partial<Parameters<ReturnType<typeof repo>['createPost']>[0]> = {}) {
  return {
    boardId: 'fb-01',
    title: '图书馆四楼插座还开着吗',
    body: '想找个能充电的位置，求情报。',
    tags: ['图书馆'],
    anonymous: false,
    authorId: 'u_1024',
    authorNickname: '鸭鸭先冲',
    ...overrides,
  };
}

describe('游标工具', () => {
  it('encode/decode 往返，非法游标退化为 0', () => {
    expect(decodeCursor(encodeCursor(7))).toBe(7);
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor('nonsense')).toBe(0);
    expect(decodeCursor('c_-1')).toBe(0);
  });

  it('契约 §11.10-E：游标对客户端不透明 —— 复合格式（base64）不解析、不抛异常，安全退化为首页', async () => {
    const opaque = 'eyJvIjo0LCJ0IjoiMjAyNi0xMC0xNlQxMDowMDowMFoifQ==';
    expect(decodeCursor(opaque)).toBe(0);

    const result = await repo().listPosts({ cursor: opaque, limit: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 没有崩溃，返回第一页（服务端自行决定如何解释未知游标）
    expect(result.value.items).toHaveLength(4);
    expect(result.value.items[0]?.id).toBe('fp-1002');
  });
});

describe('mock 数据集（无后端可跑）', () => {
  it('覆盖全部 5 种主题状态与 4 个版块', () => {
    const seed = createForumSeed(NOW);
    expect(new Set(seed.posts.map((p) => p.status))).toEqual(
      new Set(['DRAFT', 'PUBLISHED', 'LOCKED', 'HIDDEN', 'DELETED']),
    );
    expect(seed.boards).toHaveLength(4);
    expect(seed.boards.some((b) => b.visibility === 'campus_only')).toBe(true);
    for (const post of seed.posts) {
      expect(post.createdAt.endsWith('Z')).toBe(true);
    }
  });

  it('filterForumPosts 排除 DRAFT/DELETED，默认保留被治理的主题', () => {
    const posts = createForumSeed(NOW).posts;
    const all = filterForumPosts(posts, {});
    expect(all.map((p) => p.id)).not.toContain('fp-1007'); // DRAFT
    expect(all.map((p) => p.id)).not.toContain('fp-1008'); // DELETED
    expect(all.map((p) => p.id)).toContain('fp-1006'); // HIDDEN 仍在

    const withoutGoverned = filterForumPosts(posts, { includeGoverned: false });
    expect(withoutGoverned.map((p) => p.id)).not.toContain('fp-1006');
    expect(withoutGoverned.map((p) => p.id)).not.toContain('fp-1004'); // LOCKED
  });
});

describe('mock 论坛仓储（契约形状）', () => {
  it('listBoards 返回全部版块（含需登录的 campus_only）', async () => {
    const result = await repo().listBoards();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(4);
    expect(result.value.find((b) => b.slug === 'study')?.visibility).toBe('campus_only');
  });

  it('listPosts 游标分页且两页不重叠，置顶优先', async () => {
    const repository = repo();
    const first = await repository.listPosts({ limit: 4 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.value.items).toHaveLength(4);
    expect(first.value.total).toBe(6);
    expect(first.value.nextCursor).toBe('c_4');
    // 置顶的公告排第一（fp-1002）
    expect(first.value.items[0]?.id).toBe('fp-1002');

    const second = await repository.listPosts({
      limit: 4,
      cursor: first.value.nextCursor ?? undefined,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.items).toHaveLength(2);
    expect(second.value.nextCursor).toBeNull();

    const firstIds = first.value.items.map((p) => p.id);
    const secondIds = second.value.items.map((p) => p.id);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });

  it('listPosts 支持版块筛选与关键词搜索', async () => {
    const repository = repo();

    const byBoard = await repository.listPosts({ boardId: 'fb-01' });
    expect(byBoard.ok).toBe(true);
    if (byBoard.ok) {
      expect(byBoard.value.items).toHaveLength(3);
      expect(byBoard.value.items.every((p) => p.boardId === 'fb-01')).toBe(true);
    }

    const byKeyword = await repository.listPosts({ keyword: '麻辣香锅' });
    expect(byKeyword.ok).toBe(true);
    if (byKeyword.ok) {
      expect(byKeyword.value.items).toHaveLength(1);
      expect(byKeyword.value.items[0]?.id).toBe('fp-1001');
    }

    const noMatch = await repository.listPosts({ keyword: '不存在的关键词' });
    expect(noMatch.ok).toBe(true);
    if (noMatch.ok) {
      expect(noMatch.value.items).toEqual([]);
      expect(noMatch.value.total).toBe(0);
    }
  });

  it('postDetail：HIDDEN 主题仍可打开并带明确状态（不静默消失）', async () => {
    const repository = repo();
    const hidden = await repository.postDetail('fp-1006');
    expect(hidden.ok).toBe(true);
    if (hidden.ok) {
      expect(hidden.value.post.status).toBe('HIDDEN');
      expect(hidden.value.post.tags).toContain('二手');
    }

    const locked = await repository.postDetail('fp-1004');
    expect(locked.ok).toBe(true);
    if (locked.ok) expect(locked.value.post.status).toBe('LOCKED');

    // 草稿与已删除主题对他人不可见
    const draftPost = await repository.postDetail('fp-1007');
    expect(draftPost.ok).toBe(false);
    if (!draftPost.ok) expect(draftPost.error.code).toBe('NOT_FOUND');

    const deleted = await repository.postDetail('fp-1008');
    expect(deleted.ok).toBe(false);
    if (!deleted.ok) expect(deleted.error.code).toBe('NOT_FOUND');
  });

  it('postDetail 返回按时间正序的回复，含二级回复', async () => {
    const result = await repo().postDetail('fp-1001');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.replies.map((r) => r.id)).toEqual(['fr-2001', 'fr-2002', 'fr-2003']);
    expect(result.value.replies[1]?.parentReplyId).toBe('fr-2001');
    expect(result.value.repliesNextCursor).toBeNull();
  });

  it('listReplies 支持游标分页，主题不存在返回 NOT_FOUND', async () => {
    const repository = repo();
    const first = await repository.listReplies({ postId: 'fp-1001', limit: 2 });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.items).toHaveLength(2);
      expect(first.value.nextCursor).toBe('c_2');
    }

    const missing = await repository.listReplies({ postId: 'fp-9999' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND');
  });
});

describe('匿名开关语义（端到端：application → port → mock）', () => {
  it('匿名发帖：出站对象只有匿名身份 id，实名 id 只留在仓储私有映射里', async () => {
    const repository = repo();
    const result = await repository.createPost(draft({ anonymous: true, boardId: 'fb-01' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const post = result.value;
    expect(post.anonymous).toBe(true);
    expect(post.authorNickname).toBe('匿名同学');
    expect(post.authorId.startsWith('anon_')).toBe(true);
    expect(post.authorId).not.toBe('u_1024');
    expect(post.authorId.includes('u_1024')).toBe(false);
    // 版主可追溯（同一版块内的匿名身份 → 实名），普通用户拿不到
    expect(repository.realAuthorOfPost(post.id)).toBe('u_1024');
  });

  it('同一用户在同一版块的匿名身份稳定，跨版块不可拼接', async () => {
    const repository = repo();
    const inBoard1 = await repository.createPost(
      draft({ anonymous: true, boardId: 'fb-01', title: '匿名帖 A' }),
    );
    const inBoard2 = await repository.createPost(
      draft({ anonymous: true, boardId: 'fb-02', title: '匿名帖 B' }),
    );
    expect(inBoard1.ok && inBoard2.ok).toBe(true);
    if (!inBoard1.ok || !inBoard2.ok) return;

    expect(inBoard1.value.authorId).not.toBe(inBoard2.value.authorId);
  });

  it('实名发帖保留昵称与实名 id', async () => {
    const repository = repo();
    const result = await repository.createPost(draft({ boardId: 'fb-02', title: '实名帖' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.authorId).toBe('u_1024');
    expect(result.value.authorNickname).toBe('鸭鸭先冲');
    expect(result.value.status).toBe('PUBLISHED');
  });

  it('发帖会更新版块冗余计数与最近活跃时间', async () => {
    const repository = repo();
    const before = await repository.listBoards();
    const beforeCount = before.ok ? before.value.find((b) => b.id === 'fb-02')?.postCount : undefined;

    await repository.createPost(draft({ boardId: 'fb-02', title: '计数验证' }));

    const after = await repository.listBoards();
    expect(after.ok).toBe(true);
    if (after.ok) {
      const board = after.value.find((b) => b.id === 'fb-02');
      expect(board?.postCount).toBe((beforeCount ?? 0) + 1);
      expect(board?.lastPostAt).toBe(NOW.toISOString());
    }
  });
});

describe('mock 治理行为', () => {
  it('发帖校验：空标题 / 敏感词 → VALIDATION_FAILED（不静默改写）', async () => {
    const repository = repo();

    const emptyTitle = await repository.createPost(draft({ title: '   ' }));
    expect(emptyTitle.ok).toBe(false);
    if (!emptyTitle.ok) {
      expect(emptyTitle.error.code).toBe('VALIDATION_FAILED');
      expect(emptyTitle.error.details).toBeTruthy();
    }

    const sensitive = await repository.createPost(draft({ body: '有偿代考，价格好谈' }));
    expect(sensitive.ok).toBe(false);
    if (!sensitive.ok) {
      expect(sensitive.error.code).toBe('VALIDATION_FAILED');
      expect(sensitive.error.message).toContain('敏感词');
    }
  });

  it('版块不存在 → NOT_FOUND', async () => {
    const result = await repo().createPost(draft({ boardId: 'fb-nope' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('发帖频率：10 分钟内第 4 帖 → RATE_LIMITED（匿名不豁免）', async () => {
    const repository = repo();
    for (let i = 0; i < 3; i += 1) {
      const ok = await repository.createPost(draft({ title: `第 ${i + 1} 帖`, anonymous: true }));
      expect(ok.ok).toBe(true);
    }
    const fourth = await repository.createPost(draft({ title: '第 4 帖' }));
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) {
      expect(fourth.error.code).toBe('RATE_LIMITED');
      expect(fourth.error.message).toContain('10 分钟内最多发 3 帖');
    }
  });

  it('回复：已发布可回，锁定/隐藏主题 → CONFLICT，并更新回复计数', async () => {
    const repository = repo();

    const before = await repository.postDetail('fp-1001');
    const beforeCount = before.ok ? before.value.post.replyCount : 0;

    const ok = await repository.createReply({
      postId: 'fp-1001',
      body: '11 点前去基本不用等。',
      anonymous: true,
      authorId: 'u_1024',
      authorNickname: '鸭鸭先冲',
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.authorNickname).toBe('匿名同学');
      expect(ok.value.authorId.startsWith('anon_')).toBe(true);
    }

    const after = await repository.postDetail('fp-1001');
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value.post.replyCount).toBe(beforeCount + 1);

    const locked = await repository.createReply({
      postId: 'fp-1004',
      body: '还能回吗',
      anonymous: false,
      authorId: 'u_1024',
      authorNickname: '鸭鸭先冲',
    });
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.error.code).toBe('CONFLICT');
      expect(locked.error.message).toContain('锁定');
    }

    const hidden = await repository.createReply({
      postId: 'fp-1006',
      body: '还能回吗',
      anonymous: false,
      authorId: 'u_1024',
      authorNickname: '鸭鸭先冲',
    });
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) expect(hidden.error.code).toBe('CONFLICT');
  });

  it('回复频率：1 分钟内第 6 条 → RATE_LIMITED', async () => {
    const repository = repo();
    for (let i = 0; i < 5; i += 1) {
      const ok = await repository.createReply({
        postId: 'fp-1001',
        body: `第 ${i + 1} 条`,
        anonymous: false,
        authorId: 'u_1024',
        authorNickname: '鸭鸭先冲',
      });
      expect(ok.ok).toBe(true);
    }
    const sixth = await repository.createReply({
      postId: 'fp-1001',
      body: '第 6 条',
      anonymous: false,
      authorId: 'u_1024',
      authorNickname: '鸭鸭先冲',
    });
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.error.code).toBe('RATE_LIMITED');
  });

  it('举报：不能举报自己、不能重复举报、目标不存在', async () => {
    const repository = repo();

    const own = await repository.report({
      targetType: 'POST',
      targetId: 'fp-1001',
      reason: 'spam',
      reporterId: 'u_1024',
      anonymous: false,
    });
    expect(own.ok).toBe(false);
    if (!own.ok) {
      expect(own.error.code).toBe('VALIDATION_FAILED');
      expect(own.error.message).toContain('不能举报自己');
    }

    const first = await repository.report({
      targetType: 'POST',
      targetId: 'fp-1001',
      reason: 'abuse',
      reporterId: 'u_9001',
      anonymous: true,
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.status).toBe('PENDING');

    const duplicate = await repository.report({
      targetType: 'POST',
      targetId: 'fp-1001',
      reason: 'abuse',
      reporterId: 'u_9001',
      anonymous: true,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.code).toBe('CONFLICT');

    const missing = await repository.report({
      targetType: 'REPLY',
      targetId: 'fr-nope',
      reason: 'other',
      reporterId: 'u_9001',
      anonymous: false,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND');
  });

  it('3 个不同用户举报 → 主题自动 HIDDEN，但仍在列表里出现并带状态', async () => {
    const repository = repo();

    for (const reporterId of ['u_9001', 'u_9002']) {
      const result = await repository.report({
        targetType: 'POST',
        targetId: 'fp-1003',
        reason: 'spam',
        reporterId,
        anonymous: false,
      });
      expect(result.ok).toBe(true);
    }

    const stillPublished = await repository.postDetail('fp-1003');
    expect(stillPublished.ok).toBe(true);
    if (stillPublished.ok) expect(stillPublished.value.post.status).toBe('PUBLISHED');

    const third = await repository.report({
      targetType: 'POST',
      targetId: 'fp-1003',
      reason: 'privacy',
      reporterId: 'u_9003',
      anonymous: true,
    });
    expect(third.ok).toBe(true);

    const hidden = await repository.postDetail('fp-1003');
    expect(hidden.ok).toBe(true);
    if (hidden.ok) expect(hidden.value.post.status).toBe('HIDDEN');

    const list = await repository.listPosts({});
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value.items.map((p) => p.id)).toContain('fp-1003');
      expect(list.value.items.find((p) => p.id === 'fp-1003')?.status).toBe('HIDDEN');
    }
  });

  it('举报回复也会在达到阈值后隐藏该回复', async () => {
    const repository = repo();
    for (const reporterId of ['u_9001', 'u_9002', 'u_9003']) {
      const result = await repository.report({
        targetType: 'REPLY',
        targetId: 'fr-2003',
        reason: 'abuse',
        reporterId,
        anonymous: false,
      });
      expect(result.ok).toBe(true);
    }
    const detail = await repository.postDetail('fp-1001');
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(detail.value.replies.find((r) => r.id === 'fr-2003')?.status).toBe('HIDDEN');
    }
  });
});

describe('故障演练与重置（三态之 error）', () => {
  it('failureMode=error 时所有请求返回 UPSTREAM_UNAVAILABLE，恢复后可读', async () => {
    const repository = repo();
    expect(repository.getFailureMode()).toBe('none');

    repository.setFailureMode('error');
    const list = await repository.listPosts({});
    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.error.code).toBe('UPSTREAM_UNAVAILABLE');

    const boards = await repository.listBoards();
    expect(boards.ok).toBe(false);

    const detail = await repository.postDetail('fp-1001');
    expect(detail.ok).toBe(false);

    const created = await repository.createPost(draft({ title: '故障期间发帖' }));
    expect(created.ok).toBe(false);

    const reported = await repository.report({
      targetType: 'POST',
      targetId: 'fp-1001',
      reason: 'spam',
      reporterId: 'u_9001',
      anonymous: false,
    });
    expect(reported.ok).toBe(false);

    repository.setFailureMode('none');
    const recovered = await repository.listPosts({});
    expect(recovered.ok).toBe(true);
  });

  it('reset 恢复初始数据集', async () => {
    const repository = repo();
    await repository.createPost(draft({ title: '临时帖' }));
    const afterCreate = await repository.listPosts({});
    expect(afterCreate.ok).toBe(true);
    if (afterCreate.ok) expect(afterCreate.value.total).toBe(7);

    repository.reset();
    const afterReset = await repository.listPosts({});
    expect(afterReset.ok).toBe(true);
    if (afterReset.ok) expect(afterReset.value.total).toBe(6);
  });
});
