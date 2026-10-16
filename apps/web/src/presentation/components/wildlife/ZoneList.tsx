'use client';

/**
 * 区域列表页主体（`/wildlife/zones`）。
 *
 * 区域是**人工定义**的管理边界，承载投喂政策与告示位（规格 §2.2 / §8.3）。
 * 敏感区必须显式说明"只给区域、不给坐标"（规格 §9.3 ①）。
 */
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { loadWildlifeCatalog } from '@/application/wildlife/loadWildlifeCatalog';
import { loadZoneList } from '@/application/wildlife/listZones';
import { getRepositories } from '@/data/repositories';

import { queryKeys } from '../../query/keys';
import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdyEmpty } from '../KdyEmpty';
import { KdySkeleton } from '../KdySkeleton';
import { FeedingPolicyBadge } from './FeedingPolicyBadge';

export function ZoneList() {
  const repository = getRepositories().wildlife;
  const query = useQuery({
    queryKey: queryKeys.wildlife.zones('all'),
    queryFn: async () => {
      const catalog = unwrapOrThrow(await loadWildlifeCatalog(repository));
      return unwrapOrThrow(await loadZoneList(repository, { limit: 50 }, catalog));
    },
  });

  return (
    <section className="flex flex-col gap-4" aria-labelledby="wildlife-zone-list-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="wildlife-zone-list-heading" className="mr-auto text-sm font-semibold text-body">
          活动区域
        </h2>
        <KdyButton
          size="sm"
          variant="secondary"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} aria-hidden />
          刷新
        </KdyButton>
      </div>

      {query.isPending ? (
        <div aria-busy aria-live="polite" className="flex flex-col gap-3" data-testid="wildlife-zones-loading">
          <KdySkeleton className="h-24 w-full" />
          <KdySkeleton className="h-24 w-full" />
        </div>
      ) : null}

      {query.isError ? (
        <KdyAlert tone="danger" title="区域列表加载失败" role="alert">
          <p>{errorMessage(query.error)}</p>
        </KdyAlert>
      ) : null}

      {query.isSuccess && query.data.isEmpty ? (
        <KdyEmpty
          title="还没有人工定义的区域"
          description={query.data.emptyHint}
        />
      ) : null}

      {query.data && !query.data.isEmpty ? (
        <>
          <p className="text-xs text-muted" data-testid="wildlife-zones-total">
            共 {query.data.total} 个区域 · 禁投喂 {query.data.forbiddenCount} 个 · 敏感区 {query.data.sensitiveCount} 个
          </p>
          <KdyAlert tone="warning" title="底图是占位示意图（待学校授权）">
            <p>{query.data.basemapNotice}</p>
          </KdyAlert>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {query.data.items.map((zone) => (
              <KdyCard key={zone.id} className="flex flex-col gap-2" data-testid="wildlife-zone-card">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-md font-semibold text-body">{zone.name}</h3>
                  {zone.isSensitive ? <KdyBadge tone="warning">敏感区</KdyBadge> : null}
                  <FeedingPolicyBadge policy={zone.feedingPolicy} withHint className="ml-auto" />
                </div>
                <p className="text-xs text-muted">
                  {zone.speciesLabelText} · {zone.radiusLabel} · {zone.fuzzLabel}
                </p>
                <p className="text-sm text-body">{zone.feedingCopy}</p>
                {zone.forbiddenWarning ? (
                  <p className="rounded-md border border-danger/40 bg-surface-alt px-3 py-2 text-xs text-danger" role="status">
                    {zone.forbiddenWarning}
                  </p>
                ) : null}
                {zone.noticeText ? (
                  <div className="rounded-md border border-border bg-surface-alt px-3 py-2">
                    <p className="text-sm text-body">{zone.noticeText}</p>
                    {zone.noticeDraftFlag ? (
                      <p className="mt-1 text-xs text-muted">{zone.noticeDraftFlag}</p>
                    ) : null}
                  </div>
                ) : null}
                {zone.sensitiveNotice ? <p className="text-xs text-warning">{zone.sensitiveNotice}</p> : null}
                {zone.note ? <p className="text-xs text-muted">{zone.note}</p> : null}
              </KdyCard>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
