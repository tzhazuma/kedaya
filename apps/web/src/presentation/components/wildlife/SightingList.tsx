'use client';

/**
 * 观测列表（游标分页 + 物种筛选 + **三态齐全**）。
 *
 * 数据流：`SightingList`（presentation）→ `loadSightingList`（application）
 *         → `WildlifeRepository`（domain port）← mock/http adapter（data）
 *
 * 三态：loading（骨架）/ error（可重试 + 显示上一次数据）/ empty（带引导文案）。
 * 错误态**不吞掉**已有数据（契约 §8：失败静默降级而非白屏）。
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';

import { loadWildlifeCatalog } from '@/application/wildlife/loadWildlifeCatalog';
import { loadSightingList, type WildlifeCatalog } from '@/application/wildlife/listSightings';
import { getMockWildlifeRepository, getRepositories } from '@/data/repositories';

import { queryKeys } from '../../query/keys';
import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyButton } from '../KdyButton';
import { KdyEmpty } from '../KdyEmpty';
import { KdyCardSkeleton } from '../KdySkeleton';
import { SightingCard } from './SightingCard';

const PAGE_SIZE = 4;

export interface SightingListProps {
  /** 物种筛选（`'all'` 表示不过滤） */
  speciesId?: string;
  /** 仅看疑似受伤 */
  healthConcernOnly?: boolean;
  /** 是否显示"演练故障"开关（mock 模式下默认显示） */
  showMockControls?: boolean;
  className?: string;
}

export function SightingList({
  speciesId = 'all',
  healthConcernOnly = false,
  showMockControls = true,
  className,
}: SightingListProps) {
  const repository = getRepositories().wildlife;
  const mockRepository = getMockWildlifeRepository();
  /** 故障演练开关（标签由 state 驱动；行为由 mock 的 setFailureMode 决定） */
  const [forcingError, setForcingError] = useState(false);

  const catalogQuery = useInfiniteQuery({
    queryKey: queryKeys.wildlife.list({ speciesId, healthConcernOnly }),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const catalog = unwrapOrThrow(await loadWildlifeCatalog(repository));
      const page = unwrapOrThrow(
        await loadSightingList(
          repository,
          {
            cursor: pageParam,
            limit: PAGE_SIZE,
            ...(speciesId === 'all' ? {} : { species: speciesId }),
            ...(healthConcernOnly ? { healthConcernOnly: true } : {}),
          },
          catalog,
          new Date(),
        ),
      );
      return { page, catalog };
    },
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
    placeholderData: (previous) => previous,
  });

  const items = useMemo(
    () => catalogQuery.data?.pages.flatMap((entry) => entry.page.items) ?? [],
    [catalogQuery.data],
  );
  const total = catalogQuery.data?.pages[0]?.page.total ?? 0;
  const catalog: WildlifeCatalog = catalogQuery.data?.pages[0]?.catalog ?? {
    species: [],
    zones: [],
    individuals: [],
  };

  return (
    <section className={cn('flex flex-col gap-4', className)} aria-labelledby="wildlife-sightings-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="wildlife-sightings-heading" className="mr-auto text-sm font-semibold text-body">
          观测记录
        </h2>
        {mockRepository && showMockControls ? (
          <KdyButton
            size="sm"
            variant={forcingError ? 'danger' : 'secondary'}
            onClick={() => {
              const next = !forcingError;
              mockRepository.setFailureMode(next ? 'error' : 'none');
              setForcingError(next);
              void catalogQuery.refetch();
            }}
          >
            {forcingError ? '恢复正常' : '演练故障'}
          </KdyButton>
        ) : null}
      </div>

      {catalogQuery.isPending ? (
        <div aria-busy aria-live="polite" className="flex flex-col gap-3" data-testid="wildlife-list-loading">
          <KdyCardSkeleton />
          <KdyCardSkeleton />
        </div>
      ) : null}

      {catalogQuery.isError ? (
        <KdyAlert
          tone="danger"
          title="观测列表加载失败"
          role="alert"
          action={
            <KdyButton
              size="sm"
              variant="secondary"
              onClick={() => void catalogQuery.refetch()}
              disabled={catalogQuery.isFetching}
            >
              <RefreshCw className={cn('size-3.5', catalogQuery.isFetching && 'animate-spin')} aria-hidden />
              重试
            </KdyButton>
          }
        >
          <p>{errorMessage(catalogQuery.error)}</p>
          <p className="mt-1 text-xs">
            这是可恢复错误。{items.length > 0 ? '下方展示的是上一次成功获取的数据。' : ''}
          </p>
        </KdyAlert>
      ) : null}

      {catalogQuery.isSuccess && items.length === 0 ? (
        <KdyEmpty
          title="没有匹配的观测记录"
          description="公开列表只包含审核通过的记录。可以换个物种筛选，或自己上报一条。"
          action={
            <KdyButton size="sm" href="/wildlife/report">
              上报一条观测
            </KdyButton>
          }
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <p className="text-xs text-muted" data-testid="wildlife-list-total">
            共 {total} 条 · 当前展示 {items.length} 条（仅审核通过的记录）
          </p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {items.map((item) => (
              <SightingCard key={item.id} item={item} />
            ))}
          </div>
          {catalogQuery.hasNextPage ? (
            <div className="flex justify-center">
              <KdyButton
                variant="secondary"
                onClick={() => void catalogQuery.fetchNextPage()}
                disabled={catalogQuery.isFetchingNextPage}
              >
                {catalogQuery.isFetchingNextPage ? '加载中…' : '加载更多（游标分页）'}
              </KdyButton>
            </div>
          ) : null}
        </>
      ) : null}

      {catalog.species.length === 0 && catalogQuery.isSuccess ? (
        <p className="text-xs text-muted">
          物种表为空 —— 真实物种清单需由校园动物社团确认后由服务端下发（未决问题 U2）。
        </p>
      ) : null}
    </section>
  );
}
