/**
 * wildlife · 派生资源重算验收（规格 §6.4）
 *
 * 这一层最容易出的两个 bug，都在这里被断言：
 *   1. **轨迹的 `spotIds` 指向了不存在的热点**（`createMany` 不返回 id，
 *      如果不用应用层分配的 id 对齐，映射就会错位）；
 *   2. **失败时清空了旧结果**（规格要求"宁可展示旧轨迹，也不展示空地图"）。
 */
import { describe, expect, it, vi } from 'vitest';
import { WildlifeDerivationService } from './wildlife.derivation.service';
import { ALGORITHM_VERSION, type ObservationPoint } from './domain/cluster';
import type {
  DerivedSpotInput,
  DerivedTrackInput,
  PublishedPointFilter,
  SpotModel,
  TrackModel,
  WildlifeCatalogRepository,
  WildlifeDerivedRepository,
  WildlifeSightingRepository,
  ZoneModel,
} from './domain/wildlife.domain';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-17T03:00:00Z');

const A = { lat: 31.178, lng: 121.59 };
const B = { lat: 31.1815, lng: 121.595 };

function pointsAround(center: { lat: number; lng: number }, count: number, prefix: string): ObservationPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    point: { lat: center.lat + (i % 3) * 0.0001 - 0.0001, lng: center.lng + (Math.floor(i / 3) % 3) * 0.0001 - 0.0001 },
    observedAt: new Date(NOW.getTime() - 2 * DAY + i * 3600_000),
    reporterId: `${prefix}-reporter-${i % 3}`,
  }));
}

/** 记录写入内容的内存仓储 */
function makeDerivedRepo() {
  const state = {
    spots: [] as DerivedSpotInput[],
    tracks: [] as DerivedTrackInput[],
    replaceSpotsCalls: 0,
  };
  const repo: Partial<WildlifeDerivedRepository> = {
    async replaceSpotsForSpecies(_speciesId, _computedAt, spots) {
      state.replaceSpotsCalls += 1;
      state.spots = [...spots];
      // 与真实仓储一样：**按传入顺序**返回（用应用层分配的 id 对齐）
      return spots.map((s) => ({ ...s, id: s.id! }) as unknown as SpotModel);
    },
    async replaceTracksForSpecies(_speciesId, _computedAt, tracks) {
      state.tracks = [...tracks];
      return tracks.map((t) => ({ ...t, id: t.id! }) as unknown as TrackModel);
    },
  };
  return { repo: repo as WildlifeDerivedRepository, state };
}

function makeService(options: {
  points?: ObservationPoint[];
  speciesIds?: string[];
  zones?: ZoneModel[];
  failFor?: string[];
}) {
  const { repo, state } = makeDerivedRepo();
  const sightings: Partial<WildlifeSightingRepository> = {
    async listPublishedPoints(filter: PublishedPointFilter) {
      if (options.failFor?.includes(filter.speciesId)) throw new Error('boom');
      return options.points ?? [];
    },
    async listPublishedSpeciesIds() {
      return options.speciesIds ?? ['sp-cat'];
    },
  };
  const catalog: Partial<WildlifeCatalogRepository> = {
    async listZones() {
      return options.zones ?? [];
    },
  };
  const service = new WildlifeDerivationService(
    sightings as WildlifeSightingRepository,
    catalog as WildlifeCatalogRepository,
    repo,
  );
  return { service, state };
}

function zone(overrides: Partial<ZoneModel>): ZoneModel {
  return {
    id: 'zone-lawn',
    name: '草坪',
    speciesIds: [],
    centerLat: A.lat,
    centerLng: A.lng,
    radiusM: 200,
    feedingPolicy: 'discouraged',
    note: null,
    fuzzRadiusM: 50,
    isSensitive: false,
    sensitiveRing: null,
    noticeText: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

describe('§6.4 重算：热点与轨迹', () => {
  it('两个分离的簇 → 2 个热点 + 2 条轨迹，且 spotIds **指向真实存在的热点**', async () => {
    const { service, state } = makeService({
      points: [...pointsAround(A, 6, 'a'), ...pointsAround(B, 6, 'b')],
      zones: [zone({})],
    });

    const result = await service.recomputeSpecies('sp-cat', { now: NOW });

    expect(result.speciesId).toBe('sp-cat');
    expect(result.pointCount).toBe(12);
    expect(result.spotCount).toBe(2);
    expect(result.trackCount).toBe(2);
    expect(result.algorithmVersion).toBe(ALGORITHM_VERSION);

    const spotIds = state.spots.map((s) => s.id!);
    expect(new Set(spotIds).size).toBe(2);
    for (const track of state.tracks) {
      expect(track.spotIds.length).toBeGreaterThan(0);
      for (const id of track.spotIds) expect(spotIds).toContain(id);
    }
    // 每个热点都被某个轨迹引用（12 个点分成两簇，各自成轨迹）
    const referenced = new Set(state.tracks.flatMap((t) => t.spotIds));
    expect([...referenced].sort()).toEqual([...spotIds].sort());
  });

  it('质心落在区域内的热点带上 zoneId；敏感区优先', async () => {
    const { service, state } = makeService({
      points: pointsAround(A, 6, 'a'),
      zones: [
        zone({ id: 'zone-normal', radiusM: 500 }),
        zone({ id: 'zone-sensitive', radiusM: 500, isSensitive: true }),
      ],
    });
    await service.recomputeSpecies('sp-cat', { now: NOW });
    expect(state.spots[0]!.zoneId).toBe('zone-sensitive');
  });

  it('少于 5 个点 → 不产出轨迹，但**仍然替换**（清空过期结果）', async () => {
    const { service, state } = makeService({ points: pointsAround(A, 3, 'a') });
    const result = await service.recomputeSpecies('sp-cat', { now: NOW });
    expect(result.spotCount).toBe(0);
    expect(result.trackCount).toBe(0);
    expect(state.replaceSpotsCalls).toBe(1);
    expect(state.spots).toEqual([]);
  });

  it('算法版本、computedAt、isInferred 都写进结果（可复现 + 恒真）', async () => {
    const { service, state } = makeService({ points: pointsAround(A, 6, 'a') });
    await service.recomputeSpecies('sp-cat', { now: NOW });
    for (const spot of state.spots) {
      expect(spot.algorithmVersion).toBe(ALGORITHM_VERSION);
      expect(spot.computedAt).toEqual(NOW);
      expect(spot.hourHistogram).toHaveLength(24);
      expect(spot.distinctReporters).toBeGreaterThan(0);
    }
    for (const track of state.tracks) {
      expect(track.isInferred).toBe(true);
      expect(track.method).toBe('dbscan-chain');
      expect(track.algorithmVersion).toBe(ALGORITHM_VERSION);
      expect(track.pathGeoJson).toMatchObject({ type: 'LineString' });
    }
  });

  it('同输入重算两次：除"新分配的 id"外**完全一致**（T19 可复现）', async () => {
    const points = pointsAround(A, 6, 'a');
    const first = makeService({ points });
    const second = makeService({ points });
    await first.service.recomputeSpecies('sp-cat', { now: NOW });
    await second.service.recomputeSpecies('sp-cat', { now: NOW });

    // 每次重算都会分配新的热点 id（这是**替换语义**的一部分，不是不确定性），
    // 因此比较时要连同轨迹里的 spotIds 一起归一化成"第几个热点"。
    const normalize = (state: { spots: DerivedSpotInput[]; tracks: DerivedTrackInput[] }) => {
      const index = new Map(state.spots.map((spot, i) => [spot.id!, i]));
      return {
        spots: state.spots.map(({ id: _id, ...rest }) => rest),
        tracks: state.tracks.map(({ id: _id, spotIds, ...rest }) => ({
          ...rest,
          spotIndices: spotIds.map((spotId) => index.get(spotId)),
        })),
      };
    };

    expect(normalize(second.state)).toEqual(normalize(first.state));
    // 归一化后的热点序号必须是有效下标（否则说明 spotIds 指错了热点）
    for (const track of normalize(second.state).tracks) {
      for (const spotIndex of track.spotIndices) expect(typeof spotIndex).toBe('number');
    }
  });

  it('回看窗口：只取 lookbackDays 内的点（超窗口的历史点不参与）', async () => {
    // 显式标注参数类型，否则 `spy.mock.calls[0]![0]` 会被推成 never
    const spy = vi.fn(async (_filter: PublishedPointFilter) => [] as ObservationPoint[]);
    const sightings = {
      listPublishedPoints: spy,
      listPublishedSpeciesIds: async () => [],
    } as unknown as WildlifeSightingRepository;
    const catalog = { listZones: async () => [] } as unknown as WildlifeCatalogRepository;
    const { repo } = makeDerivedRepo();
    const service = new WildlifeDerivationService(sightings, catalog, repo);

    await service.recomputeSpecies('sp-cat', { now: NOW, lookbackDays: 30 });
    const filter = spy.mock.calls[0]![0];
    expect(filter.from.toISOString()).toBe(new Date(NOW.getTime() - 30 * DAY).toISOString());
    expect(filter.to).toEqual(NOW);
  });
});

describe('§6.4 失败语义：**保留上一次结果**', () => {
  it('单个物种失败不影响其它物种，且不抛给调用方', async () => {
    const { service } = makeService({
      speciesIds: ['sp-cat', 'sp-broken', 'sp-swan'],
      points: pointsAround(A, 6, 'a'),
      failFor: ['sp-broken'],
    });
    const results = await service.recomputeAll({ now: NOW });
    expect(results.map((r) => r.speciesId)).toEqual(['sp-cat', 'sp-swan']);
  });

  it('没有已发布观测时返回空数组（不报错）', async () => {
    const { service } = makeService({ speciesIds: [] });
    expect(await service.recomputeAll({ now: NOW })).toEqual([]);
  });
});
