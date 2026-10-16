/**
 * wildlife · 底图配置（规格 §1）
 *
 * ## 方案：静态校园平面图 + 叠加层（规格 §1.2 推荐）
 *
 * 三个理由（规格 §1.2）：
 *   1. 上科大校园是一个约 1km² 的封闭园区，街道图在这个尺度上**信息密度反而更低**；
 *   2. 动物活动点大多在草坪、湖边、宿舍楼下、小径旁 —— 这些在街道图上**根本不存在**；
 *   3. **方案 B 不经过 GCJ-02**，直接绕开本模块最大的技术陷阱（§3）。
 *
 * ## ⚠️ 诚实标注（规格 §1.3 / U1 / U3）
 *
 * 这里下发的是 **P1 自绘示意图的占位配置**：
 *   · `imageUrl` 指向尚未产出的示意图（`original` 许可，无授权风险）；
 *   · `affine` 由**合成控制点**标定而来，**不是**实地测量的结果；
 *   · 真正的 `CampusBasemap` 必须用 ≥6 个实地采集的地标（WGS84 + 像素）
 *     重跑 `calibrateAffine` 后替换，并把 `calibrationRmsePx` 控制在 < 5px。
 *
 * **在拿到书面授权前，禁止把学校官方平面图放进仓库或对象存储**（规格 §1.3）。
 * 这个未知项登记在 U1，本文件不假装它已解决。
 */
import { calibrateAffine, CAMPUS_BBOX, type Affine, type CampusBasemap, type ControlPoint } from './domain/geo';
import { asWgs84, projectToPixels } from './domain/geo';

/** 示意图像素尺寸（1 m ≈ 1 px，覆盖校园约 1km × 1km） */
export const PLACEHOLDER_BASEMAP_WIDTH_PX = 1000;
export const PLACEHOLDER_BASEMAP_HEIGHT_PX = 1000;

/**
 * 占位仿射：局部米 → 像素。
 *
 * `u = x + 500`（东为 +u）、`v = 500 - y`（北为 -v，因为图像 y 轴向下）。
 */
export const PLACEHOLDER_AFFINE: Affine = [1, 0, 500, 0, -1, 500];

/**
 * 占位控制点：**校园内 8 个易辨认地标的示意坐标**（不是实测值）。
 *
 * 像素坐标由占位仿射算出后**取整到整像素** —— 这模拟"用看图工具读像素"的
 * 读数误差（≤0.5px），于是 `calibrateAffine` 会解出 ≈ 占位仿射、
 * `rmsePx` 落在亚像素级。这样 CI 阈值（<5px）是真被检验的，而不是手填一个 0。
 */
const LANDMARK_WGS84: Array<{ name: string; lat: number; lng: number }> = [
  { name: '校园西北角（示意）', lat: 31.1722, lng: 121.5835 },
  { name: '校园东北角（示意）', lat: 31.1725, lng: 121.5962 },
  { name: '校园西南角（示意）', lat: 31.1843, lng: 121.5832 },
  { name: '校园东南角（示意）', lat: 31.1841, lng: 121.5965 },
  { name: '图书馆台阶（示意）', lat: 31.1782, lng: 121.5901 },
  { name: '体育馆入口（示意）', lat: 31.1811, lng: 121.5938 },
  { name: '人工湖东岸（示意）', lat: 31.1768, lng: 121.5949 },
  { name: '一食堂门口（示意）', lat: 31.1802, lng: 121.5864 },
];

export const PLACEHOLDER_CONTROL_POINTS: ControlPoint[] = LANDMARK_WGS84.map((landmark) => {
  const pixels = projectToPixels(asWgs84(landmark.lat, landmark.lng), PLACEHOLDER_AFFINE);
  return {
    wgsLat: landmark.lat,
    wgsLng: landmark.lng,
    // 取整模拟人工读图误差
    px: Math.round(pixels.u),
    py: Math.round(pixels.v),
  };
});

const CALIBRATION = calibrateAffine(PLACEHOLDER_CONTROL_POINTS);

/**
 * 下发的底图配置。
 *
 * ⚠️ `version` 带 `placeholder` 后缀，客户端可以据此显示"示意底图"提示。
 */
export const WILDLIFE_PLACEHOLDER_BASEMAP: CampusBasemap = {
  version: 'placeholder-p1-2026-10-17',
  imageUrl: '/static/wildlife/campus-basemap-placeholder.svg',
  widthPx: PLACEHOLDER_BASEMAP_WIDTH_PX,
  heightPx: PLACEHOLDER_BASEMAP_HEIGHT_PX,
  affine: CALIBRATION.affine,
  calibrationRmsePx: Math.round(CALIBRATION.rmsePx * 1000) / 1000,
  controlPointCount: PLACEHOLDER_CONTROL_POINTS.length,
  attribution: '可达鸭项目组自绘示意图（非测绘精度）',
  license: 'original',
};

/** 校园边界（供客户端画底图范围；与 §3.5 的写入校验用的是同一份常量） */
export const BASEMAP_CAMPUS_BBOX = CAMPUS_BBOX;
