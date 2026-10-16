'use client';

/**
 * 管理端 · 观测审核队列（`/admin/wildlife`）。
 *
 * 审核动作名是契约 §11.2 **已冻结**的 `moderate`：
 * `POST /api/v1/wildlife/items/:id/moderate`，body `{ decision, reason? }`。
 *
 * 页面上必须体现的三条规则（规格 §2.10 / §8）：
 * 1. **保护物种必须两名审核员**（单人通过 → `FORBIDDEN`，界面明确说明）；
 * 2. 拒绝**必须**填理由（仅审核端可见）；
 * 3. `healthConcern = true` **排到队首**（受伤动物不能等审核队列）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { loadWildlifeCatalog } from '@/application/wildlife/loadWildlifeCatalog';
import {
  DEMO_MODERATOR,
  DEMO_SECOND_MODERATOR,
  loadModerationQueue,
  moderateSighting,
} from '@/application/wildlife/moderateSightings';
import { getMockWildlifeRepository, getRepositories } from '@/data/repositories';
import type { ModerationDecision } from '@/domain/models/wildlife/sightings';

import { queryKeys } from '../../query/keys';
import { asApiError, errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdyEmpty } from '../KdyEmpty';
import { KdySkeleton } from '../KdySkeleton';
import { FeedingPolicyBadge } from '../wildlife/FeedingPolicyBadge';

export function WildlifeModerationQueue() {
  const repository = getRepositories().wildlife;
  const mockRepository = getMockWildlifeRepository();
  const queryClient = useQueryClient();

  /** 演示用：可在两名审核员之间切换，验证保护物种的双人复核 */
  const [asSecondModerator, setAsSecondModerator] = useState(false);
  const moderator = asSecondModerator ? DEMO_SECOND_MODERATOR : DEMO_MODERATOR;

  /** 故障演练开关（标签由 state 驱动；行为由 mock 的 setFailureMode 决定） */
  const [forcingError, setForcingError] = useState(false);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: [...queryKeys.admin.wildlifeModeration, moderator.id],
    queryFn: async () => {
      const catalog = unwrapOrThrow(await loadWildlifeCatalog(repository));
      return unwrapOrThrow(await loadModerationQueue(repository, catalog, moderator, new Date()));
    },
  });

  const mutation = useMutation({
    mutationFn: async (input: { id: string; decision: ModerationDecision }) =>
      unwrapOrThrow(
        await moderateSighting(repository, input.id, input.decision, moderator, {
          ...(reason[input.id] ? { reason: reason[input.id] } : {}),
        }),
      ),
    onSuccess: (result) => {
      setError(null);
      setFeedback(`${result.decisionLabel}：记录 ${result.sightingId} → ${result.statusLabel}（${result.message}）`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.wildlifeModeration });
    },
    onError: (cause) => {
      const apiError = asApiError(cause);
      setFeedback(null);
      setError(
        apiError.code === 'FORBIDDEN'
          ? `保护物种需要两名审核员复核：${apiError.message}。可切换到「第二名审核员」再试。`
          : apiError.message,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.wildlifeModeration });
    },
  });

  return (
    <section className="flex flex-col gap-4" aria-labelledby="wildlife-moderation-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="wildlife-moderation-heading" className="mr-auto text-sm font-semibold text-body">
          观测审核队列
        </h2>
        <label className="inline-flex items-center gap-2 text-xs text-body">
          <input
            type="checkbox"
            checked={asSecondModerator}
            onChange={(event) => setAsSecondModerator(event.target.checked)}
          />
          以第二名审核员身份操作
        </label>
        {mockRepository ? (
          <KdyButton
            size="sm"
            variant={forcingError ? 'danger' : 'secondary'}
            onClick={() => {
              const next = !forcingError;
              mockRepository.setFailureMode(next ? 'error' : 'none');
              setForcingError(next);
              void query.refetch();
            }}
          >
            {forcingError ? '恢复正常' : '演练故障'}
          </KdyButton>
        ) : null}
        <KdyButton size="sm" variant="secondary" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} aria-hidden />
          刷新
        </KdyButton>
      </div>

      <KdyAlert tone="info" title={`当前审核员：${moderator.label}`}>
        <p>
          动作名 <code>moderate</code> 已由契约 §11.2 冻结；通过/拒绝共用同一端点，
          由 body 的 <code>decision</code> 区分（拆成两个 action 会产生重复守卫代码）。
        </p>
      </KdyAlert>

      {feedback ? (
        <KdyAlert tone="success" title="操作已完成" role="status">
          <p>{feedback}</p>
        </KdyAlert>
      ) : null}
      {error ? (
        <KdyAlert tone="danger" title="操作被拒绝" role="alert">
          <p>{error}</p>
        </KdyAlert>
      ) : null}

      {query.isPending ? (
        <div aria-busy aria-live="polite" className="flex flex-col gap-3" data-testid="wildlife-moderation-loading">
          <KdySkeleton className="h-28 w-full" />
          <KdySkeleton className="h-28 w-full" />
        </div>
      ) : null}

      {query.isError ? (
        <KdyAlert tone="danger" title="审核队列加载失败" role="alert">
          <p>{errorMessage(query.error)}</p>
        </KdyAlert>
      ) : null}

      {query.data && query.data.isEmpty ? (
        <KdyEmpty title="审核队列是空的" description={query.data.emptyHint} />
      ) : null}

      {query.data && !query.data.isEmpty ? (
        <>
          <p className="text-xs text-muted" data-testid="wildlife-moderation-summary">
            共 {query.data.total} 条 · 待审核 {query.data.pendingCount} 条 · 疑似受伤{' '}
            {query.data.healthConcernCount} 条 · 保护物种 {query.data.protectedCount} 条
          </p>
          <p className="text-xs text-muted">{query.data.moderatorNotice}</p>

          <div className="flex flex-col gap-3">
            {query.data.items.map((item) => (
              <KdyCard key={item.id} className="flex flex-col gap-3" data-testid="wildlife-moderation-item">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-md font-semibold text-body">{item.speciesLabel}</span>
                  <KdyBadge
                    tone={item.status === 'PENDING' ? 'warning' : item.status === 'REJECTED' ? 'danger' : 'success'}
                  >
                    {item.statusLabel}
                  </KdyBadge>
                  {item.healthConcern ? <KdyBadge tone="danger">疑似受伤 · 队首优先</KdyBadge> : null}
                  {item.isProtected ? <KdyBadge tone="warning">保护物种 · 双人复核</KdyBadge> : null}
                  {item.awaitingSecondModerator ? (
                    <KdyBadge tone="info">已有第一票：{item.preconditionReason ? '待复核' : '待复核'}</KdyBadge>
                  ) : null}
                  <FeedingPolicyBadge policy={item.feedingPolicy} className="ml-auto" />
                </div>

                <p className="text-xs text-muted">
                  {item.observedLabel} · {item.reporterLabel} · {item.zoneName ?? '未落在已定义区域'} ·{' '}
                  {item.photoCount} 张照片 · 分类来源：{item.classifiedByLabel}
                </p>

                {item.note ? <p className="text-sm text-body">{item.note}</p> : null}
                {item.healthNotice ? <p className="text-xs text-danger">{item.healthNotice}</p> : null}
                {item.preconditionReason ? (
                  <p className="text-xs text-warning">{item.preconditionReason}</p>
                ) : null}
                <p className="text-xs text-muted">{item.moderatorHint}</p>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-muted">拒绝理由（拒绝时必填，仅审核端可见）</span>
                  <input
                    type="text"
                    value={reason[item.id] ?? ''}
                    maxLength={200}
                    onChange={(event) =>
                      setReason((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                    className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body"
                    placeholder="例如：照片未拍到动物，无法确认物种"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <KdyButton
                    size="sm"
                    disabled={mutation.isPending || item.status === 'REJECTED'}
                    onClick={() => mutation.mutate({ id: item.id, decision: 'PUBLISHED' })}
                  >
                    通过并发布
                  </KdyButton>
                  <KdyButton
                    size="sm"
                    variant="danger"
                    disabled={mutation.isPending || item.status === 'REJECTED' || !(reason[item.id] ?? '').trim()}
                    onClick={() => mutation.mutate({ id: item.id, decision: 'REJECTED' })}
                  >
                    拒绝
                  </KdyButton>
                </div>
              </KdyCard>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
