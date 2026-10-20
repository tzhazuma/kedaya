/**
 * BD-09（百度坐标）↔ WGS84 转换。
 *
 * ## 为什么需要它
 *
 * 我们从「上科大一图通」（`map.niyiwei.com`）借用了食堂菜单与地下车库照片，
 * 它们的 POI 坐标是 **BD-09**。而我们全仓库的**坐标唯一真相是 WGS84**
 * （见 `packages/contracts/src/campus-poi.ts` 的 `CAMPUS_POI_BOUNDS` 与
 * `docs/architecture/` 里的坐标系裁决）。
 *
 * 2026-10-20 实测：把他们的原始坐标直接当 WGS84 用，食堂会落在校园外
 * **约 1.4 km** 的地方 —— 而且那个位置在 OpenStreetMap 里**一个带标签的
 * 元素都没有**（说明那里根本没有建筑）。这不是"差一点"，是**完全错位**。
 *
 * 反过来验证：按 BD-09 → WGS84 转换后，四个食堂全部落在 `CAMPUS_POI_BOUNDS`
 * 内，且紧邻 OSM 记录的图书馆（`121.592341, 31.177398`）与全家便利店
 * （`121.592916, 31.179580`）—— 食堂本来就该在那儿。这条交叉验证是
 * 「他们用 BD-09」的最强证据。
 *
 * ## 算法
 *
 * BD-09 是百度在 GCJ-02 之上又加的一层偏移，所以转换是两步：
 *   BD-09 → GCJ-02（闭式公式）→ WGS84（迭代逼近，复用 `gcj02ToWgs84`）
 *
 * ⚠️ 反向（WGS84 → BD-09）仅供展示/调试，**不要把 BD-09 存进任何库**。
 * 仓库内的落库与传输一律 WGS84。
 */

import { gcj02ToWgs84, wgs84ToGcj02 } from './gcj02';
import type { LatLng } from './types';

/** 百度的固定偏移量（BD-09 → GCJ-02 公式里的常数） */
const BD_FACTOR = {
  /** 经度偏移 */
  x: 0.0065,
  /** 纬度偏移 */
  y: 0.006,
  /** 极坐标半径修正 */
  radius: 0.00002,
  /** 极角修正 */
  angle: 0.000003,
} as const;

/**
 * BD-09 → GCJ-02。
 *
 * 百度用的是「先平移再转极坐标」的构造，所以反解是**闭式**的（不需要迭代）。
 */
export function bd09ToGcj02(lat: number, lng: number): LatLng {
  const x = lng - BD_FACTOR.x;
  const y = lat - BD_FACTOR.y;
  const z = Math.sqrt(x * x + y * y) - BD_FACTOR.radius * Math.sin(y * Math.PI);
  const theta = Math.atan2(y, x) - BD_FACTOR.angle * Math.cos(x * Math.PI);
  return { lat: z * Math.sin(theta), lng: z * Math.cos(theta) };
}

/** GCJ-02 → BD-09（反向；仅供展示，不要落库） */
export function gcj02ToBd09(lat: number, lng: number): LatLng {
  const z = Math.sqrt(lng * lng + lat * lat) + BD_FACTOR.radius * Math.sin(lat * Math.PI);
  const theta = Math.atan2(lat, lng) + BD_FACTOR.angle * Math.cos(lng * Math.PI);
  return {
    lat: z * Math.sin(theta) + BD_FACTOR.y,
    lng: z * Math.cos(theta) + BD_FACTOR.x,
  };
}

/**
 * BD-09 → WGS84。**这是导入百度系数据时必须走的那一步。**
 *
 * 两步链式：BD-09 → GCJ-02（闭式）→ WGS84（迭代）。
 */
export function bd09ToWgs84(lat: number, lng: number): LatLng {
  const gcj = bd09ToGcj02(lat, lng);
  return gcj02ToWgs84(gcj.lat, gcj.lng);
}

/**
 * WGS84 → BD-09（反向；仅供与百度系接口对接时使用）。
 *
 * ⚠️ 不要把结果存进数据库 —— 落库永远是 WGS84。
 */
export function wgs84ToBd09(lat: number, lng: number): LatLng {
  const gcj = wgs84ToGcj02(lat, lng);
  return gcj02ToBd09(gcj.lat, gcj.lng);
}
