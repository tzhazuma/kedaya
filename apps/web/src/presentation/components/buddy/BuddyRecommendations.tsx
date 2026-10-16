'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

import {
  loadBuddyRecommendations,
  submitBuddyFeedback,
  type BuddyFeedbackEntry,
  type BuddyRecommendationListVM,
} from '@/application/buddy/recommendations';
import { DEMO_BUDDY_SESSION } from '@/application/buddy/session';
import { getRepositories } from '@/data/repositories';
import {
  BUDDY_FEEDBACK_ACTION_LABELS,
  BUDDY_SECTIONS,
  BUDDY_SECTION_DESCRIPTIONS,
  BUDDY_SECTION_LABELS,
  type BuddyFeedbackAction,
  type BuddySection,
} from '@/domain/models/buddy';

import { queryKeys } from '../../query/keys';
import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyEmpty } from '../KdyEmpty';
import { KdyCardSkeleton } from '../KdySkeleton';
import { BuddyPostCard } from './BuddyPostCard';

const FEEDBACK_ACTIONS: BuddyFeedbackAction[] = ['like', 'dislike', 'skip'];

/**
 * 推荐页（规格 §5.7 / §1.1 G3）。
 *
 * **展示理由，不是只给分数**：每条推荐都列出 `explainMatch` 给出的结构化理由
 * （`同一个院系` / `共同兴趣 3 项` / `时间能碰上` / `水平接近` / `常在同一个区域`），
 * 一条都没有时显示「有潜在匹配」。
 *
 * 诚实性：`matchMode` 必须展示 —— `rule` 模式下这里是按时间排序，不是个性化推荐；
 * `hash` 模式下不能说"语义相似"（那只是字符袋哈希）。
 */
export function BuddyRecommendations() {
  const [section, setSection] = useState<BuddySection>('academic');
  const [feedbacks, setFeedbacks] = useState<BuddyFeedbackEntry[]>([]);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const repository = getRepositories().buddy;
  const userId = DEMO_BUDDY_SESSION.userId;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.buddy.recommendations({ section, userId }),
    queryFn: async () =>
      unwrapOrThrow(
        await loadBuddyRecommendations(
          repository,
          { userId, section, limit: 10 },
          { viewerId: userId, feedbacks },
        ),
      ),
  });

  const feedbackMutation = useMutation({
    mutationFn: async (input: { postId: string; action: BuddyFeedbackAction }) =>
      unwrapOrThrow(
        await submitBuddyFeedback(repository, {
          postId: input.postId,
          section,
          action: input.action,
          userId,
        }),
      ),
  });

  const sendFeedback = (postId: string, action: BuddyFeedbackAction): void => {
    setReceipt(null);
    setActionError(null);
    feedbackMutation
      .mutateAsync({ postId, action })
      .then((entry) => {
        setFeedbacks((current) => [
          ...current.filter((item) => item.targetPostId !== postId || item.section !== section),
          entry,
        ]);
        setReceipt(`已记录「${BUDDY_FEEDBACK_ACTION_LABELS[action]}」：它只影响你自己的推荐顺序。`);
        return queryClient.invalidateQueries({ queryKey: queryKeys.buddy.root });
      })
      .catch((error: unknown) => setActionError(errorMessage(error)));
  };

  const vm: BuddyRecommendationListVM | undefined = query.data;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="buddy-recommendations-heading">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="buddy-recommendations-heading" className="mr-auto text-sm font-semibold text-body">
            按板块看推荐
          </h2>
          <KdyButton href="/buddy/profile" size="sm" variant="secondary">
            调整匹配资料
          </KdyButton>
          <KdyButton href="/buddy" size="sm" variant="secondary">
            回到搭子广场
          </KdyButton>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="推荐板块">
          {BUDDY_SECTIONS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={section === value}
              title={BUDDY_SECTION_DESCRIPTIONS[value]}
              onClick={() => setSection(value)}
              data-testid={`buddy-recommend-section-${value}`}
              className={cn(
                'rounded-pill border px-3 py-1 text-xs transition-colors',
                section === value
                  ? 'border-brand-soft bg-brand-soft text-brand-strong'
                  : 'border-border bg-surface text-muted hover:bg-surface-alt',
              )}
            >
              {BUDDY_SECTION_LABELS[value]}
            </button>
          ))}
        </div>

        {vm ? (
          <div className="flex flex-col gap-1" data-testid="buddy-match-mode">
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
              匹配模式：<KdyBadge tone={vm.matchMode === 'rule' ? 'warning' : 'info'}>{vm.matchModeLabel}</KdyBadge>
              <span>共 {vm.items.length} 条 · 其中 {vm.explainedCount} 条带明确理由</span>
            </p>
            <p className="text-xs text-muted">{vm.matchModeNotice}</p>
          </div>
        ) : null}
      </div>

      {receipt ? (
        <KdyAlert tone="success" title="反馈已记录" role="status">
          <p data-testid="buddy-feedback-receipt">{receipt}</p>
        </KdyAlert>
      ) : null}
      {actionError ? (
        <KdyAlert tone="danger" title="反馈失败" role="alert">
          <p data-testid="buddy-feedback-error">{actionError}</p>
        </KdyAlert>
      ) : null}

      {query.isPending ? (
        <div
          aria-busy
          aria-live="polite"
          className="grid grid-cols-1 gap-3 md:grid-cols-2"
          data-testid="buddy-recommendations-loading"
        >
          <KdyCardSkeleton />
          <KdyCardSkeleton />
        </div>
      ) : null}

      {query.isError ? (
        <KdyAlert
          tone="danger"
          title="推荐加载失败"
          role="alert"
          action={
            <KdyButton size="sm" variant="secondary" onClick={() => void query.refetch()}>
              <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} aria-hidden />
              重试
            </KdyButton>
          }
        >
          <p>{errorMessage(query.error)}</p>
        </KdyAlert>
      ) : null}

      {vm && vm.items.length === 0 ? (
        <KdyEmpty
          title="这个板块暂时没有可推荐的活动"
          description="可能是当前没有开放中的活动，或者你已经申请过了、时间不合适的都被过滤掉了。可以先去搭子广场看看，或者自己发一条。"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <KdyButton size="sm" href="/buddy">
                去搭子广场
              </KdyButton>
              <KdyButton size="sm" variant="secondary" href="/buddy/new">
                发布活动
              </KdyButton>
            </div>
          }
        />
      ) : null}

      {vm && vm.items.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {vm.items.map((item) => (
            <BuddyPostCard
              key={item.post.id}
              item={item.post}
              footer={
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">匹配分</span>
                    <KdyBadge tone="info">{item.scoreLabel}</KdyBadge>
                    <span className="text-xs text-muted">{item.scorePercentLabel}</span>
                    <span className="ml-auto text-xs text-muted">{item.sectionLabel}</span>
                  </div>

                  {/* ---- 理由区：这是本页的核心，不是只给分数 ---- */}
                  <div className="flex flex-col gap-1" data-testid={`buddy-reasons-${item.post.id}`}>
                    <p className="text-xs text-muted">为什么推荐给你</p>
                    <ul className="flex flex-wrap gap-1.5">
                      {item.reasons.map((reason) => (
                        <li key={reason.code}>
                          <KdyBadge tone={reason.code === 'potential' ? 'neutral' : 'brand'}>
                            {reason.label}
                          </KdyBadge>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted" data-testid={`buddy-reason-text-${item.post.id}`}>
                      {item.reasonLabel}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {FEEDBACK_ACTIONS.map((action) => (
                      <KdyButton
                        key={action}
                        size="sm"
                        variant={item.feedback === action ? 'primary' : 'secondary'}
                        disabled={feedbackMutation.isPending}
                        onClick={() => sendFeedback(item.post.id, action)}
                      >
                        {BUDDY_FEEDBACK_ACTION_LABELS[action]}
                      </KdyButton>
                    ))}
                    {item.feedbackLabel ? (
                      <span className="text-xs text-muted">已反馈：{item.feedbackLabel}</span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted">
                    反馈对象是活动而不是人，按板块隔离，只影响你自己的推荐顺序。
                  </p>
                </div>
              }
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
