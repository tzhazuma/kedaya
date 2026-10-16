'use client';

/**
 * 动物地图（**方案 B：静态校园平面图 + SVG 叠加层**）。
 *
 * 为什么不用高德/腾讯瓦片（规格 §1.2）：
 * - 校园尺度（~1 km²）下街道图会渲染出与校园无关的道路与建筑轮廓，**信息密度反而更低**；
 * - 动物活动点大多在草坪、湖边、宿舍楼下、小径旁 —— 这些在街道图上**根本不存在**；
 * - 静态底图用图像像素空间，WGS84 经仿射标定到像素，**完全不经过 GCJ-02**，
 *   于是"坐标偏移几百米"这类极难排查的 bug 在本模块的作用面被压到零。
 *
 * 渲染结构：一张底图 `<img>` + 一个同坐标系（viewBox = 底图像素）的 `<svg>` 叠加层。
 * 所有颜色都用 `currentColor` + 令牌工具类（`text-danger` / `text-brand-strong` …），
 * **零手写色值**。
 */
import { useCallback, useRef } from 'react';

import {
  toSvgPolylinePoints,
  type SightingMarkerOverlay,
  type SpotOverlay,
  type TrackOverlay,
  type ZoneOverlay,
} from '@/domain/models/wildlife/geometry';
import { pixelToWgs84 } from '@/domain/models/wildlife/basemap';
import { FEEDING_POLICY_TONES, type FeedingPolicy } from '@/domain/models/wildlife/species';
import type { BasemapVM } from '@/application/wildlife/wildlifeMap';

import { cn } from '../../theme/cn';

/** 投喂政策 → 令牌工具类（`text-*` 供 `currentColor` 使用） */
const POLICY_STROKE: Record<FeedingPolicy, string> = {
  allowed: 'text-success',
  discouraged: 'text-warning',
  forbidden: 'text-danger',
};

export interface PickedPoint {
  lat: number;
  lng: number;
  px: number;
  py: number;
}

export interface WildlifeBasemapMapProps {
  basemap: BasemapVM;
  zones: readonly ZoneOverlay[];
  spots: readonly SpotOverlay[];
  tracks: readonly TrackOverlay[];
  markers: readonly SightingMarkerOverlay[];
  /** 区域 id → 名称（用于 `<title>` 提示与图例） */
  zoneNames?: ReadonlyMap<string, string>;
  /** 是否处于"地图点选"模式（上报表单） */
  picking?: boolean;
  picked?: PickedPoint | null;
  onPick?: (point: PickedPoint) => void;
  /** 高亮的轨迹 id */
  highlightedTrackId?: string | null;
  className?: string;
}

export function WildlifeBasemapMap({
  basemap,
  zones,
  spots,
  tracks,
  markers,
  zoneNames,
  picking = false,
  picked = null,
  onPick,
  highlightedTrackId = null,
  className,
}: WildlifeBasemapMapProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const handleClick = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (!picking || !onPick) return;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const px = ((event.clientX - rect.left) / rect.width) * basemap.widthPx;
      const py = ((event.clientY - rect.top) / rect.height) * basemap.heightPx;
      // 用**当前底图配置的 affine** 换算（不是模块级单例），因此换底图不用改组件
      const { lat, lng } = pixelToWgs84({ px, py }, basemap.affine);
      onPick({ px, py, lat, lng });
    },
    [basemap, onPick, picking],
  );

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-lg border border-border bg-surface',
        className,
      )}
      data-testid="wildlife-map"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 静态 SVG 底图，不需要 next/image 优化器 */}
      <img
        src={basemap.imageUrl}
        alt={`校园示意底图（${basemap.isPlaceholder ? '占位自绘' : basemap.licenseLabel}）`}
        className="absolute inset-0 size-full object-fill select-none"
        style={{ aspectRatio: `${basemap.widthPx} / ${basemap.heightPx}` }}
        draggable={false}
      />

      <svg
        ref={svgRef}
        viewBox={`0 0 ${basemap.widthPx} ${basemap.heightPx}`}
        className={cn('relative block size-full', picking && 'cursor-crosshair')}
        style={{ aspectRatio: `${basemap.widthPx} / ${basemap.heightPx}` }}
        role={picking ? 'application' : 'img'}
        aria-label={
          picking
            ? '校园示意底图：点击选择发现地点'
            : '校园示意底图：叠加了动物活动区域、聚合热点与推断轨迹'
        }
        onClick={handleClick}
        data-testid="wildlife-map-svg"
      >
        {/* ---- 活动区域（人工定义的管理边界） ---- */}
        {zones.map((zone) => (
          <g
            key={zone.id}
            className={POLICY_STROKE[zone.feedingPolicy]}
            data-overlay="zone"
            data-zone-id={zone.id}
          >
            <circle
              cx={zone.center.px}
              cy={zone.center.py}
              r={zone.radiusPx}
              fill="currentColor"
              fillOpacity={zone.isSensitive ? 0.06 : 0.1}
              stroke="currentColor"
              strokeOpacity={0.7}
              strokeWidth={2}
              strokeDasharray={zone.isSensitive ? '10 6' : undefined}
            />
            <title>
              {`${zoneNames?.get(zone.id) ?? zone.id}｜投喂政策：${zone.feedingPolicy}｜半径 ${zone.radiusM} m${zone.isSensitive ? '｜敏感区：不公开坐标' : ''}`}
            </title>
          </g>
        ))}

        {/* ---- 聚合热点（历史聚合，延迟 ≥24h） ---- */}
        {spots.map((spot) => (
          <g key={spot.id} className="text-info" data-overlay="spot" data-spot-id={spot.id}>
            <circle
              cx={spot.center.px}
              cy={spot.center.py}
              r={spot.radiusPx}
              fill="currentColor"
              fillOpacity={0.16}
              stroke="currentColor"
              strokeOpacity={0.5}
              strokeWidth={1.5}
            />
            <circle cx={spot.center.px} cy={spot.center.py} r={4} fill="currentColor" />
            <title>
              {`热点：${spot.speciesNameZh}｜${spot.sightingCount} 次上报 / ${spot.distinctReporters} 位同学｜可信度 ${Math.round(spot.confidence * 100)}%｜历史聚合，非实时位置`}
            </title>
          </g>
        ))}

        {/* ---- 推断轨迹（**虚线**，且 UI 另有显著标注） ---- */}
        {tracks.map((track) =>
          track.points.length >= 2 ? (
            <g key={track.id} data-overlay="track" data-track-id={track.id}>
              <polyline
                points={toSvgPolylinePoints(track.points)}
                fill="none"
                stroke="currentColor"
                strokeWidth={highlightedTrackId === track.id ? 5 : 3}
                strokeDasharray="10 7"
                strokeLinecap="round"
                className={highlightedTrackId === track.id ? 'text-brand-strong' : 'text-brand'}
              />
              <title>{`推断轨迹（非实测路径）：${track.speciesNameZh}｜${track.disclaimer}`}</title>
            </g>
          ) : null,
        )}

        {/* ---- 观测点（坐标被扣留的记录不会出现在这里） ---- */}
        {markers.map((marker) => (
          <g key={marker.id} data-overlay="marker" data-marker-id={marker.id}>
            <circle
              cx={marker.at.px}
              cy={marker.at.py}
              r={6}
              fill="currentColor"
              fillOpacity={0.9}
              stroke="currentColor"
              strokeWidth={2}
              className={marker.healthConcern ? 'text-danger' : 'text-ink-soft'}
            />
            <title>
              {`${marker.speciesNameZh}${marker.healthConcern ? '（疑似受伤）' : ''}｜位置已模糊化`}
            </title>
          </g>
        ))}

        {/* ---- 点选标记 ---- */}
        {picked ? (
          <g className="text-danger" data-testid="wildlife-picked-point">
            <circle
              cx={picked.px}
              cy={picked.py}
              r={12}
              fill="currentColor"
              fillOpacity={0.25}
              stroke="currentColor"
              strokeWidth={3}
            />
            <line
              x1={picked.px - 18}
              y1={picked.py}
              x2={picked.px + 18}
              y2={picked.py}
              stroke="currentColor"
              strokeWidth={2}
            />
            <line
              x1={picked.px}
              y1={picked.py - 18}
              x2={picked.px}
              y2={picked.py + 18}
              stroke="currentColor"
              strokeWidth={2}
            />
          </g>
        ) : null}
      </svg>
    </div>
  );
}

/** 图例（颜色语义与叠加层一致；颜色来自令牌工具类） */
export function WildlifeMapLegend({
  zones,
  spots,
  tracks,
  markers,
}: {
  zones: number;
  spots: number;
  tracks: number;
  markers: number;
}) {
  const items = [
    { key: 'zone', className: 'text-warning', label: `活动区域 ${zones}`, shape: 'circle' as const },
    { key: 'spot', className: 'text-info', label: `聚合热点 ${spots}`, shape: 'circle' as const },
    { key: 'track', className: 'text-brand-strong', label: `推断轨迹 ${tracks}`, shape: 'line' as const },
    { key: 'marker', className: 'text-ink-soft', label: `观测点 ${markers}`, shape: 'dot' as const },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-3 text-xs text-muted" data-testid="wildlife-map-legend">
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5">
          <span className={cn('inline-flex size-4 items-center justify-center', item.className)} aria-hidden>
            {item.shape === 'line' ? (
              <svg viewBox="0 0 16 16" className="size-4">
                <line x1="1" y1="12" x2="15" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" className="size-4">
                <circle
                  cx="8"
                  cy="8"
                  r={item.shape === 'dot' ? 4 : 6}
                  fill="currentColor"
                  fillOpacity={item.shape === 'dot' ? 0.9 : 0.2}
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            )}
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** 投喂政策徽章的色调（导出给其它组件复用，避免两处各写一套映射） */
export function policyToneClass(policy: FeedingPolicy): string {
  const tone = FEEDING_POLICY_TONES[policy];
  switch (tone) {
    case 'success':
      return 'text-success';
    case 'warning':
      return 'text-warning';
    case 'danger':
      return 'text-danger';
    default:
      return 'text-muted';
  }
}
