import { describe, expect, it } from 'vitest';

import type { ApiError, Page } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import { createMockForumRepository } from '@/data/mock/forum.repository';
import type { ForumBoard, ForumPost, ForumReply } from '@/domain/models/forum';
import type { ForumPostDetail, ForumRepository } from '@/domain/ports/forum';

import { deriveViewState } from '../viewState';
import {
  createEmptyForumDraft,
  isForumDraftDirty,
  anonymityNoticeFor,
  submitForumPost,
  toCreatePostInput,
  validateForumComposerDraft,
} from './composeForumPost';
import {
  loadForumPostDetailWithBoard,
  toForumPostDetailVM,
  toForumReplyVM,
} from './getForumPostDetail';
import {
  forumListState,
  loadForumPostList,
  toForumBoardVM,
  toForumPostItemVM,
  toForumPostListVM,
} from './listForumPosts';
import {
  FORUM_REPORT_REASON_OPTIONS,
  REPORT_THRESHOLD_NOTICE,
  replyToForumPost,
  submitForumReport,
  toForumReportReceiptVM,
} from './reportForumTarget';
import { ANONYMOUS_FORUM_SESSION, DEMO_FORUM_SESSION } from './session';

const NOW = new Date('2026-10-16T10:00:00.000Z');

function makeBoard(overrides: Partial<ForumBoard> = {}): ForumBoard {
  return {
    id: 'fb-01',
    slug: 'campus-life',
    name: '校园生活',
    description: '日常互助',
    visibility: 'public',
    postCount: 3,
    lastPostAt: '2026-10-16T09:35:00.000Z',
    ...overrides,
  };
}

function makePost(overrides: Partial<ForumPost> = {}): ForumPost {
  return {
    id: 'fp-1',
    boardId: 'fb-01',
    title: '三食堂几点人最少？',
    body: '每次 12 点去都排 20 分钟。',
    status: 'PUBLISHED',
    anonymous: false,
    authorId: 'u_1024',
    authorNickname: '鸭鸭先冲',
    tags: ['食堂'],
    replyCount: 2,
    likeCount: 5,
    pinnedAt: null,
    createdAt: '2026-10-16T05:00:00.000Z',
    lastActivityAt: '2026-10-16T09:35:00.000Z',
    ...overrides,
  };
}

function makeReply(overrides: Partial<ForumReply> = {}): ForumReply {
  return {
    id: 'fr-1',
    postId: 'fp-1',
    parentReplyId: null,
    body: '11:15 去基本不用排。',
    status: 'PUBLISHED',
    anonymous: false,
    authorId: 'u_2048',
    authorNickname: '图书馆常驻',
    likeCount: 3,
    createdAt: '2026-10-16T06:00:00.000Z',
    ...overrides,
  };
}

function fakeRepository(overrides: Partial<ForumRepository> = {}): ForumRepository {
  return {
    listBoards: async () => ok<ForumBoard[]>([]),
    listPosts: async () =>
      ok<Page<ForumPost>>({ items: [], nextCursor: null, total: 0 }),
    postDetail: async () =>
      err<ApiError>({ code: 'NOT_FOUND', message: '主题不存在' }),
    listReplies: async () =>
      ok<Page<ForumReply>>({ items: [], nextCursor: null, total: 0 }),
    createPost: async () => err<ApiError>({ code: 'INTERNAL', message: '未实现' }),
    createReply: async () => err<ApiError>({ code: 'INTERNAL', message: '未实现' }),
    report: async () => err<ApiError>({ code: 'INTERNAL', message: '未实现' }),
    ...overrides,
  };
}

function mockRepository() {
  return createMockForumRepository({ now: () => NOW, latencyMs: 0 });
}

describe('四态选择器（三态可单测）', () => {
  it('优先级 loading > error > empty > ready', () => {
    expect(deriveViewState({ isPending: true, isError: true, isEmpty: true })).toBe('loading');
    expect(deriveViewState({ isPending: false, isError: true, isEmpty: true })).toBe('error');
    expect(deriveViewState({ isPending: false, isError: false, isEmpty: true })).toBe('empty');
    expect(deriveViewState({ isPending: false, isError: false, isEmpty: false })).toBe('ready');
  });

  it('forumListState 把条目数映射成空态 / 就绪态', () => {
    expect(forumListState({ isPending: true, isError: false, itemCount: 0 })).toBe('loading');
    expect(forumListState({ isPending: false, isError: true, itemCount: 0 })).toBe('error');
    expect(forumListState({ isPending: false, isError: false, itemCount: 0 })).toBe('empty');
    expect(forumListState({ isPending: false, isError: false, itemCount: 3 })).toBe('ready');
  });
});

describe('版块视图模型', () => {
  it('campus_only 未登录时不可访问，但仍出现在列表里', () => {
    const study = makeBoard({ id: 'fb-02', slug: 'study', visibility: 'campus_only' });
    const anonymousVM = toForumBoardVM(study, ANONYMOUS_FORUM_SESSION, NOW);
    expect(anonymousVM.accessible).toBe(false);
    expect(anonymousVM.campusOnly).toBe(true);
    expect(anonymousVM.visibilityLabel).toBe('校内可见');

    const loggedInVM = toForumBoardVM(study, DEMO_FORUM_SESSION, NOW);
    expect(loggedInVM.accessible).toBe(true);
    expect(loggedInVM.postCountLabel).toBe('3 帖');
    expect(loggedInVM.lastActivityLabel).toBe('25 分钟前');
  });
});

describe('主题视图模型（治理状态显式化）', () => {
  it('HIDDEN：状态文案 + 治理说明 + 不可回复', () => {
    const vm = toForumPostItemVM(makePost({ status: 'HIDDEN' }), makeBoard(), NOW);
    expect(vm.statusLabel).toBe('已隐藏');
    expect(vm.statusTone).toBe('danger');
    expect(vm.hidden).toBe(true);
    expect(vm.replyable).toBe(false);
    expect(vm.notice).toContain('因举报被隐藏');
  });

  it('LOCKED：可读但不可回复，说明写明原因', () => {
    const vm = toForumPostItemVM(makePost({ status: 'LOCKED' }), makeBoard(), NOW);
    expect(vm.locked).toBe(true);
    expect(vm.replyable).toBe(false);
    expect(vm.notice).toContain('不再接受新回复');
  });

  it('匿名条目显示「匿名同学」，实名条目显示昵称', () => {
    const anon = toForumPostItemVM(
      makePost({ anonymous: true, authorId: 'anon_abc', authorNickname: '匿名同学' }),
      makeBoard(),
      NOW,
    );
    expect(anon.authorLabel).toBe('匿名同学');
    const real = toForumPostItemVM(makePost(), makeBoard(), NOW);
    expect(real.authorLabel).toBe('鸭鸭先冲');
  });

  it('列表聚合：总数 / 治理计数 / 置顶优先', () => {
    const page: Page<ForumPost> = {
      items: [
        makePost({ id: 'fp-a', lastActivityAt: '2026-10-16T09:00:00.000Z' }),
        makePost({ id: 'fp-b', status: 'HIDDEN' }),
        makePost({ id: 'fp-c', status: 'LOCKED' }),
        makePost({ id: 'fp-pinned', pinnedAt: '2026-10-10T00:00:00.000Z', lastActivityAt: '2026-10-01T00:00:00.000Z' }),
      ],
      nextCursor: 'c_4',
      total: 9,
    };
    const vm = toForumPostListVM(page, [makeBoard()], {
      session: DEMO_FORUM_SESSION,
      activeBoardId: 'fb-01',
      now: NOW,
    });

    expect(vm.total).toBe(9);
    expect(vm.nextCursor).toBe('c_4');
    expect(vm.isEmpty).toBe(false);
    expect(vm.governedCount).toBe(2);
    expect(vm.hiddenCount).toBe(1);
    expect(vm.items[0]?.id).toBe('fp-pinned');
    expect(vm.activeBoardId).toBe('fb-01');
    expect(vm.state).toBe('ready');
  });

  it('空列表 → isEmpty 与 empty 态', () => {
    const vm = toForumPostListVM(
      { items: [], nextCursor: null, total: 0 },
      [makeBoard()],
      { session: DEMO_FORUM_SESSION, now: NOW },
    );
    expect(vm.isEmpty).toBe(true);
    expect(vm.state).toBe('empty');
    expect(vm.boards).toHaveLength(1);
  });
});

describe('用例：加载列表 / 详情', () => {
  it('loadForumPostList 编排版块 + 主题并本地化', async () => {
    const result = await loadForumPostList(
      fakeRepository({
        listBoards: async () => ok([makeBoard()]),
        listPosts: async () =>
          ok<Page<ForumPost>>({ items: [makePost()], nextCursor: null, total: 1 }),
      }),
      { limit: 10 },
      { session: DEMO_FORUM_SESSION, now: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]?.boardName).toBe('校园生活');
    expect(result.value.items[0]?.createdLabel).toBe('5 小时前');
  });

  it('版块失败 / 主题失败都原样透传错误码（不吞错）', async () => {
    const boardsFail = await loadForumPostList(
      fakeRepository({ listBoards: async () => err({ code: 'UPSTREAM_UNAVAILABLE', message: '版块服务挂了' }) }),
      {},
      { session: DEMO_FORUM_SESSION, now: NOW },
    );
    expect(boardsFail.ok).toBe(false);
    if (!boardsFail.ok) {
      expect(boardsFail.error.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(boardsFail.error.message).toBe('版块服务挂了');
    }

    const postsFail = await loadForumPostList(
      fakeRepository({
        listBoards: async () => ok([makeBoard()]),
        listPosts: async () => err({ code: 'RATE_LIMITED', message: '太快了' }),
      }),
      {},
      { session: DEMO_FORUM_SESSION, now: NOW },
    );
    expect(postsFail.ok).toBe(false);
    if (!postsFail.ok) expect(postsFail.error.code).toBe('RATE_LIMITED');
  });

  it('§11.10-E：application 层把不透明游标原样交给端口，不解析不构造', async () => {
    const opaque = 'eyJvIjo0LCJ0IjoiMjAyNi0xMC0xNlQxMDowMDowMFoifQ==';
    const seen: Array<string | undefined> = [];
    const result = await loadForumPostList(
      fakeRepository({
        listBoards: async () => ok([makeBoard()]),
        listPosts: async (query) => {
          seen.push(query.cursor);
          return ok<Page<ForumPost>>({ items: [makePost()], nextCursor: opaque, total: 1 });
        },
      }),
      { cursor: opaque, limit: 4 },
      { session: DEMO_FORUM_SESSION, now: NOW },
    );

    expect(seen).toEqual([opaque]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.nextCursor).toBe(opaque);
  });

  it('toForumPostDetailVM：HIDDEN 正文不可见且给出不可回复原因', () => {
    const detail: ForumPostDetail = {
      post: makePost({ status: 'HIDDEN' }),
      replies: [makeReply({ id: 'fr-1' }), makeReply({ id: 'fr-2', parentReplyId: 'fr-1' })],
      repliesNextCursor: null,
    };
    const vm = toForumPostDetailVM(detail, makeBoard(), NOW);
    expect(vm.contentVisible).toBe(false);
    expect(vm.replyable).toBe(false);
    expect(vm.replyBlockedReason).toContain('因举报被隐藏');
    expect(vm.replies).toHaveLength(2);
    expect(vm.replies[1]?.depth).toBe(1);
  });

  it('loadForumPostDetailWithBoard 用版块列表补出版块名', async () => {
    const result = await loadForumPostDetailWithBoard(
      fakeRepository({
        listBoards: async () => ok([makeBoard({ id: 'fb-01', name: '校园生活' })]),
        postDetail: async () =>
          ok<ForumPostDetail>({ post: makePost(), replies: [makeReply()], repliesNextCursor: null }),
      }),
      'fp-1',
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.boardName).toBe('校园生活');
    expect(result.value.replies[0]?.authorLabel).toBe('图书馆常驻');
  });

  it('toForumReplyVM：隐藏回复也带说明', () => {
    const vm = toForumReplyVM(makeReply({ status: 'HIDDEN' }), NOW);
    expect(vm.hidden).toBe(true);
    expect(vm.notice).toContain('因举报被隐藏');
    expect(vm.statusTone).toBe('danger');
  });
});

describe('用例：发帖 + 匿名开关语义', () => {
  it('空草稿不脏；填了内容即脏', () => {
    const draft = createEmptyForumDraft();
    expect(isForumDraftDirty(draft)).toBe(false);
    expect(isForumDraftDirty({ ...draft, title: '标题' })).toBe(true);
    expect(isForumDraftDirty({ ...draft, tagInput: '  ' })).toBe(false);
  });

  it('校验把阻断项与提示分开返回', () => {
    const invalid = validateForumComposerDraft(createEmptyForumDraft());
    expect(invalid.ok).toBe(false);
    expect(invalid.problems).toContain('请选择版块');
    expect(invalid.problems).toContain('正文不能为空');

    const sensitive = validateForumComposerDraft({
      ...createEmptyForumDraft('fb-01'),
      title: '有偿代考',
      body: '价格好谈',
    });
    expect(sensitive.sensitiveWords).toEqual(['代考']);
    expect(sensitive.problems.some((p) => p.includes('敏感词'))).toBe(true);

    const hinted = validateForumComposerDraft({
      ...createEmptyForumDraft('fb-01'),
      title: '树洞',
      body: '我是 2023 级的，学号 12345678',
      anonymous: true,
    });
    expect(hinted.ok).toBe(true);
    expect(hinted.hints.length).toBeGreaterThan(0);
  });

  it('toCreatePostInput 传实名身份 + 匿名标记（匿名化交给 data 层）', () => {
    const input = toCreatePostInput(
      { boardId: 'fb-01', title: ' 标题 ', body: '正文', tagInput: '食堂, 排队, 食堂', anonymous: true },
      DEMO_FORUM_SESSION,
      'idem-1',
    );
    expect(input.authorId).toBe('u_1024');
    expect(input.authorNickname).toBe('鸭鸭先冲');
    expect(input.anonymous).toBe(true);
    expect(input.title).toBe('标题');
    expect(input.tags).toEqual(['食堂', '排队']);
    expect(input.idempotencyKey).toBe('idem-1');
  });

  it('匿名说明只在开关打开时给出，且包含关键承诺', () => {
    expect(anonymityNoticeFor(false)).toBeNull();
    const notice = anonymityNoticeFor(true);
    expect(notice).toContain('实名身份不会与帖子关联');
    expect(notice).toContain('版主追溯');
  });

  it('submitForumPost 校验失败时不调用仓储', async () => {
    let called = 0;
    const result = await submitForumPost(
      fakeRepository({
        createPost: async () => {
          called += 1;
          return err({ code: 'INTERNAL', message: '不该被调用' });
        },
      }),
      createEmptyForumDraft(),
      DEMO_FORUM_SESSION,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(called).toBe(0);
  });

  it('submitForumPost 成功返回「已创建」视图模型（匿名帖带确认文案）', async () => {
    const result = await submitForumPost(
      mockRepository(),
      {
        boardId: 'fb-01',
        title: '匿名吐槽一下快递站',
        body: '周六又关门了。',
        tagInput: '快递',
        anonymous: true,
      },
      DEMO_FORUM_SESSION,
      { now: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.anonymous).toBe(true);
    expect(result.value.authorLabel).toBe('匿名同学');
    expect(result.value.statusLabel).toBe('已发布');
    expect(result.value.href).toBe(`/forum/${result.value.id}`);
    expect(result.value.anonymityNotice).toContain('实名身份不会与帖子关联');
  });

  it('submitForumPost 透传仓储错误（如 RATE_LIMITED）', async () => {
    const result = await submitForumPost(
      fakeRepository({
        createPost: async () => err({ code: 'RATE_LIMITED', message: '发帖过于频繁' }),
      }),
      { boardId: 'fb-01', title: '标题', body: '正文', tagInput: '', anonymous: false },
      DEMO_FORUM_SESSION,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RATE_LIMITED');
      expect(result.error.message).toBe('发帖过于频繁');
    }
  });
});

describe('用例：举报与回复', () => {
  it('举报原因选项齐全且带说明', () => {
    expect(FORUM_REPORT_REASON_OPTIONS.map((o) => o.value)).toEqual([
      'spam',
      'abuse',
      'illegal',
      'privacy',
      'other',
    ]);
    expect(FORUM_REPORT_REASON_OPTIONS[0]?.label).toBe('垃圾广告');
    expect(FORUM_REPORT_REASON_OPTIONS.every((o) => o.description.length > 0)).toBe(true);
    expect(REPORT_THRESHOLD_NOTICE).toContain('3 个不同用户');
  });

  it('submitForumReport 成功后返回回执视图模型', async () => {
    // fp-1003 的作者是 u_2048（不是本人），且种子里没有它的举报记录
    const result = await submitForumReport(
      mockRepository(),
      { targetType: 'POST', targetId: 'fp-1003', reason: 'spam', note: '广告' },
      { session: DEMO_FORUM_SESSION, anonymous: true, now: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.targetLabel).toBe('主题');
    expect(result.value.reasonLabel).toBe('垃圾广告');
    expect(result.value.statusLabel).toBe('待人工复核');
    expect(result.value.receiptText).toContain('举报已提交');
    expect(result.value.anonymous).toBe(true);
  });

  it('submitForumReport：缺目标 → VALIDATION_FAILED；仓储冲突 → 原样透传', async () => {
    const missing = await submitForumReport(
      mockRepository(),
      { targetType: 'POST', targetId: '  ', reason: 'spam' },
      { session: DEMO_FORUM_SESSION },
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('VALIDATION_FAILED');

    const conflict = await submitForumReport(
      fakeRepository({
        report: async () => err({ code: 'CONFLICT', message: '你已举报过该内容，我们正在处理' }),
      }),
      { targetType: 'REPLY', targetId: 'fr-1', reason: 'abuse' },
      { session: DEMO_FORUM_SESSION },
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.error.code).toBe('CONFLICT');
      expect(conflict.error.message).toContain('已举报过');
    }
  });

  it('toForumReportReceiptVM 本地化时间与状态', () => {
    const vm = toForumReportReceiptVM(
      {
        id: 'frep-1',
        targetType: 'REPLY',
        targetId: 'fr-1',
        reason: 'privacy',
        status: 'PENDING',
        reporterId: 'u_1024',
        anonymous: false,
        createdAt: '2026-10-16T09:30:00.000Z',
      },
      NOW,
    );
    expect(vm.targetLabel).toBe('回复');
    expect(vm.reasonLabel).toBe('泄露隐私');
    expect(vm.createdAtLabel).toBe('30 分钟前');
  });

  it('replyToForumPost：空内容被拦下，成功时返回回复视图模型', async () => {
    const empty = await replyToForumPost(mockRepository(), 'fp-1001', '   ', {
      session: DEMO_FORUM_SESSION,
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('VALIDATION_FAILED');

    const okResult = await replyToForumPost(mockRepository(), 'fp-1001', '11 点前去不用排队。', {
      session: DEMO_FORUM_SESSION,
      anonymous: true,
      now: NOW,
    });
    expect(okResult.ok).toBe(true);
    if (okResult.ok) {
      expect(okResult.value.authorLabel).toBe('匿名同学');
      expect(okResult.value.createdLabel).toBe('刚刚');
    }
  });

  it('replyToForumPost 对锁定主题透传 CONFLICT', async () => {
    const result = await replyToForumPost(mockRepository(), 'fp-1004', '还能回吗', {
      session: DEMO_FORUM_SESSION,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CONFLICT');
  });
});
