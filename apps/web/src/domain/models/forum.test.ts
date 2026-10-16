import { describe, expect, it } from 'vitest';

import {
  ANONYMOUS_AUTHOR_LABEL,
  ANONYMITY_NOTICE,
  canReplyToPost,
  canTransitionPost,
  canTransitionReply,
  checkPostRateLimit,
  checkReplyRateLimit,
  countPostsByStatus,
  deriveAnonymousIdentityId,
  draftPrivacyHints,
  excerpt,
  findSensitiveWords,
  hasReported,
  isBoardAccessible,
  isPostContentVisible,
  isPostListable,
  nextPostStatuses,
  normalizeTags,
  parseTagInput,
  postVisibility,
  replyBlockedReason,
  reportThresholdReached,
  resolveAuthorLabel,
  shouldAutoHide,
  sortPosts,
  sortReplies,
  transitionPostStatus,
  transitionReplyStatus,
  validateForumPostDraft,
  validateForumReplyDraft,
  type ForumPost,
  type ForumReply,
  type ForumReport,
} from './forum';

const NOW = new Date('2026-10-16T10:00:00.000Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function makePost(overrides: Partial<ForumPost> = {}): ForumPost {
  return {
    id: 'fp-1',
    boardId: 'fb-01',
    title: '三食堂几点人最少？',
    body: '正文',
    status: 'PUBLISHED',
    anonymous: false,
    authorId: 'u_1024',
    authorNickname: '鸭鸭先冲',
    tags: ['食堂'],
    replyCount: 0,
    likeCount: 0,
    pinnedAt: null,
    createdAt: NOW.toISOString(),
    lastActivityAt: NOW.toISOString(),
    ...overrides,
  };
}

function makeReply(overrides: Partial<ForumReply> = {}): ForumReply {
  return {
    id: 'fr-1',
    postId: 'fp-1',
    parentReplyId: null,
    body: '回复',
    status: 'PUBLISHED',
    anonymous: false,
    authorId: 'u_1024',
    authorNickname: '鸭鸭先冲',
    likeCount: 0,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('匿名身份（契约 §9：与实名身份解耦）', () => {
  it('同一 (用户, 版块) 恒定，跨版块不同', () => {
    const a = deriveAnonymousIdentityId('u_1024', 'fb-01');
    const b = deriveAnonymousIdentityId('u_1024', 'fb-01');
    const c = deriveAnonymousIdentityId('u_1024', 'fb-02');
    const d = deriveAnonymousIdentityId('u_2048', 'fb-01');

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a.startsWith('anon_')).toBe(true);
  });

  it('输出不含实名 id 明文（解耦存储，避免泄露）', () => {
    const anon = deriveAnonymousIdentityId('u_1024', 'fb-01');
    expect(anon.includes('u_1024')).toBe(false);
  });

  it('匿名条目的展示名一律「匿名同学」，绝不回退实名昵称', () => {
    expect(resolveAuthorLabel({ anonymous: true, authorNickname: '鸭鸭先冲' })).toBe(
      ANONYMOUS_AUTHOR_LABEL,
    );
    expect(resolveAuthorLabel({ anonymous: false, authorNickname: '鸭鸭先冲' })).toBe('鸭鸭先冲');
  });

  it('匿名说明同时覆盖「实名不关联」与「版主可追溯」，不能只讲一半', () => {
    expect(ANONYMITY_NOTICE).toContain('实名身份不会与帖子关联');
    expect(ANONYMITY_NOTICE).toContain('版主追溯');
  });
});

describe('治理可见性（被隐藏的主题不得静默消失）', () => {
  it('HIDDEN / LOCKED 仍在列表里出现，DELETED / DRAFT 不出现', () => {
    expect(isPostListable({ status: 'HIDDEN' })).toBe(true);
    expect(isPostListable({ status: 'LOCKED' })).toBe(true);
    expect(isPostListable({ status: 'PUBLISHED' })).toBe(true);
    expect(isPostListable({ status: 'DELETED' })).toBe(false);
    expect(isPostListable({ status: 'DRAFT' })).toBe(false);
  });

  it('HIDDEN 正文不可见且不能回复，并带明确说明', () => {
    expect(isPostContentVisible({ status: 'HIDDEN' })).toBe(false);
    expect(canReplyToPost({ status: 'HIDDEN' })).toBe(false);
    const visibility = postVisibility('HIDDEN');
    expect(visibility.notice).toContain('因举报被隐藏');
    expect(visibility.notice).toContain('不会静默消失');
    expect(visibility.tone).toBe('danger');
  });

  it('LOCKED 可读不可回复，说明里写明原因', () => {
    expect(isPostContentVisible({ status: 'LOCKED' })).toBe(true);
    expect(canReplyToPost({ status: 'LOCKED' })).toBe(false);
    expect(replyBlockedReason({ status: 'LOCKED' })).toContain('不再接受新回复');
    expect(replyBlockedReason({ status: 'PUBLISHED' })).toBeNull();
  });
});

describe('主题状态机（严格对齐域模型 §2.4）', () => {
  it('合法迁移与非法迁移', () => {
    expect(canTransitionPost('DRAFT', 'PUBLISHED')).toBe(true);
    expect(canTransitionPost('PUBLISHED', 'LOCKED')).toBe(true);
    expect(canTransitionPost('LOCKED', 'PUBLISHED')).toBe(true);
    expect(canTransitionPost('PUBLISHED', 'HIDDEN')).toBe(true);
    expect(canTransitionPost('HIDDEN', 'PUBLISHED')).toBe(true);
    expect(canTransitionPost('DELETED', 'PUBLISHED')).toBe(false);
    expect(canTransitionPost('DRAFT', 'LOCKED')).toBe(false);
  });

  it('transitionPostStatus 非法返回 null，合法返回新对象且不可变', () => {
    const post = makePost({ status: 'PUBLISHED' });
    const locked = transitionPostStatus(post, 'LOCKED');
    expect(locked?.status).toBe('LOCKED');
    expect(post.status).toBe('PUBLISHED');
    expect(transitionPostStatus(post, 'DRAFT')).toBeNull();
    expect(nextPostStatuses('DELETED')).toEqual([]);
  });

  it('回复状态机只有 PUBLISHED/HIDDEN → DELETED 等合法路径', () => {
    expect(canTransitionReply('PUBLISHED', 'HIDDEN')).toBe(true);
    expect(canTransitionReply('HIDDEN', 'PUBLISHED')).toBe(true);
    expect(canTransitionReply('DELETED', 'PUBLISHED')).toBe(false);
    const reply = makeReply();
    expect(transitionReplyStatus(reply, 'HIDDEN')?.status).toBe('HIDDEN');
    expect(transitionReplyStatus(reply, 'DELETED')?.status).toBe('DELETED');
    expect(transitionReplyStatus({ ...reply, status: 'DELETED' }, 'PUBLISHED')).toBeNull();
  });
});

describe('举报治理（3 个不同用户 → 自动隐藏）', () => {
  const reports = [
    { reporterId: 'u_a', status: 'UPHELD' as const },
    { reporterId: 'u_b', status: 'PENDING' as const },
    { reporterId: 'u_c', status: 'PENDING' as const },
  ];

  it('阈值按**不同用户**计，同一人重复举报只算 1 票', () => {
    expect(reportThresholdReached([{ reporterId: 'u_a' }, { reporterId: 'u_a' }])).toBe(false);
    expect(reportThresholdReached(reports)).toBe(true);
    expect(reportThresholdReached(reports, 4)).toBe(false);
  });

  it('DISMISSED 的举报不计票（举报不成立时不维持隐藏）', () => {
    const dismissed = [
      { reporterId: 'u_a', status: 'UPHELD' as const },
      { reporterId: 'u_b', status: 'DISMISSED' as const },
      { reporterId: 'u_c', status: 'DISMISSED' as const },
    ];
    expect(shouldAutoHide(dismissed)).toBe(false);
    expect(shouldAutoHide(reports)).toBe(true);
  });

  it('hasReported 判定同一用户对同一目标是否已举报', () => {
    const list: Array<Pick<ForumReport, 'reporterId' | 'targetId'>> = [
      { reporterId: 'u_a', targetId: 'fp-1' },
    ];
    expect(hasReported(list, 'u_a', 'fp-1')).toBe(true);
    expect(hasReported(list, 'u_a', 'fp-2')).toBe(false);
  });
});

describe('发帖 / 回复频率上限', () => {
  it('10 分钟 3 帖：第 4 帖被拒并给出等待时间', () => {
    const two = [minutesAgo(1), minutesAgo(2)];
    expect(checkPostRateLimit(two, NOW).allowed).toBe(true);

    const three = [minutesAgo(1), minutesAgo(2), minutesAgo(3)];
    const verdict = checkPostRateLimit(three, NOW);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('10 分钟内最多发 3 帖');
    expect(verdict.retryAfterMs).toBe(7 * 60_000);
  });

  it('窗口外的旧帖不再计入', () => {
    const old = [minutesAgo(11), minutesAgo(12), minutesAgo(13)];
    expect(checkPostRateLimit(old, NOW).allowed).toBe(true);
  });

  it('24 小时 20 帖的上限单独生效', () => {
    const spread = Array.from({ length: 20 }, (_, i) => minutesAgo((i + 1) * 60));
    const verdict = checkPostRateLimit(spread, NOW);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('24 小时内最多发 20 帖');
  });

  it('回复 1 分钟 5 条', () => {
    // 窗口判定是「严格晚于 now-60s」，所以用秒级间隔构造窗口内的 5 条
    const five = [0, 10, 20, 30, 40].map((s) => new Date(NOW.getTime() - s * 1000).toISOString());
    expect(checkReplyRateLimit(five, NOW).allowed).toBe(false);
    expect(checkReplyRateLimit(five.slice(0, 4), NOW).allowed).toBe(true);
    expect(checkReplyRateLimit(five, NOW).reason).toContain('1 分钟内最多回复 5 次');
  });
});

describe('草稿校验（敏感词命中即拦截，不静默改写）', () => {
  const validDraft = {
    boardId: 'fb-01',
    title: '三食堂几点人最少？',
    body: '每次 12 点去都排 20 分钟。',
    tags: ['食堂'],
    anonymous: false,
  };

  it('合法草稿零问题', () => {
    expect(validateForumPostDraft(validDraft)).toEqual([]);
  });

  it('缺版块 / 空正文 / 标题超长都会报问题', () => {
    expect(validateForumPostDraft({ ...validDraft, boardId: '' })).toContain('请选择版块');
    expect(validateForumPostDraft({ ...validDraft, body: '   ' })).toContain('正文不能为空');
    const tooLong = validateForumPostDraft({ ...validDraft, title: '标'.repeat(101) });
    expect(tooLong.some((p) => p.includes('标题长度'))).toBe(true);
  });

  it('标签超量 / 超长会报问题，normalizeTags 去重并截断', () => {
    const tooMany = validateForumPostDraft({
      ...validDraft,
      tags: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(tooMany.some((p) => p.includes('标签最多'))).toBe(true);

    const tooLongTag = validateForumPostDraft({ ...validDraft, tags: ['x'.repeat(17)] });
    expect(tooLongTag.some((p) => p.includes('单个标签'))).toBe(true);

    expect(normalizeTags(['  食堂 ', '食堂', '排队', '', 'a', 'b', 'c', 'd'])).toEqual([
      '食堂',
      '排队',
      'a',
      'b',
      'c',
    ]);
    expect(parseTagInput('食堂，排队 快递')).toEqual(['食堂', '排队', '快递']);
  });

  it('敏感词命中 → 拦截并明确提示（不改写内容）', () => {
    const problems = validateForumPostDraft({ ...validDraft, body: '有偿代考，价格好谈' });
    expect(problems.some((p) => p.includes('敏感词'))).toBe(true);
    expect(problems.some((p) => p.includes('不会被静默改写'))).toBe(true);
    expect(findSensitiveWords('正常内容')).toEqual([]);
    expect(findSensitiveWords('有偿代考')).toEqual(['代考']);
  });

  it('回复草稿校验：空内容 / 超长 / 敏感词', () => {
    expect(validateForumReplyDraft({ postId: 'fp-1', body: '', anonymous: false })).toContain(
      '回复内容不能为空',
    );
    expect(
      validateForumReplyDraft({ postId: 'fp-1', body: 'x'.repeat(5001), anonymous: false }).some((p) =>
        p.includes('回复不能超过'),
      ),
    ).toBe(true);
    expect(
      validateForumReplyDraft({ postId: 'fp-1', body: '代考', anonymous: true }).some((p) =>
        p.includes('敏感词'),
      ),
    ).toBe(true);
    expect(validateForumReplyDraft({ postId: 'fp-1', body: '好的', anonymous: false })).toEqual([]);
  });

  it('隐私提示：疑似个人信息 / 匿名帖自报身份', () => {
    expect(
      draftPrivacyHints({ title: '联系方式', body: '我的手机 13800000000' }).some((h) =>
        h.includes('个人信息'),
      ),
    ).toBe(true);
    expect(
      draftPrivacyHints({ title: '树洞', body: '我是 2023 级的，学号 12345678', anonymous: true }).some(
        (h) => h.includes('匿名发布时请避免'),
      ),
    ).toBe(true);
    expect(draftPrivacyHints({ title: '正常', body: '正常内容', anonymous: true })).toEqual([]);
  });
});

describe('排序与聚合', () => {
  it('置顶优先，其余按最近活跃倒序', () => {
    const pinned = makePost({ id: 'pinned', pinnedAt: minutesAgo(60 * 24), lastActivityAt: minutesAgo(5000) });
    const fresh = makePost({ id: 'fresh', lastActivityAt: minutesAgo(10) });
    const old = makePost({ id: 'old', lastActivityAt: minutesAgo(600) });
    expect(sortPosts([old, fresh, pinned]).map((p) => p.id)).toEqual(['pinned', 'fresh', 'old']);
  });

  it('回复按时间正序，countPostsByStatus 统计各状态', () => {
    const a = makeReply({ id: 'a', createdAt: minutesAgo(30) });
    const b = makeReply({ id: 'b', createdAt: minutesAgo(5) });
    expect(sortReplies([b, a]).map((r) => r.id)).toEqual(['a', 'b']);

    const counts = countPostsByStatus([
      makePost({ status: 'PUBLISHED' }),
      makePost({ status: 'HIDDEN' }),
      makePost({ status: 'HIDDEN' }),
      makePost({ status: 'DELETED' }),
    ]);
    expect(counts).toEqual({ DRAFT: 0, PUBLISHED: 1, LOCKED: 0, HIDDEN: 2, DELETED: 1 });
  });

  it('campus_only 版块需要登录', () => {
    expect(isBoardAccessible({ visibility: 'public' }, { authenticated: false })).toBe(true);
    expect(isBoardAccessible({ visibility: 'campus_only' }, { authenticated: false })).toBe(false);
    expect(isBoardAccessible({ visibility: 'campus_only' }, { authenticated: true })).toBe(true);
  });

  it('excerpt 去掉 Markdown 标记并截断', () => {
    expect(excerpt('## 标题\n\n**加粗**正文 [链接](https://a.b)')).toBe('标题 加粗 正文 链接');
    const long = excerpt('字'.repeat(200), 10);
    expect(long.endsWith('…')).toBe(true);
    expect([...long].length).toBe(11);
  });
});
