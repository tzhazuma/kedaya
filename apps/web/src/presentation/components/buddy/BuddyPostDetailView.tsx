'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import {
  closeBuddyPost,
  decideBuddyApplication,
  joinBuddyPost,
  leaveBuddyPost,
  loadBuddyPostDetail,
  type BuddyPostDetailVM,
} from '@/application/buddy/getBuddyPostDetail';
import { DEMO_BUDDY_SESSION } from '@/application/buddy/session';
import { getRepositories } from '@/data/repositories';

import { queryKeys } from '../../query/keys';
import { asApiError, errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyEmpty } from '../KdyEmpty';
import { KdyCardSkeleton, KdySkeleton } from '../KdySkeleton';
import { BuddyPrivacyNotice } from './BuddyPrivacyNotice';

export interface BuddyPostDetailViewProps {
  id: string;
}

/** 搭子详情 + 申请 / 审批 / 关闭 / 撤回（全部走契约 §11.2 已冻结的动作名）。 */
export function BuddyPostDetailView({ id }: BuddyPostDetailViewProps) {
  const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const repository = getRepositories().buddy;
  const session = DEMO_BUDDY_SESSION;

  const query = useQuery({
    queryKey: queryKeys.buddy.detail(id),
    queryFn: async () =>
      unwrapOrThrow(await loadBuddyPostDetail(repository, id, { session })),
  });

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.buddy.detail(id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.buddy.root });
  };

  const run = (label: string, action: () => Promise<{ message?: string } | void>): void => {
    setActionError(null);
    setReceipt(null);
    action()
      .then(() => {
        setReceipt(label);
        return invalidate();
      })
      .catch((error: unknown) => setActionError(errorMessage(error)));
  };

  const joinMutation = useMutation({
    mutationFn: async (text: string) => {
      const result = await joinBuddyPost(repository, {
        postId: id,
        session,
        ...(text.trim() ? { message: text.trim() } : {}),
      });
      return unwrapOrThrow(result);
    },
  });

  const leaveMutation = useMutation({
    mutationFn: async () => unwrapOrThrow(await leaveBuddyPost(repository, { postId: id, session })),
  });

  const decideMutation = useMutation({
    mutationFn: async (input: { applicationId: string; decision: 'ACCEPTED' | 'REJECTED' }) =>
      unwrapOrThrow(
        await decideBuddyApplication(repository, {
          postId: id,
          applicationId: input.applicationId,
          decision: input.decision,
          session,
        }),
      ),
  });

  const closeMutation = useMutation({
    mutationFn: async () => unwrapOrThrow(await closeBuddyPost(repository, { postId: id, session })),
  });

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy aria-live="polite" data-testid="buddy-detail-loading">
        <KdyCardSkeleton />
        <KdySkeleton lines={4} />
      </div>
    );
  }

  if (query.isError) {
    const error = asApiError(query.error);
    if (error.code === 'NOT_FOUND') {
      return (
        <KdyEmpty
          title="这条搭子不存在或不可见"
          description="可能已被发起人删除，或者链接里的编号不对。契约 §2.1 要求「不存在」与「不可见」都返回 NOT_FOUND，不区分。"
          action={
            <KdyButton size="sm" href="/buddy">
              回到搭子广场
            </KdyButton>
          }
        />
      );
    }
    return (
      <KdyAlert
        tone="danger"
        title="详情加载失败"
        role="alert"
        action={
          <KdyButton size="sm" variant="secondary" onClick={() => void query.refetch()}>
            <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} aria-hidden />
            重试
          </KdyButton>
        }
      >
        <p>{error.message}</p>
      </KdyAlert>
    );
  }

  const detail: BuddyPostDetailVM = query.data;
  const { post } = detail;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/buddy" className="inline-flex items-center gap-1 text-xs text-muted hover:text-body">
        <ArrowLeft className="size-3.5" aria-hidden />
        返回搭子广场
      </Link>

      <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <KdyBadge tone="neutral">{post.sectionLabel}</KdyBadge>
          <KdyBadge tone={post.statusTone}>{post.statusLabel}</KdyBadge>
          <KdyBadge tone="info">{post.activityLabel}</KdyBadge>
          {post.isMine ? <KdyBadge tone="brand">我发布的</KdyBadge> : null}
          <span className="ml-auto text-xs text-muted">{post.createdLabel}发布</span>
        </div>

        <h1 className="text-xl font-bold text-body" data-testid="buddy-detail-title">
          {post.title}
        </h1>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-muted">时间</dt>
            <dd className="text-body">
              {post.startsAtLabel}（{post.startsInLabel}）
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">时长</dt>
            <dd className="text-body">{post.durationLabel}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">地点</dt>
            <dd className="text-body">{post.locationLabel}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">人数</dt>
            <dd className="text-body">
              {post.capacityLabel} · {post.remainingLabel}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">性别偏好</dt>
            <dd className="text-body">{post.genderPreferenceLabel}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">发起人</dt>
            <dd className="text-body">{post.creatorLabel}</dd>
          </div>
        </dl>

        {post.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="活动标签">
            {post.tags.map((tag) => (
              <li key={tag.key}>
                <KdyBadge tone="brand">{tag.label}</KdyBadge>
              </li>
            ))}
          </ul>
        ) : null}

        {post.skillLabel ? <p className="text-xs text-muted">{post.skillLabel}</p> : null}

        <div className="text-sm text-body">
          {detail.description ? (
            <p className="whitespace-pre-wrap">{detail.description}</p>
          ) : (
            <p className="text-muted">发起人没有填写描述。</p>
          )}
        </div>

        {post.notice ? (
          <p className="rounded-md border border-border bg-surface-alt px-3 py-2 text-xs text-muted">
            {post.notice}
          </p>
        ) : null}
      </article>

      {receipt ? (
        <KdyAlert tone="success" title="操作已完成" role="status">
          <p data-testid="buddy-action-receipt">{receipt}</p>
        </KdyAlert>
      ) : null}
      {actionError ? (
        <KdyAlert tone="danger" title="操作失败" role="alert">
          <p data-testid="buddy-action-error">{actionError}</p>
        </KdyAlert>
      ) : null}

      {/* ---- 申请人视角 ---- */}
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-body">
          {detail.viewerIsCreator ? '申请管理' : '我要申请'}
        </h2>

        {detail.viewerApplication ? (
          <p className="text-sm text-muted" data-testid="buddy-my-application">
            我的申请状态：
            <KdyBadge tone={detail.viewerApplication.statusTone}>
              {detail.viewerApplication.statusLabel}
            </KdyBadge>
            {detail.viewerApplication.message ? ` · 留言：${detail.viewerApplication.message}` : ''}
          </p>
        ) : null}

        {detail.canJoin ? (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              给发起人的留言（可选，≤{detail.messageMaxLength} 字）
              <textarea
                value={message}
                maxLength={detail.messageMaxLength}
                rows={2}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="例如：我也常打，一起？"
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-body outline-none"
              />
            </label>
            <div className="flex items-center gap-2">
              <KdyButton
                disabled={joinMutation.isPending}
                onClick={() =>
                  run('申请已提交，等待发起人审批（join 只是申请，不占名额）。', async () => {
                    await joinMutation.mutateAsync(message);
                    setMessage('');
                  })
                }
              >
                {joinMutation.isPending ? '提交中…' : '申请加入'}
              </KdyButton>
              <p className="text-xs text-muted">申请不占名额：只有发起人接受后才计入人数。</p>
            </div>
          </div>
        ) : null}

        {detail.canLeave ? (
          <div className="flex items-center gap-2">
            <KdyButton
              size="sm"
              variant="secondary"
              disabled={leaveMutation.isPending}
              onClick={() =>
                run('申请已撤回。撤回后 10 分钟内不能重新申请（防反复申请骚扰）。', async () => {
                  await leaveMutation.mutateAsync();
                })
              }
            >
              撤回申请
            </KdyButton>
            <p className="text-xs text-muted">撤回后同一行会被复用：重新申请不会产生重复记录。</p>
          </div>
        ) : null}

        {!detail.canJoin && !detail.canLeave ? (
          <p className="text-sm text-muted">
            {post.blockedReason ?? '当前不需要你操作。'}
          </p>
        ) : null}

        {detail.canClose ? (
          <div className="flex items-center gap-2 border-t border-border pt-3">
            <KdyButton
              size="sm"
              variant="danger"
              disabled={closeMutation.isPending}
              onClick={() =>
                run('活动已关闭（CLOSED），不再接受申请。', async () => {
                  await closeMutation.mutateAsync();
                })
              }
            >
              关闭招募
            </KdyButton>
            <p className="text-xs text-muted">
              close 与「取消」不同：close → CLOSED，取消由删除触发（状态机在 domain）。
            </p>
          </div>
        ) : null}
      </section>

      {/* ---- 发起人视角：申请列表（规格 §6.1 可见性矩阵） ---- */}
      {detail.viewerIsCreator ? (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-body">收到的申请</h2>
            <KdyBadge tone="warning">待审批 {detail.pendingCount}</KdyBadge>
            <KdyBadge tone="success">已通过 {detail.acceptedCount}</KdyBadge>
          </div>

          {detail.applications.length === 0 ? (
            <p className="text-sm text-muted">
              还没有人申请。把链接发给同学，或者去推荐页看看谁在找搭子。
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {detail.applications.map((application) => (
                <li
                  key={application.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-alt p-3"
                  data-testid={`buddy-application-${application.id}`}
                >
                  <span className="text-sm text-body">{application.applicantLabel}</span>
                  <KdyBadge tone={application.statusTone}>{application.statusLabel}</KdyBadge>
                  <span className="text-xs text-muted">{application.createdLabel}</span>
                  {application.message ? (
                    <p className="w-full text-xs text-muted">留言：{application.message}</p>
                  ) : null}
                  {application.decidable ? (
                    <span className="ml-auto flex gap-2">
                      <KdyButton
                        size="sm"
                        disabled={decideMutation.isPending}
                        onClick={() =>
                          run(`已通过 ${application.applicantLabel} 的申请。`, async () => {
                            await decideMutation.mutateAsync({
                              applicationId: application.id,
                              decision: 'ACCEPTED',
                            });
                          })
                        }
                      >
                        接受
                      </KdyButton>
                      <KdyButton
                        size="sm"
                        variant="secondary"
                        disabled={decideMutation.isPending}
                        onClick={() =>
                          run('已拒绝该申请（不会向申请人给出拒绝理由）。', async () => {
                            await decideMutation.mutateAsync({
                              applicationId: application.id,
                              decision: 'REJECTED',
                            });
                          })
                        }
                      >
                        拒绝
                      </KdyButton>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted">
            申请人列表与留言只有你能看到；申请人只能看到自己那条。拒绝时不给出理由 ——
            理由文本会成为骚扰面。
          </p>
        </section>
      ) : null}

      <BuddyPrivacyNotice items={detail.privacy.items} summary={detail.privacy} />
    </div>
  );
}
