/**
 * 用例：加载论坛版块 + 主题列表（契约 §7：application 层编排，不含 IO）。
 *
 * 依赖方向 `presentation → application → domain ← data`：
 * 本文件只依赖 domain 的模型与端口，仓储实例由调用方注入。
 * 输出是**视图模型**（已本地化文案 / 已判定治理状态），UI 不再做任何计算。
 */
import type { ApiError, Page } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  excerpt,
  FORUM_BOARD_VISIBILITY_LABELS,
  FORUM_POST_STATUS_LABELS,
  isBoardAccessible,
  postVisibility,
  resolveAuthorLabel,
  sortPosts,
  type ForumBoard,
  type ForumPost,
  type ForumPostStatus,
} from '@/domain/models/forum';
import type { ForumPostListQuery, ForumRepository } from '@/domain/ports/forum';

import { deriveViewState, type ViewState } from '../viewState';
import type { ForumSession } from './session';

export interface ForumBoardVM {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibilityLabel: string;
  /** campus_only 版块需要登录 */
  campusOnly: boolean;
  accessible: boolean;
  postCountLabel: string;
  lastActivityLabel: string | null;
}

export interface ForumPostItemVM {
  id: string;
  boardId: string;
  boardName: string;
  title: string;
  excerpt: string;
  tags: string[];
  status: ForumPostStatus;
  statusLabel: string;
  /** 徽章语义色名（具体色值由 design-tokens 决定） */
  statusTone: 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';
  /** 治理说明：被隐藏 / 被锁定时**必须**展示，不得静默消失 */
  notice: string | null;
  hidden: boolean;
  locked: boolean;
  replyable: boolean;
  authorLabel: string;
  anonymous: boolean;
  replyCountLabel: string;
  likeCountLabel: string;
  createdLabel: string;
  lastActivityLabel: string;
  pinned: boolean;
  /** 是否可以举报（自己发的内容不能举报，由 data 层最终判定） */
  reportable: boolean;
}

export interface ForumPostListVM {
  items: ForumPostItemVM[];
  boards: ForumBoardVM[];
  nextCursor: string | null;
  total: number;
  /** 当前筛选的版块（null = 全部） */
  activeBoardId: string | null;
  isEmpty: boolean;
  /** 列表里被治理（HIDDEN / LOCKED）的条目数 —— 用于提示"有内容被处理过" */
  governedCount: number;
  hiddenCount: number;
  state: ViewState;
}

export function toForumBoardVM(
  board: ForumBoard,
  session: Pick<ForumSession, 'authenticated'>,
  now: Date,
): ForumBoardVM {
  return {
    id: board.id,
    slug: board.slug,
    name: board.name,
    description: board.description ?? null,
    visibilityLabel: FORUM_BOARD_VISIBILITY_LABELS[board.visibility],
    campusOnly: board.visibility === 'campus_only',
    accessible: isBoardAccessible(board, { authenticated: session.authenticated }),
    postCountLabel: `${board.postCount} 帖`,
    lastActivityLabel: board.lastPostAt
      ? formatRelativeTime(board.lastPostAt, now) || null
      : null,
  };
}

/** 列表项 → 视图模型（纯函数，可单测） */
export function toForumPostItemVM(
  post: ForumPost,
  board: Pick<ForumBoard, 'id' | 'name'> | undefined,
  now: Date,
): ForumPostItemVM {
  const visibility = postVisibility(post.status);
  return {
    id: post.id,
    boardId: post.boardId,
    boardName: board?.name ?? post.boardId,
    title: post.title,
    excerpt: excerpt(post.body),
    tags: [...post.tags],
    status: post.status,
    statusLabel: FORUM_POST_STATUS_LABELS[post.status],
    statusTone: visibility.tone,
    notice: visibility.notice,
    hidden: post.status === 'HIDDEN',
    locked: post.status === 'LOCKED',
    replyable: visibility.replyable,
    authorLabel: resolveAuthorLabel(post),
    anonymous: post.anonymous,
    replyCountLabel: `${post.replyCount} 回复`,
    likeCountLabel: `${post.likeCount} 赞`,
    createdLabel: formatRelativeTime(post.createdAt, now) || '时间未知',
    lastActivityLabel: formatRelativeTime(post.lastActivityAt, now) || '时间未知',
    pinned: post.pinnedAt !== null,
    reportable: true,
  };
}

export function toForumPostListVM(
  page: Page<ForumPost>,
  boards: readonly ForumBoard[],
  options: { session: Pick<ForumSession, 'authenticated'>; activeBoardId?: string | null; now: Date; state?: ViewState },
): ForumPostListVM {
  const boardMap = new Map(boards.map((b) => [b.id, b]));
  const items = sortPosts(page.items).map((post) =>
    toForumPostItemVM(post, boardMap.get(post.boardId), options.now),
  );
  return {
    items,
    boards: boards.map((board) => toForumBoardVM(board, options.session, options.now)),
    nextCursor: page.nextCursor,
    total: page.total ?? page.items.length,
    activeBoardId: options.activeBoardId ?? null,
    isEmpty: items.length === 0,
    governedCount: items.filter((item) => item.hidden || item.locked).length,
    hiddenCount: items.filter((item) => item.hidden).length,
    state: options.state ?? deriveViewState({ isPending: false, isError: false, isEmpty: items.length === 0 }),
  };
}

/** 用例入口：版块 + 主题列表一起取（页面只需要一次调用） */
export async function loadForumPostList(
  repository: ForumRepository,
  query: ForumPostListQuery = {},
  options: { session: Pick<ForumSession, 'authenticated'>; now?: Date } = {
    session: { authenticated: true },
  },
): Promise<Result<ForumPostListVM, ApiError>> {
  const now = options.now ?? new Date();

  const boardsResult = await repository.listBoards();
  if (!boardsResult.ok) return err(boardsResult.error);

  const postsResult = await repository.listPosts(query);
  if (!postsResult.ok) return err(postsResult.error);

  return ok(
    toForumPostListVM(postsResult.value, boardsResult.value, {
      session: options.session,
      activeBoardId: query.boardId ?? null,
      now,
    }),
  );
}

/** 供页面在错误/空态之间复用：把 query 状态映射成四态 */
export function forumListState(input: {
  isPending: boolean;
  isError: boolean;
  itemCount: number;
}): ViewState {
  return deriveViewState({
    isPending: input.isPending,
    isError: input.isError,
    isEmpty: input.itemCount === 0,
  });
}
