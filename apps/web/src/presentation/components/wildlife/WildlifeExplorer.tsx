'use client';

/**
 * 动物地图浏览器（`/wildlife` 页面的主体）—— 垂直切片的入口。
 *
 * 数据流：`WildlifeExplorer`（presentation）→ `loadWildlifeMap`（application）
 *         → `WildlifeRepository`（domain port）← mock/http adapter（data）
 *
 * 三态齐全：loading（骨架）/ error（可重试 + 保留上一次数据）/ empty（带引导文案）。
 * 页面上**必须**同时出现：底图占位声明、热点非实时声明、位置模糊化声明（规格 §1.3 / §8.1 E10 / §9）。
 */
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  ALL_SPECIES,
  defaultMapFilters,
  loadWildlifeMap,
  type WildlifeMapFilters,
} from '@/application/wildlife/wildlifeMap';
import { getMockWildlifeRepository, getRepositories } from '@/data/repositories';

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
import { PrivacyNoticePanel } from './PrivacyNoticePanel';
import { SightingCard } from './SightingCard';
import { SpeciesFilterBar } from './SpeciesFilterBar';
import { WildlifeBasemapMap, WildlifeMapLegend } from './WildlifeBasemapMap';

const LAYER_TOGGLES: ReadonlyArray<{ key: keyof Pick<WildlifeMapFilters, 'showZones' | 'showSpots' | 'showTracks' | 'showMarkers'>; label: string; hint: string }> = [
  { key: 'showZones', label: '活动区域', hint: '人工定义的管理边界（投喂政策、告示位）' },
  { key: 'showSpots', label: '聚合热点', hint: '历史聚合（延迟 ≥24h），不是实时位置' },
  { key: 'showTracks', label: '推断轨迹', hint: '由上报推断的活动走廊，非实测路径' },
  { key: 'showMarkers', label: '观测点', hint: '已发布观测的模糊化坐标（敏感区不落点）' },
];

export function WildlifeExplorer() {
  const repository = getRepositories().wildlife;
  const mockRepository = getMockWildlifeRepository();
  const [filters, setFilters] = useState<WildlifeMapFilters>(defaultMapFilters);
  /**
   * 故障演练开关的**标签**由 React state 驱动，而不是每次渲染去读 mock 的可变状态：
   * 读外部可变值会让"点了按钮但界面没变"看起来像没生效（真实后端下这个开关不存在，
   * 它只是 mock 演示三态用的）。行为仍然由 mock 的 `setFailureMode` 决定。
   */
  const [forcingError, setForcingError] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.wildlife.map(filters),
    queryFn: async () => unwrapOrThrow(await loadWildlifeMap(repository, filters, new Date())),
    // 切物种/图层时**保留上一次的数据**继续渲染（`isFetching` 期间不闪骨架屏）：
    // 否则整页（含筛选控件）会卸载成骨架，用户会丢掉"我正在操作什么"的上下文。
    placeholderData: (previous) => previous,
  });

  const zoneNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const zone of query.data?.zoneVMs ?? []) map.set(zone.id, zone.name);
    return map;
  }, [query.data]);

  const update = (patch: Partial<WildlifeMapFilters>): void =>
    setFilters((current) => ({ ...current, ...patch }));

  return (
    <div className="flex flex-col gap-4" data-testid="wildlife-explorer">
      {/* ---- 筛选与图层 ---- */}
      <KdyCard className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-semibold text-body">物种与图层</h2>
          {mockRepository ? (
            <>
              <KdyBadge tone="neutral" title="当前数据源">
                mock（无后端可跑）
              </KdyBadge>
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
            </>
          ) : null}
        </div>

        {query.data ? (
          <SpeciesFilterBar
            options={query.data.speciesOptions}
            value={filters.speciesId}
            allValue={ALL_SPECIES}
            onChange={(next) => update({ speciesId: next })}
          />
        ) : (
          <KdySkeleton className="h-6 w-64" />
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          {LAYER_TOGGLES.map((toggle) => (
            <label key={toggle.key} className="inline-flex items-center gap-2 text-xs text-body" title={toggle.hint}>
              <input
                type="checkbox"
                checked={filters[toggle.key]}
                onChange={(event) => update({ [toggle.key]: event.target.checked })}
              />
              {toggle.label}
            </label>
          ))}
        </div>
      </KdyCard>

      {/* ---- loading ---- */}
      {query.isPending ? (
        <div aria-busy aria-live="polite" className="flex flex-col gap-3" data-testid="wildlife-map-loading">
          <KdySkeleton className="h-80 w-full" />
          <KdySkeleton lines={3} />
        </div>
      ) : null}

      {/* ---- error ---- */}
      {query.isError ? (
        <KdyAlert
          tone="danger"
          title="动物地图加载失败"
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
            契约 §8 要求失败静默降级而非白屏：{query.data ? '下方保留上一次成功的地图数据。' : '当前没有可用的缓存数据。'}
          </p>
        </KdyAlert>
      ) : null}

      {/* ---- empty ---- */}
      {query.isSuccess && query.data.isEmpty ? (
        <KdyEmpty
          title="这个筛选下还没有动物活动数据"
          description={query.data.emptyHint}
          action={
            <div className="flex flex-wrap gap-2">
              <KdyButton size="sm" variant="secondary" onClick={() => setFilters(defaultMapFilters())}>
                切回全部物种
              </KdyButton>
              <KdyButton size="sm" href="/wildlife/report">
                上报一条观测
              </KdyButton>
            </div>
          }
        />
      ) : null}

      {/* ---- ready ---- */}
      {query.data ? (
        <>
          <WildlifeBasemapMap
            basemap={query.data.basemap}
            zones={query.data.overlays.zones}
            spots={query.data.overlays.spots}
            tracks={query.data.overlays.tracks}
            markers={query.data.overlays.markers}
            zoneNames={zoneNames}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <WildlifeMapLegend
              zones={query.data.counts.zones}
              spots={query.data.counts.spots}
              tracks={query.data.counts.tracks}
              markers={query.data.counts.markers}
            />
            <p className="text-xs text-muted">
              底图 {query.data.basemap.widthPx}×{query.data.basemap.heightPx} px ·{' '}
              {query.data.basemap.calibrationLabel}
            </p>
          </div>

          <p className="text-xs text-muted" data-testid="wildlife-basemap-attribution">
            底图来源：{query.data.basemap.attribution} · 许可：{query.data.basemap.licenseLabel}
          </p>

          {query.data.counts.markersHiddenByPrivacy > 0 ? (
            <p className="text-xs text-muted" data-testid="wildlife-hidden-markers">
              另有 {query.data.counts.markersHiddenByPrivacy} 条观测因位于敏感区或上报人数不足，
              <strong className="font-medium">没有</strong>出现在地图上，只在下方列表里显示所属区域。
            </p>
          ) : null}

          {query.data.notices.nesting ? (
            <KdyAlert tone="warning" title="繁殖期：位置模糊半径已加强">
              <p>{query.data.notices.nesting}</p>
            </KdyAlert>
          ) : null}

          {/* ---- 区域 ---- */}
          <section className="flex flex-col gap-3" aria-labelledby="wildlife-zones-heading">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="wildlife-zones-heading" className="mr-auto text-sm font-semibold text-body">
                活动区域（{query.data.zoneVMs.length}）
              </h2>
              <KdyButton size="sm" variant="secondary" href="/wildlife/zones">
                查看全部区域
              </KdyButton>
            </div>
            {query.data.zoneVMs.length === 0 ? (
              <KdyEmpty
                title="还没有人工定义的区域"
                description="区域由管理端录入（投喂政策、告示位、敏感区标记都在那里维护）。"
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {query.data.zoneVMs.map((zone) => (
                  <KdyCard key={zone.id} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-body">{zone.name}</h3>
                      {zone.isSensitive ? <KdyBadge tone="warning">敏感区 · 不公开坐标</KdyBadge> : null}
                      <FeedingPolicyBadge policy={zone.feedingPolicy} className="ml-auto" />
                    </div>
                    <p className="text-xs text-muted">
                      {zone.speciesLabelText} · {zone.radiusLabel} · {zone.fuzzLabel}
                    </p>
                    {zone.forbiddenWarning ? (
                      <p className="text-xs text-danger" role="status">
                        {zone.forbiddenWarning}
                      </p>
                    ) : null}
                    {zone.noticeText ? (
                      <p className="text-xs text-body">{zone.noticeText}</p>
                    ) : null}
                    {zone.noticeDraftFlag ? (
                      <p className="text-xs text-muted">{zone.noticeDraftFlag}</p>
                    ) : null}
                  </KdyCard>
                ))}
              </div>
            )}
          </section>

          {/* ---- 热点 ---- */}
          <section className="flex flex-col gap-3" aria-labelledby="wildlife-spots-heading">
            <h2 id="wildlife-spots-heading" className="text-sm font-semibold text-body">
              聚合热点（{query.data.spotVMs.length}）
            </h2>
            {query.data.spotVMs.length === 0 ? (
              <KdyEmpty title="还没有达到公开条件的热点" description={query.data.emptyHint} />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {query.data.spotVMs.map((spot) => (
                    <KdyCard key={spot.id} tone="alt" className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-body">{spot.speciesLabel}</span>
                        <KdyBadge tone="info" title={spot.realtimeNotice}>
                          历史聚合 · 延迟 ≥24h
                        </KdyBadge>
                        {spot.kAnonymous ? (
                          <KdyBadge tone="success">满足 k-匿名</KdyBadge>
                        ) : (
                          <KdyBadge tone="warning">人数不足，不公开</KdyBadge>
                        )}
                      </div>
                      <p className="text-xs text-muted">
                        {spot.zoneName ? `${spot.zoneName} · ` : ''}
                        {spot.radiusLabel} · {spot.confidenceLabel}
                      </p>
                      <p className="text-xs text-muted">{spot.reporterNotice}</p>
                      <p className="text-xs text-muted">
                        {spot.peakLabel} · {spot.computedLabel}
                      </p>
                    </KdyCard>
                  ))}
                </div>
                <p className="text-xs text-muted">{query.data.notices.spotRealtime}</p>
              </>
            )}
          </section>

          {/* ---- 推断轨迹 ---- */}
          <section className="flex flex-col gap-3" aria-labelledby="wildlife-tracks-heading">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="wildlife-tracks-heading" className="mr-auto text-sm font-semibold text-body">
                推断轨迹（{query.data.trackVMs.length}）
              </h2>
              <KdyButton size="sm" variant="secondary" href="/wildlife/tracks">
                轨迹页（含完整说明）
              </KdyButton>
            </div>
            {query.data.trackVMs.length === 0 ? (
              <KdyEmpty
                title="还没有可推断的轨迹"
                description="轨迹要求同一物种在 7 天窗口内至少有 5 个已发布观测。"
              />
            ) : (
              <div className="flex flex-col gap-3">
                {query.data.trackVMs.map((track) => (
                  <KdyCard key={track.id} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-body">
                        {track.individualName ? `${track.individualName}（${track.speciesLabel}）` : track.speciesLabel}
                      </span>
                      {/* ⚠️ 硬要求：轨迹必须显著标注"推断，非实测路径" */}
                      <KdyBadge tone="warning" title={track.disclaimer}>
                        {track.inferredLabel}
                      </KdyBadge>
                    </div>
                    <p className="text-xs text-muted">
                      {track.summaryLabel} · {track.spanLabel} · {track.distanceLabel} · {track.confidenceLabel}
                    </p>
                    <p className="text-xs text-muted">{track.methodLabel}</p>
                    <p className="text-xs text-body">{track.disclaimer}</p>
                    {!track.distanceConsistent ? (
                      <p className="text-xs text-warning">
                        折线长度与上报的 totalDistanceM 差异超过 20%，数据可能有问题（已如实显示，不静默修正）。
                      </p>
                    ) : null}
                  </KdyCard>
                ))}
              </div>
            )}
          </section>

          {/* ---- 最近观测 ---- */}
          <section className="flex flex-col gap-3" aria-labelledby="wildlife-recent-heading">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="wildlife-recent-heading" className="mr-auto text-sm font-semibold text-body">
                最近观测（{query.data.sightingVMs.length}）
              </h2>
              <KdyButton size="sm" href="/wildlife/report">
                上报观测
              </KdyButton>
            </div>
            {query.data.sightingVMs.length === 0 ? (
              <KdyEmpty
                title="还没有审核通过的观测"
                description={query.data.emptyHint}
                action={
                  <KdyButton size="sm" href="/wildlife/report">
                    上报一条观测
                  </KdyButton>
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {query.data.sightingVMs.map((item) => (
                  <SightingCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>

          {/* ---- 隐私与合规（硬要求，必须出现在地图页） ---- */}
          <PrivacyNoticePanel basemapNotice={query.data.notices.basemap} />
        </>
      ) : null}
    </div>
  );
}
