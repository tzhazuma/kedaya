/**
 * 用例：加载论坛主题详情（正文 + 回复列表 + 回复可用性）。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  FORUM_REPLY_STATUS_LABELS,
  postVisibility,
  replyBlockedReason,
  resolveAuthorLabel,
  sortReplies,
  type ForumBoard,
  type ForumReply,
} from '@/domain/models/forum';
import type { ForumRepository } from '@/domain/ports/forum';

import { toForumPostItemVM, type ForumPostItemVM } from './listForumPosts';

export interface ForumReplyVM {
  id: string;
  body: string;
  statusLabel: string;
  statusTone: 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';
  /** 被隐藏的回复也保留在列表里并说明原因 */
  notice: string | null;
  hidden: boolean;
  authorLabel: string;
  anonymous: boolean;
  likeCountLabel: string;
  createdLabel: string;
  /** 二级回复缩进一层 */
  depth: 0 | 1;
}

export interface ForumPostDetailVM extends ForumPostItemVM {
  /** 正文（HIDDEN 时正文不可见，由 `contentVisible` 决定 UI 是否渲染） */
  body: string;
  contentVisible: boolean;
  replies: ForumReplyVM[];
  repliesNextCursor: string | null;
  /** 不能回复时的原因；可以回复时为 null */
  replyBlockedReason: string | null;
  replyable: boolean;
}

const REPLY_HIDDEN_NOTICE = '该回复因举报被隐藏，正在人工复核。';

export function toForumReplyVM(reply: ForumReply, now: Date, depth: 0 | 1 = 0): ForumReplyVM {
  const hidden = reply.status === 'HIDDEN';
  return {
    id: reply.id,
    body: reply.body,
    statusLabel: FORUM_REPLY_STATUS_LABELS[reply.status],
    statusTone: hidden ? 'danger' : reply.status === 'DELETED' ? 'neutral' : 'success',
    notice: hidden ? REPLY_HIDDEN_NOTICE : null,
    hidden,
    authorLabel: resolveAuthorLabel(reply),
    anonymous: reply.anonymous,
    likeCountLabel: `${reply.likeCount} 赞`,
    createdLabel: formatRelativeTime(reply.createdAt, now) || '时间未知',
    depth,
  };
}

export function toForumPostDetailVM(
  detail: { post: Parameters<typeof toForumPostItemVM>[0]; replies: ForumReply[]; repliesNextCursor: string | null },
  board: Pick<ForumBoard, 'id' | 'name'> | undefined,
  now: Date,
): ForumPostDetailVM {
  const base = toForumPostItemVM(detail.post, board, now);
  const ordered = sortReplies(detail.replies);
  const replies = ordered.map((reply) =>
    toForumReplyVM(reply, now, reply.parentReplyId ? 1 : 0),
  );
  const visibility = postVisibility(detail.post.status);
  return {
    ...base,
    body: detail.post.body,
    contentVisible: visibility.contentVisible,
    replies,
    repliesNextCursor: detail.repliesNextCursor,
    replyBlockedReason: replyBlockedReason(detail.post),
    replyable: visibility.replyable,
  };
}

export async function loadForumPostDetail(
  repository: ForumRepository,
  id: string,
  board: Pick<ForumBoard, 'id' | 'name'> | undefined,
  now: Date = new Date(),
): Promise<Result<ForumPostDetailVM, ApiError>> {
  const result = await repository.postDetail(id);
  if (!result.ok) return err(result.error);
  return ok(toForumPostDetailVM(result.value, board, now));
}

/**
 * 用例入口（页面用）：详情 + 版块名一起取。
 *
 * 版块名要从 `listBoards()` 里查，所以必须先拿详情再查版块 —— 两次串行请求，
 * 换来的是 UI 不必自己拼接 boardId → name 的映射（UI 不做计算）。
 */
export async function loadForumPostDetailWithBoard(
  repository: ForumRepository,
  id: string,
  now: Date = new Date(),
): Promise<Result<ForumPostDetailVM, ApiError>> {
  const result = await repository.postDetail(id);
  if (!result.ok) return err(result.error);

  const boards = await repository.listBoards();
  const board = boards.ok
    ? boards.value.find((candidate) => candidate.id === result.value.post.boardId)
    : undefined;

  return ok(toForumPostDetailVM(result.value, board, now));
}
