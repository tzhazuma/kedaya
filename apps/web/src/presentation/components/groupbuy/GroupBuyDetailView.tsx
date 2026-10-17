'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import {
  joinGroupBuy,
  loadGroupBuyDetail,
  type GroupBuyDetailVM,
} from '@/application/groupbuy/getGroupBuyDetail';
import { getRepositories } from '@/data/repositories';

import { queryKeys } from '../../query/keys';
import { asApiError, errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdySkeleton } from '../KdySkeleton';

const STATUS_TONE: Record<GroupBuyDetailVM['status'], 'brand' | 'info' | 'success' | 'neutral'> = {
  recruiting: 'brand',
  locked: 'info',
  completed: 'success',
  cancelled: 'neutral',
};

/**
 * 拼单详情 —— 同样的三态（loading / error / success），外加参团领域动作。
 */
export function GroupBuyDetailView({ id }: { id: string }) {
  const repository = getRepositories().groupbuy;
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(1);

  const query = useQuery({
    queryKey: queryKeys.groupbuy.detail(id),
    queryFn: async () =>
      unwrapOrThrow(await loadGroupBuyDetail(repository, id, new Date())),
  });

  const joinMutation = useMutation({
    mutationFn: async (count: number) =>
      unwrapOrThrow(await joinGroupBuy(repository, id, count, new Date())),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.groupbuy.detail(id), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.groupbuy.root });
    },
  });

  const backLink = (
    <Link href="/groupbuy" className="inline-flex items-center gap-1 text-sm text-muted hover:text-body">
      <ArrowLeft className="size-4" aria-hidden />
      返回拼单列表
    </Link>
  );

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy data-testid="groupbuy-detail-loading">
        {backLink}
        <KdyCard className="flex flex-col gap-3">
          <KdySkeleton className="h-6 w-1/2" />
          <KdySkeleton lines={3} />
          <KdySkeleton className="h-2 w-full" />
        </KdyCard>
      </div>
    );
  }

  if (query.isError) {
    const apiError = asApiError(query.error);
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <KdyAlert
          tone="danger"
          title={apiError.code === 'NOT_FOUND' ? '拼单不存在' : '详情加载失败'}
          action={
            <KdyButton size="sm" variant="secondary" onClick={() => void query.refetch()}>
              <RefreshCw className="size-3.5" aria-hidden />
              重试
            </KdyButton>
          }
        >
          <p>{errorMessage(query.error)}</p>
          <p className="mt-1 text-xs">错误码：{apiError.code}</p>
        </KdyAlert>
      </div>
    );
  }

  const detail = query.data;
  const joinError = joinMutation.isError ? asApiError(joinMutation.error) : undefined;

  return (
    <div className="flex flex-col gap-4">
      {backLink}

      <KdyCard className="flex flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-bold text-body">{detail.title}</h1>
            <p className="text-sm text-muted">
              {detail.merchant} · {detail.categoryLabel} · 发起人 {detail.initiatorName}
            </p>
          </div>
          <KdyBadge tone={STATUS_TONE[detail.status]}>{detail.statusLabel}</KdyBadge>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xxl font-bold text-brand-strong">{detail.priceLabel}</span>
          <span className="text-sm text-muted line-through">{detail.originalPriceLabel}</span>
          <KdyBadge tone="success">{detail.discountLabel}</KdyBadge>
        </div>

        <div className="flex flex-col gap-1">
          <div
            className="h-2 w-full overflow-hidden rounded-pill bg-surface-alt"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={detail.progress}
            aria-label={`成团进度 ${detail.progress}%`}
          >
            <span className="block h-full rounded-pill bg-brand" style={{ width: `${detail.progress}%` }} />
          </div>
          <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>{detail.joinedLabel}</span>
            <span>
              {detail.remainingSlots > 0 ? `还差 ${detail.remainingSlots} 人` : '人数已满'} ·{' '}
              {detail.deadlineLabel}
            </span>
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-3 border-t border-border pt-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">取货点</dt>
            <dd className="text-body">{detail.pickupSpot}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">发起时间</dt>
            <dd className="text-body">{detail.createdLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">已收款（mock）</dt>
            <dd className="text-body">{detail.paidTotalLabel}</dd>
          </div>
        </dl>

        {detail.note ? <p className="text-sm text-muted">备注：{detail.note}</p> : null}
      </KdyCard>

      <KdyCard className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-body">参团（领域动作）</h2>
        <p className="text-xs text-muted">
          契约路由：<code className="font-mono">POST /api/v1/groupbuy/items/{id}/join</code>
          {detail.joinable ? '' : ' · 当前不可参团'}
        </p>

        {joinError ? (
          <KdyAlert tone="danger" title="参团失败">
            <p>{joinError.message}</p>
            <p className="mt-1 text-xs">错误码：{joinError.code}</p>
          </KdyAlert>
        ) : null}

        {joinMutation.isSuccess ? (
          <KdyAlert tone="success" title="参团成功">
            <p>已加入 {detail.participantCount} 人中的一员，列表已同步刷新。</p>
          </KdyAlert>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-body">
            份数
            <select
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <KdyButton
            onClick={() => joinMutation.mutate(quantity)}
            disabled={!detail.joinable || joinMutation.isPending}
          >
            {joinMutation.isPending ? '提交中…' : '立即参团'}
          </KdyButton>
        </div>
      </KdyCard>

      <KdyCard className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-body">
          参与者（{detail.participantCount}）
        </h2>
        <ul className="flex flex-col divide-y divide-border">
          {detail.participants.map((participant) => (
            <li key={participant.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="flex items-center gap-2 text-body">
                {participant.nickname}
                {participant.anonymous ? <KdyBadge tone="neutral">匿名</KdyBadge> : null}
              </span>
              <span className="text-xs text-muted">
                {participant.quantityLabel} · {participant.paidLabel} · {participant.joinedLabel}
              </span>
            </li>
          ))}
        </ul>
      </KdyCard>

      <KdyCard tone="alt" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-body">成团规则</h2>
        <ul className="list-inside list-disc text-sm text-muted">
          {detail.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </KdyCard>
    </div>
  );
}
