/**
 * 经纬度 ↔ 局部米制平面（ENU 近似），以及距离/方位计算。
 *
 * 为什么需要它：
 *   - 网格吸附、噪声、半径判定都要在**米**里做，不能在"度"里做
 *     （一度经度在纬度 31° 处约 95km，一度纬度约 111km —— 两者不等，直接用度会歪）
 *   - 校园尺度（~2km）下等距圆柱近似（equirectangular）误差 < 0.1%，足够
 */

import {
  CAMPUS_ORIGIN,
  METERS_PER_DEG_LAT,
  type LatLng,
} from './types';

/** 局部平面坐标（米），x 向东，y 向北 */
export interface LocalMeters {
  x: number;
  y: number;
}

/** 指定纬度处，一度经度对应的米数 */
export function metersPerDegLng(atLat: number): number {
  return METERS_PER_DEG_LAT * Math.cos((atLat * Math.PI) / 180);
}

/** WGS84 → 以 origin 为原点的局部米制平面 */
export function toLocalMeters(p: LatLng, origin: LatLng = CAMPUS_ORIGIN): LocalMeters {
  return {
    x: (p.lng - origin.lng) * metersPerDegLng(origin.lat),
    y: (p.lat - origin.lat) * METERS_PER_DEG_LAT,
  };
}

/** 局部米制平面 → WGS84 */
export function fromLocalMeters(m: LocalMeters, origin: LatLng = CAMPUS_ORIGIN): LatLng {
  return {
    lat: origin.lat + m.y / METERS_PER_DEG_LAT,
    lng: origin.lng + m.x / metersPerDegLng(origin.lat),
  };
}

/** 两点距离（米），Haversine */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_008.8; // 平均地球半径
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 方位角（度，正北为 0，顺时针） */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/**
 * 点在多边形内（射线法）。
 *
 * 先把顶点与测试点转到**局部米制平面**再做判定 ——
 * 直接在经纬度上做射线法，在跨经度较大或多边形含竖直边时会出现边界问题。
 */
export function pointInPolygon(point: LatLng, ring: LatLng[]): boolean {
  if (ring.length < 3) return false;

  const origin = ring[0] as LatLng;
  const p = toLocalMeters(point, origin);
  const vs = ring.map((v) => toLocalMeters(v, origin));

  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i, i += 1) {
    const vi = vs[i] as LocalMeters;
    const vj = vs[j] as LocalMeters;
    const intersects =
      vi.y > p.y !== vj.y > p.y &&
      p.x < ((vj.x - vi.x) * (p.y - vi.y)) / (vj.y - vi.y || Number.EPSILON) + vi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * GCJ-02 偏移量的**量级断言**（规格文档 §3.5 的 V2 验证法）。
 *
 * 为什么需要它：往返转换测试（V1）抓不到"转换函数被写成恒等函数"这类 bug ——
 * 因为恒等函数的往返也是自洽的。而真实的 GCJ-02 偏移在中国境内**必然**是
 * 百米量级；若偏移接近 0，说明转换没生效。
 */
export function isGcj02OffsetPlausible(wgs: LatLng, gcj: LatLng): boolean {
  const d = distanceMeters(wgs, gcj);
  return d >= 100 && d <= 900;
}
