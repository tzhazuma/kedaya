import { describe, expect, it } from 'vitest';
import { coarseTime, gridCellKey, seasonalFuzzMultiplier, snapToGrid } from './grid';
import { distanceMeters, fromLocalMeters, pointInPolygon, toLocalMeters } from './local';
import { CAMPUS_ORIGIN, type LatLng } from './types';

describe('toLocalMeters / fromLocalMeters', () => {
  it('原点映射到 (0,0)', () => {
    const m = toLocalMeters(CAMPUS_ORIGIN);
    expect(Math.abs(m.x)).toBeLessThan(1e-6);
    expect(Math.abs(m.y)).toBeLessThan(1e-6);
  });

  it('往返一致', () => {
    const p: LatLng = { lat: 31.181, lng: 121.5935 };
    const back = fromLocalMeters(toLocalMeters(p));
    expect(distanceMeters(p, back)).toBeLessThan(0.01);
  });

  it('向北 100m 的局部 y ≈ 100', () => {
    const north = fromLocalMeters({ x: 0, y: 100 });
    expect(toLocalMeters(north).y).toBeCloseTo(100, 6);
    expect(distanceMeters(CAMPUS_ORIGIN, north)).toBeCloseTo(100, 0);
  });
});

describe('distanceMeters', () => {
  it('同点为 0', () => {
    expect(distanceMeters(CAMPUS_ORIGIN, CAMPUS_ORIGIN)).toBe(0);
  });

  it('已知量级：0.001° 纬度 ≈ 111m', () => {
    const d = distanceMeters({ lat: 31.0, lng: 121.0 }, { lat: 31.001, lng: 121.0 });
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(118);
  });

  it('对称', () => {
    const a = { lat: 31.1795, lng: 121.591 };
    const b = { lat: 31.185, lng: 121.599 };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 9);
  });
});

describe('snapToGrid', () => {
  it('吸附后落在格心，且位移不超过半格对角线', () => {
    const p: LatLng = { lat: 31.17953, lng: 121.59127 };
    const snapped = snapToGrid(p, 50);
    expect(distanceMeters(p, snapped)).toBeLessThan((50 * Math.SQRT2) / 2 + 1);
  });

  it('同一格内的不同点吸附到同一位置', () => {
    const a = fromLocalMeters({ x: 101, y: 101 });
    const b = fromLocalMeters({ x: 120, y: 130 });
    expect(gridCellKey(a, 50)).toBe(gridCellKey(b, 50));
    expect(distanceMeters(snapToGrid(a, 50), snapToGrid(b, 50))).toBeLessThan(0.5);
  });

  it('确定性：同输入必同输出', () => {
    const p: LatLng = { lat: 31.17953, lng: 121.59127 };
    expect(snapToGrid(p, 50)).toEqual(snapToGrid(p, 50));
  });

  it('gridM 非正数抛错', () => {
    expect(() => snapToGrid(CAMPUS_ORIGIN, 0)).toThrow(RangeError);
    expect(() => snapToGrid(CAMPUS_ORIGIN, -10)).toThrow(RangeError);
  });

  it('gridM 越大，位移上限越大（单调性）', () => {
    const p: LatLng = { lat: 31.17953, lng: 121.59127 };
    expect(distanceMeters(p, snapToGrid(p, 200))).toBeGreaterThan(
      distanceMeters(p, snapToGrid(p, 10)),
    );
  });
});

describe('gridCellKey', () => {
  it('相邻格不同 key，同格同 key', () => {
    const a = fromLocalMeters({ x: 10, y: 10 });
    const b = fromLocalMeters({ x: 60, y: 10 });
    expect(gridCellKey(a, 50)).not.toBe(gridCellKey(b, 50));
    expect(gridCellKey(a, 50)).toBe(gridCellKey(fromLocalMeters({ x: 40, y: 40 }), 50));
  });
});

describe('coarseTime', () => {
  it('按小时截断', () => {
    expect(coarseTime('2026-10-17T03:47:12.345Z', 'hour')).toBe('2026-10-17T03:00:00.000Z');
  });

  it('按天截断', () => {
    expect(coarseTime('2026-10-17T23:59:59.999Z', 'day')).toBe('2026-10-17T00:00:00.000Z');
  });

  it('非法时间抛错', () => {
    expect(() => coarseTime('not-a-date', 'hour')).toThrow(TypeError);
  });
});

describe('seasonalFuzzMultiplier', () => {
  it('非繁殖敏感物种恒为 1', () => {
    expect(seasonalFuzzMultiplier(4, false, [3, 4, 5])).toBe(1);
  });

  it('繁殖期放大 4 倍，非繁殖期为 1', () => {
    expect(seasonalFuzzMultiplier(4, true, [3, 4, 5])).toBe(4);
    expect(seasonalFuzzMultiplier(11, true, [3, 4, 5])).toBe(1);
  });
});

describe('pointInPolygon', () => {
  // 以原点为中心的 100m 见方
  const square: LatLng[] = [
    fromLocalMeters({ x: -50, y: -50 }),
    fromLocalMeters({ x: 50, y: -50 }),
    fromLocalMeters({ x: 50, y: 50 }),
    fromLocalMeters({ x: -50, y: 50 }),
  ];

  it('内部点为 true', () => {
    expect(pointInPolygon(fromLocalMeters({ x: 0, y: 0 }), square)).toBe(true);
    expect(pointInPolygon(fromLocalMeters({ x: 40, y: -40 }), square)).toBe(true);
  });

  it('外部点为 false', () => {
    expect(pointInPolygon(fromLocalMeters({ x: 200, y: 0 }), square)).toBe(false);
    expect(pointInPolygon(fromLocalMeters({ x: 0, y: -300 }), square)).toBe(false);
  });

  it('顶点数不足 3 返回 false', () => {
    expect(pointInPolygon(CAMPUS_ORIGIN, [])).toBe(false);
    expect(pointInPolygon(CAMPUS_ORIGIN, square.slice(0, 2))).toBe(false);
  });
});
