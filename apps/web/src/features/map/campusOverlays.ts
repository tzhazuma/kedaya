/**
 * 校园地图 · 叠加层坐标重投影
 * =====================================================================
 *
 * ## 为什么需要"重投影"
 *
 * 现有用例 `loadWildlifeMap` 返回的叠加层（`ZoneOverlay` / `SpotOverlay` /
 * `TrackOverlay` / `SightingMarkerOverlay`）里的 `px/py` 是**按仓储下发的底图仿射**
 * 算出来的（mock 下是手绘占位底图的仿射）。而校园地图用的是 **OSM 底图**，
 * 视口与仿射完全不同 —— 直接把旧像素画到新图上，所有点都会系统性偏移。
 *
 * 正确做法是**走回地理坐标**再投到新底图：
 *
 * ```
 * 旧像素 ──旧 affine⁻¹──▶ WGS84 ──toLocalMeters + 新 affine──▶ 新像素
 * ```
 *
 * 这是**线性可逆**的（像素↔米），所以不会引入额外误差；也因此不需要改
 * `application` / `domain` 层——那两层本来就不该知道"这次用哪张底图"。
 *
 * ## 半径必须重算，不能照抄
 *
 * 旧叠加层的 `radiusPx` 是按旧图的"像素/米"算的；两张图比例不同，
 * 直接把旧 `radiusPx` 搬过来会让 60 m 的活动圈看起来像 40 m 或 90 m。
 * 因此这里用 `radiusM × 新图 pixelsPerMeter` 重新计算。
 */
import type { AffineMatrix } from '@/domain/models/wildlife/basemap';
import { pixelToWgs84 } from '@/domain/models/wildlife/basemap';
import type {
  SightingMarkerOverlay,
  SpotOverlay,
  TrackOverlay,
  ZoneOverlay,
} from '@/domain/models/wildlife/geometry';

import {
  campusPixelsPerMeter,
  campusWgs84ToPixel,
  type CampusPixelPoint,
} from './campusBasemap';

/** 旧底图像素 → WGS84 → 新底图像素 */
export function rebasePixel(pixel: CampusPixelPoint, fromAffine: AffineMatrix): CampusPixelPoint {
  return campusWgs84ToPixel(pixelToWgs84(pixel, fromAffine));
}

export function rebaseZones(
  zones: readonly ZoneOverlay[],
  fromAffine: AffineMatrix,
): ZoneOverlay[] {
  return zones.map((zone) => ({
    ...zone,
    center: rebasePixel(zone.center, fromAffine),
    radiusPx: Math.max(0, zone.radiusM) * campusPixelsPerMeter(),
    speciesIds: [...zone.speciesIds],
  }));
}

export function rebaseSpots(
  spots: readonly SpotOverlay[],
  fromAffine: AffineMatrix,
): SpotOverlay[] {
  return spots.map((spot) => ({
    ...spot,
    center: rebasePixel(spot.center, fromAffine),
    radiusPx: Math.max(0, spot.radiusM) * campusPixelsPerMeter(),
  }));
}

export function rebaseTracks(
  tracks: readonly TrackOverlay[],
  fromAffine: AffineMatrix,
): TrackOverlay[] {
  return tracks.map((track) => ({
    ...track,
    points: track.points.map((point) => rebasePixel(point, fromAffine)),
  }));
}

export function rebaseMarkers(
  markers: readonly SightingMarkerOverlay[],
  fromAffine: AffineMatrix,
): SightingMarkerOverlay[] {
  return markers.map((marker) => ({
    ...marker,
    at: rebasePixel(marker.at, fromAffine),
  }));
}
