'use client';

/**
 * 推断轨迹页主体（`/wildlife/tracks`）。
 *
 * ⚠️ 本页最重要的要求（规格 §6.1 / §2.4 / 验收 T18）：
 * **显著标注"推断轨迹，非实测路径"**，并且给出为什么（数据来自偶发上报，不是 GPS 项圈）。
 * 文案全部来自 application 层与 domain 的常量，组件不自己写一份 ——
 * 避免某个端"忘记加"免责声明（这也是服务端下发 `disclaimer` 的原因）。
 */
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';

import { loadWildlifeCatalog } from '@/application/wildlife/loadWildlifeCatalog';
import { loadTrackList } from '@/application/wildlife/listTracks';
import { ALL_SPECIES, loadWildlifeMap, defaultMapFilters } from '@/application/wildlife/wildlifeMap';
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
import { SpeciesFilterBar } from './SpeciesFilterBar';
import { WildlifeBasemapMap } from './WildlifeBasemapMap';

export function TrackList() {
  const repository = getRepositories().wildlife;
  const [speciesId, setSpeciesId] = useState<string>(ALL_SPECIES);
  const [highlightedTrackId, setHighlightedTrackId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.wildlife.tracks(speciesId),
    queryFn: async () => {
      const catalog = unwrapOrThrow(await loadWildlifeCatalog(repository));
      const [tracks, map] = await Promise.all([
        loadTrackList(repository, speciesId === ALL_SPECIES ? {} : { species: speciesId }, catalog),
        loadWildlifeMap(repository, { ...defaultMapFilters(), speciesId, showMarkers: false }),
      ]);
      return {
        tracks: unwrapOrThrow(tracks),
        map: unwrapOrThrow(map),
      };
    },
    placeholderData: (previous) => previous,
  });

  const selected = useMemo(() => {
    const items = query.data?.tracks.items ?? [];
    if (items.length === 0) return null;
    return items.find((item) => item.id === highlightedTrackId) ?? items[0] ?? null;
  }, [query.data, highlightedTrackId]);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="wildlife-track-list-heading">
      <KdyAlert tone="warning" title="推断轨迹，非实测路径">
        <p>
          {query.data?.tracks.inferredNotice ??
            '数据来自同学偶发上报，不是 GPS 项圈：无法重建真实运动路径，也无法知道动物在两次上报之间去了哪。'}
        </p>
        <p className="mt-1 text-xs">
          服务端下发的每条轨迹都带 <code>isInferred: true</code> 与免责声明；页面
          <strong className="font-medium">不允许</strong>出现“这只动物的路线”这类文案。
        </p>
      </KdyAlert>

      <div className="flex flex-wrap items-center gap-2">
        <h2 id="wildlife-track-list-heading" className="mr-auto text-sm font-semibold text-body">
          推断轨迹
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

      {query.data ? (
        <SpeciesFilterBar
          options={query.data.map.speciesOptions}
          value={speciesId}
          allValue={ALL_SPECIES}
          onChange={setSpeciesId}
        />
      ) : null}

      {query.isPending ? (
        <div aria-busy aria-live="polite" className="flex flex-col gap-3" data-testid="wildlife-tracks-loading">
          <KdySkeleton className="h-72 w-full" />
          <KdySkeleton lines={3} />
        </div>
      ) : null}

      {query.isError ? (
        <KdyAlert tone="danger" title="轨迹加载失败" role="alert">
          <p>{errorMessage(query.error)}</p>
        </KdyAlert>
      ) : null}

      {query.data && query.data.tracks.isEmpty ? (
        <KdyEmpty title="还没有可推断的轨迹" description={query.data.tracks.emptyHint} />
      ) : null}

      {query.data && !query.data.tracks.isEmpty ? (
        <>
          {selected ? (
            <WildlifeBasemapMap
              basemap={query.data.map.basemap}
              zones={query.data.map.overlays.zones}
              spots={[]}
              tracks={query.data.map.overlays.tracks}
              markers={[]}
              highlightedTrackId={selected.id}
            />
          ) : null}

          <div className="flex flex-col gap-3">
            {query.data.tracks.items.map((track) => (
              <KdyCard
                key={track.id}
                className={cn(
                  'flex flex-col gap-2',
                  selected?.id === track.id && 'border-brand-soft',
                )}
                data-testid="wildlife-track-card"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-md font-semibold text-body">
                    {track.individualName ? `${track.individualName}（${track.speciesLabel}）` : track.speciesLabel}
                  </h3>
                  {/* ⚠️ 硬要求：短标签必须显著 */}
                  <KdyBadge tone="warning" title={track.disclaimer}>
                    {track.inferredLabel}
                  </KdyBadge>
                  <KdyButton
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => setHighlightedTrackId(track.id)}
                  >
                    {selected?.id === track.id ? '地图已高亮' : '在地图上高亮'}
                  </KdyButton>
                </div>
                <p className="text-xs text-muted">
                  {track.summaryLabel} · {track.spanLabel} · {track.distanceLabel} · {track.confidenceLabel}
                </p>
                <p className="text-xs text-muted">{track.methodLabel}</p>
                <p className="text-sm text-body">{track.disclaimer}</p>
                <p className="text-xs text-muted">{track.computedLabel}</p>
                {!track.hasPath ? (
                  <p className="text-xs text-warning">该轨迹只有 1 个途经点，无法连成折线（不插值、不编造）。</p>
                ) : null}
              </KdyCard>
            ))}
          </div>

          <p className="text-xs text-muted">
            地图上共绘制 {query.data.tracks.renderedPointCount} 个折线顶点 · 折线为虚线，表示“推断”而非实测。
          </p>
        </>
      ) : null}
    </section>
  );
}
