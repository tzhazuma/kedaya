import { describe, expect, it } from 'vitest';

import { bd09ToGcj02, bd09ToWgs84, gcj02ToBd09, wgs84ToBd09 } from './bd09';

/**
 * BD-09 转换。
 *
 * ## 这组测试是**对着真实数据**写的
 *
 * 「上科大一图通」（map.niyiwei.com）的食堂坐标是 BD-09。2026-10-20 实测：
 *
 * - 把它们的原始坐标（如 `121.603431, 31.183072`）直接当 WGS84 用，
 *   食堂会落在校园外约 **1.4 km**，且那个位置在 OpenStreetMap 里
 *   **一个带标签的元素都没有**（没有建筑）。
 * - 按 BD-09 → WGS84 转换后，四个食堂全部落进 `CAMPUS_POI_BOUNDS`，
 *   且紧邻 OSM 记录的图书馆与全家便利店 —— 食堂本来就该在那儿。
 *
 * 这条交叉验证就是「他们用 BD-09」的证据，也是为什么必须有这个模块。
 */

/** 一图通的真实原始坐标（BD-09） */
const NIYIWEI_SAMPLES = [
  { name: '尚科食堂', bd: { lat: 31.183072, lng: 121.603431 } },
  { name: '肯德基（上科大店）', bd: { lat: 31.183478, lng: 121.603554 } },
  { name: '丝路食堂', bd: { lat: 31.183884, lng: 121.603747 } },
  { name: '白玉兰食堂', bd: { lat: 31.181999, lng: 121.602993 } },
] as const;

/** OSM 记录的校园真实位置（WGS84） */
const OSM_LIBRARY = { lat: 31.177398, lng: 121.592341 };

describe('bd09ToWgs84 —— 真实一图通数据', () => {
  it('四个食堂全部落进校园范围（纬度 31.17~31.19，经度 121.58~121.60）', () => {
    for (const { name, bd } of NIYIWEI_SAMPLES) {
      const wgs = bd09ToWgs84(bd.lat, bd.lng);
      expect(wgs.lat, `${name} 纬度`).toBeGreaterThan(31.17);
      expect(wgs.lat, `${name} 纬度`).toBeLessThan(31.19);
      expect(wgs.lng, `${name} 经度`).toBeGreaterThan(121.58);
      expect(wgs.lng, `${name} 经度`).toBeLessThan(121.6);
    }
  });

  it('⚠️ 转换后与 OSM 图书馆的距离在 1 km 内（原始坐标会差 1.4 km）', () => {
    for (const { name, bd } of NIYIWEI_SAMPLES) {
      const wgs = bd09ToWgs84(bd.lat, bd.lng);
      const meters = haversine(wgs, OSM_LIBRARY);
      expect(meters, `${name} 距图书馆 ${Math.round(meters)} m`).toBeLessThan(1000);
    }
  });

  it('⚠️ 原始坐标（未转换）与图书馆的距离**超过** 1 km —— 这就是必须转换的理由', () => {
    const raw = { lat: NIYIWEI_SAMPLES[0].bd.lat, lng: NIYIWEI_SAMPLES[0].bd.lng };
    expect(haversine(raw, OSM_LIBRARY)).toBeGreaterThan(1000);
  });

  it('转换是稳定的（同输入同输出）', () => {
    const a = bd09ToWgs84(31.183072, 121.603431);
    const b = bd09ToWgs84(31.183072, 121.603431);
    expect(a).toEqual(b);
  });
});

describe('往返一致性', () => {
  it('BD-09 → WGS84 → BD-09 在原值附近（误差 < 1 m）', () => {
    for (const { bd } of NIYIWEI_SAMPLES) {
      const wgs = bd09ToWgs84(bd.lat, bd.lng);
      const back = wgs84ToBd09(wgs.lat, wgs.lng);
      expect(haversine({ lat: bd.lat, lng: bd.lng }, back)).toBeLessThan(1);
    }
  });

  it('BD-09 → GCJ-02 是闭式的（不需要迭代，结果确定）', () => {
    const g = bd09ToGcj02(31.183072, 121.603431);
    expect(Number.isFinite(g.lat)).toBe(true);
    expect(Number.isFinite(g.lng)).toBe(true);
    // GCJ-02 在 BD-09 的西南方向（百度是"先平移再极坐标"）
    expect(g.lng).toBeLessThan(121.603431);
    expect(g.lat).toBeLessThan(31.183072);
  });

  it('GCJ-02 → BD-09 方向正确（东北）', () => {
    const b = gcj02ToBd09(31.177, 121.592);
    expect(b.lng).toBeGreaterThan(121.592);
    expect(b.lat).toBeGreaterThan(31.177);
  });
});

/** 两点间距离（米），Haversine */
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
