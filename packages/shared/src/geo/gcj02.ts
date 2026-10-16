/**
 * WGS84 ↔ GCJ-02 坐标转换。
 *
 * ⚠️ **这是本模块最容易出错的地方**（规格文档 §3 整节都在讲它）：
 *   - GPS / 浏览器 `navigator.geolocation` / 手机定位 → **WGS84**
 *   - 微信小程序 `<map>` 组件 / 高德 / 腾讯地图 / 百度(再叠 BD-09) → **GCJ-02**
 *   - 直接混用 → 在中国境内**偏移数百米**（校园尺度下足以跨过一整栋楼）
 *
 * 我们的规范（冻结）：
 *   1. **WGS84 是唯一真相**：数据库、API、上传一律 WGS84
 *   2. GCJ-02 **只在渲染前一刻**由 `wgs84ToGcj02()` 转换
 *   3. 绝不把 GCJ-02 存库或上传 —— 否则数据永久污染且无法与 GPS 数据比较
 *
 * 算法：国测局（GCJ-02）公开的标准偏移算法。它**不是**加密，只是偏移，
 * 因此可以正反转换；反向用一次迭代逼近（解析解不存在）。
 */

import { type Gcj02Point, type LatLng } from './types';

/** 克拉索夫斯基椭球长半轴（米） */
const A = 6_378_245.0;
/** 第一偏心率平方 */
const EE = 0.006_693_421_622_965_943_23;

/** 中国大陆粗略范围之外不做偏移（境外 GCJ-02 与 WGS84 一致） */
export function outOfChina(lat: number, lng: number): boolean {
  return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret =
    300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

/** 计算 WGS84 → GCJ-02 的偏移量（度） */
function delta(lat: number, lng: number): { dLat: number; dLng: number } {
  const dLat0 = transformLat(lng - 105.0, lat - 35.0);
  const dLng0 = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const dLat = (dLat0 * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  const dLng = (dLng0 * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { dLat, dLng };
}

/** WGS84 → GCJ-02。渲染到中国地图服务前调用。 */
export function wgs84ToGcj02(lat: number, lng: number): Gcj02Point {
  if (outOfChina(lat, lng)) return { lat, lng };
  const { dLat, dLng } = delta(lat, lng);
  return { lat: lat + dLat, lng: lng + dLng };
}

/**
 * GCJ-02 → WGS84。
 *
 * 解析解不存在，用**迭代逼近**：反复把当前估计值正向偏移一次，
 * 用残差修正，通常 3 次迭代即可到亚米级。
 */
export function gcj02ToWgs84(lat: number, lng: number, iterations = 3): LatLng {
  if (outOfChina(lat, lng)) return { lat, lng };
  let wLat = lat;
  let wLng = lng;
  for (let i = 0; i < iterations; i += 1) {
    const { dLat, dLng } = delta(wLat, wLng);
    wLat = lat - dLat;
    wLng = lng - dLng;
  }
  return { lat: wLat, lng: wLng };
}

/** 便捷：把一批 WGS84 点转成 GCJ-02（用于地图渲染） */
export function wgs84PointsToGcj02(points: LatLng[]): Gcj02Point[] {
  return points.map((p) => wgs84ToGcj02(p.lat, p.lng));
}
