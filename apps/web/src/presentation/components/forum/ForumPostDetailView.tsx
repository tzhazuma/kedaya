'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus, RefreshCw, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import {
  loadForumPostDetailWithBoard,
  type ForumPostDetailVM,
} from '@/application/forum/getForumPostDetail';
import { replyToForumPost } from '@/application/forum/reportForumTarget';
import { ANONYMOUS_TOGGLE_COPY } from '@/application/forum/composeForumPost';
import { DEMO_FORUM_SESSION } from '@/application/forum/session';
import { deriveViewState } from '@/application/viewState';
import { getRepositories } from '@/data/repositories';
import { FORUM_LIMITS } from '@/domain/models/forum';

import { queryKeys } from '../../query/keys';
import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdyEmpty } from '../KdyEmpty';
import { KdyCardSkeleton } from '../KdySkeleton';
import { ForumReportDialog } from './ForumReportDialog';
import { ForumPostStatusNotice } from './ForumPostStatusNotice';

export interface ForumPostDetailViewProps {
  id: string;
}

interface ReportTarget {
  targetType: 'POST' | 'REPLY';
  targetId: string;
  targetLabel: string;
}

/**
 * 主题详情：正文 + 回复列表 + 回复框 + 举报入口。
 *
 * 治理：HIDDEN 主题正文不可见，但**页面照常渲染**并说明"正在人工复核"（不静默 404）；
 * LOCKED 主题可读但回复框禁用并给出原因。
 */
export function ForumPostDetailView({ id }: ForumPostDetailViewProps) {
  const repository = getRepositories().forum;
  const queryClient = useQueryClient();

  const [replyBody, setReplyBody] = useState('');
  const [anonymousReply, setAnonymousReply] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  const query = useQuery({
    queryKey: queryKeys.forum.detail(id),
    queryFn: async () => unwrapOrThrow(await loadForumPostDetailWithBoard(repository, id)),
  });

  const detail: ForumPostDetailVM | undefined = query.data;

  const replyMutation = useMutation({
    mutationFn: async () =>
      unwrapOrThrow(
        await replyToForumPost(repository, id, replyBody, {
          session: DEMO_FORUM_SESSION,
          anonymous: anonymousReply,
        }),
      ),
    onSuccess: async () => {
      setReplyBody('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.forum.detail(id) });
    },
  });

  const state = deriveViewState({
    isPending: query.isPending,
    isError: query.isError,
    isEmpty: false,
  });

  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-3" aria-busy aria-live="polite" data-testid="forum-detail-loading">
        <KdyCardSkeleton />
        <KdyCardSkeleton />
      </div>
    );
  }

  if (state === 'error' || !detail) {
    return (
      <KdyAlert
        tone="danger"
        title="主题加载失败"
        role="alert"
        action={
          <KdyButton size="sm" variant="secondary" onClick={() => void query.refetch()}>
            <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} aria-hidden />
            重试
          </KdyButton>
        }
      >
        <p>{errorMessage(query.error)}</p>
        <p className="mt-1 text-xs">
          主题可能已被删除，或链接有误。返回{' '}
          <Link className="underline" href="/forum">
            论坛首页
          </Link>{' '}
          看看其它主题。
        </p>
      </KdyAlert>
    );
  }

  return (
    <article className="flex flex-col gap-4" aria-labelledby="forum-post-title">
      <KdyCard className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="rounded-pill border border-border bg-surface-alt px-2 py-0.5">
            {detail.boardName}
          </span>
          <span>{detail.authorLabel}</span>
          <span>· {detail.createdLabel}</span>
          {detail.anonymous ? <KdyBadge tone="neutral">匿名</KdyBadge> : null}
        </div>

        <h1 id="forum-post-title" className="text-xl font-bold text-body">
          {detail.title}
        </h1>

        <ForumPostStatusNotice
          statusLabel={detail.statusLabel}
          tone={detail.statusTone}
          notice={detail.notice}
          hidden={detail.hidden}
          locked={detail.locked}
        />

        {detail.contentVisible ? (
          <div className="whitespace-pre-wrap text-sm text-body" data-testid="forum-post-body">
            {detail.body}
          </div>
        ) : (
          <p className="rounded-md border border-border bg-surface-alt px-3 py-6 text-center text-sm text-muted">
            正文已被隐藏，人工复核完成后会恢复或删除。
          </p>
        )}

        {detail.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {detail.tags.map((tag) => (
              <li key={tag} className="rounded-sm bg-surface-alt px-1.5 py-0.5 text-xs text-muted">
                #{tag}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-muted">
          <span>{detail.replyCountLabel}</span>
          <span>{detail.likeCountLabel}</span>
          <KdyButton
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() =>
              setReportTarget({
                targetType: 'POST',
                targetId: detail.id,
                targetLabel: `主题「${detail.title}」`,
              })
            }
          >
            <ShieldAlert className="size-3.5" aria-hidden />
            举报主题
          </KdyButton>
        </div>
      </KdyCard>

      {/* ---- 回复列表 ---- */}
      <section className="flex flex-col gap-3" aria-labelledby="forum-replies-heading">
        <h2 id="forum-replies-heading" className="text-sm font-semibold text-body">
          回复（{detail.replies.length}）
        </h2>

        {detail.replies.length === 0 ? (
          <KdyEmpty
            title="还没有人回复"
            description={
              detail.replyable
                ? '在下面写下第一条回复，或者补充一点上下文让讨论更容易开始。'
                : '该主题当前不接受回复。'
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {detail.replies.map((reply) => (
              <li key={reply.id} className={cn(reply.depth === 1 && 'ml-4 border-l border-border pl-3')}>
                <KdyCard tone={reply.hidden ? 'alt' : 'surface'} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="font-medium text-body">{reply.authorLabel}</span>
                    {reply.anonymous ? <KdyBadge tone="neutral">匿名</KdyBadge> : null}
                    <span>· {reply.createdLabel}</span>
                    <KdyBadge tone={reply.statusTone}>{reply.statusLabel}</KdyBadge>
                    <span>{reply.likeCountLabel}</span>
                    <KdyButton
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() =>
                        setReportTarget({
                          targetType: 'REPLY',
                          targetId: reply.id,
                          targetLabel: `回复「${reply.body.slice(0, 20)}…」`,
                        })
                      }
                    >
                      <ShieldAlert className="size-3.5" aria-hidden />
                      举报
                    </KdyButton>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-body">{reply.body}</p>
                  {reply.notice ? (
                    <p className="rounded-md border border-border bg-surface-alt px-2 py-1 text-xs text-danger">
                      {reply.notice}
                    </p>
                  ) : null}
                </KdyCard>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- 回复框 ---- */}
      <section className="flex flex-col gap-3" aria-labelledby="forum-reply-form-heading">
        <h2 id="forum-reply-form-heading" className="text-sm font-semibold text-body">
          发表回复
        </h2>

        {detail.replyable ? (
          <KdyCard className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="sr-only">回复内容</span>
              <textarea
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
                rows={4}
                maxLength={FORUM_LIMITS.replyBodyMax}
                placeholder="友善发言，不要泄露他人隐私"
                className="w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body outline-none placeholder:text-muted"
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-body">
              <input
                type="checkbox"
                checked={anonymousReply}
                onChange={(event) => setAnonymousReply(event.target.checked)}
              />
              {anonymousReply ? ANONYMOUS_TOGGLE_COPY.onLabel : ANONYMOUS_TOGGLE_COPY.offLabel}
            </label>

            {anonymousReply ? (
              <p className="rounded-md border border-border bg-surface-alt px-2 py-1 text-xs text-muted">
                {ANONYMOUS_TOGGLE_COPY.notice}
              </p>
            ) : null}

            {replyMutation.isError ? (
              <KdyAlert tone="danger" title="回复失败" role="alert">
                <p>{errorMessage(replyMutation.error)}</p>
              </KdyAlert>
            ) : null}

            {replyMutation.isSuccess ? (
              <KdyAlert tone="success" title="回复已发布" role="status">
                <p>你的回复已经出现在下方回复列表里。</p>
              </KdyAlert>
            ) : null}

            <div className="flex justify-end">
              <KdyButton
                disabled={replyMutation.isPending || !replyBody.trim()}
                onClick={() => replyMutation.mutate()}
              >
                <MessageSquarePlus className="size-4" aria-hidden />
                {replyMutation.isPending ? '提交中…' : '发布回复'}
              </KdyButton>
            </div>
          </KdyCard>
        ) : (
          <KdyAlert tone="warning" title="当前不能回复">
            <p>{detail.replyBlockedReason ?? '该主题当前不接受回复。'}</p>
          </KdyAlert>
        )}
      </section>

      <ForumReportDialog
        open={reportTarget !== null}
        targetType={reportTarget?.targetType ?? 'POST'}
        targetId={reportTarget?.targetId ?? ''}
        targetLabel={reportTarget?.targetLabel ?? ''}
        onClose={() => setReportTarget(null)}
      />
    </article>
  );
}
