/**
 * wildlife · 热点与**推断轨迹**（规格 §2.3 / §2.4 / §6）
 *
 * ## ⚠️ 本文件最重要的约束：轨迹是"推断"，不是"实测路径"
 *
 * 我们的数据来自**同学偶发上报**，不是 GPS 项圈。因此：
 * - **无法**重建真实运动路径；**无法**知道动物在两次上报之间去了哪；
 * - 上报密度直接决定轨迹质量，且时空分布极不均匀（白天多夜里少）。
 *
 * 所以：
 * - `WildlifeTrack.isInferred` **恒为 `true`**（字段存在的唯一目的就是让客户端
 *   **无法忘记**标注它，规格 §2.4）；
 * - `disclaimer` 由**服务端下发**（规格 §10.5）—— 这样文案不可能被某个端"忘记加"；
 *   本文件提供的 `TRACK_FALLBACK_DISCLAIMER` 只在服务端漏发时兜底；
 * - UI 上**禁止**出现"这只猫的路线"这类文案，只能写"基于 N 次上报推断的活动范围"。
 */
import type { LatLng } from '@kedaya/shared';

/* ------------------------------------------------------------------ *
 * 热点（`WildlifeSpot` —— 算法聚类产出，**只读**）
 * ------------------------------------------------------------------ */

export interface WildlifeSpot {
  id: string;
  speciesId: string;
  speciesNameZh: string;
  zoneId?: string | null;
  /** 聚类质心（**已模糊化**） */
  centroid: LatLng;
  /** 95 分位半径（米） */
  radiusM: number;
  /** 参与聚类的观测数（原始条数） */
  sightingCount: number;
  /** **去重后的上报人数**（反作弊：同一人多次上报只计 1，规格 §6.2 ②） */
  distinctReporters: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** 24 小时分布直方图（"常见出没时段"） */
  hourHistogram: number[];
  /** 0.000–1.000 聚类可信度 */
  confidence: number;
  computedAt: string;
  /** 恒为 true：这是**历史聚合**，不是实时位置（规格 §8.1 E10） */
  isAggregated: true;
  /** 聚合延迟小时数（契约的一部分：让客户端**无法**把热点当实时位置展示） */
  aggregationDelayHours: number;
}

export const DEFAULT_AGGREGATION_DELAY_HOURS = 24;

/** 空直方图（24 桶），用于容错 */
export function emptyHourHistogram(): number[] {
  return Array.from({ length: 24 }, () => 0);
}

/** 直方图是否可用（长度 24 且至少有一个非零桶） */
export function isHourHistogramUsable(histogram: readonly number[]): boolean {
  return histogram.length === 24 && histogram.some((v) => v > 0);
}

/** 高峰时段（按小时桶降序取前 N 个，返回 `HH:00` 形式，供"常见出没时段"展示） */
export function peakHours(histogram: readonly number[], topN = 3): string[] {
  if (!isHourHistogramUsable(histogram)) return [];
  return histogram
    .map((count, hour) => ({ hour, count }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.hour - b.hour)
    .slice(0, topN)
    .map((entry) => `${String(entry.hour).padStart(2, '0')}:00`);
}

/** 常见出没时段文案 */
export function peakHoursLabel(histogram: readonly number[], topN = 3): string {
  const peaks = peakHours(histogram, topN);
  return peaks.length > 0 ? `常见出没时段：${peaks.join('、')}` : '出没时段数据不足';
}

/** 聚类可信度文案（0.000–1.000） */
export function spotConfidenceLabel(confidence: number): string {
  const percent = Math.round(Math.min(1, Math.max(0, confidence)) * 100);
  if (percent >= 70) return `可信度较高（${percent}%）`;
  if (percent >= 40) return `可信度中等（${percent}%）`;
  return `可信度较低（${percent}%）`;
}

/** 反作弊提示：上报条数 ≫ 人数时，说明可能有人在刷点（规格 §6.2 ②） */
export function spotReporterNotice(spot: Pick<WildlifeSpot, 'sightingCount' | 'distinctReporters'>): string {
  return `${spot.sightingCount} 次上报 · ${spot.distinctReporters} 位不同同学（同一人多次上报只计 1 次）`;
}

/** 热点是否满足公开条件（k-匿名：≥3 位不同上报人，规格 §9.3 ④） */
export const K_ANONYMITY_MIN_REPORTERS = 3;

export function spotMeetsKAnonymity(spot: Pick<WildlifeSpot, 'distinctReporters'>): boolean {
  return spot.distinctReporters >= K_ANONYMITY_MIN_REPORTERS;
}

/* ------------------------------------------------------------------ *
 * 推断轨迹（`WildlifeTrack`）
 * ------------------------------------------------------------------ */

export interface GeoJsonLineString {
  type: 'LineString';
  /** `[lng, lat]` 顺序（GeoJSON 规范） */
  coordinates: Array<[number, number]>;
}

export type TrackMethod = 'dbscan-chain';

export interface WildlifeTrack {
  id: string;
  speciesId: string;
  speciesNameZh: string;
  individualId?: string | null;
  /** 途经的 `WildlifeSpot`，按时间排序 */
  spotIds: string[];
  /** 折线（**已模糊化**） */
  path: GeoJsonLineString;
  totalDistanceM: number;
  spanStartAt: string;
  spanEndAt: string;
  sightingCount: number;
  method: TrackMethod;
  confidence: number;
  /** **恒为 `true`**（规格 §2.4） */
  isInferred: true;
  /** 服务端下发的免责声明（规格 §10.5） */
  disclaimer: string;
  computedAt: string;
}

/** 服务端漏发 `disclaimer` 时的兜底文案（正常路径不会用到） */
export const TRACK_FALLBACK_DISCLAIMER =
  '本轨迹由同学偶发上报推断得出，并非实测运动路径；两次上报之间的位置未知。';

/** UI 上必须显著展示的短标签 */
export const INFERRED_TRACK_LABEL = '推断轨迹，非实测路径';

/** 由 N 次上报推断的活动范围（**禁止**写成"这只动物的路线"） */
export function trackSummaryLabel(track: Pick<WildlifeTrack, 'sightingCount'>): string {
  return `基于 ${track.sightingCount} 次上报推断的活动范围`;
}

/** 轨迹详情的一句话说明（含方法名与置信度） */
export function trackMethodLabel(track: Pick<WildlifeTrack, 'method'>): string {
  return track.method === 'dbscan-chain'
    ? 'DBSCAN 聚类 + 走廊连接（只连直线，不做插值/平滑/地图匹配）'
    : track.method;
}

/** 时间跨度文案 */
export function trackSpanLabel(track: Pick<WildlifeTrack, 'spanStartAt' | 'spanEndAt'>): string {
  const start = new Date(track.spanStartAt);
  const end = new Date(track.spanEndAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '时间跨度未知';
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
  return `${days} 天内的观测聚合`;
}

/** 轨迹折线的 WGS84 点（`[lng, lat]` → `{lat, lng}`） */
export function trackPathPoints(track: Pick<WildlifeTrack, 'path'>): LatLng[] {
  return track.path.coordinates
    .filter((pair) => pair.length >= 2)
    .map((pair) => ({ lng: pair[0] as number, lat: pair[1] as number }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

/** 轨迹是否有可渲染的折线（< 2 点无法成线） */
export function trackHasRenderablePath(track: Pick<WildlifeTrack, 'path'>): boolean {
  return trackPathPoints(track).length >= 2;
}

/** 折线长度（米），用于与 `totalDistanceM` 交叉核对（两者差异 > 20% 视为可疑） */
export function isTrackDistanceConsistent(
  track: Pick<WildlifeTrack, 'path' | 'totalDistanceM'>,
): boolean {
  const points = trackPathPoints(track);
  if (points.length < 2) return true;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((points[0]!.lat * Math.PI) / 180);
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = (points[i]!.lng - points[i - 1]!.lng) * metersPerDegLng;
    const dy = (points[i]!.lat - points[i - 1]!.lat) * metersPerDegLat;
    sum += Math.hypot(dx, dy);
  }
  if (track.totalDistanceM <= 0) return sum <= 1;
  return Math.abs(sum - track.totalDistanceM) / track.totalDistanceM <= 0.2;
}

/* ------------------------------------------------------------------ *
 * 命名个体（`WildlifeIndividual` —— 规格 §5.6(b) "给个体起个名字"）
 * ------------------------------------------------------------------ */

export interface WildlifeIndividual {
  id: string;
  name: string;
  speciesId: string;
  speciesNameZh: string;
  description?: string | null;
  coverPhotoUrl?: string | null;
  status: 'PENDING' | 'PUBLISHED' | 'REJECTED';
  isActive: boolean;
}

export const INDIVIDUAL_NAME_MAX = 24;

/**
 * 个体名校验（规格 §2.8）：≤24 字、非空、且过敏感词。
 * 这里只做**长度与空值**；内容安全由服务端负责（客户端敏感词表永远不完整）。
 */
export function validateIndividualName(name: string): string[] {
  const problems: string[] = [];
  const trimmed = name.trim();
  if (trimmed === '') problems.push('个体名不能为空');
  if (trimmed.length > INDIVIDUAL_NAME_MAX) {
    problems.push(`个体名不超过 ${INDIVIDUAL_NAME_MAX} 字`);
  }
  return problems;
}

/** 该物种下已发布的个体（供"这是某只熟悉的动物吗？"下拉） */
export function individualsForSpecies(
  individuals: readonly WildlifeIndividual[],
  speciesId: string,
): WildlifeIndividual[] {
  return individuals.filter(
    (individual) => individual.speciesId === speciesId && individual.status === 'PUBLISHED' && individual.isActive,
  );
}

/** 个体选项标签（带物种名，避免重名歧义） */
export function individualOptionLabel(individual: WildlifeIndividual): string {
  return `${individual.name}（${individual.speciesNameZh}）`;
}
