/**
 * 用例：加载**推断轨迹**与热点（规格 §6 / §10.5）。
 *
 * ⚠️ 本文件的存在意义之一是让"轨迹是推断的"这件事**无法被 UI 忘记**：
 * VM 里同时给出 `inferredLabel`（短标签）、`disclaimer`（服务端下发的完整免责声明）、
 * `summaryLabel`（"基于 N 次上报推断的活动范围"）与 `methodLabel`（只连直线、不插值）。
 * 组件只需要渲染字段，没有机会自己编一句"这只猫的路线"。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  INFERRED_TRACK_LABEL,
  K_ANONYMITY_MIN_REPORTERS,
  TRACK_FALLBACK_DISCLAIMER,
  isTrackDistanceConsistent,
  peakHoursLabel,
  spotConfidenceLabel,
  spotMeetsKAnonymity,
  spotReporterNotice,
  trackHasRenderablePath,
  trackMethodLabel,
  trackPathPoints,
  trackSpanLabel,
  trackSummaryLabel,
  type WildlifeSpot,
  type WildlifeTrack,
} from '@/domain/models/wildlife/tracks';
import { SPOT_REALTIME_NOTICE } from '@/domain/models/wildlife/ethics';
import { spotToOverlay, trackToOverlay, type SpotOverlay, type TrackOverlay } from '@/domain/models/wildlife/geometry';
import type { WildlifeRepository, SpotListQuery, TrackListQuery } from '@/domain/ports/wildlife';

import type { WildlifeCatalog } from './listSightings';

/* ------------------------------------------------------------------ *
 * 热点
 * ------------------------------------------------------------------ */

export interface SpotVM {
  id: string;
  speciesId: string;
  speciesLabel: string;
  zoneName: string | null;
  center: SpotOverlay['center'];
  radiusPx: number;
  radiusM: number;
  radiusLabel: string;
  confidenceLabel: string;
  reporterNotice: string;
  peakLabel: string;
  /** 恒为 true：历史聚合，非实时（规格 §8.1 E10） */
  aggregated: true;
  realtimeNotice: string;
  computedLabel: string;
  /** 是否满足 k-匿名（≥3 位不同上报人） */
  kAnonymous: boolean;
  overlay: SpotOverlay;
}

export function toSpotVM(spot: WildlifeSpot, catalog: WildlifeCatalog, now: Date): SpotVM {
  const overlay = spotToOverlay(spot);
  return {
    id: spot.id,
    speciesId: spot.speciesId,
    speciesLabel: spot.speciesNameZh,
    zoneName: catalog.zones.find((zone) => zone.id === spot.zoneId)?.name ?? null,
    center: overlay.center,
    radiusPx: overlay.radiusPx,
    radiusM: spot.radiusM,
    radiusLabel: `聚合半径约 ${spot.radiusM} m`,
    confidenceLabel: spotConfidenceLabel(spot.confidence),
    reporterNotice: spotReporterNotice(spot),
    peakLabel: peakHoursLabel(spot.hourHistogram),
    aggregated: true,
    realtimeNotice: SPOT_REALTIME_NOTICE,
    computedLabel: `聚合于 ${formatRelativeTime(spot.computedAt, now) || '时间未知'}`,
    kAnonymous: spotMeetsKAnonymity(spot),
    overlay,
  };
}

export interface SpotListVM {
  items: SpotVM[];
  nextCursor: string | null;
  total: number;
  isEmpty: boolean;
  emptyHint: string;
  /** k-匿名门槛说明（为什么某些热点不出现） */
  kAnonymityNotice: string;
  realtimeNotice: string;
}

export function toSpotListVM(
  spots: readonly WildlifeSpot[],
  catalog: WildlifeCatalog,
  nextCursor: string | null,
  total: number,
  now: Date,
): SpotListVM {
  const items = spots.map((spot) => toSpotVM(spot, catalog, now));
  return {
    items,
    nextCursor,
    total,
    isEmpty: items.length === 0,
    emptyHint:
      '还没有达到公开条件的热点。热点由服务端按 7 天滑窗聚类生成，且同一格内需要至少 3 位不同同学上报才会公开 —— 多上报几次就能积累出来。',
    kAnonymityNotice: `同一网格内不足 ${K_ANONYMITY_MIN_REPORTERS} 位不同上报人的位置不会公开（k-匿名）。`,
    realtimeNotice: SPOT_REALTIME_NOTICE,
  };
}

export async function loadSpotList(
  repository: WildlifeRepository,
  query: SpotListQuery,
  catalog: WildlifeCatalog,
  now: Date = new Date(),
): Promise<Result<SpotListVM, ApiError>> {
  const result = await repository.spots(query);
  if (!result.ok) return err(result.error);
  const { items, nextCursor, total } = result.value;
  return ok(toSpotListVM(items, catalog, nextCursor, total ?? items.length, now));
}

/* ------------------------------------------------------------------ *
 * 推断轨迹
 * ------------------------------------------------------------------ */

export interface TrackVM {
  id: string;
  speciesId: string;
  speciesLabel: string;
  individualName: string | null;
  /** ⚠️ UI **必须**显著展示的短标签：「推断轨迹，非实测路径」 */
  inferredLabel: string;
  /** 服务端下发的免责声明（缺失时兜底，绝不留空） */
  disclaimer: string;
  /** "基于 N 次上报推断的活动范围" —— **禁止**写成"这只动物的路线" */
  summaryLabel: string;
  methodLabel: string;
  spanLabel: string;
  sightingCount: number;
  distanceLabel: string;
  confidenceLabel: string;
  computedLabel: string;
  /** 折线是否可渲染（< 2 点无法成线） */
  hasPath: boolean;
  /** 折线长度与 `totalDistanceM` 是否一致（> 20% 差异视为可疑，UI 提示） */
  distanceConsistent: boolean;
  overlay: TrackOverlay;
}

export function toTrackVM(track: WildlifeTrack, catalog: WildlifeCatalog, now: Date): TrackVM {
  const overlay = trackToOverlay(track);
  const individual = track.individualId
    ? catalog.individuals.find((i) => i.id === track.individualId)
    : undefined;
  return {
    id: track.id,
    speciesId: track.speciesId,
    speciesLabel: track.speciesNameZh,
    individualName: individual?.name ?? null,
    inferredLabel: INFERRED_TRACK_LABEL,
    disclaimer: track.disclaimer.trim() || TRACK_FALLBACK_DISCLAIMER,
    summaryLabel: trackSummaryLabel(track),
    methodLabel: trackMethodLabel(track),
    spanLabel: trackSpanLabel(track),
    sightingCount: track.sightingCount,
    distanceLabel: `折线长度约 ${track.totalDistanceM} m`,
    confidenceLabel: spotConfidenceLabel(track.confidence),
    computedLabel: `重算于 ${formatRelativeTime(track.computedAt, now) || '时间未知'}`,
    hasPath: trackHasRenderablePath(track),
    distanceConsistent: isTrackDistanceConsistent(track),
    overlay,
  };
}

export interface TrackListVM {
  items: TrackVM[];
  nextCursor: string | null;
  total: number;
  isEmpty: boolean;
  emptyHint: string;
  /** 页面顶部必须展示的整体说明 */
  inferredNotice: string;
  /** 折线点数（供图例显示"地图上画了几段"） */
  renderedPointCount: number;
}

export function toTrackListVM(
  tracks: readonly WildlifeTrack[],
  catalog: WildlifeCatalog,
  nextCursor: string | null,
  total: number,
  now: Date,
): TrackListVM {
  const items = tracks.map((track) => toTrackVM(track, catalog, now));
  return {
    items,
    nextCursor,
    total,
    isEmpty: items.length === 0,
    emptyHint:
      '还没有可推断的轨迹。轨迹要求同一物种在 7 天窗口内至少有 5 个已发布观测，少于 5 个点不会出轨迹（避免"两点连一线"的伪轨迹）。',
    inferredNotice:
      '我们的数据来自同学偶发上报，不是 GPS 项圈：无法重建真实运动路径，也无法知道动物在两次上报之间去了哪。因此这里展示的是「推断的活动范围与走廊」，不是“这只动物的路线”。',
    renderedPointCount: items.reduce((sum, item) => sum + item.overlay.points.length, 0),
  };
}

export async function loadTrackList(
  repository: WildlifeRepository,
  query: TrackListQuery,
  catalog: WildlifeCatalog,
  now: Date = new Date(),
): Promise<Result<TrackListVM, ApiError>> {
  const result = await repository.tracks(query);
  if (!result.ok) return err(result.error);
  const { items, nextCursor, total } = result.value;
  return ok(toTrackListVM(items, catalog, nextCursor, total ?? items.length, now));
}

/** 轨迹折线的 WGS84 点数（供测试与调试） */
export function trackPointCount(track: WildlifeTrack): number {
  return trackPathPoints(track).length;
}
