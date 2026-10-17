/**
 * 校园地图 · 底图配置与投影（**OSM 数据底图，方案 B 的替代底图**）
 * =====================================================================
 *
 * 为什么需要这一层（而不是直接把 `apps/web/public/wildlife/basemap.svg` 换掉）：
 *
 * 1. 旧的 `basemap.svg` 是**手绘占位图**，它的控制点是占位经纬度，标定得到的
 *    仿射矩阵只对那张图成立。真实 OSM 底图有**自己的**视口与仿射矩阵，
 *    两者的像素空间不能混用 —— 混用的结果就是"点画在图上但位置整体偏移"。
 * 2. 底图是**可配置资源**（`docs/features/wildlife-map.md` §1.4）。这里给出第二份
 *    配置，消费方（`CampusMapView`）显式选择它；旧的占位底图保持原样，
 *    因此 `/wildlife` 页不会因为这次改动而改变行为。
 *
 * 坐标链路（与 `packages/shared/src/geo/local.ts` **同一套公式**）：
 *
 * ```
 * WGS84 ──toLocalMeters(CAMPUS_ORIGIN)──▶ 局部 ENU 米 (x 东, y 北)
 *       ──线性视口 ──▶ 底图像素 (px 右, py 下)
 * ```
 *
 * **不经过 GCJ-02**：底图是图像像素空间，WGS84 直接线性映射。
 *
 * 数据来源与许可见 `apps/web/public/map/campus-poi.json` 的 `_meta`，
 * 以及 `docs/features/campus-map-data.md`。底图数据是 **ODbL 1.0**，
 * 必须署名 "© OpenStreetMap contributors"。
 */
import {
  fromLocalMeters,
  toLocalMeters,
  type LatLng,
} from '@kedaya/shared';

import type { AffineMatrix } from '@/domain/models/wildlife/basemap';

/** 底图像素坐标 */
export interface CampusPixelPoint {
  readonly px: number;
  readonly py: number;
}

/**
 * OSM 底图配置。
 *
 * `affine` 由 `tools/generate-campus-basemap.py` 生成，与
 * `public/map/campus-basemap.geometry.json` 中的值**逐字对应**；
 * `features/map/campusAssets.test.ts` 会读文件比对，防止手改漂移。
 */
export const CAMPUS_BASEMAP = {
  version: 'campus-osm-2026-10-17',
  widthPx: 1400,
  heightPx: 868,
  /** 米 → 像素：[a,b,c,d,e,f]，px=a·x+b·y+c，py=d·x+e·y+f */
  affine: [0.9410692043, 0, 625.6779147525, 0, -0.9410692043, 410.6417508174] as AffineMatrix,
  pixelsPerMeter: 0.9410692043,
  imageLight: '/map/campus-basemap.svg',
  imageDark: '/map/campus-basemap-dark.svg',
  attribution: '© OpenStreetMap contributors',
  license: 'odbl' as const,
  licenseLabel: 'ODbL 1.0（需署名 + 衍生数据库同许可）',
  /** 数据快照时间（OSM base timestamp，UTC） */
  osmSnapshotAt: '2026-10-17T11:19:01Z',
  /** 生成器路径（文档用，不是运行时依赖） */
  generator: 'apps/web/src/features/map/tools/generate-campus-basemap.py',
} as const;

/** 视口是线性映射，因此逆变换也精确（误差为浮点噪声） */
export function campusWgs84ToPixel(point: LatLng): CampusPixelPoint {
  const { x, y } = toLocalMeters(point);
  const [a, b, c, d, e, f] = CAMPUS_BASEMAP.affine;
  return { px: a * x + b * y + c, py: d * x + e * y + f };
}

/** 底图像素 → WGS84（地图点选上报时用；**不经过 GCJ-02**） */
export function campusPixelToWgs84(pixel: CampusPixelPoint): LatLng {
  const [a, b, c, d, e, f] = CAMPUS_BASEMAP.affine;
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-15) throw new Error('campusPixelToWgs84: 仿射矩阵不可逆');
  const u = pixel.px - c;
  const v = pixel.py - f;
  return fromLocalMeters({ x: (e * u - b * v) / det, y: (-d * u + a * v) / det });
}

/** 底图上 1 米对应多少像素（圆半径换算用） */
export function campusPixelsPerMeter(): number {
  return CAMPUS_BASEMAP.pixelsPerMeter;
}

/** 像素是否落在底图范围内 */
export function isInsideCampusBasemap(pixel: CampusPixelPoint): boolean {
  return (
    Number.isFinite(pixel.px) &&
    Number.isFinite(pixel.py) &&
    pixel.px >= 0 &&
    pixel.py >= 0 &&
    pixel.px <= CAMPUS_BASEMAP.widthPx &&
    pixel.py <= CAMPUS_BASEMAP.heightPx
  );
}
