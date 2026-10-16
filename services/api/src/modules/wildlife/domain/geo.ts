/**
 * wildlife · 坐标系与底图标定（规格 §3）
 *
 * **本节是本模块最容易出错的地方**，因此把两件事做成"类型上不可能做错"：
 *
 *   1. **WGS84 是唯一真相**（规格 §3.2）。持久化列、请求体、响应体的坐标语义
 *      都是 WGS84；`Gcj02Point` 只能由 `toGcj02()` 产出，而 `<map>` 组件需要的
 *      正是 `Gcj02Point` —— 于是"忘记转换"在编译期就失败，而不是在线上偏移 500 米。
 *   2. **所有写入路径必须过 `assertInCampus()`**（规格 §3.5 V5）。
 *      `lat`/`lng` 顺序颠倒是极高频错误，在上科大（lat≈31.2, lng≈121.6）
 *      颠倒后会跑到地球另一处 —— 校园边界断言能立刻抓住它。
 *
 * ⚠️ 诚实标注：`CAMPUS_BBOX` 与 `CAMPUS_ORIGIN` 是**占位值**（规格 U3），
 * 必须由实地测量替换。它们的作用是"抓住数量级错误"，不是测绘精度。
 */
import { CAMPUS_ORIGIN, METERS_PER_DEG_LAT, gcj02ToWgs84, metersPerDegLng, wgs84ToGcj02 } from '@kedaya/shared';
import { ValidationError } from '../../../common/errors/app-error';

/* ------------------------------------------------------------------ *
 * 1. 类型自证（规格 §3.2 第 5 条）
 * ------------------------------------------------------------------ */

/** WGS84（GPS 原始坐标系）。**唯一允许入库/上传的坐标语义** */
export interface Wgs84Point {
  readonly datum: 'WGS84';
  lat: number;
  lng: number;
}

/** GCJ-02（"火星坐标"）。只在渲染前一刻存在于内存中，**绝不入库** */
export interface Gcj02Point {
  readonly datum: 'GCJ02';
  lat: number;
  lng: number;
}

/** 裸经纬度 → WGS84 点（唯一入口，避免到处手写 `{ datum: 'WGS84' }`） */
export function asWgs84(lat: number, lng: number): Wgs84Point {
  return { datum: 'WGS84', lat, lng };
}

/**
 * 去掉 datum 标记，喂给 `@kedaya/shared/geo` 的纯数学函数。
 *
 * 参数刻意是**结构类型**（而不是 `Wgs84Point`）：这个函数只做"拆掉标记"，
 * 对 GCJ-02 点同样成立（例如"算一下 GCJ-02 与 WGS84 的偏移量"），
 * 而把它限定成 Wgs84Point 只会逼调用方到处写 `asWgs84(gcj.lat, gcj.lng)` 这种噪音。
 * **它不构成"把 GCJ-02 当 WGS84 用"的风险**：产出的是一个裸 `{lat,lng}`，
 * 没有 datum 标记，进不了任何要求 `Wgs84Point` 的写入路径。
 */
export function toLatLng(p: { lat: number; lng: number }): { lat: number; lng: number } {
  return { lat: p.lat, lng: p.lng };
}

/**
 * 只有这个函数能产出 `Gcj02Point`（规格 §3.2）。
 *
 * 消费点只有两个（规格 §3.2 第 3 条）：
 *   A. `<map>` 组件的 markers/polyline → 需要 GCJ-02
 *   B. `wx.openLocation()` → **要求** GCJ-02
 * 静态底图方案（§1.2 推荐）**不经过 GCJ-02**，走 `projectToPixels()`。
 */
export function toGcj02(p: Wgs84Point): Gcj02Point {
  const out = wgs84ToGcj02(p.lat, p.lng);
  return { datum: 'GCJ02', lat: out.lat, lng: out.lng };
}

/** GCJ-02 → WGS84（反向消费点：客户端从地图点选拿到的坐标） */
export function toWgs84(p: Gcj02Point): Wgs84Point {
  const out = gcj02ToWgs84(p.lat, p.lng);
  return { datum: 'WGS84', lat: out.lat, lng: out.lng };
}

/* ------------------------------------------------------------------ *
 * 2. 校园边界（规格 §3.5 V5）
 * ------------------------------------------------------------------ */

/**
 * 上科大张江校区边界框（WGS84）。
 *
 * ⚠️ **占位值，待实测**（规格 U3）。它的用途是**拒绝数量级错误**：
 *   · 校园外坐标 → `COORDINATE_OUT_OF_CAMPUS`
 *   · lat/lng 互换（(121.59, 31.18) 这种）→ 同样被拒绝
 */
export const CAMPUS_BBOX = {
  minLat: 31.17,
  maxLat: 31.186,
  minLng: 121.582,
  maxLng: 121.598,
} as const;

export function isInCampus(p: { lat: number; lng: number }): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= CAMPUS_BBOX.minLat &&
    p.lat <= CAMPUS_BBOX.maxLat &&
    p.lng >= CAMPUS_BBOX.minLng &&
    p.lng <= CAMPUS_BBOX.maxLng
  );
}

/**
 * 所有写入路径（上报 / 个体 / 区域）都必须过这里（规格 §3.5）。
 * 失败返回 `VALIDATION_FAILED` + `details.reason = 'COORDINATE_OUT_OF_CAMPUS'`（规格 §10.3）。
 */
export function assertInCampus(p: { lat: number; lng: number }): void {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
    throw new ValidationError('坐标必须是有限数值', { reason: 'COORDINATE_OUT_OF_CAMPUS' });
  }
  if (!isInCampus(p)) {
    throw new ValidationError('该坐标不在校园范围内', {
      reason: 'COORDINATE_OUT_OF_CAMPUS',
      // 不回显原始坐标：错误响应也是泄漏面（规格 §9.1 A3）
      bbox: CAMPUS_BBOX,
    });
  }
}

/* ------------------------------------------------------------------ *
 * 3. 静态底图与仿射标定（规格 §3.4 / §1.4）
 * ------------------------------------------------------------------ */

/** 底图许可标识。`school-authorized` 需要 `docs/legal/basemap-authorization.md` 佐证 */
export type BasemapLicense = 'original' | 'odbl' | 'school-authorized';

/** 底图配置（规格 §1.4 的 `CampusBasemap`） */
export interface CampusBasemap {
  /** 版本号，用于缓存失效 */
  version: string;
  /** 底图图片 URL（对象存储，经 CDN） */
  imageUrl: string;
  widthPx: number;
  heightPx: number;
  /** 仿射标定：**局部米制平面 → 像素**，6 个数按 [a,b,c,d,e,f] 排列 */
  affine: Affine;
  /** 标定残差 RMSE（像素），必须 < 5，否则 CI 失败 */
  calibrationRmsePx: number;
  /** 控制点数量，必须 >= 6 */
  controlPointCount: number;
  attribution: string;
  license: BasemapLicense;
}

/** `[a,b,c,d,e,f]`：u = a·x + b·y + c，v = d·x + e·y + f（x,y 为局部米） */
export type Affine = readonly [number, number, number, number, number, number];

/** 标定用控制点：地标的 WGS84 坐标 + 它在底图上的像素坐标 */
export interface ControlPoint {
  wgsLat: number;
  wgsLng: number;
  px: number;
  py: number;
}

/** CI 阈值（规格 §1.4 / T5） */
export const BASEMAP_MAX_RMSE_PX = 5;
export const BASEMAP_MIN_CONTROL_POINTS = 6;

/** 3×3 线性方程组求解（克拉默法则）。标定只需 3 个未知数，够用且无依赖 */
function solve3(m: number[][], b: number[]): [number, number, number] {
  const det = (a: number[][]): number =>
    a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) -
    a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) +
    a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);

  // ⚠️ 奇异性判定必须**相对化**：正规方程 AᵀA 的元素量级取决于控制点的
  // 坐标尺度（米、上千），绝对阈值 1e-12 会让"共线但数值大"的矩阵蒙混过关。
  // 做法：整体除以最大元素后判行列式 —— 这样阈值与量纲无关。
  const scale = Math.max(...m.flat().map((v) => Math.abs(v)));
  const normalized = scale > 0 ? m.map((row) => row.map((v) => v / scale)) : m;
  const d = det(normalized);
  if (Math.abs(d) < 1e-12) {
    // 控制点共线/重合 → 无法定标。宁可报错，也不要一个悄悄外推爆炸的矩阵
    throw new ValidationError('底图标定失败：控制点退化（共线或重合），无法求解仿射变换', {
      reason: 'BASEMAP_CALIBRATION_DEGENERATE',
    });
  }
  const dm = det(m);
  const replace = (col: number): number[][] =>
    m.map((row, i) => row.map((v, j) => (j === col ? b[i]! : v)));

  return [det(replace(0)) / dm, det(replace(1)) / dm, det(replace(2)) / dm];
}

/**
 * 最小二乘标定 6 参数仿射（规格 §3.4 步骤 3）。
 *
 * 对 u 与 v **各解一个 3 参数线性最小二乘**：
 *   设计矩阵 A = [[x, y, 1], ...]，目标 b = [px, ...] 与 [py, ...]
 *   正规方程 θ = (AᵀA)⁻¹Aᵀb
 * 残差按 u 与 v **合并**计算：rmse = sqrt(Σ(ru²+rv²) / 2n)。
 */
export function calibrateAffine(points: readonly ControlPoint[]): {
  affine: Affine;
  rmsePx: number;
} {
  if (points.length < BASEMAP_MIN_CONTROL_POINTS) {
    throw new ValidationError(
      `底图标定至少需要 ${BASEMAP_MIN_CONTROL_POINTS} 个控制点，收到 ${points.length} 个`,
      { reason: 'BASEMAP_TOO_FEW_CONTROL_POINTS', required: BASEMAP_MIN_CONTROL_POINTS },
    );
  }

  const rows = points.map((p) => {
    const x = (p.wgsLng - CAMPUS_ORIGIN.lng) * metersPerDegLng(CAMPUS_ORIGIN.lat);
    const y = (p.wgsLat - CAMPUS_ORIGIN.lat) * METERS_PER_DEG_LAT;
    return { x, y, px: p.px, py: p.py };
  });

  // 正规方程 AᵀA（3×3）与 Aᵀb
  const ata = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const atbu = [0, 0, 0];
  const atbv = [0, 0, 0];
  for (const r of rows) {
    const a = [r.x, r.y, 1];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) ata[i]![j]! += a[i]! * a[j]!;
      atbu[i]! += a[i]! * r.px;
      atbv[i]! += a[i]! * r.py;
    }
  }

  const [a, b, c] = solve3(ata, atbu);
  const [d, e, f] = solve3(ata, atbv);
  const affine: Affine = [a, b, c, d, e, f];

  let sum = 0;
  for (const r of rows) {
    const ru = a! * r.x + b! * r.y + c! - r.px;
    const rv = d! * r.x + e! * r.y + f! - r.py;
    sum += ru * ru + rv * rv;
  }
  const rmsePx = Math.sqrt(sum / (2 * rows.length));

  return { affine, rmsePx };
}

/** WGS84 → 底图像素（规格 §3.4 步骤 2）。静态底图方案**不经过 GCJ-02** */
export function projectToPixels(p: Wgs84Point, affine: Affine): { u: number; v: number } {
  const x = (p.lng - CAMPUS_ORIGIN.lng) * metersPerDegLng(CAMPUS_ORIGIN.lat);
  const y = (p.lat - CAMPUS_ORIGIN.lat) * METERS_PER_DEG_LAT;
  const [a, b, c, d, e, f] = affine;
  return { u: a * x + b * y + c, v: d * x + e * y + f };
}

/**
 * 底图配置的机器可检查前置条件（规格 §1.4）。
 *
 * 把"学校授权"这个法务事项变成**机器可检查的**条件，而不是靠人记住。
 * 注意：`school-authorized` 还需要 `docs/legal/basemap-authorization.md` 存在 ——
 * 那半条规则属于 CI（构建期文件检查），运行期只能校验数值与署名一致性。
 */
export function assertBasemap(basemap: CampusBasemap): void {
  if (!(basemap.calibrationRmsePx < BASEMAP_MAX_RMSE_PX)) {
    throw new ValidationError(
      `底图标定残差 ${basemap.calibrationRmsePx}px 未达到 < ${BASEMAP_MAX_RMSE_PX}px 的要求`,
      { reason: 'BASEMAP_RMSE_TOO_HIGH', rmsePx: basemap.calibrationRmsePx },
    );
  }
  if (basemap.controlPointCount < BASEMAP_MIN_CONTROL_POINTS) {
    throw new ValidationError(
      `底图控制点数量 ${basemap.controlPointCount} 少于 ${BASEMAP_MIN_CONTROL_POINTS} 个`,
      { reason: 'BASEMAP_TOO_FEW_CONTROL_POINTS', controlPointCount: basemap.controlPointCount },
    );
  }
  if (basemap.license === 'odbl' && basemap.attribution.trim() === '') {
    throw new ValidationError('ODbL 底图必须署名（规格 §1.4）', {
      reason: 'BASEMAP_ATTRIBUTION_REQUIRED',
    });
  }
  if (basemap.affine.length !== 6 || basemap.affine.some((n) => !Number.isFinite(n))) {
    throw new ValidationError('仿射矩阵必须是 6 个有限数 [a,b,c,d,e,f]', {
      reason: 'BASEMAP_AFFINE_INVALID',
    });
  }
}
