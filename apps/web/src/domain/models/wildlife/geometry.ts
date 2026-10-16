/**
 * wildlife · 叠加层几何（纯函数）—— WGS84/米 → **底图像素**
 *
 * 方案 B 的渲染链路：底图是一张静态图（`/wildlife/basemap.svg`），
 * 所有动态内容都是**同一个 SVG 坐标系里的图元**：
 * 区域 = 圆、热点 = 圆、观测点 = 点、轨迹 = 折线。
 *
 * 这里只做纯几何换算，不 import 任何 UI 库 —— 于是"点画在哪儿"可以被真实单测覆盖
 * （不需要 jsdom）。像素 ↔ 经纬度的换算全部委托给 `basemap.ts`。
 */
import type { LatLng } from '@kedaya/shared';

import {
  pixelsPerMeter,
  wgs84ToPixel,
  WILDLIFE_BASEMAP,
  type AffineMatrix,
  type CampusBasemap,
  type PixelPoint,
} from './basemap';
import type { FeedingPolicy, WildlifeZone } from './species';
import type { SightingStatus, WildlifeSighting } from './sightings';
import type { WildlifeSpot, WildlifeTrack } from './tracks';

export interface ZoneOverlay {
  id: string;
  name: string;
  center: PixelPoint;
  /** 半径（像素）—— 由米换算，保证与底图比例一致 */
  radiusPx: number;
  radiusM: number;
  feedingPolicy: FeedingPolicy;
  /** 敏感区：地图上只画区域边界，不画中心点（规格 §9.3 ①） */
  isSensitive: boolean;
  noticeSummary: string | null;
  speciesIds: string[];
}

export interface SpotOverlay {
  id: string;
  center: PixelPoint;
  radiusPx: number;
  radiusM: number;
  speciesId: string;
  speciesNameZh: string;
  confidence: number;
  sightingCount: number;
  distinctReporters: number;
  /** 是否满足 k-匿名（≥3 位不同上报人） */
  kAnonymous: boolean;
  /** 恒为 true：历史聚合，非实时（规格 §8.1 E10） */
  aggregated: true;
}

export interface TrackOverlay {
  id: string;
  /** 折线的像素点串（≥2 个才有意义） */
  points: PixelPoint[];
  speciesNameZh: string;
  /** 恒为 true（规格 §2.4） */
  isInferred: true;
  disclaimer: string;
  sightingCount: number;
}

export interface SightingMarkerOverlay {
  id: string;
  at: PixelPoint;
  speciesId: string;
  speciesNameZh: string;
  status: SightingStatus;
  healthConcern: boolean;
}

/** 局部米制半径 → 像素半径 */
export function radiusMetersToPixels(
  radiusM: number,
  affine: AffineMatrix = WILDLIFE_BASEMAP.affine,
): number {
  return Math.max(0, radiusM) * pixelsPerMeter(affine);
}

export function zoneToOverlay(
  zone: WildlifeZone,
  affine: AffineMatrix = WILDLIFE_BASEMAP.affine,
): ZoneOverlay {
  return {
    id: zone.id,
    name: zone.name,
    center: wgs84ToPixel({ lat: zone.geo.lat, lng: zone.geo.lng }, affine),
    radiusPx: radiusMetersToPixels(zone.geo.radiusM, affine),
    radiusM: zone.geo.radiusM,
    feedingPolicy: zone.feedingPolicy,
    isSensitive: zone.isSensitive,
    noticeSummary: zone.noticeText?.trim() ? zone.noticeText.trim().slice(0, 40) : null,
    speciesIds: [...zone.speciesIds],
  };
}

export function spotToOverlay(
  spot: WildlifeSpot,
  affine: AffineMatrix = WILDLIFE_BASEMAP.affine,
): SpotOverlay {
  return {
    id: spot.id,
    center: wgs84ToPixel(spot.centroid, affine),
    radiusPx: radiusMetersToPixels(spot.radiusM, affine),
    radiusM: spot.radiusM,
    speciesId: spot.speciesId,
    speciesNameZh: spot.speciesNameZh,
    confidence: spot.confidence,
    sightingCount: spot.sightingCount,
    distinctReporters: spot.distinctReporters,
    kAnonymous: spot.distinctReporters >= 3,
    aggregated: true,
  };
}

export function trackToOverlay(
  track: WildlifeTrack,
  affine: AffineMatrix = WILDLIFE_BASEMAP.affine,
): TrackOverlay {
  const points = track.path.coordinates
    .filter((pair) => pair.length >= 2)
    .map((pair) => ({ lat: pair[1] as number, lng: pair[0] as number }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    .map((point) => wgs84ToPixel(point, affine));

  return {
    id: track.id,
    points,
    speciesNameZh: track.speciesNameZh,
    isInferred: true,
    disclaimer: track.disclaimer,
    sightingCount: track.sightingCount,
  };
}

/**
 * 观测点 → 地图标记。
 *
 * **坐标被扣留的记录（敏感区 / k-匿名不足）返回 `null`** ——
 * 它们不会出现在地图上，只出现在列表里（带"位置已扣留"说明）。
 * 这条规则把"敏感区不落点"从一句承诺变成**类型上的不可能**。
 */
export function sightingToMarker(
  sighting: Pick<WildlifeSighting, 'id' | 'geo' | 'species' | 'speciesNameZh' | 'status' | 'healthConcern'>,
  affine: AffineMatrix = WILDLIFE_BASEMAP.affine,
): SightingMarkerOverlay | null {
  if (sighting.geo === null) return null;
  return {
    id: sighting.id,
    at: wgs84ToPixel(sighting.geo, affine),
    speciesId: sighting.species,
    speciesNameZh: sighting.speciesNameZh,
    status: sighting.status,
    healthConcern: sighting.healthConcern,
  };
}

/** SVG 折线的 `points` 属性值（"x,y x,y …"） */
export function toSvgPolylinePoints(points: readonly PixelPoint[]): string {
  return points.map((point) => `${round(point.px)},${round(point.py)}`).join(' ');
}

/** 底图上的像素 → 百分比定位（用于把 <img> 与叠加层对齐的绝对定位） */
export function toPercentPosition(
  pixel: PixelPoint,
  basemap: CampusBasemap = WILDLIFE_BASEMAP,
): { left: string; top: string } {
  return {
    left: `${round((pixel.px / basemap.widthPx) * 100)}%`,
    top: `${round((pixel.py / basemap.heightPx) * 100)}%`,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** 叠加层统计（供图例/空态判断：三者都为空时地图上什么都没有） */
export function overlayCounts(input: {
  zones: readonly ZoneOverlay[];
  spots: readonly SpotOverlay[];
  tracks: readonly TrackOverlay[];
  markers: readonly SightingMarkerOverlay[];
}): { zones: number; spots: number; tracks: number; markers: number; total: number } {
  return {
    zones: input.zones.length,
    spots: input.spots.length,
    tracks: input.tracks.length,
    markers: input.markers.length,
    total: input.zones.length + input.spots.length + input.tracks.length + input.markers.length,
  };
}

/** 经纬度是否可安全画到底图内（防止后端脏数据把图元甩到画布外） */
export function isPointOnBasemap(
  point: LatLng,
  basemap: CampusBasemap = WILDLIFE_BASEMAP,
): boolean {
  const pixel = wgs84ToPixel(point, basemap.affine);
  return (
    pixel.px >= -basemap.widthPx &&
    pixel.py >= -basemap.heightPx &&
    pixel.px <= basemap.widthPx * 2 &&
    pixel.py <= basemap.heightPx * 2
  );
}
