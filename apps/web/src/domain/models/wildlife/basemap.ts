/**
 * wildlife · 底图与坐标标定（**方案 B：静态校园平面图 + 叠加层**）
 * =====================================================================
 *
 * ## 为什么是方案 B，而不是高德/腾讯瓦片
 *
 * 1. **坐标系陷阱被缩小到零**（规格 §1.2 理由 3、§3.2 第 4 条）：
 *    静态底图用**图像像素空间**，WGS84 通过仿射变换映射到像素，**不经过 GCJ-02**。
 *    如果改用 GCJ-02 瓦片，整张地图上的每个点都要转换，任何一处漏转
 *    都会让"图书馆后草坪的猫"出现在几百米外的教学楼，而且**看起来像数据错了**。
 * 2. **校园尺度下街道图信息密度更低**（规格 §1.2 理由 1、2）：
 *    上科大是约 1 km² 的封闭园区，街道图会渲染出与校园无关的道路与建筑轮廓；
 *    而动物活动点大多在草坪、湖边、宿舍楼下、小径旁 —— 这些在街道图上**根本不存在**。
 * 3. **不依赖第三方地图 key**（无配额 / 无 ToS 约束）。
 *
 * ## 坐标链路（单向、可验证）
 *
 * ```
 * WGS84（唯一真相，服务端/API 一律 WGS84）
 *   ──toLocalMeters()──▶ 局部 ENU 米制平面 (x 向东, y 向北)
 *   ──affine 仿射矩阵──▶ 底图像素 (px, py)，py 向下
 * ```
 *
 * 反向同理：像素 ──affine⁻¹──▶ 米 ──fromLocalMeters()──▶ WGS84。
 * 两个方向都是**线性**的，所以"像素 → 经纬度 → 像素"的往返误差是浮点噪声级
 * （测试断言 < 1 px，实测 ~1e-10 px）。
 *
 * ## 底图是可配置资源（规格 §1.4）
 *
 * 底图**尚未获得学校授权**（规格 §1.3 / 未决问题 U1，状态：**未知**）。
 * 因此这里用 `public/wildlife/basemap.svg` 的**自绘示意底图**（P1 路径，零授权风险），
 * 并用 `isPlaceholder: true` + `placeholderNotice` 让 UI **必须**显示占位声明。
 * 拿到书面授权后只需替换 `imageUrl` / `license` / 控制点，不改任何消费方代码。
 */
import { CAMPUS_ORIGIN, fromLocalMeters, toLocalMeters, type LatLng } from '@kedaya/shared';

/* ------------------------------------------------------------------ *
 * 控制点与仿射标定（规格 §3.4）
 * ------------------------------------------------------------------ */

/**
 * 一个标定控制点：某个**易辨认地标**的 WGS84 坐标 + 它在底图上的像素坐标。
 *
 * ⚠️ 诚实标注：下面这批 WGS84 值是**占位数据**（未实测，规格未决问题 U3）。
 * 像素坐标则与 `public/wildlife/basemap.svg` 中实际绘制的地标位置一一对应。
 * 真实上线前必须由人工实地采集 ≥6 个地标的 WGS84（多次取平均、去掉跳点）。
 */
export interface ControlPoint {
  /** 地标名（人工核对用） */
  readonly name: string;
  /** WGS84 纬度（占位，待实测） */
  readonly wgsLat: number;
  /** WGS84 经度（占位，待实测） */
  readonly wgsLng: number;
  /** 底图上的像素 x（向右） */
  readonly px: number;
  /** 底图上的像素 y（向下） */
  readonly py: number;
}

/**
 * 控制点（8 个 ≥ 规格要求的 6 个），分散在图的四角与中心 ——
 * 都挤在一起会让仿射外推误差爆炸（规格 §3.4 标定流程第 1 步）。
 */
export const WILDLIFE_BASEMAP_CONTROL_POINTS: readonly ControlPoint[] = [
  { name: '图书馆台阶', wgsLat: 31.180417, wgsLng: 121.589599, px: 470, py: 300 },
  { name: '体育馆入口', wgsLat: 31.180824, wgsLng: 121.594169, px: 900, py: 250 },
  { name: '一食堂门口', wgsLat: 31.178451, wgsLng: 121.588190, px: 330, py: 520 },
  { name: '人工湖北岸', wgsLat: 31.178047, wgsLng: 121.592020, px: 700, py: 560 },
  { name: '宿舍区西角', wgsLat: 31.176830, wgsLng: 121.586833, px: 200, py: 700 },
  { name: '东门', wgsLat: 31.179291, wgsLng: 121.596447, px: 1120, py: 420 },
  { name: '行政楼广场', wgsLat: 31.181489, wgsLng: 121.591238, px: 620, py: 180 },
  { name: '南门', wgsLat: 31.176067, wgsLng: 121.590592, px: 560, py: 780 },
];

/**
 * 6 参数仿射矩阵 `[a, b, c, d, e, f]`，把**局部米制平面**映射到**底图像素**：
 *
 * ```
 * [px]   [a b c] [x]
 * [py] = [d e f] [y]
 *               [1]
 * ```
 *
 * 即 `px = a·x + b·y + c`，`py = d·x + e·y + f`。
 * （与规格 §1.4 `CampusBasemap.affine` 的排列一致。）
 */
export type AffineMatrix = readonly [number, number, number, number, number, number];

export interface CalibrationResult {
  readonly affine: AffineMatrix;
  /** 标定残差 RMSE（像素）—— 规格 §1.4 要求 < 5，否则 CI 失败 */
  readonly rmsePx: number;
  readonly controlPointCount: number;
}

/** 解 3×3 线性方程组（列主元高斯消元）。奇异时抛错 —— 宁可失败也不要静默给错矩阵。 */
function solve3x3(matrix: number[][], rhs: number[]): [number, number, number] {
  const m = matrix.map((row, i) => [...row, rhs[i] as number]);
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(m[row]?.[col] ?? 0) > Math.abs(m[pivot]?.[col] ?? 0)) pivot = row;
    }
    const pivotValue = m[pivot]?.[col] ?? 0;
    if (Math.abs(pivotValue) < 1e-12) {
      throw new Error('calibrate: 控制点退化（无法求解仿射矩阵），请检查控制点是否共线');
    }
    [m[col], m[pivot]] = [m[pivot] as number[], m[col] as number[]];
    for (let row = col + 1; row < 3; row += 1) {
      const factor = (m[row]?.[col] ?? 0) / (m[col]?.[col] as number);
      for (let k = col; k < 4; k += 1) {
        m[row]![k] = (m[row]?.[k] as number) - factor * (m[col]?.[k] as number);
      }
    }
  }
  const solution: [number, number, number] = [0, 0, 0];
  for (let row = 2; row >= 0; row -= 1) {
    let sum = m[row]?.[3] as number;
    for (let k = row + 1; k < 3; k += 1) sum -= (m[row]?.[k] as number) * (solution[k] as number);
    solution[row] = sum / (m[row]?.[row] as number);
  }
  return solution;
}

/**
 * 最小二乘标定（规格 §3.4 步骤 3）：控制点 → `affine` + `rmsePx`。
 *
 * 对 `px` 与 `py` 各解一个 3 参数线性最小二乘（正规方程 `θ = (AᵀA)⁻¹Aᵀb`），
 * 设计矩阵 `A = [[x, y, 1], ...]`，其中 `(x, y) = toLocalMeters(wgs)`。
 * 残差对 u 与 v 合并计算：`rmse = sqrt(mean(residual²))`。
 *
 * 注意：**只用线性最小二乘，不做 RANSAC / 稳健回归** ——
 * 控制点是人工采集的少量数据，出问题时应当**重标**（规格 §3.4 第 5 步），
 * 而不是让算法悄悄把可疑点丢掉。
 */
export function calibrate(points: readonly ControlPoint[]): CalibrationResult {
  if (points.length < 3) {
    throw new Error(`calibrate: 至少需要 3 个控制点，收到 ${points.length}`);
  }

  const ata: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const atu = [0, 0, 0];
  const atv = [0, 0, 0];

  for (const point of points) {
    const { x, y } = toLocalMeters({ lat: point.wgsLat, lng: point.wgsLng });
    const row = [x, y, 1];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        ata[i]![j] = (ata[i]?.[j] as number) + (row[i] as number) * (row[j] as number);
      }
      atu[i] = (atu[i] as number) + (row[i] as number) * point.px;
      atv[i] = (atv[i] as number) + (row[i] as number) * point.py;
    }
  }

  const [a, b, c] = solve3x3(ata, atu);
  const [d, e, f] = solve3x3(ata, atv);

  let sumSquares = 0;
  for (const point of points) {
    const { x, y } = toLocalMeters({ lat: point.wgsLat, lng: point.wgsLng });
    const du = a * x + b * y + c - point.px;
    const dv = d * x + e * y + f - point.py;
    sumSquares += du * du + dv * dv;
  }
  const rmsePx = Math.sqrt(sumSquares / (points.length * 2));

  return {
    affine: [a, b, c, d, e, f],
    rmsePx,
    controlPointCount: points.length,
  };
}

/* ------------------------------------------------------------------ *
 * 米 ↔ 像素 ↔ WGS84
 * ------------------------------------------------------------------ */

export interface PixelPoint {
  readonly px: number;
  readonly py: number;
}

export interface MetersPoint {
  readonly x: number;
  readonly y: number;
}

/** 局部米制平面 → 底图像素 */
export function metersToPixel(meters: MetersPoint, affine: AffineMatrix): PixelPoint {
  const [a, b, c, d, e, f] = affine;
  return {
    px: a * meters.x + b * meters.y + c,
    py: d * meters.x + e * meters.y + f,
  };
}

/** 底图像素 → 局部米制平面（解析求逆，精确到浮点） */
export function pixelToMeters(pixel: PixelPoint, affine: AffineMatrix): MetersPoint {
  const [a, b, c, d, e, f] = affine;
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-15) {
    throw new Error('pixelToMeters: 仿射矩阵不可逆（行列式为 0）');
  }
  const u = pixel.px - c;
  const v = pixel.py - f;
  return {
    x: (e * u - b * v) / det,
    y: (-d * u + a * v) / det,
  };
}

/** WGS84 → 底图像素（方案 B 的坐标唯一消费点，**不经过 GCJ-02**） */
export function wgs84ToPixel(
  point: LatLng,
  affine: AffineMatrix = WILDLIFE_BASEMAP.affine,
): PixelPoint {
  return metersToPixel(toLocalMeters(point), affine);
}

/** 底图像素 → WGS84（地图点选上报时使用） */
export function pixelToWgs84(
  pixel: PixelPoint,
  affine: AffineMatrix = WILDLIFE_BASEMAP.affine,
): LatLng {
  return fromLocalMeters(pixelToMeters(pixel, affine));
}

/** 底图上 1 米对应多少像素（用于"30 m 上报 → 25–35 px"这类验收断言） */
export function pixelsPerMeter(affine: AffineMatrix): number {
  const [a, b, , d, e] = affine;
  // 取两个正交基向量长度均值（标定含轻微旋转/错切时仍稳定）
  return (Math.hypot(a, d) + Math.hypot(b, e)) / 2;
}

/* ------------------------------------------------------------------ *
 * 校园边界（规格 §3.5 V5）
 * ------------------------------------------------------------------ */

/**
 * 校园边界框（WGS84）。
 *
 * ⚠️ **占位值，待实测**（规格未决问题 U3）—— 与规格 §3.5 给出的占位值一致。
 * 它的作用不是"精确描述校园"，而是**在写入路径上挡住明显错误的坐标**：
 * 尤其是 `lat`/`lng` 顺序颠倒（上科大 lat≈31、lng≈121，颠倒后坐标跑到地球另一处）。
 */
export const CAMPUS_BBOX = {
  minLat: 31.17,
  maxLat: 31.186,
  minLng: 121.582,
  maxLng: 121.598,
} as const;

/** 校园外坐标 —— 写入路径必须拒绝（规格 §3.5：`COORDINATE_OUT_OF_CAMPUS` / 422） */
export class CoordinateOutOfCampusError extends Error {
  readonly reason = 'COORDINATE_OUT_OF_CAMPUS';
  readonly point: LatLng;

  constructor(point: LatLng) {
    super(
      `坐标不在校园范围内（lat ${point.lat}, lng ${point.lng}）—— 若刚用地图点选，请重选；若来自 GPS，请检查是否用了 WGS84。`,
    );
    this.name = 'CoordinateOutOfCampusError';
    this.point = point;
  }
}

/** 坐标是否落在校园边界框内 */
export function isInCampus(point: LatLng): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= CAMPUS_BBOX.minLat &&
    point.lat <= CAMPUS_BBOX.maxLat &&
    point.lng >= CAMPUS_BBOX.minLng &&
    point.lng <= CAMPUS_BBOX.maxLng
  );
}

/** 所有写入路径（上报 / 个体 / 区域）都必须过这里 */
export function assertInCampus(point: LatLng): void {
  if (!isInCampus(point)) throw new CoordinateOutOfCampusError(point);
}

/* ------------------------------------------------------------------ *
 * 底图配置（规格 §1.4：底图是可配置资源）
 * ------------------------------------------------------------------ */

export type BasemapLicense = 'original' | 'odbl' | 'school-authorized';

export interface CampusBasemap {
  /** 版本号，用于缓存失效 */
  readonly version: string;
  /** 底图图片 URL */
  readonly imageUrl: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly affine: AffineMatrix;
  /** 标定残差 RMSE（像素），必须 < 5 */
  readonly calibrationRmsePx: number;
  /** 控制点数量，必须 >= 6 */
  readonly controlPointCount: number;
  /** 署名文本（P2 ODbL 时必须是 OSM 署名） */
  readonly attribution: string;
  readonly license: BasemapLicense;
  /** 是否占位底图（自绘示意）—— UI 必须据此显示占位声明 */
  readonly isPlaceholder: boolean;
  readonly placeholderNotice: string;
}

/**
 * 占位底图声明（**必须在 UI 可见**，不允许只在代码注释里说）。
 * 规格 §1.3 要求对"校园平面图尚未获得授权"这一未知项**诚实标注**。
 */
export const BASEMAP_PLACEHOLDER_NOTICE =
  '占位底图：自绘示意图（非测绘精度）。校园官方平面图尚未获得学校授权（授权状态：未知），拿到书面授权后替换。';

/** 当前底图配置（唯一真相；替换底图时只改这里 + 控制点） */
export const WILDLIFE_BASEMAP: CampusBasemap = (() => {
  const calibration = calibrate(WILDLIFE_BASEMAP_CONTROL_POINTS);
  return {
    version: 'placeholder-v1',
    imageUrl: '/wildlife/basemap.svg',
    widthPx: 1200,
    heightPx: 800,
    affine: calibration.affine,
    calibrationRmsePx: calibration.rmsePx,
    controlPointCount: calibration.controlPointCount,
    attribution: '可达鸭项目自绘示意图（原创）',
    license: 'original',
    isPlaceholder: true,
    placeholderNotice: BASEMAP_PLACEHOLDER_NOTICE,
  };
})();

/**
 * 标定约束检查（规格 §1.4 / 验收 T5）—— 由 CI/单测执行，不是运行时装饰。
 *
 * - `calibrationRmsePx < 5`
 * - `controlPointCount >= 6`
 * - `license === 'odbl'` → `attribution` 非空
 * - `license === 'school-authorized'` → 必须有 `docs/legal/basemap-authorization.md`
 *   （Web 侧无法读仓库外文件，因此这里只断言"不得静默声称已授权"：
 *    必须由人工提供授权记录，见下）
 */
export function basemapCalibrationProblems(
  basemap: CampusBasemap = WILDLIFE_BASEMAP,
): string[] {
  const problems: string[] = [];
  if (!(basemap.calibrationRmsePx < 5)) {
    problems.push(`标定残差 RMSE ${basemap.calibrationRmsePx.toFixed(3)} px ≥ 5，必须重标或换图`);
  }
  if (basemap.controlPointCount < 6) {
    problems.push(`控制点数量 ${basemap.controlPointCount} < 6`);
  }
  if (basemap.license === 'odbl' && basemap.attribution.trim() === '') {
    problems.push('ODbL 底图必须提供 attribution（OSM 署名）');
  }
  if (basemap.license === 'school-authorized' && basemap.attribution.trim() === '') {
    problems.push('school-authorized 底图必须记录授权来源（attribution / docs/legal/basemap-authorization.md）');
  }
  if (!(basemap.widthPx > 0) || !(basemap.heightPx > 0)) {
    problems.push('底图像素尺寸必须为正');
  }
  if (basemap.imageUrl.trim() === '') problems.push('底图 imageUrl 不能为空');
  return problems;
}

/**
 * `GET /wildlife/basemap` 的**契约形状**（规格 §1.4）——
 * 只有服务端能给的字段，**不含** `isPlaceholder` / `placeholderNotice`
 * （那是 Web 端根据 `license` 派生的展示信息）。
 */
export interface CampusBasemapResponse {
  version: string;
  imageUrl: string;
  widthPx: number;
  heightPx: number;
  affine: AffineMatrix;
  calibrationRmsePx: number;
  controlPointCount: number;
  attribution: string;
  license: BasemapLicense;
}

/**
 * 契约响应 → Web 侧底图模型。
 *
 * `isPlaceholder` 的判定：**只有 `school-authorized` 才算非占位**。
 * 这样"学校授权"这个法务事项就变成了一个**可被代码检查**的前置条件，
 * 而不是靠人记住（参考规格 §1.4 把授权做成 CI 规则的同类做法）。
 */
export function resolveCampusBasemap(response: CampusBasemapResponse): CampusBasemap {
  const isPlaceholder = response.license !== 'school-authorized';
  return {
    ...response,
    isPlaceholder,
    placeholderNotice: isPlaceholder ? BASEMAP_PLACEHOLDER_NOTICE : '',
  };
}

/** 像素是否落在底图范围内（点选上报时用于拒绝画布外的点击） */
export function isInsideBasemap(pixel: PixelPoint, basemap: CampusBasemap = WILDLIFE_BASEMAP): boolean {
  return (
    Number.isFinite(pixel.px) &&
    Number.isFinite(pixel.py) &&
    pixel.px >= 0 &&
    pixel.py >= 0 &&
    pixel.px <= basemap.widthPx &&
    pixel.py <= basemap.heightPx
  );
}

/** 局部 ENU 原点（与 `@kedaya/shared` 同一真相，此处导出便于文档与测试引用） */
export const WILDLIFE_ENU_ORIGIN: LatLng = CAMPUS_ORIGIN;
