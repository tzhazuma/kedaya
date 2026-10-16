/**
 * 用例：加载动物地图（**方案 B**：静态校园平面图 + SVG 叠加层）。
 *
 * 一次编排把地图需要的全部东西拼成一个 VM：
 * 底图配置 → 叠加层（区域圈 / 热点圈 / 轨迹折线 / 观测点）→ 物种筛选 → 列表数据 → 各类合规提示。
 *
 * ⚠️ 三个"必须一起出现"的提示（缺任何一个都算实现不完整）：
 * 1. `basemap.placeholderNotice` —— 底图是**占位自绘**，学校授权状态未知（规格 §1.3）；
 * 2. `notices.spotRealtime` —— 热点是**历史聚合**（延迟 ≥24h），不是实时位置（规格 §8.1 E10）；
 * 3. `notices.privacy` —— 位置**已模糊化**，且不能声称"完全匿名"（规格 §9.3）。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import {
  basemapCalibrationProblems,
  type AffineMatrix,
  type BasemapLicense,
  type CampusBasemap,
} from '@/domain/models/wildlife/basemap';
import {
  NO_ACCURACY_CLAIM_NOTICE,
  NESTING_NOTICE,
  PLATFORM_POSITION_NOTICE,
  PRIVACY_FUZZ_NOTICE,
  PRIVACY_SENSITIVE_ZONE_NOTICE,
  SPOT_REALTIME_NOTICE,
} from '@/domain/models/wildlife/ethics';
import {
  overlayCounts,
  sightingToMarker,
  zoneToOverlay,
  type SightingMarkerOverlay,
  type SpotOverlay,
  type TrackOverlay,
  type ZoneOverlay,
} from '@/domain/models/wildlife/geometry';
import {
  activeSpecies,
  isNestingSeason,
  toSpeciesOption,
  type SpeciesOption,
  type SpeciesTaxonomy,
} from '@/domain/models/wildlife/species';
import { monthInShanghai } from '@/domain/models/wildlife/species';
import { sortSightingsByObservedDesc } from '@/domain/models/wildlife/sightings';
import type { WildlifeRepository } from '@/domain/ports/wildlife';

import {
  toSightingListItemVM,
  type SightingListItemVM,
  type WildlifeCatalog,
} from './listSightings';
import { toSpotVM, toTrackVM, type SpotVM, type TrackVM } from './listTracks';
import { toZoneVM, type ZoneVM } from './listZones';

/** 物种筛选的"全部"哨兵值（**不传 `species` 参数**，而不是传 `'all'` 给后端） */
export const ALL_SPECIES = 'all';

export interface WildlifeMapFilters {
  speciesId: string;
  showZones: boolean;
  showSpots: boolean;
  showTracks: boolean;
  showMarkers: boolean;
}

export function defaultMapFilters(): WildlifeMapFilters {
  return {
    speciesId: ALL_SPECIES,
    showZones: true,
    showSpots: true,
    showTracks: true,
    showMarkers: false,
  };
}

const LICENSE_LABELS: Record<BasemapLicense, string> = {
  original: '原创自绘示意图',
  odbl: 'ODbL（需署名 + 衍生数据库同许可）',
  'school-authorized': '学校授权',
};

export interface BasemapVM {
  imageUrl: string;
  widthPx: number;
  heightPx: number;
  version: string;
  affine: AffineMatrix;
  attribution: string;
  license: BasemapLicense;
  licenseLabel: string;
  /** 标定质量说明（控制点数 + RMSE）—— 让"标定是精确的"可见 */
  calibrationLabel: string;
  calibrationOk: boolean;
  calibrationProblems: string[];
  isPlaceholder: boolean;
  /** 占位底图声明（非占位时为空串） */
  placeholderNotice: string;
}

export interface WildlifeMapVM {
  basemap: BasemapVM;
  speciesOptions: SpeciesOption[];
  selectedSpeciesId: string;
  /** 当前筛选对应的物种对象（用于繁殖期提示等） */
  selectedSpecies: SpeciesTaxonomy | null;
  overlays: {
    zones: ZoneOverlay[];
    spots: SpotOverlay[];
    tracks: TrackOverlay[];
    markers: SightingMarkerOverlay[];
  };
  zoneVMs: ZoneVM[];
  spotVMs: SpotVM[];
  trackVMs: TrackVM[];
  sightingVMs: SightingListItemVM[];
  counts: {
    zones: number;
    spots: number;
    tracks: number;
    markers: number;
    /** 坐标被扣留、因此**不在地图上**的记录数（必须在 UI 说明） */
    markersHiddenByPrivacy: number;
    sightings: number;
  };
  isEmpty: boolean;
  emptyHint: string;
  notices: {
    basemap: string;
    spotRealtime: string;
    privacy: string;
    sensitiveZone: string;
    noAccuracyClaim: string;
    platform: string;
    /** 当前筛选物种处于繁殖期时的加强模糊提示（规格 §9.4） */
    nesting: string | null;
  };
}

export function toBasemapVM(basemap: CampusBasemap): BasemapVM {
  const problems = basemapCalibrationProblems(basemap);
  return {
    imageUrl: basemap.imageUrl,
    widthPx: basemap.widthPx,
    heightPx: basemap.heightPx,
    version: basemap.version,
    affine: basemap.affine,
    attribution: basemap.attribution,
    license: basemap.license,
    licenseLabel: LICENSE_LABELS[basemap.license],
    calibrationLabel: `${basemap.controlPointCount} 个控制点 · 标定残差 RMSE ${basemap.calibrationRmsePx.toFixed(2)} px（阈值 < 5）`,
    calibrationOk: problems.length === 0,
    calibrationProblems: problems,
    isPlaceholder: basemap.isPlaceholder,
    placeholderNotice: basemap.placeholderNotice,
  };
}

export async function loadWildlifeMap(
  repository: WildlifeRepository,
  filters: WildlifeMapFilters,
  now: Date = new Date(),
): Promise<Result<WildlifeMapVM, ApiError>> {
  const speciesFilter = filters.speciesId === ALL_SPECIES ? undefined : filters.speciesId;

  const [basemapResult, speciesResult, zonesResult, individualsResult] = await Promise.all([
    repository.basemap(),
    repository.species(),
    repository.zones({ limit: 50, ...(speciesFilter ? { species: speciesFilter } : {}) }),
    repository.individuals({ limit: 50 }),
  ]);

  if (!basemapResult.ok) return err(basemapResult.error);
  if (!speciesResult.ok) return err(speciesResult.error);
  if (!zonesResult.ok) return err(zonesResult.error);
  if (!individualsResult.ok) return err(individualsResult.error);

  const [spotsResult, tracksResult, sightingsResult] = await Promise.all([
    repository.spots({ limit: 50, ...(speciesFilter ? { species: speciesFilter } : {}) }),
    repository.tracks({ limit: 20, ...(speciesFilter ? { species: speciesFilter } : {}) }),
    repository.sightings({ limit: 20, ...(speciesFilter ? { species: speciesFilter } : {}) }),
  ]);

  if (!spotsResult.ok) return err(spotsResult.error);
  if (!tracksResult.ok) return err(tracksResult.error);
  if (!sightingsResult.ok) return err(sightingsResult.error);

  const catalog: WildlifeCatalog = {
    species: speciesResult.value,
    zones: zonesResult.value.items,
    individuals: individualsResult.value.items,
  };

  const zoneVMs = zonesResult.value.items.map((zone) => toZoneVM(zone, catalog));
  const spotVMs = spotsResult.value.items.map((spot) => toSpotVM(spot, catalog, now));
  const trackVMs = tracksResult.value.items.map((track) => toTrackVM(track, catalog, now));
  const sightings = sortSightingsByObservedDesc(sightingsResult.value.items);
  const sightingVMs = sightings.map((sighting) => toSightingListItemVM(sighting, catalog, now));

  // ⚠️ 坐标被扣留的记录**不会**出现在地图上（`sightingToMarker` 返回 null）——
  // 它们只出现在列表里，并带"位置已扣留"说明。
  const markers = sightings
    .map((sighting) => sightingToMarker(sighting))
    .filter((marker): marker is SightingMarkerOverlay => marker !== null);

  const selectedSpecies =
    speciesFilter === undefined
      ? null
      : (speciesResult.value.find((s) => s.id === speciesFilter) ?? null);

  const counts = {
    ...overlayCounts({ zones: zoneVMs.map((z) => z.overlay), spots: spotVMs.map((s) => s.overlay), tracks: trackVMs.map((t) => t.overlay), markers }),
    markersHiddenByPrivacy: sightings.length - markers.length,
    sightings: sightings.length,
  };

  const nesting = selectedSpecies && isNestingSeason(selectedSpecies, now)
    ? `${selectedSpecies.commonNameZh} 当前处于繁殖期（${selectedSpecies.nestingMonths.join('、')} 月）：位置模糊半径已放大，请勿靠近巢区。`
    : null;

  return ok({
    basemap: toBasemapVM(basemapResult.value),
    speciesOptions: activeSpecies(speciesResult.value).map(toSpeciesOption),
    selectedSpeciesId: filters.speciesId,
    selectedSpecies,
    overlays: {
      zones: filters.showZones ? zoneVMs.map((z) => z.overlay) : [],
      spots: filters.showSpots ? spotVMs.map((s) => s.overlay) : [],
      tracks: filters.showTracks ? trackVMs.map((t) => t.overlay) : [],
      markers: filters.showMarkers ? markers : [],
    },
    zoneVMs,
    spotVMs,
    trackVMs,
    sightingVMs,
    counts,
    isEmpty: counts.zones + counts.spots + counts.tracks === 0 && counts.sightings === 0,
    emptyHint:
      '这个筛选下还没有任何动物活动数据。可以切回「全部物种」，或者去上报一条观测 —— 审核通过后就会出现在地图上。',
    notices: {
      basemap: basemapResult.value.placeholderNotice,
      spotRealtime: SPOT_REALTIME_NOTICE,
      privacy: PRIVACY_FUZZ_NOTICE,
      sensitiveZone: PRIVACY_SENSITIVE_ZONE_NOTICE,
      noAccuracyClaim: NO_ACCURACY_CLAIM_NOTICE,
      platform: PLATFORM_POSITION_NOTICE,
      nesting: nesting ?? (selectedSpecies ? NESTING_NOTICE : null),
    },
  });
}

/** 当前月份（上海时区）—— 供页面显示"繁殖期加强模糊已生效" */
export function currentShanghaiMonth(now: Date): number {
  return monthInShanghai(now);
}
