/**
 * wildlife · wire 视图（API 响应形状）
 *
 * 两条硬规则集中在这里落地，而不是散落在各处：
 *
 *   1. **公开响应永不含精确坐标、永不含 `reporterId`**（规格 §2.7 / §9.6 / T15）。
 *      视图函数是唯一的出参出口，因此"忘记过滤"在结构上很难发生。
 *   2. **`isInferred: true` + 服务端 `disclaimer`**（规格 §10.5 / T18）：
 *      合规文案是接口契约的一部分，客户端**无法**忘记加。
 *
 * 命名说明（一处**刻意的双名**）：规格 §10.3 用 `geo`，而冻结的 OpenAPI
 * （`packages/contracts/openapi/kedaya.v1.yaml`）用 `fuzzedGeo`。两者是**同一个值**，
 * 这里同时下发，避免任一侧的客户端拿不到坐标；差异已记入交付说明待 Lead 裁决。
 */
import type { Page } from '@kedaya/contracts';
import { AGGREGATION_DELAY_HOURS, trackDisclaimer } from './domain/cluster';
import type { CampusBasemap } from './domain/geo';
import { ETHICS_HIGHLIGHTS } from './domain/content';
import type {
  IndividualModel,
  MediaModel,
  SightingModel,
  SpeciesModel,
  SpotModel,
  TrackModel,
  ZoneModel,
} from './domain/wildlife.domain';

export const ANONYMOUS_NICKNAME = '匿名同学';

export interface GeoView {
  lat: number;
  lng: number;
}

/* ------------------------------------------------------------------ *
 * 底图 / 物种 / 区域
 * ------------------------------------------------------------------ */

export function toBasemapView(basemap: CampusBasemap): CampusBasemap {
  return { ...basemap };
}

export interface SpeciesView {
  id: string;
  scientificName: string;
  commonNameZh: string;
  commonNameEn: string | null;
  taxonRank: string;
  parentId: string | null;
  isProtected: boolean;
  isNestingSensitive: boolean;
  nestingMonths: number[];
  defaultFeedingPolicy: string;
  iconUrl: string | null;
  isActive: boolean;
  /** ⚠️ 种子数据是推测值（U2）；该标记让未知项**机器可见** */
  needsFieldVerification: boolean;
  verificationNote: string | null;
}

export function toSpeciesView(species: SpeciesModel): SpeciesView {
  return {
    id: species.id,
    scientificName: species.scientificName,
    commonNameZh: species.commonNameZh,
    commonNameEn: species.commonNameEn,
    taxonRank: species.taxonRank,
    parentId: species.parentId,
    isProtected: species.isProtected,
    isNestingSensitive: species.isNestingSensitive,
    nestingMonths: species.nestingMonths,
    defaultFeedingPolicy: species.defaultFeedingPolicy,
    iconUrl: species.iconUrl,
    isActive: species.isActive,
    needsFieldVerification: species.needsFieldVerification,
    verificationNote: species.verificationNote,
  };
}

/** 分类树节点 */
export interface SpeciesTreeNode extends SpeciesView {
  children: SpeciesTreeNode[];
}

/** 平铺列表 → 分类树（规格 §2.5 的自引用结构） */
export function toSpeciesTree(species: readonly SpeciesModel[]): SpeciesTreeNode[] {
  const nodes = new Map<string, SpeciesTreeNode>();
  for (const item of species) nodes.set(item.id, { ...toSpeciesView(item), children: [] });
  const roots: SpeciesTreeNode[] = [];
  for (const item of species) {
    const node = nodes.get(item.id)!;
    const parent = item.parentId ? nodes.get(item.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export interface ZoneView {
  id: string;
  name: string;
  speciesIds: string[];
  center: GeoView;
  radiusM: number;
  feedingPolicy: string;
  note: string | null;
  fuzzRadiusM: number;
  isSensitive: boolean;
  noticeText: string | null;
  sortOrder: number;
}

/**
 * 区域视图。
 *
 * ⚠️ `isSensitive` 的区域**仍然返回圆心** —— 因为区域本身是管理端公开的
 * 管理边界（告示位、投喂政策需要它），而"某条观测落在哪"才是隐私。
 * 观测的坐标在 `toSightingView` 里被彻底抹掉。
 */
export function toZoneView(zone: ZoneModel): ZoneView {
  return {
    id: zone.id,
    name: zone.name,
    speciesIds: zone.speciesIds,
    center: { lat: zone.centerLat, lng: zone.centerLng },
    radiusM: zone.radiusM,
    feedingPolicy: zone.feedingPolicy,
    note: zone.note,
    fuzzRadiusM: zone.fuzzRadiusM,
    isSensitive: zone.isSensitive,
    noticeText: zone.noticeText,
    sortOrder: zone.sortOrder,
  };
}

/* ------------------------------------------------------------------ *
 * 观测
 * ------------------------------------------------------------------ */

export interface SightingView {
  id: string;
  species: string;
  speciesNameZh: string | null;
  status: string;
  /** 模糊后的公开坐标。降级（敏感区 / k<3）时为 `null`，只给 `zoneId` */
  geo: GeoView | null;
  /** 与 `geo` 同值的别名（冻结 OpenAPI 的字段名） */
  fuzzedGeo: GeoView | null;
  fuzzLevel: string;
  fuzzRadiusM: number;
  zoneId: string | null;
  observedAt: string;
  observedAtFuzzed: string;
  photoUrls: string[];
  healthConcern: boolean;
  isAnonymous: boolean;
  authorNickname: string | null;
  /** 只有请求者本人能看到"这是我的上报"（替代泄漏 `reporterId`） */
  mine: boolean;
  individualId: string | null;
  note: string | null;
  classifiedBy: string;
  autoSpeciesId: string | null;
  autoConfidence: number | null;
  correctedFromSpeciesId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SightingViewOptions {
  speciesNameZh?: string | null;
  /** 当前请求者（用于计算 `mine`，**不是**用来回显 id） */
  viewerId?: string;
  /** 审核端视角：可带 `rejectReason`（**仅审核端可见**） */
  moderatorView?: boolean;
  rejectReason?: string | null;
}

/**
 * 观测视图。
 *
 * **绝不包含**：精确坐标、`reporterId`、`gridCellKey`（会泄漏"哪一格"）、
 * 受限表的任何字段。
 */
export function toSightingView(
  sighting: SightingModel,
  options: SightingViewOptions = {},
): SightingView {
  // 没有坐标就是没有坐标：不构造、不近似、不"顺手补一个"
  const geo: GeoView | null =
    sighting.geoLat === null || sighting.geoLng === null
      ? null
      : { lat: sighting.geoLat, lng: sighting.geoLng };

  const view: SightingView & { rejectReason?: string | null } = {
    id: sighting.id,
    species: sighting.species,
    speciesNameZh: options.speciesNameZh ?? null,
    status: sighting.status,
    geo,
    fuzzedGeo: geo,
    fuzzLevel: sighting.geoFuzzLevel,
    fuzzRadiusM: sighting.fuzzRadiusM,
    zoneId: sighting.zoneId,
    observedAt: sighting.observedAt.toISOString(),
    observedAtFuzzed: sighting.observedAtFuzzed.toISOString(),
    photoUrls: sighting.photoUrls,
    healthConcern: sighting.healthConcern,
    isAnonymous: sighting.isAnonymous,
    authorNickname: sighting.isAnonymous ? ANONYMOUS_NICKNAME : null,
    mine: options.viewerId !== undefined && options.viewerId === sighting.reporterId,
    individualId: sighting.individualId,
    note: sighting.note,
    classifiedBy: sighting.classifiedBy,
    autoSpeciesId: sighting.autoSpeciesId,
    autoConfidence: sighting.autoConfidence,
    correctedFromSpeciesId: sighting.correctedFromSpeciesId,
    createdAt: sighting.createdAt.toISOString(),
    updatedAt: sighting.updatedAt.toISOString(),
  };
  if (options.moderatorView) view.rejectReason = options.rejectReason ?? sighting.rejectReason;
  return view;
}

export function toSightingPage(
  page: Page<SightingModel>,
  options: SightingViewOptions = {},
): Page<SightingView> {
  return {
    items: page.items.map((item) => toSightingView(item, options)),
    nextCursor: page.nextCursor,
  };
}

/* ------------------------------------------------------------------ *
 * 热点 / 轨迹
 * ------------------------------------------------------------------ */

export interface SpotView {
  id: string;
  speciesId: string;
  speciesNameZh: string | null;
  zoneId: string | null;
  centroid: GeoView;
  radiusM: number;
  sightingCount: number;
  distinctReporters: number;
  firstSeenAt: string;
  lastSeenAt: string;
  hourHistogram: number[];
  confidence: number;
  computedAt: string;
  /** 恒为 true：让客户端**无法**把聚合热点误当成实时位置展示（规格 §8.1 E10） */
  isAggregated: true;
  aggregationDelayHours: number;
}

export function toSpotView(spot: SpotModel, speciesNameZh: string | null = null): SpotView {
  return {
    id: spot.id,
    speciesId: spot.speciesId,
    speciesNameZh,
    zoneId: spot.zoneId,
    centroid: { lat: spot.centroidLat, lng: spot.centroidLng },
    radiusM: spot.radiusM,
    sightingCount: spot.sightingCount,
    distinctReporters: spot.distinctReporters,
    firstSeenAt: spot.firstSeenAt.toISOString(),
    lastSeenAt: spot.lastSeenAt.toISOString(),
    hourHistogram: spot.hourHistogram,
    confidence: spot.confidence,
    computedAt: spot.computedAt.toISOString(),
    isAggregated: true,
    aggregationDelayHours: AGGREGATION_DELAY_HOURS,
  };
}

export interface TrackView {
  id: string;
  speciesId: string;
  speciesNameZh: string | null;
  individualId: string | null;
  /** **恒为 true**：由离散观测点推断，不是实测路径 */
  isInferred: true;
  method: string;
  sightingCount: number;
  spanStartAt: string;
  spanEndAt: string;
  totalDistanceM: number;
  confidence: number;
  path: { type: 'LineString'; coordinates: Array<[number, number]> };
  points: Array<{ lat: number; lng: number }>;
  pointCount: number;
  /** **服务端下发**的免责声明（客户端必须原样展示） */
  disclaimer: string;
  computedAt: string;
}

export function toTrackView(track: TrackModel, speciesNameZh: string | null = null): TrackView {
  const coordinates = readLineString(track.pathGeoJson);
  return {
    id: track.id,
    speciesId: track.speciesId,
    speciesNameZh,
    individualId: track.individualId,
    isInferred: true,
    method: track.method,
    sightingCount: track.sightingCount,
    spanStartAt: track.spanStartAt.toISOString(),
    spanEndAt: track.spanEndAt.toISOString(),
    totalDistanceM: track.totalDistanceM,
    confidence: track.confidence,
    path: { type: 'LineString', coordinates },
    points: coordinates.map(([lng, lat]) => ({ lat, lng })),
    pointCount: coordinates.length,
    disclaimer: trackDisclaimer(track.sightingCount),
    computedAt: track.computedAt.toISOString(),
  };
}

/** 从 `pathGeoJson` 安全读出 LineString 坐标串（脏数据不炸接口） */
export function readLineString(raw: unknown): Array<[number, number]> {
  if (typeof raw !== 'object' || raw === null) return [];
  const coordinates = (raw as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates)) return [];
  const out: Array<[number, number]> = [];
  for (const pair of coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const [lng, lat] = pair;
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    out.push([lng, lat]);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 个体 / 媒体
 * ------------------------------------------------------------------ */

export interface IndividualView {
  id: string;
  name: string;
  speciesId: string;
  description: string | null;
  coverPhotoUrl: string | null;
  status: string;
  isActive: boolean;
  createdAt: string;
}

export function toIndividualView(individual: IndividualModel): IndividualView {
  return {
    id: individual.id,
    name: individual.name,
    speciesId: individual.speciesId,
    description: individual.description,
    coverPhotoUrl: individual.coverPhotoUrl,
    status: individual.status,
    isActive: individual.isActive,
    createdAt: individual.createdAt.toISOString(),
  };
}

export interface MediaView {
  mediaId: string;
  url: string;
  thumbUrl: string;
  widthPx: number;
  heightPx: number;
  byteSize: number;
  mimeType: string;
  sha256: string;
  /** 服务端是否真的生成了缩略图（sharp 不可用时为 false） */
  thumbnailGenerated: boolean;
  /** 服务端是否已强制剥离 EXIF（**恒为 true**，否则该请求会 500） */
  exifStripped: true;
}

export function toMediaView(
  media: MediaModel,
  urlFor: (key: string) => string,
): MediaView {
  return {
    mediaId: media.id,
    url: urlFor(media.storageKey),
    thumbUrl: urlFor(media.thumbKey),
    widthPx: media.widthPx,
    heightPx: media.heightPx,
    byteSize: media.byteSize,
    mimeType: media.mimeType,
    sha256: media.sha256,
    thumbnailGenerated: media.thumbKey !== media.storageKey,
    exifStripped: true,
  };
}

/* ------------------------------------------------------------------ *
 * 伦理提示（规格 §8.2）
 * ------------------------------------------------------------------ */

export interface EthicsNoticeView {
  /** 精简提示（≤5 条，每条 ≤20 字） */
  highlights: readonly string[];
  /** 这是**表单校验**，不是同意门：缺它只影响该次提交，不影响浏览 */
  required: true;
}

export function toEthicsNoticeView(): EthicsNoticeView {
  return { highlights: ETHICS_HIGHLIGHTS, required: true };
}
