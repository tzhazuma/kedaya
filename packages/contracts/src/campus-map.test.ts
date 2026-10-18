import { describe, expect, it } from 'vitest';

import {
  CAMPUS_ATTRIBUTION,
  CAMPUS_BOUNDARY,
  CAMPUS_BOUNDS,
  CAMPUS_FEATURED,
  CAMPUS_MAP,
  CAMPUS_METERS_PER_PIXEL,
  CAMPUS_PLACES,
  blurredCampusPoint,
  campusCoordinate,
  campusPixel,
  isOnCampus,
} from './campus-map';
import { CAMPUS_ATTRIBUTION as ATTRIBUTION_FROM_INDEX } from './index';

/**
 * 校园地图契约的测试口径：
 *
 * 1. **数据自洽**：快照必须真的有校园规模（不是占位 JSON）；
 * 2. **投影可逆**：`campusPixel` / `campusCoordinate` 往返误差要小于
 *    1e-6 度（约 0.1 米）—— 否则底图上的点会肉眼可见地偏；
 * 3. **边界判定**：校园内为真、市中心为假、NaN 为假；
 * 4. **模糊坐标**：必须落在校园内，且永远是 0.001° 栅格点。
 */
describe('campus map contract', () => {
  it('ships the real campus snapshot, not a placeholder', () => {
    expect(CAMPUS_MAP.width).toBeGreaterThan(2000);
    expect(CAMPUS_MAP.height).toBeGreaterThan(1400);
    expect(CAMPUS_METERS_PER_PIXEL).toBeGreaterThan(0);
    expect(CAMPUS_BOUNDARY.length).toBeGreaterThanOrEqual(8);
    expect(CAMPUS_PLACES.length).toBeGreaterThanOrEqual(65);
    expect(CAMPUS_ATTRIBUTION).toContain('上海科技大学');
    expect(ATTRIBUTION_FROM_INDEX).toBe(CAMPUS_ATTRIBUTION);
  });

  it('keeps the featured landmark list meaningful', () => {
    expect(CAMPUS_FEATURED.some((place) => place.name === '物质塔')).toBe(true);
    expect(CAMPUS_FEATURED.some((place) => place.name === '图书馆')).toBe(true);
    expect(CAMPUS_FEATURED.some((place) => place.kind === 'bridge')).toBe(true);
  });

  it('round-trips pixels and coordinates without meaningful drift', () => {
    for (const place of CAMPUS_PLACES) {
      const pixel = campusPixel(place);
      const point = campusCoordinate(pixel.x, pixel.y);
      expect(Math.abs(point.latitude - place.latitude)).toBeLessThan(0.000002);
      expect(Math.abs(point.longitude - place.longitude)).toBeLessThan(0.000002);
    }
  });

  it('accepts the campus and rejects points outside it', () => {
    const library = CAMPUS_PLACES.find((place) => place.name === '图书馆');
    expect(library).toBeDefined();
    expect(isOnCampus(library as { latitude: number; longitude: number })).toBe(true);

    // 上海市中心（人民广场附近）—— 明显在校园外
    expect(isOnCampus({ latitude: 31.2304, longitude: 121.4737 })).toBe(false);
    // 非有限值必须是 false，而不是「碰巧某条射线判定为真」
    expect(isOnCampus({ latitude: Number.NaN, longitude: 121.591 })).toBe(false);
    expect(isOnCampus({ latitude: 31.1795, longitude: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it('derives the bounding box from the boundary itself', () => {
    const latitudes = CAMPUS_BOUNDARY.map((point) => point.latitude);
    const longitudes = CAMPUS_BOUNDARY.map((point) => point.longitude);
    expect(CAMPUS_BOUNDS.south).toBeCloseTo(Math.min(...latitudes), 10);
    expect(CAMPUS_BOUNDS.north).toBeCloseTo(Math.max(...latitudes), 10);
    expect(CAMPUS_BOUNDS.west).toBeCloseTo(Math.min(...longitudes), 10);
    expect(CAMPUS_BOUNDS.east).toBeCloseTo(Math.max(...longitudes), 10);
  });

  it('blurs a point onto a coarse grid inside the campus', () => {
    const library = CAMPUS_PLACES.find((place) => place.name === '图书馆');
    if (library === undefined) throw new Error('校园数据里没有图书馆');

    const blurred = blurredCampusPoint({
      latitude: library.latitude + 0.0004,
      longitude: library.longitude - 0.0006,
    });
    expect(blurred).not.toEqual({ latitude: library.latitude, longitude: library.longitude });
    expect(Number.isInteger(blurred.latitude * 1000)).toBe(true);
    expect(Number.isInteger(blurred.longitude * 1000)).toBe(true);
    expect(isOnCampus(blurred)).toBe(true);
    // 模糊不能把点甩到校园另一头（校园东西向约 1.3 km）
    expect(Math.abs(blurred.longitude - library.longitude)).toBeLessThan(0.004);
    expect(Math.abs(blurred.latitude - library.latitude)).toBeLessThan(0.004);
  });
});
