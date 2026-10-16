/**
 * wildlife · 热点与推断轨迹验收（规格 §6 / §11.3）
 *
 * 覆盖：T19（可复现）、T20（反作弊：一个人刷不出热点）、T21（DBSCAN 分簇 + 噪声）、
 * T22（走廊连接的两条断链条件）、T23（窗口内 <5 点不出轨迹）。
 */
import { describe, expect, it } from 'vitest';
import { distanceMeters } from '@kedaya/shared';
import {
  ALGORITHM_VERSION,
  CHAIN_MAX_DISTANCE_M,
  CHAIN_MAX_GAP_HOURS,
  DEFAULT_CLUSTER,
  WINDOW_MIN_POINTS,
  chainSpots,
  computeSpot,
  dbscan,
  deriveSpotsAndTracks,
  localHour,
  percentile,
  splitIntoWindows,
  trackDisclaimer,
  type ObservationPoint,
} from './cluster';

const DAY = 24 * 60 * 60 * 1000;

/** 簇 A 中心（图书馆后草坪） */
const A = { lat: 31.178, lng: 121.59 };
/** 簇 B 中心（人工湖东岸），距 A 约 400m */
const B = { lat: 31.1815, lng: 121.595 };

function pointAt(center: { lat: number; lng: number }, dLat: number, dLng: number) {
  return { lat: center.lat + dLat, lng: center.lng + dLng };
}

/** 造 n 条观测：同一位置附近抖动，可指定上报人 */
function makePoints(options: {
  center: { lat: number; lng: number };
  count: number;
  reporters: string[];
  startAt: Date;
  stepMs?: number;
  spread?: number;
  idPrefix?: string;
}): ObservationPoint[] {
  const spread = options.spread ?? 0.0002; // ≈ 20m
  return Array.from({ length: options.count }, (_, i) => ({
    id: `${options.idPrefix ?? 'obs'}-${i}`,
    point: pointAt(
      options.center,
      (i % 3) * spread - spread,
      (Math.floor(i / 3) % 3) * spread - spread,
    ),
    observedAt: new Date(options.startAt.getTime() + i * (options.stepMs ?? 60 * 60 * 1000)),
    reporterId: options.reporters[i % options.reporters.length]!,
  }));
}

describe('§6.2 ② DBSCAN（T21）', () => {
  it('两个明显分离的簇 + 3 个离群点 → 2 簇 + 3 噪声', () => {
    // ⚠️ dbscan 只吃 `{lat,lng}`；ObservationPoint 的坐标在 `.point` 里，
    // 忘了解包会让所有点变成 NaN → 全噪声（这条断言正是为了抓这种错）
    const points = [
      ...makePoints({ center: A, count: 4, reporters: ['u1'], startAt: new Date('2026-10-01T00:00:00Z'), spread: 0.0001 }).map((p) => p.point),
      ...makePoints({ center: B, count: 4, reporters: ['u2'], startAt: new Date('2026-10-01T00:00:00Z'), spread: 0.0001, idPrefix: 'b' }).map((p) => p.point),
      // 3 个离群点：距两个簇都远超 eps
      { lat: 31.1755, lng: 121.5855 },
      { lat: 31.1848, lng: 121.5985 },
      { lat: 31.1705, lng: 121.5835 },
    ];

    const result = dbscan(points, DEFAULT_CLUSTER);
    expect(result.clusters).toHaveLength(2);
    expect(result.noise).toHaveLength(3);
    expect(result.clusters[0]).toHaveLength(4);
    expect(result.clusters[1]).toHaveLength(4);
  });

  it('少于 minPts 的点全是噪声（不会硬凑出簇）', () => {
    const points = [
      { lat: 31.178, lng: 121.59 },
      { lat: 31.1781, lng: 121.5901 },
    ];
    const result = dbscan(points, { epsM: 50, minPts: 3 });
    expect(result.clusters).toHaveLength(0);
    expect(result.noise).toHaveLength(2);
  });

  it('eps 生效：相距 80m 的两点在 eps=50 下不同簇，在 eps=100 下同簇', () => {
    const points = [
      { lat: 31.178, lng: 121.59 },
      { lat: 31.178, lng: 121.59085 }, // ≈ 81m 以东
      { lat: 31.178, lng: 121.5917 },
    ];
    expect(distanceMeters(points[0]!, points[1]!)).toBeGreaterThan(50);
    expect(dbscan(points, { epsM: 50, minPts: 2 }).clusters).toHaveLength(0);
    expect(dbscan(points, { epsM: 100, minPts: 2 }).clusters).toHaveLength(1);
  });

  it('参数非法直接抛错（不静默用默认值）', () => {
    expect(() => dbscan([], { epsM: 0, minPts: 3 })).toThrow(RangeError);
    expect(() => dbscan([], { epsM: 50, minPts: 0 })).toThrow(RangeError);
  });
});

describe('§6.2 ③ 停留点识别', () => {
  it('质心在局部米制空间算（不是经纬度直接平均）', () => {
    const members = makePoints({
      center: A,
      count: 6,
      reporters: ['u1', 'u2', 'u3'],
      startAt: new Date('2026-10-01T00:00:00Z'),
    });
    const spot = computeSpot(members);
    expect(spot.centroid.lat).toBeCloseTo(A.lat, 3);
    expect(spot.centroid.lng).toBeCloseTo(A.lng, 3);
    expect(spot.sightingCount).toBe(6);
    expect(spot.distinctReporters).toBe(3);
  });

  it('radiusM 用 95 分位（抗离群点），不是最大值', () => {
    const inliers = makePoints({
      center: A,
      count: 19,
      reporters: ['u1'],
      startAt: new Date('2026-10-01T00:00:00Z'),
      spread: 0.00005, // 全部在中心 ~7m 内
    });
    const outlier: ObservationPoint = {
      id: 'outlier',
      point: { lat: 31.196, lng: 121.61 }, // ≈ 2km 外
      observedAt: new Date('2026-10-01T05:00:00Z'),
      reporterId: 'u1',
    };
    const members = [...inliers, outlier];

    const spot = computeSpot(members);
    const outlierDistance = distanceMeters(A, outlier.point);
    expect(outlierDistance).toBeGreaterThan(1900);
    // 若用最大值，radius 会是 ~2000m；95 分位把它压到离群点影响之外
    // （注意：算术平均质心**本身**会被离群点拉走 ~100m，这是 ③ 之前
    //  必须先用 DBSCAN 剔除噪声的原因）
    expect(spot.radiusM).toBeLessThan(outlierDistance / 4);
    expect(spot.radiusM).toBeLessThan(500);
  });

  it('hourHistogram 是本地时区（UTC+8）的 24 桶，总和等于观测数', () => {
    const members = makePoints({
      center: A,
      count: 5,
      reporters: ['u1'],
      startAt: new Date('2026-10-01T00:00:00Z'), // 上海 08:00
    });
    const spot = computeSpot(members);
    expect(spot.hourHistogram).toHaveLength(24);
    expect(spot.hourHistogram.reduce((a, b) => a + b, 0)).toBe(5);
    expect(spot.hourHistogram[8]).toBe(1);
    expect(localHour(new Date('2026-10-01T00:00:00Z'))).toBe(8);
  });

  it('firstSeenAt / lastSeenAt 取簇内最早与最晚', () => {
    const members = makePoints({
      center: A,
      count: 4,
      reporters: ['u1'],
      startAt: new Date('2026-10-01T00:00:00Z'),
    });
    const spot = computeSpot(members);
    expect(spot.firstSeenAt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(spot.lastSeenAt.toISOString()).toBe('2026-10-01T03:00:00.000Z');
  });

  it('percentile 边界正确', () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
  });

  it('空成员抛错（不产出"幽灵热点"）', () => {
    expect(() => computeSpot([])).toThrow(RangeError);
  });
});

describe('§6.2 ② 反作弊：一个人刷不出热点（T20）', () => {
  it('同一人在 10m 内上报 10 次 → distinctReporters=1、sightingCount=10，且置信度被人数项封顶', () => {
    const members = makePoints({
      center: A,
      count: 10,
      reporters: ['spammer'],
      startAt: new Date('2026-10-01T00:00:00Z'),
      spread: 0.00005, // ≈ 5m
    });
    const spot = computeSpot(members);
    expect(spot.sightingCount).toBe(10);
    expect(spot.distinctReporters).toBe(1);
    // 人数项 min(1, 1/5) = 0.2 → 刷到 10 条也只能到 0.2
    expect(spot.confidence).toBeLessThanOrEqual(0.2);
  });

  it('5 个不同上报人 × 2 次 → 置信度显著更高（人数才是可信度来源）', () => {
    const spam = computeSpot(
      makePoints({ center: A, count: 10, reporters: ['u1'], startAt: new Date('2026-10-01T00:00:00Z') }),
    );
    const crowd = computeSpot(
      makePoints({
        center: A,
        count: 10,
        reporters: ['u1', 'u2', 'u3', 'u4', 'u5'],
        startAt: new Date('2026-10-01T00:00:00Z'),
      }),
    );
    expect(crowd.distinctReporters).toBe(5);
    expect(crowd.confidence).toBeGreaterThan(spam.confidence);
    expect(crowd.confidence).toBe(1);
  });
});

describe('§6.2 ① 时间窗口切分（T23）', () => {
  it('窗口内 <5 个点 → 不产出窗口（也就不出轨迹）', () => {
    const points = makePoints({
      center: A,
      count: WINDOW_MIN_POINTS - 1,
      reporters: ['u1'],
      startAt: new Date('2026-10-01T00:00:00Z'),
    });
    expect(splitIntoWindows(points)).toHaveLength(0);

    const derived = deriveSpotsAndTracks(points, { speciesId: 'sp-cat' });
    expect(derived.tracks).toHaveLength(0);
  });

  it('7 天滑窗、步长 1 天：跨 10 天的点会被多个窗口覆盖', () => {
    const points: ObservationPoint[] = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      point: A,
      observedAt: new Date(new Date('2026-10-01T00:00:00Z').getTime() + i * DAY),
      reporterId: `u${i % 5}`,
    }));
    const windows = splitIntoWindows(points);
    expect(windows.length).toBeGreaterThan(1);
    // 每个窗口都必须是 7 天长度
    for (const w of windows) {
      expect(w.end.getTime() - w.start.getTime()).toBe(7 * DAY);
      expect(w.members.length).toBeGreaterThanOrEqual(WINDOW_MIN_POINTS);
    }
  });

  it('空输入返回空（不抛错）', () => {
    expect(splitIntoWindows([])).toHaveLength(0);
  });
});

describe('§6.2 ④ 走廊连接（T22）', () => {
  const base = new Date('2026-10-01T00:00:00Z');
  const spot = (overrides: Partial<Parameters<typeof chainSpots>[0][number]>) => ({
    centroid: A,
    firstSeenAt: base,
    lastSeenAt: new Date(base.getTime() + 30 * 60 * 1000),
    sightingCount: 3,
    confidence: 0.5,
    ...overrides,
  });

  it('相距 200m 且间隔 2h → 连接成一条轨迹', () => {
    const near = { lat: A.lat + 0.0018, lng: A.lng }; // ≈ 200m 以北
    const tracks = chainSpots([
      spot({ centroid: A }),
      spot({
        centroid: near,
        firstSeenAt: new Date(base.getTime() + 2 * 60 * 60 * 1000),
        lastSeenAt: new Date(base.getTime() + 3 * 60 * 60 * 1000),
      }),
    ]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.pathCoordinates).toHaveLength(2);
    expect(tracks[0]!.totalDistanceM).toBeGreaterThan(150);
    expect(tracks[0]!.totalDistanceM).toBeLessThan(260);
    expect(tracks[0]!.sightingCount).toBe(6);
  });

  it('距离 > 300m → **断开**（宁可轨迹断裂，也不编造）', () => {
    const far = { lat: A.lat + 0.005, lng: A.lng }; // ≈ 555m
    expect(distanceMeters(A, far)).toBeGreaterThan(CHAIN_MAX_DISTANCE_M);
    const tracks = chainSpots([
      spot({ centroid: A }),
      spot({
        centroid: far,
        firstSeenAt: new Date(base.getTime() + 60 * 60 * 1000),
        lastSeenAt: new Date(base.getTime() + 2 * 60 * 60 * 1000),
      }),
    ]);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]!.pathCoordinates).toHaveLength(1);
  });

  it('时间间隔 > 6h → **断开**', () => {
    const near = { lat: A.lat + 0.0018, lng: A.lng };
    const tracks = chainSpots([
      spot({ centroid: A }),
      spot({
        centroid: near,
        firstSeenAt: new Date(base.getTime() + (CHAIN_MAX_GAP_HOURS + 1) * 60 * 60 * 1000),
        lastSeenAt: new Date(base.getTime() + (CHAIN_MAX_GAP_HOURS + 2) * 60 * 60 * 1000),
      }),
    ]);
    expect(tracks).toHaveLength(2);
  });

  it('**不做插值**：路径点数等于途经热点数（只连直线）', () => {
    const points = [0, 1, 2, 3].map((i) => spot({
      centroid: { lat: A.lat + i * 0.0012, lng: A.lng + i * 0.0006 },
      firstSeenAt: new Date(base.getTime() + i * 60 * 60 * 1000),
      lastSeenAt: new Date(base.getTime() + (i + 1) * 60 * 60 * 1000),
    }));
    const tracks = chainSpots(points);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.pathCoordinates).toHaveLength(4);
    expect(tracks[0]!.bearings).toHaveLength(3); // 3 段直线
  });

  it('空输入 → 空输出', () => {
    expect(chainSpots([])).toHaveLength(0);
  });
});

describe('§6.4 可复现（T19）', () => {
  const points = [
    ...makePoints({ center: A, count: 6, reporters: ['u1', 'u2'], startAt: new Date('2026-10-01T00:00:00Z') }),
    ...makePoints({ center: B, count: 6, reporters: ['u3', 'u4'], startAt: new Date('2026-10-01T00:00:00Z'), idPrefix: 'b' }),
  ];

  it('同窗口同参数重算两次，结果**完全一致**', () => {
    const first = deriveSpotsAndTracks(points, { speciesId: 'sp-cat' });
    const second = deriveSpotsAndTracks(points, { speciesId: 'sp-cat' });
    expect(second).toEqual(first);
    expect(first.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(first.spots.length).toBeGreaterThanOrEqual(2);
  });

  it('输入顺序不影响结果（调用方不需要保证顺序）', () => {
    const shuffled = [...points].reverse();
    const a = deriveSpotsAndTracks(points, { speciesId: 'sp-cat' });
    const b = deriveSpotsAndTracks(shuffled, { speciesId: 'sp-cat' });
    expect(b.spots.map((s) => s.sightingCount)).toEqual(a.spots.map((s) => s.sightingCount));
    expect(b.spots.map((s) => s.centroid.lat)).toEqual(a.spots.map((s) => s.centroid.lat));
  });

  it('两个分离的簇 → 两条轨迹（不硬连成一条）', () => {
    const derived = deriveSpotsAndTracks(points, { speciesId: 'sp-cat' });
    expect(derived.tracks.length).toBe(2);
    for (const track of derived.tracks) {
      expect(track.speciesId).toBe('sp-cat');
      expect(track.individualId).toBeNull();
    }
  });

  it('individualId 会写进轨迹（有名字的个体出独立轨迹）', () => {
    const derived = deriveSpotsAndTracks(points, { speciesId: 'sp-cat', individualId: 'ind-daju' });
    expect(derived.tracks.every((t) => t.individualId === 'ind-daju')).toBe(true);
  });
});

describe('§10.5 免责声明由服务端下发（T18 的一部分）', () => {
  it('文案里含上报次数，且明确写"推断 / 并非实测"', () => {
    const text = trackDisclaimer(31);
    expect(text).toContain('31 次');
    expect(text).toContain('推断');
    expect(text).toContain('并非实测');
  });
});
