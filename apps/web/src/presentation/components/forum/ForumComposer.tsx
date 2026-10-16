'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { RefreshCw, Send } from 'lucide-react';
import { useState } from 'react';

import {
  ANONYMOUS_TOGGLE_COPY,
  createEmptyForumDraft,
  isForumDraftDirty,
  submitForumPost,
  validateForumComposerDraft,
  type ForumComposerDraft,
  type ForumPostCreatedVM,
} from '@/application/forum/composeForumPost';
import { DEMO_FORUM_SESSION } from '@/application/forum/session';
import { toForumBoardVM } from '@/application/forum/listForumPosts';
import { deriveViewState } from '@/application/viewState';
import { getRepositories } from '@/data/repositories';
import { FORUM_LIMITS } from '@/domain/models/forum';

import { queryKeys } from '../../query/keys';
import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdyCardSkeleton } from '../KdySkeleton';

/**
 * 发帖表单（含**匿名开关**）。
 *
 * 匿名开关打开时必须展示完整说明（实名身份不关联 + 版主同版块可追溯），
 * 文案来自 domain 的 `ANONYMITY_NOTICE`，组件不自己写一份 —— 避免两处说法不一致。
 */
export function ForumComposer() {
  const repository = getRepositories().forum;
  const [draft, setDraft] = useState<ForumComposerDraft>(createEmptyForumDraft());
  const [created, setCreated] = useState<ForumPostCreatedVM | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const boardsQuery = useQuery({
    queryKey: queryKeys.forum.boards,
    queryFn: async () => unwrapOrThrow(await repository.listBoards()),
  });

  const boards = (boardsQuery.data ?? []).map((board) =>
    toForumBoardVM(board, DEMO_FORUM_SESSION, new Date()),
  );

  const validation = validateForumComposerDraft(draft);

  const mutation = useMutation({
    mutationFn: async () =>
      unwrapOrThrow(await submitForumPost(repository, draft, DEMO_FORUM_SESSION)),
    onSuccess: (result) => {
      setProblems([]);
      setCreated(result);
    },
    onError: (error) => {
      setProblems([errorMessage(error)]);
    },
  });

  const boardState = deriveViewState({
    isPending: boardsQuery.isPending,
    isError: boardsQuery.isError,
    isEmpty: boards.length === 0,
  });

  if (created) {
    return (
      <KdyCard className="flex flex-col gap-3">
        <KdyAlert tone="success" title="发布成功" role="status">
          <p>
            主题「{created.title}」已发布，状态：{created.statusLabel}，作者显示为{' '}
            <strong className="font-medium">{created.authorLabel}</strong>。
          </p>
          {created.anonymityNotice ? (
            <p className="mt-2 text-xs">{created.anonymityNotice}</p>
          ) : (
            <p className="mt-2 text-xs">本次为实名发布：主题会显示你的昵称 {DEMO_FORUM_SESSION.nickname}。</p>
          )}
        </KdyAlert>
        <div className="flex flex-wrap gap-2">
          <KdyButton href={created.href}>查看主题</KdyButton>
          <KdyButton
            variant="secondary"
            onClick={() => {
              setCreated(null);
              setDraft(createEmptyForumDraft());
            }}
          >
            再发一帖
          </KdyButton>
        </div>
      </KdyCard>
    );
  }

  if (boardState === 'loading') {
    return (
      <div className="flex flex-col gap-3" aria-busy aria-live="polite" data-testid="forum-composer-loading">
        <KdyCardSkeleton />
      </div>
    );
  }

  if (boardState === 'error' || boardState === 'empty') {
    return (
      <KdyAlert
        tone="danger"
        title="版块列表不可用"
        role="alert"
        action={
          <KdyButton size="sm" variant="secondary" onClick={() => void boardsQuery.refetch()}>
            <RefreshCw className={cn('size-3.5', boardsQuery.isFetching && 'animate-spin')} aria-hidden />
            重试
          </KdyButton>
        }
      >
        <p>
          {boardState === 'error'
            ? errorMessage(boardsQuery.error)
            : '当前没有任何可发帖的版块，请稍后再试或联系站务。'}
        </p>
      </KdyAlert>
    );
  }

  return (
    <KdyCard className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-body">版块</span>
        <select
          value={draft.boardId}
          onChange={(event) => setDraft({ ...draft, boardId: event.target.value })}
          className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body outline-none"
        >
          <option value="">请选择版块</option>
          {boards.map((board) => (
            <option key={board.id} value={board.id} disabled={!board.accessible}>
              {board.name}
              {board.campusOnly ? `（${board.visibilityLabel}）` : ''}
              {board.accessible ? '' : ' · 需登录'}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-body">
          标题 <span className="text-xs text-muted">（1–{FORUM_LIMITS.postTitleMax} 字）</span>
        </span>
        <input
          type="text"
          value={draft.title}
          maxLength={FORUM_LIMITS.postTitleMax}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          placeholder="一句话说清你要讨论什么"
          className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body outline-none placeholder:text-muted"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-body">
          正文 <span className="text-xs text-muted">（Markdown 子集，≤{FORUM_LIMITS.postBodyMax} 字）</span>
        </span>
        <textarea
          value={draft.body}
          rows={8}
          maxLength={FORUM_LIMITS.postBodyMax}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          placeholder="补充上下文、时间、地点，方便其他同学回答"
          className="w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body outline-none placeholder:text-muted"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-body">
          标签 <span className="text-xs text-muted">（最多 {FORUM_LIMITS.tagCountMax} 个，逗号分隔）</span>
        </span>
        <input
          type="text"
          value={draft.tagInput}
          onChange={(event) => setDraft({ ...draft, tagInput: event.target.value })}
          placeholder="例：食堂, 排队"
          className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body outline-none placeholder:text-muted"
        />
        {validation.tags.length > 0 ? (
          <span className="text-xs text-muted">将提交标签：{validation.tags.join('、')}</span>
        ) : null}
      </label>

      {/* ---- 匿名开关 ---- */}
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-alt p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-body">
          <input
            type="checkbox"
            checked={draft.anonymous}
            onChange={(event) => setDraft({ ...draft, anonymous: event.target.checked })}
          />
          {draft.anonymous ? ANONYMOUS_TOGGLE_COPY.onLabel : ANONYMOUS_TOGGLE_COPY.label}
        </label>
        {draft.anonymous ? (
          <p className="text-xs text-muted" data-testid="forum-anonymity-notice">
            {ANONYMOUS_TOGGLE_COPY.notice}
          </p>
        ) : (
          <p className="text-xs text-muted">
            开启后，帖子只记录匿名身份，普通用户看不到你的姓名、学号与院系。
          </p>
        )}
      </div>

      {validation.hints.length > 0 ? (
        <KdyAlert tone="warning" title="发布前提醒">
          <ul className="list-disc pl-4">
            {validation.hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </KdyAlert>
      ) : null}

      {problems.length > 0 ? (
        <KdyAlert tone="danger" title="无法发布" role="alert">
          <ul className="list-disc pl-4">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </KdyAlert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {isForumDraftDirty(draft)
            ? validation.ok
              ? '内容检查通过，可以发布。'
              : '还有未通过检查的项，见上方提示。'
            : '还没有填写内容。'}
        </p>
        <KdyButton
          disabled={mutation.isPending || !validation.ok}
          onClick={() => mutation.mutate()}
        >
          <Send className="size-4" aria-hidden />
          {mutation.isPending ? '发布中…' : draft.anonymous ? '匿名发布' : '发布'}
        </KdyButton>
      </div>
    </KdyCard>
  );
}
