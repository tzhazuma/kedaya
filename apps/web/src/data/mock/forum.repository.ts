/**
 * 论坛 mock 适配器（契约 §7 硬规则 4：必须有 mock，UI 才能脱离后端开发）。
 *
 * 行为对齐真实后端的**契约形状**：返回 `Result<Page<...>, ApiError>`，
 * 错误码用冻结的 `ApiErrorCode`（NOT_FOUND / CONFLICT / VALIDATION_FAILED / RATE_LIMITED /
 * UPSTREAM_UNAVAILABLE）。所有出站数据都过一遍 zod schema —— mock 也不能绕过契约校验。
 *
 * 治理语义（与域模型 §2.4 一致）：
 * - 3 个**不同**用户举报同一目标 → 目标转 HIDDEN，**但仍在列表里出现**并带明确状态说明
 * - 发帖 10 分钟 3 帖 / 24 小时 20 帖，回复 1 分钟 5 条，超出返回 RATE_LIMITED
 * - 敏感词命中 → VALIDATION_FAILED（不静默改写）
 * - 匿名：实名 id 只存在于 mock 的**私有映射**里（`authorRealIds`），出站对象只有匿名身份 id
 */
import type { ApiError, ApiErrorCode, Page } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import {
  checkPostRateLimit,
  checkReplyRateLimit,
  deriveAnonymousIdentityId,
  hasReported,
  isPostListable,
  replyBlockedReason,
  shouldAutoHide,
  sortPosts,
  sortReplies,
  transitionPostStatus,
  transitionReplyStatus,
  validateForumPostDraft,
  validateForumReplyDraft,
  ANONYMOUS_AUTHOR_LABEL,
  type ForumBoard,
  type ForumPost,
  type ForumPostStatus,
  type ForumReply,
  type ForumReport,
} from '@/domain/models/forum';
import type {
  CreateForumPostInput,
  CreateForumReplyInput,
  ForumPostDetail,
  ForumPostListQuery,
  ForumReplyListQuery,
  ForumRepository,
  MockFailureMode,
  ReportForumTargetInput,
} from '@/domain/ports/forum';

import {
  safeParseForumBoards,
  safeParseForumPost,
  safeParseForumPostDetail,
  safeParseForumPostPage,
  safeParseForumReply,
  safeParseForumReplyPage,
  safeParseForumReport,
} from '../schemas/forum';
import { slicePage } from './cursor';
import { createForumSeed, type ForumSeed } from './fixtures/forum';

export interface MockForumOptions {
  /** 注入时钟（测试用固定时间） */
  now?: () => Date;
  /** 模拟网络延迟，用于演示骨架屏 */
  latencyMs?: number;
  /** 故障演练：'error' 时所有请求返回 UPSTREAM_UNAVAILABLE */
  failureMode?: MockFailureMode;
  /** 覆盖数据集 */
  seed?: ForumSeed;
  /** 默认页大小 */
  pageSize?: number;
  /** 当前登录用户的实名 id（发帖/回复/举报用；演示默认值） */
  currentUserId?: string;
  currentNickname?: string;
}

export interface MockForumRepository extends ForumRepository {
  setFailureMode(mode: MockFailureMode): void;
  getFailureMode(): MockFailureMode;
  /** 恢复到初始数据集 */
  reset(): void;
  /** 测试/调试用：读出某个主题的实名作者（模拟"仅版主可追溯"的内部能力） */
  realAuthorOfPost(postId: string): string | undefined;
}

function apiError(code: ApiErrorCode, message: string, details?: unknown): ApiError {
  return details === undefined ? { code, message } : { code, message, details };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** 关键词 + 版块 + 状态过滤（纯函数，可单测） */
export function filterForumPosts(
  posts: readonly ForumPost[],
  query: ForumPostListQuery,
): ForumPost[] {
  const keyword = query.keyword?.trim().toLowerCase();
  const includeGoverned = query.includeGoverned ?? true;
  return posts.filter((post) => {
    if (!isPostListable(post)) return false;
    if (!includeGoverned && (post.status === 'HIDDEN' || post.status === 'LOCKED')) return false;
    if (query.boardId && post.boardId !== query.boardId) return false;
    if (query.status && post.status !== query.status) return false;
    if (!keyword) return true;
    return (
      post.title.toLowerCase().includes(keyword) ||
      post.body.toLowerCase().includes(keyword) ||
      post.tags.some((tag) => tag.toLowerCase().includes(keyword))
    );
  });
}

export function createMockForumRepository(options: MockForumOptions = {}): MockForumRepository {
  const now = options.now ?? (() => new Date());
  const latencyMs = options.latencyMs ?? 220;
  const pageSize = options.pageSize ?? 20;
  const currentUserId = options.currentUserId ?? 'u_1024';
  const currentNickname = options.currentNickname ?? '鸭鸭先冲';
  let failureMode: MockFailureMode = options.failureMode ?? 'none';

  let boards: ForumBoard[] = [];
  let posts: ForumPost[] = [];
  let replies: ForumReply[] = [];
  let reports: ForumReport[] = [];
  /** 匿名解耦：出站对象里没有实名 id，实名映射只存在于这里（模拟服务端私有表） */
  let authorRealIds = new Map<string, string>();
  let postSeq = 9000;
  let replySeq = 9000;
  let reportSeq = 9000;

  const load = (seed: ForumSeed): void => {
    boards = clone(seed.boards);
    posts = clone(seed.posts);
    replies = clone(seed.replies);
    reports = clone(seed.reports);
    authorRealIds = new Map();
    for (const post of seed.posts) {
      // 种子里匿名条目的 authorId 已经是匿名 id，这里补上实名映射用于频率/举报判定
      authorRealIds.set(post.id, post.anonymous ? `u_seed_${post.id}` : post.authorId);
    }
    postSeq = 9000;
    replySeq = 9000;
    reportSeq = 9000;
  };

  load(options.seed ?? createForumSeed(now()));

  const delay = async (): Promise<void> => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
  };

  const failIfNeeded = (): ApiError | null =>
    failureMode === 'error'
      ? apiError('UPSTREAM_UNAVAILABLE', '论坛服务暂时不可用（mock 故障演练）')
      : null;

  const touchBoard = (boardId: string, at: string): void => {
    boards = boards.map((board) =>
      board.id === boardId ? { ...board, postCount: board.postCount + 1, lastPostAt: at } : board,
    );
  };

  const findPostIndex = (id: string): number => posts.findIndex((p) => p.id === id);

  return {
    async listBoards(): Promise<Result<ForumBoard[], ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      const parsed = safeParseForumBoards(boards);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 版块数据不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(clone(parsed.value));
    },

    async listPosts(query: ForumPostListQuery): Promise<Result<Page<ForumPost>, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const filtered = sortPosts(filterForumPosts(posts, query));
      const page = slicePage(filtered, query.cursor, query.limit, pageSize);
      const parsed = safeParseForumPostPage(page);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 主题列表不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(clone(parsed.value));
    },

    async postDetail(id: string): Promise<Result<ForumPostDetail, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const post = posts.find((p) => p.id === id);
      if (!post || !isPostListable(post)) {
        return err(apiError('NOT_FOUND', `主题不存在或不可见：${id}`));
      }

      const detail: ForumPostDetail = {
        post,
        replies: sortReplies(replies.filter((r) => r.postId === id)),
        repliesNextCursor: null,
      };
      const parsed = safeParseForumPostDetail(detail);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 主题详情不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(clone(parsed.value));
    },

    async listReplies(query: ForumReplyListQuery): Promise<Result<Page<ForumReply>, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      if (findPostIndex(query.postId) < 0) {
        return err(apiError('NOT_FOUND', `主题不存在：${query.postId}`));
      }
      const filtered = sortReplies(replies.filter((r) => r.postId === query.postId));
      const page = slicePage(filtered, query.cursor, query.limit, pageSize);
      const parsed = safeParseForumReplyPage(page);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 回复列表不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(clone(parsed.value));
    },

    async createPost(input: CreateForumPostInput): Promise<Result<ForumPost, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const board = boards.find((b) => b.id === input.boardId);
      if (!board) return err(apiError('NOT_FOUND', `版块不存在：${input.boardId}`));

      const problems = validateForumPostDraft({
        boardId: input.boardId,
        title: input.title,
        body: input.body,
        tags: input.tags,
        anonymous: input.anonymous,
      });
      if (problems.length > 0) {
        return err(apiError('VALIDATION_FAILED', problems[0] ?? '发帖内容不合法', { problems }));
      }

      // 频率限制按**实名**身份计（匿名不豁免治理规则）
      const mine = posts.filter((p) => authorRealIds.get(p.id) === input.authorId);
      const verdict = checkPostRateLimit(
        mine.map((p) => p.createdAt),
        now(),
      );
      if (!verdict.allowed) {
        return err(apiError('RATE_LIMITED', verdict.reason ?? '发帖过于频繁', verdict));
      }

      const at = now().toISOString();
      postSeq += 1;
      const post: ForumPost = {
        id: `fp-${postSeq}`,
        boardId: input.boardId,
        title: input.title.trim(),
        body: input.body,
        status: 'PUBLISHED',
        anonymous: input.anonymous,
        // 匿名：出站对象只带匿名身份 id（同一版块内可被版主追溯）
        authorId: input.anonymous
          ? deriveAnonymousIdentityId(input.authorId, input.boardId)
          : input.authorId,
        authorNickname: input.anonymous ? ANONYMOUS_AUTHOR_LABEL : input.authorNickname,
        tags: input.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 5),
        replyCount: 0,
        likeCount: 0,
        pinnedAt: null,
        createdAt: at,
        lastActivityAt: at,
      };

      posts = [post, ...posts];
      authorRealIds.set(post.id, input.authorId);
      touchBoard(input.boardId, at);

      const parsed = safeParseForumPost(post);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 发帖产生了非法数据', { issues: parsed.issues }));
      }
      return ok(clone(parsed.value));
    },

    async createReply(input: CreateForumReplyInput): Promise<Result<ForumReply, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const index = findPostIndex(input.postId);
      const post = index >= 0 ? posts[index] : undefined;
      if (!post) return err(apiError('NOT_FOUND', `主题不存在：${input.postId}`));

      const blocked = replyBlockedReason(post);
      if (blocked) return err(apiError('CONFLICT', blocked));

      const problems = validateForumReplyDraft({
        postId: input.postId,
        body: input.body,
        anonymous: input.anonymous,
        parentReplyId: input.parentReplyId ?? null,
      });
      if (problems.length > 0) {
        return err(apiError('VALIDATION_FAILED', problems[0] ?? '回复内容不合法', { problems }));
      }

      const mine = replies.filter((r) => authorRealIds.get(r.id) === input.authorId);
      const verdict = checkReplyRateLimit(
        mine.map((r) => r.createdAt),
        now(),
      );
      if (!verdict.allowed) {
        return err(apiError('RATE_LIMITED', verdict.reason ?? '回复过于频繁', verdict));
      }

      const at = now().toISOString();
      replySeq += 1;
      const reply: ForumReply = {
        id: `fr-${replySeq}`,
        postId: input.postId,
        parentReplyId: input.parentReplyId ?? null,
        body: input.body.trim(),
        status: 'PUBLISHED',
        anonymous: input.anonymous,
        authorId: input.anonymous
          ? deriveAnonymousIdentityId(input.authorId, post.boardId)
          : input.authorId,
        authorNickname: input.anonymous ? ANONYMOUS_AUTHOR_LABEL : input.authorNickname,
        likeCount: 0,
        createdAt: at,
      };

      replies = [...replies, reply];
      authorRealIds.set(reply.id, input.authorId);
      posts = posts.map((p, i) =>
        i === index ? { ...p, replyCount: p.replyCount + 1, lastActivityAt: at } : p,
      );

      const parsed = safeParseForumReply(reply);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 回复产生了非法数据', { issues: parsed.issues }));
      }
      return ok(clone(parsed.value));
    },

    async report(input: ReportForumTargetInput): Promise<Result<ForumReport, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const targetPost = input.targetType === 'POST' ? posts.find((p) => p.id === input.targetId) : undefined;
      const targetReply =
        input.targetType === 'REPLY' ? replies.find((r) => r.id === input.targetId) : undefined;
      if (!targetPost && !targetReply) {
        return err(apiError('NOT_FOUND', `举报目标不存在：${input.targetId}`));
      }

      const targetRealAuthor = authorRealIds.get(input.targetId);
      if (targetRealAuthor && targetRealAuthor === input.reporterId) {
        return err(apiError('VALIDATION_FAILED', '不能举报自己发布的内容'));
      }

      const forTarget = reports.filter((r) => r.targetId === input.targetId);
      if (hasReported(forTarget, input.reporterId, input.targetId)) {
        return err(apiError('CONFLICT', '你已举报过该内容，我们正在处理'));
      }

      const at = now().toISOString();
      reportSeq += 1;
      const report: ForumReport = {
        id: `frep-${reportSeq}`,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        status: 'PENDING',
        reporterId: input.reporterId,
        anonymous: input.anonymous,
        createdAt: at,
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      };

      reports = [...reports, report];

      // 3 个不同用户举报 → 自动隐藏（进人工队列）；已锁定/已发布都可转 HIDDEN
      const effective = reports.filter((r) => r.targetId === input.targetId);
      if (shouldAutoHide(effective)) {
        if (input.targetType === 'POST') {
          posts = posts.map((p) => {
            if (p.id !== input.targetId) return p;
            const next: ForumPostStatus = 'HIDDEN';
            return transitionPostStatus(p, next) ?? p;
          });
        } else {
          replies = replies.map((r) => {
            if (r.id !== input.targetId) return r;
            return transitionReplyStatus(r, 'HIDDEN') ?? r;
          });
        }
      }

      const parsed = safeParseForumReport(report);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 举报产生了非法数据', { issues: parsed.issues }));
      }
      return ok(clone(parsed.value));
    },

    setFailureMode(mode: MockFailureMode): void {
      failureMode = mode;
    },

    getFailureMode(): MockFailureMode {
      return failureMode;
    },

    reset(): void {
      load(options.seed ?? createForumSeed(now()));
      failureMode = 'none';
    },

    realAuthorOfPost(postId: string): string | undefined {
      return authorRealIds.get(postId);
    },
  };
}
