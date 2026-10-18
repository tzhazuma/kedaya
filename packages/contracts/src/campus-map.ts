import data from './campus-map-data.json';

/**
 * 校园地图（上海科技大学校园 GIS 快照）—— 三端共享的**投影 + 地标**数据。
 *
 * 为什么要把它放进契约包：小程序的动物地图 / 上报选点、Web 的校园地图都要
 * 「把经纬度画在**真实校园底图**上的正确位置」。这件事的正确答案只有一个，
 * 因此投影、边界、地标只在这里写一份（`campus-map-data.json` 是快照，
 * 由 `scripts/sync-campus-map.mjs` 从校方 GIS 重新生成）。
 *
 * ## 坐标系（务必读这段）
 *
 * 底图瓦片来自校方 GIS，是 **BD-09** 投影；但对外暴露的坐标一律是 **GCJ-02**
 * （与微信 `wx.openLocation` / 腾讯地图同一坐标系，也是本仓库地图层的统一口径）。
 * 于是：
 *
 * ```
 * GCJ-02 ──gcjToBd──▶ BD-09 ──BD09-Mercator──▶ 图像像素（x 右 / y 下）
 * ```
 *
 * **不接受 WGS84 入参**：本仓库存储层全部是 WGS84，渲染前必须先经
 * `domain/models/wildlife.ts` 的 `toMapPoint()` 转成 GCJ-02，再交给这里。
 * 少转一次不会报错，只会让所有点整体偏移约 470 米。
 *
 * ## 许可
 *
 * 底图与建筑轮廓来自校方公开的校园 GIS（`https://map.shanghaitech.edu.cn`），
 * 「物质塔」一项来自 OpenStreetMap（way 833243658）。使用时必须署名，
 * 见 [CAMPUS_ATTRIBUTION]。
 */

/** 校园坐标系里的一个点。**GCJ-02**。 */
export interface CampusPoint {
  latitude: number;
  longitude: number;
}

/** 地标分类：普通建筑 / 重点地标 / 桥（桥名是看底图写的描述，不是官方桥名）。 */
export type CampusPlaceKind = 'building' | 'landmark' | 'bridge';

/** 一个具名地点：既有经纬度（可参与计算），也有底图像素坐标（可直接定位）。 */
export interface CampusPlace extends CampusPoint {
  id: string;
  name: string;
  /** 底图像素坐标：x 向右、y 向下，原点在底图左上角 */
  x: number;
  y: number;
  kind: CampusPlaceKind;
}

/**
 * 底图快照。
 *
 * `width` / `height` 是底图的像素尺寸，`unit` 是「1 个图像像素 = 多少米」，
 * `west` / `north` 是底图左上角在 BD-09 米制平面上的位置。
 */
export const CAMPUS_MAP = data;

/**
 * 底图署名。**必须**出现在任何渲染这张底图的界面上。
 *
 * 校方 GIS 的授权口径见 `docs/features/campus-map-data.md`；
 * 「物质塔」是唯一一项 OSM 数据（ODbL），同样在此署名覆盖。
 */
export const CAMPUS_ATTRIBUTION = '底图与建筑：上海科技大学校园 GIS · 物质塔：OpenStreetMap';

/**
 * 1 个图像像素 = 多少米（= `CAMPUS_MAP.unit`）。
 *
 * 圈半径（米）换算成渲染像素时必须用它，**不能**用经纬度近似：
 * `半径像素 = 半径米 / CAMPUS_METERS_PER_PIXEL × 渲染缩放`。
 */
export const CAMPUS_METERS_PER_PIXEL = data.unit;

const BD09_LINEAR = 0.00220636496208;
const BD09_LONGITUDE_SCALE = 111320.7020209128;
/** BD-09 纬度多项式的最高次项分母（百度投影的固定常数） */
const BD09_LATITUDE_DIVISOR = 37.5;
const BD09_LATITUDE_POLYNOMIAL = [
  51751.86112841131, 3796837.749470245, 992013.7397791013, -1221952.21711287, 1340652.697009075,
  -620943.6990984312, 144416.9293806241,
] as const;

/** BD-09 纬度 → 米制投影（多项式拟合，与百度地图 JS SDK 同一套公式） */
function mercatorY(latitude: number): number {
  const t = latitude / BD09_LATITUDE_DIVISOR;
  return BD09_LATITUDE_POLYNOMIAL.reduce(
    (sum, coefficient, index) => sum + coefficient * t ** index,
    0,
  );
}

/** GCJ-02 → BD-09（百度系底图要求） */
function gcjToBd(point: CampusPoint): { lng: number; lat: number } {
  const z =
    Math.hypot(point.longitude, point.latitude) +
    0.00002 * Math.sin((point.latitude * Math.PI * 3000) / 180);
  const theta =
    Math.atan2(point.latitude, point.longitude) +
    0.000003 * Math.cos((point.longitude * Math.PI * 3000) / 180);
  return { lng: z * Math.cos(theta) + 0.0065, lat: z * Math.sin(theta) + 0.006 };
}

/** BD-09 → GCJ-02 */
function bdToGcj(lng: number, lat: number): CampusPoint {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.hypot(x, y) - 0.00002 * Math.sin((y * Math.PI * 3000) / 180);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos((x * Math.PI * 3000) / 180);
  return { longitude: z * Math.cos(theta), latitude: z * Math.sin(theta) };
}

/**
 * GCJ-02 → 底图像素。
 *
 * 这是**局部投影**：只对本校园范围有效，拿它去投影别的地方（甚至只是校园外
 * 几百米）都没有意义。
 */
export function campusPixel(point: CampusPoint): { x: number; y: number } {
  const bd = gcjToBd(point);
  return {
    x: (BD09_LINEAR + BD09_LONGITUDE_SCALE * bd.lng - data.west) / data.unit,
    y: (data.north - mercatorY(bd.lat)) / data.unit,
  };
}

/** 底图像素 → GCJ-02（[campusPixel] 的逆运算，纬度用二分法反解多项式） */
export function campusCoordinate(x: number, y: number): CampusPoint {
  const lng = (data.west + x * data.unit - BD09_LINEAR) / BD09_LONGITUDE_SCALE;
  const target = data.north - y * data.unit;
  let south = 30;
  let north = 32;
  for (let i = 0; i < 40; i += 1) {
    const middle = (south + north) / 2;
    if (mercatorY(middle) < target) south = middle;
    else north = middle;
  }
  return bdToGcj(lng, (south + north) / 2);
}

/** 校园边界（GCJ-02，闭合多边形按原顺序给出，不重复首点） */
export const CAMPUS_BOUNDARY: CampusPoint[] = data.boundary.map((point) =>
  bdToGcj(point.lng, point.lat),
);

/** 校园外接矩形（GCJ-02）。用于「粗判是否在校园附近」，精确判定用 [isOnCampus]。 */
export const CAMPUS_BOUNDS = {
  south: Math.min(...CAMPUS_BOUNDARY.map((point) => point.latitude)),
  north: Math.max(...CAMPUS_BOUNDARY.map((point) => point.latitude)),
  west: Math.min(...CAMPUS_BOUNDARY.map((point) => point.longitude)),
  east: Math.max(...CAMPUS_BOUNDARY.map((point) => point.longitude)),
};

/**
 * 点是否落在校园边界内（射线法）。
 *
 * ⚠️ 与 `domain/models/wildlife.ts` 的 `isInCampus`（矩形粗判、WGS84 入参）
 * 不是一回事：本函数是**精确多边形判定 + GCJ-02 入参**。
 * 选点、模糊坐标这类「必须落在校园里」的判断应当用本函数。
 */
export function isOnCampus(point: CampusPoint): boolean {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return false;

  const target = campusPixel(point);
  const vertices = data.boundary.map((vertex) => campusPixel(bdToGcj(vertex.lng, vertex.lat)));
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const a = vertices[i];
    const b = vertices[j];
    if (a === undefined || b === undefined) continue;
    if (
      a.y > target.y !== b.y > target.y &&
      target.x < ((b.x - a.x) * (target.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * 把任意点吸附到校园内最近的一个 **0.001° 栅格点**（粗糙模糊）。
 *
 * 这是隐私兜底的几何版本：宁可把点挪到最近的栅格，也不要输出精确坐标。
 * 校园边界外没有任何栅格点时抛错 —— 那种情况应当调用方先拒绝输入，
 * 而不是悄悄给一个校园内的假位置。
 */
export function blurredCampusPoint(point: CampusPoint): CampusPoint {
  let closest: CampusPoint | undefined;
  let distance = Number.POSITIVE_INFINITY;

  for (
    let lat = Math.ceil(CAMPUS_BOUNDS.south * 1000);
    lat <= Math.floor(CAMPUS_BOUNDS.north * 1000);
    lat += 1
  ) {
    for (
      let lng = Math.ceil(CAMPUS_BOUNDS.west * 1000);
      lng <= Math.floor(CAMPUS_BOUNDS.east * 1000);
      lng += 1
    ) {
      const candidate = { latitude: lat / 1000, longitude: lng / 1000 };
      if (!isOnCampus(candidate)) continue;
      const candidateDistance =
        (candidate.latitude - point.latitude) ** 2 +
        ((candidate.longitude - point.longitude) * 0.856) ** 2;
      if (candidateDistance < distance) {
        distance = candidateDistance;
        closest = candidate;
      }
    }
  }

  if (closest === undefined) throw new Error('校园范围内没有可用的模糊位置');
  return closest;
}

/** 三座桥的像素位置是照着底图写的**描述性**名称，不是官方桥名。 */
const BRIDGE_PIXELS = [
  { id: 'bridge-north', name: '生活区北侧步行桥', x: 2030, y: 504 },
  { id: 'bridge-west', name: '物质学院西侧桥', x: 654, y: 1012 },
  { id: 'bridge-south', name: '行政中心西侧桥', x: 1057, y: 1646 },
] as const;

/** OSM way 833243658；源坐标是 WGS84，这里直接给出换算后的 GCJ-02。 */
const MATTER_TOWER: Omit<CampusPlace, 'x' | 'y'> = {
  id: 'matter-tower',
  name: '物质塔',
  latitude: 31.17427198,
  longitude: 121.59620889,
  kind: 'landmark',
};

/**
 * 全部具名地点（官方建筑的 65 项 + 物质塔 + 3 座桥）。
 *
 * 像素坐标**一律**由 [campusPixel] 现算，不直接使用 JSON 里那份 ——
 * 投影只有一条路径，避免两份像素坐标哪天悄悄不一致。
 */
export const CAMPUS_PLACES: CampusPlace[] = [
  ...data.buildings.map((building) => ({
    id: building.id,
    name: building.name,
    ...bdToGcj(building.lng, building.lat),
    kind: 'building' as const,
  })),
  MATTER_TOWER,
  ...BRIDGE_PIXELS.map((bridge) => ({
    ...bridge,
    ...campusCoordinate(bridge.x, bridge.y),
    kind: 'bridge' as const,
  })),
].map((place) => ({ ...place, ...campusPixel(place) }));

/** 建筑（重点地标）名单 —— 底图上默认只显示这些，全部 65 项太挤。 */
const FEATURED_BUILDING_NAMES =
  /^(图书馆|体育馆|体育场|教学中心|行政中心|人字楼|生命学院|创业与管理学院|创意与艺术学院|白玉兰餐厅|物质学院1号楼|信息学院1号楼)$/;

/** 默认展示的地标：重点建筑 + 物质塔 + 三座桥。 */
export const CAMPUS_FEATURED: CampusPlace[] = CAMPUS_PLACES.filter(
  (place) => place.kind !== 'building' || FEATURED_BUILDING_NAMES.test(place.name),
);
