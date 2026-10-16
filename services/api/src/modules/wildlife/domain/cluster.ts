/**
 * wildlife · 活动热点与**推断轨迹**生成（规格 §6）
 *
 * ## 必须先说清的限制（规格 §6.1）
 *
 * 我们的数据是"同学偶发上报"，**不是 GPS 项圈**。因此：
 *   · **无法**重建真实运动路径；
 *   · **无法**知道动物在两次上报之间去了哪；
 *   · 上报密度直接决定轨迹质量，且时间/空间上极不均匀。
 *
 * 所以生成的叫"**推断**活动范围与走廊"，不叫"轨迹"。
 * `WildlifeTrack.isInferred` **恒为 true**，且服务端下发 `disclaimer` ——
 * 把合规文案变成接口契约的一部分，让某个端**无法忘记加**。
 *
 * ## 明确不做的事（规格 §6.2 ④）
 *
 *   · ❌ 不做路径插值 / 样条平滑 —— 那会**编造**动物没走过的位置；
 *   · ❌ 不做速度推断 —— 上报时间不是观测时间（用户可能几小时后才上传）；
 *   · ❌ 不做地图匹配到步道 —— 校园没有步道网络数据，且会强化"这是真实路径"的错觉。
 *
 * **只连直线、只连可信的相邻簇。宁可轨迹断裂，也不编造。**
 *
 * ## 为什么用 DBSCAN 而不是 k-means（规格 §6.2 ②）
 *
 * 我们**不知道**有几个活动区域（k-means 要求预先给定 k），上报点会形成
 * **任意形状**的簇（沿湖边、沿步道），并且有大量**噪声点**。DBSCAN 正好处理这三点。
 */
import {
  CAMPUS_ORIGIN,
  bearingDegrees,
  distanceMeters,
  fromLocalMeters,
  toLocalMeters,
  type LatLng,
} from '@kedaya/shared';

/* ------------------------------------------------------------------ *
 * 参数（规格 §6.2）
 * ------------------------------------------------------------------ */

export interface ClusterParams {
  /** 邻域半径（米） */
  epsM: number;
  /** 核心点的最小邻居数 */
  minPts: number;
}

/** 校园尺度默认值。`epsM` 约为校园建筑间距的量级，**必须可配置** */
export const DEFAULT_CLUSTER: ClusterParams = { epsM: 50, minPts: 3 };

/** 时间窗口长度（天） */
export const WINDOW_DAYS = 7;
/** 滑窗步长（天） */
export const WINDOW_STEP_DAYS = 1;
/** 窗口内最少点数：少于 5 个点不出轨迹（避免"两点连一线"的伪轨迹） */
export const WINDOW_MIN_POINTS = 5;
/** 走廊连接的距离上限（米） */
export const CHAIN_MAX_DISTANCE_M = 300;
/** 走廊连接的时间间隔上限（小时） */
export const CHAIN_MAX_GAP_HOURS = 6;
/** 算法版本号（写进结果，用于可复现） */
export const ALGORITHM_VERSION = 'dbscan-v1';

/** 反作弊：达到"满置信度"所需的人数 */
export const CONFIDENCE_FULL_REPORTERS = 5;
/** 反作弊：达到"满置信度"所需的观测条数 */
export const CONFIDENCE_FULL_SIGHTINGS = 10;

/* ------------------------------------------------------------------ *
 * DBSCAN（规格 §6.2 ②）
 * ------------------------------------------------------------------ */

export interface DbscanResult {
  /** 每簇是成员在输入数组中的下标 */
  clusters: number[][];
  /** 噪声点的下标 */
  noise: number[];
}

/**
 * DBSCAN。距离用 haversine 球面距离（校园 1km 尺度下与平面距离差异 < 1cm）。
 *
 * 实现要点：用**网格索引**（cell = epsM）加速邻域查询，避免 O(n²)。
 * 输入顺序决定簇的输出顺序，因此调用方必须传入**稳定排序**的点列，
 * 这样"同输入同输出"（T19 可复现）成立。
 */
export function dbscan(points: readonly LatLng[], params: ClusterParams = DEFAULT_CLUSTER): DbscanResult {
  const { epsM, minPts } = params;
  if (!(epsM > 0) || !Number.isInteger(minPts) || minPts < 1) {
    throw new RangeError(`dbscan: 参数非法 epsM=${epsM} minPts=${minPts}`);
  }

  const n = points.length;
  const cellOf = (p: LatLng): string => {
    const { x, y } = toLocalMeters(p, CAMPUS_ORIGIN);
    return `${Math.floor(x / epsM)}:${Math.floor(y / epsM)}`;
  };

  const grid = new Map<string, number[]>();
  points.forEach((p, i) => {
    const key = cellOf(p);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  });

  const neighborsOf = (i: number): number[] => {
    const p = points[i]!;
    const { x, y } = toLocalMeters(p, CAMPUS_ORIGIN);
    const cx = Math.floor(x / epsM);
    const cy = Math.floor(y / epsM);
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = grid.get(`${cx + dx}:${cy + dy}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j === i) continue;
          if (distanceMeters(p, points[j]!) <= epsM) out.push(j);
        }
      }
    }
    return out;
  };

  const UNVISITED = 0;
  const NOISE = 1;
  const CLUSTERED = 2;
  const state = new Array<number>(n).fill(UNVISITED);
  const clusters: number[][] = [];
  const noise: number[] = [];

  for (let i = 0; i < n; i += 1) {
    if (state[i] !== UNVISITED) continue;
    const seeds = neighborsOf(i);
    if (seeds.length + 1 < minPts) {
      state[i] = NOISE;
      noise.push(i);
      continue;
    }

    const cluster: number[] = [i];
    state[i] = CLUSTERED;
    const queue = [...seeds];
    while (queue.length > 0) {
      const j = queue.shift()!;
      if (state[j] === NOISE) {
        // 边界点：被核心点吸收
        state[j] = CLUSTERED;
        cluster.push(j);
        continue;
      }
      if (state[j] !== UNVISITED) continue;
      state[j] = CLUSTERED;
      cluster.push(j);
      const jNeighbors = neighborsOf(j);
      if (jNeighbors.length + 1 >= minPts) queue.push(...jNeighbors);
    }
    clusters.push(cluster.sort((a, b) => a - b));
  }

  // 被吸收为边界点的原噪声下标要从 noise 里摘掉
  const absorbed = new Set(clusters.flat());
  return { clusters, noise: noise.filter((i) => !absorbed.has(i)) };
}

/* ------------------------------------------------------------------ *
 * ③ 停留点识别（规格 §6.2 ③）
 * ------------------------------------------------------------------ */

/** 参与聚合的一条观测（**只用已模糊化的公开坐标**，受限表不参与聚合） */
export interface ObservationPoint {
  id: string;
  /** 已模糊化的公开坐标 */
  point: LatLng;
  observedAt: Date;
  reporterId: string;
}

export interface SpotComputation {
  centroid: LatLng;
  /** 各点到质心距离的 95 分位（用分位数而非最大值，抗离群点） */
  radiusM: number;
  sightingCount: number;
  /** 去重上报人数（反作弊关键） */
  distinctReporters: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** 24 小时分布直方图（本地时区 UTC+8） */
  hourHistogram: number[];
  confidence: number;
}

/** 上海本地小时（UTC+8，无夏令时） */
export function localHour(at: Date): number {
  return new Date(at.getTime() + 8 * 60 * 60 * 1000).getUTCHours();
}

/** 分位数（线性最近秩，输入会被复制后排序） */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx]!;
}

/**
 * 计算一个簇的停留点统计。
 *
 * 质心在**局部 ENU 米制空间**算完再转回经纬度 ——
 * 直接在经纬度上取平均会引入投影误差（一度经度 ≈ 95km，一度纬度 ≈ 111km）。
 */
export function computeSpot(members: readonly ObservationPoint[]): SpotComputation {
  if (members.length === 0) throw new RangeError('computeSpot: 成员不能为空');

  let sx = 0;
  let sy = 0;
  const locals = members.map((m) => {
    const l = toLocalMeters(m.point, CAMPUS_ORIGIN);
    sx += l.x;
    sy += l.y;
    return l;
  });
  const centroidLocal = { x: sx / members.length, y: sy / members.length };
  const centroid = fromLocalMeters(centroidLocal, CAMPUS_ORIGIN);

  const distances = locals.map((l) => Math.hypot(l.x - centroidLocal.x, l.y - centroidLocal.y));
  const radiusM = Math.round(percentile(distances, 0.95));

  const times = members.map((m) => m.observedAt.getTime());
  const firstSeenAt = new Date(Math.min(...times));
  const lastSeenAt = new Date(Math.max(...times));

  const hourHistogram = new Array<number>(24).fill(0);
  for (const m of members) hourHistogram[localHour(m.observedAt)]! += 1;

  const distinctReporters = new Set(members.map((m) => m.reporterId)).size;
  // 人越多、次数越多越可信；**单个上报人刷点无法把置信度顶上去**（T20 反作弊）
  const confidence =
    Math.min(1, distinctReporters / CONFIDENCE_FULL_REPORTERS) *
    Math.min(1, members.length / CONFIDENCE_FULL_SIGHTINGS);

  return {
    centroid,
    radiusM,
    sightingCount: members.length,
    distinctReporters,
    firstSeenAt,
    lastSeenAt,
    hourHistogram,
    confidence: Math.round(confidence * 1000) / 1000,
  };
}

/* ------------------------------------------------------------------ *
 * ① 时间窗口切分（规格 §6.2 ①）
 * ------------------------------------------------------------------ */

export interface TimeWindow {
  start: Date;
  end: Date;
  members: ObservationPoint[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 7 天滑窗，步长 1 天。
 *
 * 太短则点太少，太长则把季节变化抹平。窗口内少于 5 个点的**不产出轨迹**。
 */
export function splitIntoWindows(
  points: readonly ObservationPoint[],
  options: { windowDays?: number; stepDays?: number; minPoints?: number } = {},
): TimeWindow[] {
  const windowDays = options.windowDays ?? WINDOW_DAYS;
  const stepDays = options.stepDays ?? WINDOW_STEP_DAYS;
  const minPoints = options.minPoints ?? WINDOW_MIN_POINTS;
  if (points.length === 0) return [];

  const sorted = [...points].sort(
    (a, b) => a.observedAt.getTime() - b.observedAt.getTime() || a.id.localeCompare(b.id),
  );
  const first = sorted[0]!.observedAt.getTime();
  const last = sorted.at(-1)!.observedAt.getTime();
  const windows: TimeWindow[] = [];

  for (let start = first; start <= last; start += stepDays * DAY_MS) {
    const end = start + windowDays * DAY_MS;
    const members = sorted.filter((p) => {
      const t = p.observedAt.getTime();
      return t >= start && t < end;
    });
    if (members.length >= minPoints) {
      windows.push({ start: new Date(start), end: new Date(end), members });
    }
  }
  return windows;
}

/* ------------------------------------------------------------------ *
 * ④ 走廊连接（规格 §6.2 ④）
 * ------------------------------------------------------------------ */

/** 参与连接的停留点（按时间排序后逐个尝试连接） */
export interface ChainSpot {
  centroid: LatLng;
  firstSeenAt: Date;
  lastSeenAt: Date;
  sightingCount: number;
  confidence: number;
  /** 便于把 spotIds 写回轨迹 */
  refId?: string;
}

export interface TrackDraft {
  spotIndices: number[];
  refIds: string[];
  /** LineString 坐标串（`[lng, lat]` 顺序，GeoJSON 规范） */
  pathCoordinates: Array<[number, number]>;
  totalDistanceM: number;
  spanStartAt: Date;
  spanEndAt: Date;
  sightingCount: number;
  confidence: number;
  /** 每段直线与正北的夹角（便于前端画箭头；不是运动方向，只是几何朝向） */
  bearings: number[];
}

/**
 * 按 `firstSeenAt` 排序各簇 → 依次尝试连接相邻两簇：
 *
 * ```
 * 若 distance(centroid_i, centroid_j) <= 300 m
 *   且 (firstSeenAt_j - lastSeenAt_i) <= 6 h
 * 则连接（在 pathGeoJson 中加入一段直线）
 * 否则断开 → 结束当前 track，从 j 开始新 track
 * ```
 */
export function chainSpots(
  spots: readonly ChainSpot[],
  options: { maxDistanceM?: number; maxGapHours?: number } = {},
): TrackDraft[] {
  const maxDistanceM = options.maxDistanceM ?? CHAIN_MAX_DISTANCE_M;
  const maxGapHours = options.maxGapHours ?? CHAIN_MAX_GAP_HOURS;
  if (spots.length === 0) return [];

  const ordered = spots
    .map((spot, index) => ({ spot, index }))
    .sort(
      (a, b) =>
        a.spot.firstSeenAt.getTime() - b.spot.firstSeenAt.getTime() || a.index - b.index,
    );

  const tracks: TrackDraft[] = [];
  let current: TrackDraft | null = null;

  for (const { spot, index } of ordered) {
    if (!current) {
      current = startTrack(spot, index);
      continue;
    }
    const previous = spots[current.spotIndices.at(-1)!]!;
    const gapMs = spot.firstSeenAt.getTime() - previous.lastSeenAt.getTime();
    const distance = distanceMeters(previous.centroid, spot.centroid);
    const connectable = gapMs <= maxGapHours * 60 * 60 * 1000 && distance <= maxDistanceM;

    if (connectable) {
      current.spotIndices.push(index);
      if (spot.refId) current.refIds.push(spot.refId);
      current.pathCoordinates.push([spot.centroid.lng, spot.centroid.lat]);
      current.bearings.push(Math.round(bearingDegrees(previous.centroid, spot.centroid) * 10) / 10);
      current.totalDistanceM += Math.round(distance);
      current.spanEndAt = spot.lastSeenAt;
      current.sightingCount += spot.sightingCount;
      current.confidence = round3(
        (current.confidence * (current.spotIndices.length - 1) + spot.confidence) /
          current.spotIndices.length,
      );
    } else {
      // 宁可轨迹断裂，也不编造（规格 §6.2 ④）
      tracks.push(current);
      current = startTrack(spot, index);
    }
  }
  if (current) tracks.push(current);
  return tracks;
}

function startTrack(spot: ChainSpot, index: number): TrackDraft {
  return {
    spotIndices: [index],
    refIds: spot.refId ? [spot.refId] : [],
    pathCoordinates: [[spot.centroid.lng, spot.centroid.lat]],
    totalDistanceM: 0,
    spanStartAt: spot.firstSeenAt,
    spanEndAt: spot.lastSeenAt,
    sightingCount: spot.sightingCount,
    confidence: spot.confidence,
    bearings: [],
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/* ------------------------------------------------------------------ *
 * 端到端：观测点 → 热点 + 推断轨迹
 * ------------------------------------------------------------------ */

export interface DerivedSpot extends SpotComputation {
  /** 稳定键：用于跨滑窗去重 */
  cellKey: string;
  /** 该簇的成员观测 id */
  memberIds: string[];
}

export interface DerivedResult {
  spots: DerivedSpot[];
  tracks: Array<TrackDraft & { speciesId: string; individualId: string | null }>;
  algorithmVersion: string;
}

/**
 * 从离散观测点生成热点与推断轨迹（规格 §6.2 的四步）。
 *
 * 输入必须是**稳定排序**的点列（调用方按 `observedAt` + `id` 排），
 * 这样同窗口同参数重算两次结果**完全一致**（T19 可复现）。
 *
 * 跨滑窗去重：同一格（`epsM` 网格）的簇只保留观测数最多的那个 ——
 * 否则重叠窗口会产出重复热点。
 */
export function deriveSpotsAndTracks(
  points: readonly ObservationPoint[],
  options: {
    speciesId: string;
    individualId?: string | null;
    cluster?: ClusterParams;
    windowDays?: number;
    stepDays?: number;
    minPoints?: number;
    maxDistanceM?: number;
    maxGapHours?: number;
  },
): DerivedResult {
  const params = options.cluster ?? DEFAULT_CLUSTER;
  const windows = splitIntoWindows(points, options);
  const byCell = new Map<string, DerivedSpot>();

  for (const window of windows) {
    const { clusters } = dbscan(
      window.members.map((m) => m.point),
      params,
    );
    for (const cluster of clusters) {
      const members = cluster.map((i) => window.members[i]!);
      const computation = computeSpot(members);
      const cellKey = `${Math.floor(computation.centroid.lat * 1000)}:${Math.floor(computation.centroid.lng * 1000)}`;
      const existing = byCell.get(cellKey);
      if (!existing || existing.sightingCount < members.length) {
        byCell.set(cellKey, { ...computation, cellKey, memberIds: members.map((m) => m.id) });
      }
    }
  }

  const spots = [...byCell.values()].sort(
    (a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime() || a.cellKey.localeCompare(b.cellKey),
  );
  const tracks = chainSpots(
    spots.map((s) => ({
      centroid: s.centroid,
      firstSeenAt: s.firstSeenAt,
      lastSeenAt: s.lastSeenAt,
      sightingCount: s.sightingCount,
      confidence: s.confidence,
    })),
    options,
  ).map((t) => ({ ...t, speciesId: options.speciesId, individualId: options.individualId ?? null }));

  return { spots, tracks, algorithmVersion: ALGORITHM_VERSION };
}

/* ------------------------------------------------------------------ *
 * 免责声明（服务端下发，规格 §10.5 / T18）
 * ------------------------------------------------------------------ */

/**
 * 轨迹免责文案。
 *
 * **由服务端下发**（而不是让客户端自己写文案）：这样文案不可能被某个端"忘记加"。
 * 这是把合规文案变成**接口契约的一部分**。
 */
export function trackDisclaimer(sightingCount: number): string {
  return `本轨迹由 ${sightingCount} 次同学上报推断得出，并非实测运动路径。`;
}

/** 热点的聚合延迟（小时）—— 防止平台变成"围观召集工具"（规格 §8.1 E10） */
export const AGGREGATION_DELAY_HOURS = 24;
