'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, RefreshCw, Unlink } from 'lucide-react';
import { useState } from 'react';

import {
  bindablePlatforms,
  bindCampusPlatform,
  loadTechpieLinks,
  renewCampusLink,
  renewFailureMessage,
  techpieLinkListState,
  unbindCampusLink,
  type TechpieLinkListVM,
  type TechpieLinkVM,
} from '@/application/techpie/listTechpieLinks';
import { getMockTechpieRepository, getRepositories } from '@/data/repositories';
import { CAMPUS_PLATFORM_LABELS } from '@/domain/models/techpie';

import { queryKeys } from '../../query/keys';
import { shouldRetryQuery } from '../../query/retry';
import { asApiError, errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdyEmpty } from '../KdyEmpty';
import { KdyCardSkeleton } from '../KdySkeleton';

/** 每页条数（故意取小值，便于演示游标分页） */
const PAGE_SIZE = 5;

interface Feedback {
  tone: 'success' | 'warning' | 'danger';
  text: string;
}

/**
 * 绑定管理 —— TechPie Phase 0 的入口（规格 §8.1 端点 1–5）。
 *
 * 数据流：`TechpieLinkList`（presentation）→ `loadTechpieLinks`（application）
 *         → `TechpieRepository`（domain port）← mock/http adapter（data）
 *
 * 三态齐全：loading（骨架）/ error（可重试，保留上一次数据）/ empty（带引导文案）。
 * 游标分页：只把服务端给的 `nextCursor` 原样回传（契约 §11.10-E）。
 *
 * ⚠️ Phase 0 只允许发起 **校园卡（OPENID 通道）** 的绑定；
 * 其余平台照常展示，但按钮是"未开放"+ 阻塞原因（§11.18-D / E）。
 */
export function TechpieLinkList() {
  const repository = getRepositories().techpie;
  const mockRepository = getMockTechpieRepository();
  const queryClient = useQueryClient();
  const [forcingError, setForcingError] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const query = useInfiniteQuery({
    queryKey: queryKeys.techpie.links(),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrapOrThrow(await loadTechpieLinks(repository, { cursor: pageParam, limit: PAGE_SIZE })),
    getNextPageParam: (last: TechpieLinkListVM) => last.nextCursor ?? undefined,
    // 确定性失败（403/404/409/422…）不重试：重试只会推迟引导，
    // 且在后台标签页里会因定时器节流而表现为"永久骨架屏"
    retry: shouldRetryQuery,
  });

  const pages = query.data?.pages ?? [];
  const items = pages.flatMap((page) => page.items);
  const state = techpieLinkListState({
    isPending: query.isPending,
    isError: query.isError,
    itemCount: items.length,
  });
  const platforms = bindablePlatforms(items);

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.techpie.root });
  };

  const bindMutation = useMutation({
    mutationFn: async (platform: TechpieLinkVM['platform']) =>
      unwrapOrThrow(
        await bindCampusPlatform(repository, {
          platform,
          // Phase 0 只走 OPENID 通道（校园卡）。**绝不构造 password 凭证。**
          credential: { kind: 'openid', channel: 'wechat' },
        }),
      ),
    onSuccess: async (result, platform) => {
      setFeedback({
        tone: 'success',
        text:
          result.nextStep ??
          `已发起「${CAMPUS_PLATFORM_LABELS[platform]}」的绑定。`,
      });
      await invalidate();
    },
    onError: (error) => setFeedback({ tone: 'danger', text: errorMessage(error) }),
  });

  const unbindMutation = useMutation({
    mutationFn: async (linkId: string) => unwrapOrThrow(await unbindCampusLink(repository, linkId)),
    onSuccess: async () => {
      setFeedback({ tone: 'warning', text: '已解绑。该平台的校园能力已不可用，可随时重新绑定。' });
      await invalidate();
    },
    onError: (error) => setFeedback({ tone: 'danger', text: errorMessage(error) }),
  });

  const renewMutation = useMutation({
    mutationFn: async (linkId: string) => unwrapOrThrow(await renewCampusLink(repository, linkId)),
    onSuccess: async () => {
      setFeedback({ tone: 'success', text: '续期成功。' });
      await invalidate();
    },
    // F3：上游不支持续期时**如实**说明，绝不谎称"已续期"
    onError: (error) => setFeedback({ tone: 'warning', text: renewFailureMessage(asApiError(error)) }),
  });

  const toggleForcedError = (): void => {
    if (!mockRepository) return;
    const next = !forcingError;
    mockRepository.setFailureMode(next ? 'error' : 'none');
    setForcingError(next);
    void query.refetch();
  };

  const completeOpenId = (linkId: string): void => {
    if (!mockRepository) return;
    mockRepository.completeOpenIdBinding(linkId);
    setFeedback({ tone: 'success', text: '（mock）已模拟学校/微信侧完成 OPENID 授权。' });
    void invalidate();
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="techpie-links-heading">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="techpie-links-heading" className="mr-auto text-sm font-semibold text-body">
            我的校园系统绑定
          </h2>
          <KdyButton href="/techpie/capabilities" size="sm" variant="secondary">
            能力清单
          </KdyButton>
          <KdyButton href="/techpie/webview" size="sm" variant="secondary">
            WebView 直连
          </KdyButton>
        </div>

        <p className="text-xs text-muted">
          绑定是<strong className="font-medium">可选</strong>的：不绑定也能正常使用可达鸭的全部自有功能。
          「已登录但未绑定」是合法状态，不是错误。
        </p>

        {mockRepository ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted">
              当前数据源：<strong className="font-medium">mock</strong>
              （内存数据，无后端可跑）。可切换故障模式验证错误态。
            </p>
            <div className="flex gap-2">
              <KdyButton
                size="sm"
                variant="secondary"
                onClick={() => {
                  mockRepository.reset();
                  setForcingError(false);
                  setFeedback({ tone: 'success', text: '（mock）已恢复初始绑定数据。' });
                  void invalidate();
                }}
              >
                重置数据
              </KdyButton>
              <KdyButton
                size="sm"
                variant={forcingError ? 'danger' : 'secondary'}
                onClick={toggleForcedError}
              >
                {forcingError ? '恢复正常' : '演练故障'}
              </KdyButton>
            </div>
          </div>
        ) : null}
      </div>

      {feedback ? (
        <KdyAlert
          tone={feedback.tone}
          title={feedback.tone === 'danger' ? '操作失败' : '操作结果'}
          role={feedback.tone === 'danger' ? 'alert' : 'status'}
        >
          <p data-testid="techpie-feedback">{feedback.text}</p>
        </KdyAlert>
      ) : null}

      {state === 'loading' ? (
        <div aria-busy aria-live="polite" className="flex flex-col gap-3" data-testid="techpie-loading">
          <KdyCardSkeleton />
          <KdyCardSkeleton />
        </div>
      ) : null}

      {state === 'error' ? (
        <KdyAlert
          tone="danger"
          title="绑定列表加载失败"
          role="alert"
          action={
            <KdyButton
              size="sm"
              variant="secondary"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} aria-hidden />
              重试
            </KdyButton>
          }
        >
          <p>{errorMessage(query.error)}</p>
          <p className="mt-1 text-xs">
            契约 §8 要求失败静默降级而非白屏。
            {items.length > 0 ? '下方展示的是上一次成功获取的数据。' : ''}
          </p>
        </KdyAlert>
      ) : null}

      {state === 'empty' ? (
        <KdyEmpty
          title="还没有绑定任何校园系统"
          description="绑定之后，可达鸭才能替你访问对应的校园能力（校园卡、课表……）。现在可以绑定校园卡 —— 它走独立的 OPENID 通道，与校园会话完全无关。"
          action={
            <KdyButton
              size="sm"
              onClick={() => bindMutation.mutate('ecard')}
              disabled={bindMutation.isPending}
            >
              <Link2 className="size-3.5" aria-hidden />
              绑定校园卡（OPENID）
            </KdyButton>
          }
        />
      ) : null}

      {items.length > 0 ? (
        <ul className="flex flex-col gap-3" data-testid="techpie-links">
          {items.map((item) => (
            <li key={item.id}>
              <KdyCard className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-body">{item.platformLabel}</span>
                  <KdyBadge tone={item.statusTone}>{item.statusLabel}</KdyBadge>
                  <KdyBadge tone="neutral">{item.phaseLabel}</KdyBadge>
                  {item.openIdChannel ? <KdyBadge tone="brand">OPENID 通道</KdyBadge> : null}
                  <span className="ml-auto flex gap-2">
                    {item.canRenew ? (
                      <KdyButton
                        size="sm"
                        variant="secondary"
                        onClick={() => renewMutation.mutate(item.id)}
                        disabled={renewMutation.isPending}
                      >
                        <RefreshCw className="size-3.5" aria-hidden />
                        手动续期
                      </KdyButton>
                    ) : null}
                    {item.canUnbind ? (
                      <KdyButton
                        size="sm"
                        variant="ghost"
                        onClick={() => unbindMutation.mutate(item.id)}
                        disabled={unbindMutation.isPending}
                      >
                        <Unlink className="size-3.5" aria-hidden />
                        解绑
                      </KdyButton>
                    ) : null}
                  </span>
                </div>

                <p className="text-xs text-muted">{item.platformDescription}</p>

                <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                  <div className="flex gap-1">
                    <dt className="text-muted">对端标识</dt>
                    <dd className="text-body">{item.externalUserId ?? '—'}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="text-muted">有效期</dt>
                    <dd className="text-body">{item.expiresAtLabel}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="text-muted">上次同步</dt>
                    <dd className="text-body">{item.lastSyncAtLabel}</dd>
                  </div>
                </dl>

                {item.notice ? (
                  <p className="rounded-md bg-surface-alt p-2 text-xs text-body" role="status">
                    {item.notice}
                  </p>
                ) : null}

                {mockRepository && item.status === 'LINKING' ? (
                  <div>
                    <KdyButton size="sm" variant="secondary" onClick={() => completeOpenId(item.id)}>
                      （mock）模拟完成 OPENID 授权
                    </KdyButton>
                  </div>
                ) : null}
              </KdyCard>
            </li>
          ))}
        </ul>
      ) : null}

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <KdyButton
            variant="secondary"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? '加载中…' : '加载更多（游标分页）'}
          </KdyButton>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-body">可绑定的校园平台</h3>
        <ul className="flex flex-col gap-2">
          {platforms.map((platform) => (
            <li
              key={platform.platform}
              className="flex flex-wrap items-center gap-2 border-t border-border pt-2 first:border-t-0 first:pt-0"
            >
              <span className="text-sm text-body">{platform.label}</span>
              <KdyBadge tone={platform.available ? 'info' : 'neutral'}>{platform.phaseLabel}</KdyBadge>
              {platform.openIdChannel ? <KdyBadge tone="brand">OPENID</KdyBadge> : null}
              <span className="ml-auto">
                {platform.available ? (
                  <KdyButton
                    size="sm"
                    onClick={() => bindMutation.mutate(platform.platform)}
                    disabled={bindMutation.isPending}
                  >
                    发起绑定
                  </KdyButton>
                ) : (
                  <KdyButton size="sm" variant="secondary" disabled title={platform.blockedReason ?? ''}>
                    未开放
                  </KdyButton>
                )}
              </span>
              {platform.blockedReason ? (
                <p className="w-full text-xs text-muted">{platform.blockedReason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
