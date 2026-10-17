'use client';

/**
 * 校园地图 · 页面主体（`/wildlife/map`）
 * =====================================================================
 *
 * 与 `/wildlife` 的区别：
 *   · `/wildlife` 用**手绘占位底图**（`public/wildlife/basemap.svg`），底图授权状态未知；
 *   · 本页用 **OpenStreetMap 数据渲染的离线底图**（`public/map/campus-basemap*.svg`），
 *     坐标来自 OSM，许可为 ODbL 1.0，**必须**显示 "© OpenStreetMap contributors"。
 *
 * 三态齐全（loading / error / empty），并把三类"必须说清楚"的信息放在地图旁边：
 *   1. 数据来源 + 许可 + 精度 + 哪些是推测的（`CAMPUS_POI_META` / `CAMPUS_ACCURACY_NOTES`）；
 *   2. 隐私（位置已模糊化、敏感区不落点、热点非实时）—— 复用 `PrivacyNoticePanel`；
 *   3. mock 演示数据与真实底图的坐标偏差（**不掩盖**，见下方 drift 提示）。
 *
 * 颜色只走设计令牌（`text-*` / `bg-*` / `border-*`），**零手写色值**。
 */
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Layers, MapPin, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  ALL_SPECIES,
  defaultMapFilters,
  loadWildlifeMap,
  type BasemapVM,
  type WildlifeMapFilters,
} from '@/application/wildlife/wildlifeMap';
import { getMockWildlifeRepository, getRepositories } from '@/data/repositories';

import { queryKeys } from '@/presentation/query/keys';
import { errorMessage, unwrapOrThrow } from '@/presentation/query/unwrap';
import { useTheme } from '@/presentation/theme';
import { cn } from '@/presentation/theme/cn';
import { KdyAlert } from '@/presentation/components/KdyAlert';
import { KdyBadge } from '@/presentation/components/KdyBadge';
import { KdyButton } from '@/presentation/components/KdyButton';
import { KdyCard } from '@/presentation/components/KdyCard';
import { KdyEmpty } from '@/presentation/components/KdyEmpty';
import { KdySkeleton } from '@/presentation/components/KdySkeleton';
import { PrivacyNoticePanel } from '@/presentation/components/wildlife/PrivacyNoticePanel';
import { SpeciesFilterBar } from '@/presentation/components/wildlife/SpeciesFilterBar';
import {
  WildlifeBasemapMap,
  WildlifeMapLegend,
} from '@/presentation/components/wildlife/WildlifeBasemapMap';

import { CAMPUS_BASEMAP, campusPixelsPerMeter, campusWgs84ToPixel } from './campusBasemap';
import {
  CAMPUS_MAP_LOCATIONS,
  CAMPUS_LOCATION_CONFIDENCE_LABEL,
  campusLocationConfidenceCounts,
  type CampusLocationConfidence,
} from './campusLocations';
import { rebaseMarkers, rebaseSpots, rebaseTracks, rebaseZones } from './campusOverlays';
import { CAMPUS_ACCURACY_NOTES, CAMPUS_POI_META } from './campusPoiMeta';

const LAYER_TOGGLES: ReadonlyArray<{
  key: keyof Pick<WildlifeMapFilters, 'showZones' | 'showSpots' | 'showTracks' | 'showMarkers'>;
  label: string;
  hint: string;
}> = [
  { key: 'showZones', label: '活动区域', hint: '人工定义的管理边界（投喂政策、告示位）' },
  { key: 'showSpots', label: '聚合热点', hint: '历史聚合（延迟 ≥24h），不是实时位置' },
  { key: 'showTracks', label: '推断轨迹', hint: '由上报推断的活动走廊，非实测路径' },
  { key: 'showMarkers', label: '观测点', hint: '已发布观测的模糊化坐标（敏感区不落点）' },
];

const CONFIDENCE_TONE: Record<CampusLocationConfidence, 'success' | 'warning' | 'danger'> = {
  high: 'success',
  medium: 'warning',
  low: 'danger',
};

const CONFIDENCE_DOT: Record<CampusLocationConfidence, string> = {
  high: 'bg-success',
  medium: 'bg-warning',
  low: 'bg-danger',
};

/** 页面上的底图配置（唯一真相仍在 `campusBasemap.ts`，这里只是转成组件需要的 VM 形状） */
function toBasemapVM(imageUrl: string): BasemapVM {
  return {
    imageUrl,
    widthPx: CAMPUS_BASEMAP.widthPx,
    heightPx: CAMPUS_BASEMAP.heightPx,
    version: CAMPUS_BASEMAP.version,
    affine: CAMPUS_BASEMAP.affine,
    attribution: CAMPUS_BASEMAP.attribution,
    license: CAMPUS_BASEMAP.license,
    licenseLabel: CAMPUS_BASEMAP.licenseLabel,
    calibrationLabel: `OSM 底图 ${CAMPUS_BASEMAP.widthPx}×${CAMPUS_BASEMAP.heightPx} px · 1 m ≈ ${campusPixelsPerMeter().toFixed(3)} px · ${CAMPUS_MAP_LOCATIONS.length} 个地点标注`,
    calibrationOk: true,
    calibrationProblems: [],
    // 不是占位自绘：底图数据来源明确（OSM, ODbL）。**不表示**学校已授权官方平面图。
    isPlaceholder: false,
    placeholderNotice: '',
  };
}

export function CampusMapView() {
  const repository = getRepositories().wildlife;
  const mockRepository = getMockWildlifeRepository();
  const { resolved } = useTheme();
  const [filters, setFilters] = useState<WildlifeMapFilters>(defaultMapFilters);
  const [forcingError, setForcingError] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.wildlife.map(filters),
    queryFn: async () => unwrapOrThrow(await loadWildlifeMap(repository, filters, new Date())),
    // 切图层时保留上一次数据，避免整页闪成骨架
    placeholderData: (previous) => previous,
  });

  const basemap = useMemo(
    () => toBasemapVM(resolved === 'dark' ? CAMPUS_BASEMAP.imageDark : CAMPUS_BASEMAP.imageLight),
    [resolved],
  );

  const overlays = useMemo(() => {
    if (!query.data) return null;
    const from = query.data.basemap.affine;
    return {
      zones: rebaseZones(query.data.overlays.zones, from),
      spots: rebaseSpots(query.data.overlays.spots, from),
      tracks: rebaseTracks(query.data.overlays.tracks, from),
      markers: rebaseMarkers(query.data.overlays.markers, from),
    };
  }, [query.data]);

  const zoneNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const zone of query.data?.zoneVMs ?? []) map.set(zone.id, zone.name);
    return map;
  }, [query.data]);

  const confidenceCounts = useMemo(() => campusLocationConfidenceCounts(), []);

  const update = (patch: Partial<WildlifeMapFilters>): void =>
    setFilters((current) => ({ ...current, ...patch }));

  return (
    <div className="flex flex-col gap-4" data-testid="campus-map-view">
      {/* ---- 工具栏 ---- */}
      <KdyCard className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto flex items-center gap-2 text-sm font-semibold text-body">
            <Layers className="size-4 text-muted" aria-hidden />
            图层与筛选
          </h2>
          <KdyBadge tone="info" title="底图数据来源">
            {CAMPUS_POI_META.source} · {CAMPUS_POI_META.license}
          </KdyBadge>
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
            <label
              key={toggle.key}
              className="inline-flex items-center gap-2 text-xs text-body"
              title={toggle.hint}
            >
              <input
                type="checkbox"
                checked={filters[toggle.key]}
                onChange={(event) => update({ [toggle.key]: event.target.checked })}
              />
              {toggle.label}
            </label>
          ))}
          <span className="ml-auto text-xs text-muted">
            底图 {CAMPUS_BASEMAP.widthPx}×{CAMPUS_BASEMAP.heightPx} px · OSM 快照{' '}
            {CAMPUS_POI_META.osmBaseTimestamp}
          </span>
        </div>
      </KdyCard>

      {/* ---- loading ---- */}
      {query.isPending ? (
        <div
          aria-busy
          aria-live="polite"
          className="flex flex-col gap-3"
          data-testid="campus-map-loading"
        >
          <KdySkeleton className="h-96 w-full" />
          <KdySkeleton lines={3} />
        </div>
      ) : null}

      {/* ---- error ---- */}
      {query.isError ? (
        <KdyAlert
          tone="danger"
          title="校园地图加载失败"
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
            契约 §8 要求失败静默降级而非白屏：
            {query.data ? '下方保留上一次成功的地图数据。' : '当前没有可用的缓存数据。'}
          </p>
        </KdyAlert>
      ) : null}

      {/* ---- empty ---- */}
      {query.isSuccess && query.data.isEmpty ? (
        <KdyEmpty
          title="这个筛选下还没有动物活动数据"
          description="底图仍然可用（它来自 OSM，不依赖观测数据）。切回「全部物种」，或者去上报一条观测 —— 审核通过后就会出现在地图上。"
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

      {/* ---- ready / 有缓存时继续渲染 ---- */}
      {query.data && overlays ? (
        <>
          <WildlifeBasemapMap
            basemap={basemap}
            zones={overlays.zones}
            spots={overlays.spots}
            tracks={overlays.tracks}
            markers={overlays.markers}
            zoneNames={zoneNames}
            className="[&_img]:bg-surface"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <WildlifeMapLegend
              zones={query.data.counts.zones}
              spots={query.data.counts.spots}
              tracks={query.data.counts.tracks}
              markers={query.data.counts.markers}
            />
            <p className="text-xs text-muted">{basemap.calibrationLabel}</p>
          </div>

          <p className="text-xs text-muted" data-testid="campus-map-attribution">
            底图与 POI 数据：{CAMPUS_POI_META.attribution} · 许可：{CAMPUS_POI_META.license} ·
            衍生数据库同许可 · 地图渲染不经过 GCJ-02（WGS84 直接投影）
          </p>

          {query.data.counts.markersHiddenByPrivacy > 0 ? (
            <p className="text-xs text-muted" data-testid="campus-map-hidden-markers">
              另有 {query.data.counts.markersHiddenByPrivacy} 条观测因位于敏感区或上报人数不足，
              <strong className="font-medium">没有</strong>出现在地图上，只在列表里显示所属区域。
            </p>
          ) : null}

          {mockRepository ? (
            <KdyAlert tone="warning" title="mock 演示数据的坐标与真实底图不一致（已知问题）">
              <p>
                mock fixture 的活动区域与观测坐标是按旧的手绘占位底图编写的，不是按真实校园地理采集的。
                投到 OSM 底图后，4 个有对应地点的区域锚点与真实地点相差约 80–693 m（例如「图书馆后草坪」落在信息学院附近、
                「一食堂周边」落在创意与艺术学院附近；只有「人工湖」与真实湖心相差约 83 m）。这不是渲染错误，
                也不应靠客户端“挪点”掩盖：上线前必须在服务端/数据层按{' '}
                <code className="text-body">wildlife-map.md §3.4</code> 重新采集控制点并重锚定 fixture。
              </p>
            </KdyAlert>
          ) : null}

          {query.data.notices.nesting ? (
            <KdyAlert tone="warning" title="繁殖期：位置模糊半径已加强">
              <p>{query.data.notices.nesting}</p>
            </KdyAlert>
          ) : null}

          {/* ---- 数据来源 / 许可 / 精度 ---- */}
          <section aria-labelledby="campus-map-source-heading" className="flex flex-col gap-3">
            <h2 id="campus-map-source-heading" className="text-sm font-semibold text-body">
              底图与数据来源
            </h2>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <KdyCard tone="alt" className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-body">OpenStreetMap（ODbL 1.0）</h3>
                  <KdyBadge tone="success">可离线</KdyBadge>
                  <KdyBadge tone="neutral">WGS84</KdyBadge>
                </div>
                <p className="text-xs text-muted">
                  校园边界：OSM relation 5390610，面积约 {(CAMPUS_POI_META.campusAreaM2 / 10000).toFixed(1)} 万 m²。
                  POI 要素 {CAMPUS_POI_META.featureCount} 个：建筑 {CAMPUS_POI_META.featureCounts.building}、水域{' '}
                  {CAMPUS_POI_META.featureCounts.water}、康体 {CAMPUS_POI_META.featureCounts.leisure}、绿地{' '}
                  {CAMPUS_POI_META.featureCounts.landuse}、设施 {CAMPUS_POI_META.featureCounts.amenity}、校门{' '}
                  {CAMPUS_POI_META.featureCounts.gate}、轨道 {CAMPUS_POI_META.featureCounts.transit}；
                  另有 {CAMPUS_MAP_LOCATIONS.length} 个地点标注。
                </p>
                <p className="text-xs text-muted">
                  OSM 数据快照 {CAMPUS_POI_META.osmBaseTimestamp} · 本次抓取 {CAMPUS_POI_META.fetchedAt} ·
                  查询端点 Overpass API。
                </p>
                <p className="text-xs text-body">{CAMPUS_POI_META.licenseNotice}</p>
                <div className="flex flex-wrap gap-3 text-xs">
                  <a
                    className="inline-flex items-center gap-1 text-info underline underline-offset-2"
                    href={CAMPUS_POI_META.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    OSM relation 5390610
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                  <a
                    className="inline-flex items-center gap-1 text-info underline underline-offset-2"
                    href={CAMPUS_POI_META.files.geojson}
                    download
                  >
                    下载 GeoJSON
                  </a>
                  <a
                    className="inline-flex items-center gap-1 text-info underline underline-offset-2"
                    href={CAMPUS_POI_META.files.poi}
                    download
                  >
                    下载 campus-poi.json
                  </a>
                </div>
              </KdyCard>

              <KdyCard tone="alt" className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-body">精度与“哪些是推测的”</h3>
                <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted">
                  {CAMPUS_ACCURACY_NOTES.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                  <li>
                    学校官网校园地图版权未确认：本任务没有抓取、也没有复制学校地图；因此
                    “逐点与官方图比对”这一步未完成，不能声称已核对。
                  </li>
                </ul>
              </KdyCard>
            </div>
          </section>

          {/* ---- 25 个地点 ---- */}
          <section aria-labelledby="campus-locations-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="campus-locations-heading" className="mr-auto text-sm font-semibold text-body">
                25 个校园地点与定位依据
              </h2>
              {(['high', 'medium', 'low'] as const).map((confidence) => (
                <span key={confidence} className="inline-flex items-center gap-1 text-xs text-muted">
                  <span
                    className={cn('inline-block size-2 rounded-pill', CONFIDENCE_DOT[confidence])}
                    aria-hidden
                  />
                  {CAMPUS_LOCATION_CONFIDENCE_LABEL[confidence]} {confidenceCounts[confidence]}
                </span>
              ))}
            </div>
            <details className="rounded-lg border border-border bg-surface p-4 text-sm">
              <summary className="cursor-pointer text-xs font-medium text-body">
                展开 25 个地点（坐标来自 OSM，逐项标注依据）
              </summary>
              <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                {CAMPUS_MAP_LOCATIONS.map((location) => (
                  <li
                    key={location.key}
                    className="flex flex-col gap-1 rounded-md border border-border bg-surface-alt px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <MapPin className="size-3.5 text-muted" aria-hidden />
                      <span className="text-xs font-semibold text-body">{location.label}</span>
                      <KdyBadge tone={CONFIDENCE_TONE[location.confidence]}>
                        {CAMPUS_LOCATION_CONFIDENCE_LABEL[location.confidence]}
                      </KdyBadge>
                      <span className="ml-auto font-mono text-[11px] text-muted">
                        {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted">{location.evidence}</p>
                    <p className="text-[11px] text-muted">
                      图上位置：x {campusWgs84ToPixel(location).px.toFixed(0)} / y{' '}
                      {campusWgs84ToPixel(location).py.toFixed(0)} px
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          </section>

          {/* ---- 隐私 ---- */}
          <section aria-labelledby="campus-map-privacy-heading" className="flex flex-col gap-3">
            <h2 id="campus-map-privacy-heading" className="text-sm font-semibold text-body">
              位置隐私（契约 §11.14 / 规格 §9）
            </h2>
            <PrivacyNoticePanel />
          </section>
        </>
      ) : null}
    </div>
  );
}
