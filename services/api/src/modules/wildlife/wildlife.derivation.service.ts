/**
 * wildlife · 派生资源重算（规格 §6.2 / §6.4）
 *
 * 四步流程：① 时间窗口切分 → ② 空间聚类 DBSCAN → ③ 停留点识别 → ④ 走廊连接。
 * 全部纯函数在 `domain/cluster.ts`，本服务只负责"取点 → 算 → 事务内替换"。
 *
 * ## 可复现（T19）
 *
 * `algorithmVersion` + `computedAt` + **稳定排序的输入** → 同窗口同参数重算两次
 * 结果**完全一致**。`listPublishedPoints` 因此按 `observedAt asc, id asc` 排序。
 *
 * ## 原子性（规格 §6.4）
 *
 * 新结果在**一个事务**里 `deleteMany + createMany`，避免读到半成品；
 * 失败时保留上一次结果（**不清空** —— 宁可展示旧轨迹，也不展示空地图）。
 *
 * ## ⚠️ 调度未接线（如实声明）
 *
 * 规格 §6.4 要求 BullMQ 每日 03:00 + 每次 `PUBLISHED` 后入队（去抖 5 分钟）。
 * **本仓库没有 BullMQ/Redis 客户端依赖**，因此这里只实现"重算"这个纯能力，
 * 调度由外部 Worker 调用 `recomputeAll()`。该缺口记入交付说明。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { distanceMeters } from '@kedaya/shared';
import { ulid } from '../../common/ids/ulid';
import {
  ALGORITHM_VERSION,
  DEFAULT_CLUSTER,
  deriveSpotsAndTracks,
  type ClusterParams,
} from './domain/cluster';
import {
  WILDLIFE_CATALOG_REPOSITORY,
  WILDLIFE_DERIVED_REPOSITORY,
  WILDLIFE_SIGHTING_REPOSITORY,
  type DerivedSpotInput,
  type DerivedTrackInput,
  type WildlifeCatalogRepository,
  type WildlifeDerivedRepository,
  type WildlifeSightingRepository,
  type ZoneModel,
} from './domain/wildlife.domain';

/** 重算回看窗口（天）。超过这个窗口的历史点不再参与聚类 */
export const RECOMPUTE_LOOKBACK_DAYS = 180;

export interface RecomputeResult {
  speciesId: string;
  spotCount: number;
  trackCount: number;
  pointCount: number;
  algorithmVersion: string;
  computedAt: string;
}

@Injectable()
export class WildlifeDerivationService {
  private readonly logger = new Logger(WildlifeDerivationService.name);

  constructor(
    @Inject(WILDLIFE_SIGHTING_REPOSITORY) private readonly sightings: WildlifeSightingRepository,
    @Inject(WILDLIFE_CATALOG_REPOSITORY) private readonly catalog: WildlifeCatalogRepository,
    @Inject(WILDLIFE_DERIVED_REPOSITORY) private readonly derived: WildlifeDerivedRepository,
  ) {}

  /** 重算单个物种的热点与推断轨迹 */
  async recomputeSpecies(
    speciesId: string,
    options: { now?: Date; cluster?: ClusterParams; lookbackDays?: number } = {},
  ): Promise<RecomputeResult> {
    const now = options.now ?? new Date();
    const lookbackDays = options.lookbackDays ?? RECOMPUTE_LOOKBACK_DAYS;
    const from = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    const points = await this.sightings.listPublishedPoints({ speciesId, from, to: now });
    const zones = await this.catalog.listZones();

    // 少于 5 个点不出轨迹（规格 §6.2 ①）；但仍然清空旧结果 —— 因为
    // "已经不足以支撑任何结论"时继续展示旧热点才是错的。
    const result = deriveSpotsAndTracks(points, {
      speciesId,
      cluster: options.cluster ?? DEFAULT_CLUSTER,
    });

    const spotInputs: DerivedSpotInput[] = result.spots.map((spot) => ({
      id: ulid(),
      speciesId,
      zoneId: this.zoneForCentroid(spot.centroid, zones)?.id ?? null,
      centroidLat: spot.centroid.lat,
      centroidLng: spot.centroid.lng,
      radiusM: spot.radiusM,
      sightingCount: spot.sightingCount,
      distinctReporters: spot.distinctReporters,
      firstSeenAt: spot.firstSeenAt,
      lastSeenAt: spot.lastSeenAt,
      hourHistogram: spot.hourHistogram,
      confidence: spot.confidence,
      algorithmVersion: ALGORITHM_VERSION,
      computedAt: now,
    }));

    const storedSpots = await this.derived.replaceSpotsForSpecies(speciesId, now, spotInputs);

    // 轨迹的 spotIds 必须指向**真正入库**的那些热点：
    // 用输入顺序与入库顺序一一对应（仓储保证按传入 id 顺序返回）。
    const trackInputs: DerivedTrackInput[] = result.tracks.map((track) => ({
      id: ulid(),
      speciesId,
      individualId: track.individualId,
      spotIds: track.spotIndices
        .map((index) => storedSpots[index]?.id)
        .filter((id): id is string => typeof id === 'string'),
      pathGeoJson: {
        type: 'LineString',
        coordinates: track.pathCoordinates,
      },
      totalDistanceM: track.totalDistanceM,
      spanStartAt: track.spanStartAt,
      spanEndAt: track.spanEndAt,
      sightingCount: track.sightingCount,
      method: 'dbscan-chain',
      confidence: track.confidence,
      // 恒为 true：由离散观测点推断，不是实测路径（规格 §2.4 / T18）
      isInferred: true,
      algorithmVersion: ALGORITHM_VERSION,
      computedAt: now,
    }));

    const storedTracks = await this.derived.replaceTracksForSpecies(speciesId, now, trackInputs);

    return {
      speciesId,
      spotCount: storedSpots.length,
      trackCount: storedTracks.length,
      pointCount: points.length,
      algorithmVersion: ALGORITHM_VERSION,
      computedAt: now.toISOString(),
    };
  }

  /** 重算所有有已发布观测的物种（Worker 的每日入口） */
  async recomputeAll(options: { now?: Date } = {}): Promise<RecomputeResult[]> {
    const speciesIds = await this.sightings.listPublishedSpeciesIds();
    const results: RecomputeResult[] = [];
    for (const speciesId of speciesIds) {
      try {
        results.push(await this.recomputeSpecies(speciesId, options));
      } catch (error) {
        // 单个物种失败**不清空**它的旧结果（规格 §6.4：失败保留上一次结果）
        this.logger.error(
          `物种 ${speciesId} 的热点/轨迹重算失败（保留旧结果）: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return results;
  }

  /** 质心落在哪个区域（命中多个优先敏感区） */
  private zoneForCentroid(
    centroid: { lat: number; lng: number },
    zones: readonly ZoneModel[],
  ): ZoneModel | null {
    const containing = zones.filter(
      (zone) => distanceMeters(centroid, { lat: zone.centerLat, lng: zone.centerLng }) <= zone.radiusM,
    );
    return containing.find((zone) => zone.isSensitive) ?? containing[0] ?? null;
  }
}
