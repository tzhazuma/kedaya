/**
 * 地理基础类型（可达鸭 · 野生动物模块）
 *
 * ⚠️ 全链路**只使用 WGS84**（契约见 `docs/features/wildlife-map.md` §3.2）。
 * GCJ-02 只在"要画到微信小程序 map 组件上"的那一瞬间转换，绝不入库、绝不上传。
 */

/** WGS84 坐标（GPS 原始坐标系） */
export interface LatLng {
  lat: number;
  lng: number;
}

/** 语义别名，强调这是 WGS84 */
export type Wgs84Point = LatLng;

/** GCJ-02 坐标（"火星坐标"，中国境内地图服务的加密坐标系） */
export interface Gcj02Point {
  lat: number;
  lng: number;
}

/** 敏感区多边形（宿舍区 / 保育区 / 巢区），WGS84 顶点环 */
export interface SensitivePolygon {
  id: string;
  /** 闭合环的顶点；首尾不必重复 */
  ring: Wgs84Point[];
  reason: string;
}

/**
 * 上科大张江校区参考原点（WGS84）。
 *
 * ⚠️ **这是占位值，必须由实测替换**（见规格文档 §3.4 U3）。
 * 它只用于"经纬度 ↔ 局部米制平面"的线性化，误差在校园尺度（~1km）下可忽略；
 * 但它**不是**校园边界，不要拿它做包含判定。
 */
export const CAMPUS_ORIGIN: Wgs84Point = { lat: 31.1795, lng: 121.591 };

/** 一度纬度对应的米数（WGS84 球面近似，校园尺度足够） */
export const METERS_PER_DEG_LAT = 111_320;
