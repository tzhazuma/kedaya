/**
 * 校园地图 · 叠加层重投影测试
 *
 * 关键断言：**"旧底图像素 → WGS84 → 新底图像素"必须回到同一个地理点**。
 * 如果这里错了，地图上所有活动区域/热点/轨迹会整体平移，而且看起来"像是数据错了"。
 */
import { describe, expect, it } from 'vitest';

import { WILDLIFE_BASEMAP, wgs84ToPixel as legacyWgs84ToPixel } from '@/domain/models/wildlife/basemap';
import type { SightingMarkerOverlay, SpotOverlay, TrackOverlay, ZoneOverlay } from '@/domain/models/wildlife/geometry';

import { CAMPUS_BASEMAP, campusPixelsPerMeter, campusWgs84ToPixel } from './campusBasemap';
import {
  rebaseMarkers,
  rebasePixel,
  rebaseSpots,
  rebaseTracks,
  rebaseZones,
} from './campusOverlays';

const LIBRARY = { lat: 31.177398, lng: 121.592341 };

function distancePx(a: { px: number; py: number }, b: { px: number; py: number }): number {
  return Math.hypot(a.px - b.px, a.py - b.py);
}

describe('像素重投影：旧底图 → WGS84 → OSM 底图', () => {
  it('同一個 WGS84 点经旧图 → 新图后落在同一位置（误差 < 1e-6 px）', () => {
    const legacyPixel = legacyWgs84ToPixel(LIBRARY, WILDLIFE_BASEMAP.affine);
    const rebased = rebasePixel(legacyPixel, WILDLIFE_BASEMAP.affine);
    const direct = campusWgs84ToPixel(LIBRARY);
    expect(distancePx(rebased, direct)).toBeLessThan(1e-6);
  });

  it('旧图与新图是两套不同的像素空间（不是同一张图换皮）', () => {
    // 仿射矩阵不同：旧图是 1200×800 的手绘占位图，新图是 1400×868 的 OSM 视口
    expect(CAMPUS_BASEMAP.affine[0]).not.toBe(WILDLIFE_BASEMAP.affine[0]);
    expect(CAMPUS_BASEMAP.widthPx).not.toBe(WILDLIFE_BASEMAP.widthPx);
    // 即使某个点在两张图上恰好接近，也不能据此复用旧像素；这里要求至少不是像素级恒等
    const legacyPixel = legacyWgs84ToPixel(LIBRARY, WILDLIFE_BASEMAP.affine);
    const direct = campusWgs84ToPixel(LIBRARY);
    expect(distancePx(legacyPixel, direct)).toBeGreaterThan(1);
  });
});

describe('叠加层：中心/折线重投影，半径按新图比例重算', () => {
  it('活动区域：圆心回到真实位置，半径 = radiusM × 新图 pixelsPerMeter', () => {
    const legacyCenter = legacyWgs84ToPixel(LIBRARY, WILDLIFE_BASEMAP.affine);
    const zone: ZoneOverlay = {
      id: 'zone-test',
      name: '测试区域',
      center: legacyCenter,
      radiusPx: 999, // 旧图的值必须被丢弃
      radiusM: 60,
      feedingPolicy: 'discouraged',
      isSensitive: false,
      noticeSummary: null,
      speciesIds: ['sp-cat'],
    };
    const [rebased] = rebaseZones([zone], WILDLIFE_BASEMAP.affine);
    expect(rebased).toBeDefined();
    expect(distancePx(rebased!.center, campusWgs84ToPixel(LIBRARY))).toBeLessThan(1e-6);
    expect(rebased!.radiusPx).toBeCloseTo(60 * campusPixelsPerMeter(), 6);
    expect(rebased!.radiusPx).not.toBe(999);
    // 不修改入参（纯函数）
    expect(zone.center).toEqual(legacyCenter);
  });

  it('热点、轨迹、观测点同样被重投影', () => {
    const legacyCenter = legacyWgs84ToPixel(LIBRARY, WILDLIFE_BASEMAP.affine);
    const spot: SpotOverlay = {
      id: 'spot-test',
      center: legacyCenter,
      radiusPx: 123,
      radiusM: 40,
      speciesId: 'sp-cat',
      speciesNameZh: '猫',
      confidence: 0.8,
      sightingCount: 5,
      distinctReporters: 3,
      kAnonymous: true,
      aggregated: true,
    };
    const track: TrackOverlay = {
      id: 'track-test',
      points: [legacyCenter, legacyWgs84ToPixel({ lat: 31.178, lng: 121.593 }, WILDLIFE_BASEMAP.affine)],
      speciesNameZh: '猫',
      isInferred: true,
      disclaimer: '推断',
      sightingCount: 5,
    };
    const marker: SightingMarkerOverlay = {
      id: 'marker-test',
      at: legacyCenter,
      speciesId: 'sp-cat',
      speciesNameZh: '猫',
      status: 'PUBLISHED',
      healthConcern: false,
    };

    const [rebasedSpot] = rebaseSpots([spot], WILDLIFE_BASEMAP.affine);
    const [rebasedTrack] = rebaseTracks([track], WILDLIFE_BASEMAP.affine);
    const [rebasedMarker] = rebaseMarkers([marker], WILDLIFE_BASEMAP.affine);

    expect(distancePx(rebasedSpot!.center, campusWgs84ToPixel(LIBRARY))).toBeLessThan(1e-6);
    expect(rebasedSpot!.radiusPx).toBeCloseTo(40 * campusPixelsPerMeter(), 6);
    expect(rebasedTrack!.points).toHaveLength(2);
    expect(distancePx(rebasedTrack!.points[0]!, campusWgs84ToPixel(LIBRARY))).toBeLessThan(1e-6);
    expect(distancePx(rebasedMarker!.at, campusWgs84ToPixel(LIBRARY))).toBeLessThan(1e-6);
  });
});
