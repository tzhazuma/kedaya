/**
 * wildlife · 领域模型与端口（契约 §7：domain ← data 依赖倒置）
 *
 * **本文件不 import Prisma**（硬要求）：所有模型都是结构化接口，
 * data 层负责把 Prisma 行（含 `Decimal`）映射成这里的形状。
 *
 * 端口用**显式 Symbol token** 注入（见 `test/setup.ts`：vitest 不做
 * `emitDecoratorMetadata`，靠 design:paramtypes 会在测试环境 DI 失败）。
 */
import type { Page } from '@kedaya/contracts';
import type { ObservationPoint } from './cluster';

/* ------------------------------------------------------------------ *
 * 领域模型
 * ------------------------------------------------------------------ */

export interface SpeciesModel {
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
  externalIds: Record<string, unknown>;
  iconUrl: string | null;
  isActive: boolean;
  needsFieldVerification: boolean;
  verificationNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ZoneModel {
  id: string;
  name: string;
  speciesIds: string[];
  /** WGS84 */
  centerLat: number;
  centerLng: number;
  radiusM: number;
  feedingPolicy: string;
  note: string | null;
  fuzzRadiusM: number;
  isSensitive: boolean;
  sensitiveRing: unknown;
  noticeText: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface SightingModel {
  id: string;
  zoneId: string | null;
  /** `SpeciesTaxonomy.id`（契约冻结字段名 `species`） */
  species: string;
  status: string;
  /** 公开坐标（**已模糊化**）。降级时两者同时为 null */
  geoLat: number | null;
  geoLng: number | null;
  geoFuzzLevel: string;
  fuzzRadiusM: number;
  gridCellKey: string | null;
  photoUrls: string[];
  healthConcern: boolean;
  reporterId: string;
  observedAt: Date;
  observedAtFuzzed: Date;
  publishDelayDays: number;
  individualId: string | null;
  autoSpeciesId: string | null;
  autoConfidence: number | null;
  classifiedBy: string;
  correctedFromSpeciesId: string | null;
  note: string | null;
  isAnonymous: boolean;
  moderatedBy: string | null;
  moderatedAt: Date | null;
  rejectReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** 受限表模型（精确坐标）。**不得出现在任何公开响应里** */
export interface ExactSightingModel {
  sightingId: string;
  exactLat: number;
  exactLng: number;
  exactAccuracyM: number | null;
  exactObservedAt: Date;
}

export interface MediaModel {
  id: string;
  sightingId: string | null;
  storageKey: string;
  thumbKey: string;
  widthPx: number;
  heightPx: number;
  byteSize: number;
  mimeType: string;
  sha256: string;
  clientPhotoId: string;
  sortOrder: number;
  uploadedBy: string | null;
  createdAt: Date;
}

export interface SpotModel {
  id: string;
  speciesId: string;
  zoneId: string | null;
  centroidLat: number;
  centroidLng: number;
  radiusM: number;
  sightingCount: number;
  distinctReporters: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  hourHistogram: number[];
  confidence: number;
  algorithmVersion: string;
  computedAt: Date;
}

export interface TrackModel {
  id: string;
  speciesId: string;
  individualId: string | null;
  spotIds: string[];
  pathGeoJson: unknown;
  totalDistanceM: number;
  spanStartAt: Date;
  spanEndAt: Date;
  sightingCount: number;
  method: string;
  confidence: number;
  isInferred: boolean;
  algorithmVersion: string;
  computedAt: Date;
}

export interface IndividualModel {
  id: string;
  name: string;
  speciesId: string;
  description: string | null;
  coverPhotoUrl: string | null;
  status: string;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/* ------------------------------------------------------------------ *
 * 输入
 * ------------------------------------------------------------------ */

export interface CreateSightingInput {
  /**
   * 由**应用层生成**的 ULID（不是 Prisma 的默认值）。
   *
   * 为什么必须这样（规格 §9.3 ③）：确定性噪声按 `sightingId` 派生 HMAC，
   * 而"同一条观测永远映射到同一个模糊点"要求噪声键与持久化主键**是同一个值**。
   * 若让数据库生成 id，应用层在跑模糊化时就只能用一个临时值 —— 那么
   * 重算（如物种纠正后重跑）会得到**不同**的模糊点，确定性保证失效。
   */
  id?: string;
  zoneId: string | null;
  species: string;
  status: string;
  geoLat: number | null;
  geoLng: number | null;
  geoFuzzLevel: string;
  fuzzRadiusM: number;
  gridCellKey: string | null;
  photoUrls: string[];
  healthConcern: boolean;
  reporterId: string;
  observedAt: Date;
  observedAtFuzzed: Date;
  publishDelayDays: number;
  individualId: string | null;
  autoSpeciesId: string | null;
  autoConfidence: number | null;
  classifiedBy: string;
  correctedFromSpeciesId: string | null;
  note: string | null;
  isAnonymous: boolean;
}

export interface CreateExactInput {
  sightingId: string;
  exactLat: number;
  exactLng: number;
  exactAccuracyM: number | null;
  exactObservedAt: Date;
}

export interface UpdateSightingInput {
  species?: string;
  observedAt?: Date;
  note?: string | null;
  correctedFromSpeciesId?: string | null;
  classifiedBy?: string;
  status?: string;
  moderatedBy?: string | null;
  moderatedAt?: Date | null;
  rejectReason?: string | null;
  deletedAt?: Date | null;
  zoneId?: string | null;
  geoLat?: number | null;
  geoLng?: number | null;
  geoFuzzLevel?: string;
  fuzzRadiusM?: number;
  gridCellKey?: string | null;
  observedAtFuzzed?: Date;
  publishDelayDays?: number;
  healthConcern?: boolean;
}

export interface CreateMediaInput {
  sightingId: string | null;
  storageKey: string;
  thumbKey: string;
  widthPx: number;
  heightPx: number;
  byteSize: number;
  mimeType: string;
  sha256: string;
  clientPhotoId: string;
  sortOrder: number;
  uploadedBy: string | null;
}

export interface CreateIndividualInput {
  name: string;
  speciesId: string;
  description: string | null;
  coverPhotoUrl: string | null;
  status: string;
  createdBy: string;
}

export interface SightingListFilter {
  cursor?: string;
  limit: number;
  species?: string;
  zoneId?: string;
  /** 仅 PUBLISHED（公开列表） */
  publishedOnly?: boolean;
  /** 保护物种繁殖期的公开延迟：过滤 `publishDelayDays > 0` 的近期记录 */
  now?: Date;
}

export interface SpotListFilter {
  cursor?: string;
  limit: number;
  speciesId?: string;
  zoneId?: string;
  minConfidence: number;
  /** 只返回 computedAt <= 该时刻的热点（≥24h 聚合延迟，规格 §8.1 E10） */
  computedBefore: Date;
}

export interface TrackListFilter {
  cursor?: string;
  limit: number;
  speciesId?: string;
  individualId?: string;
  computedBefore: Date;
}

export interface PublishedPointFilter {
  speciesId: string;
  individualId?: string | null;
  from: Date;
  to: Date;
}

/* ------------------------------------------------------------------ *
 * 端口
 * ------------------------------------------------------------------ */

/** 物种 + 区域（管理端维护的"目录"数据） */
export interface WildlifeCatalogRepository {
  listSpecies(): Promise<SpeciesModel[]>;
  findSpeciesById(id: string): Promise<SpeciesModel | null>;
  listZones(): Promise<ZoneModel[]>;
  findZoneById(id: string): Promise<ZoneModel | null>;
  listSensitiveZones(): Promise<ZoneModel[]>;
}

export const WILDLIFE_CATALOG_REPOSITORY = Symbol('KEDAYA_WILDLIFE_CATALOG_REPOSITORY');

/** 观测 + 受限精确坐标 */
export interface WildlifeSightingRepository {
  list(filter: SightingListFilter): Promise<Page<SightingModel>>;
  findById(id: string): Promise<SightingModel | null>;
  create(input: CreateSightingInput): Promise<SightingModel>;
  update(id: string, input: UpdateSightingInput): Promise<SightingModel>;
  softDelete(id: string, at: Date): Promise<void>;

  /**
   * k-匿名计数：同格 + 同 7 天窗口内的**去重上报人数**（规格 §9.3 ④）。
   *
   * `excludeReporterId` 用于把"当前这条上报"排除掉 —— 它还没入库，
   * 调用方需要 `+1` 才是"含本条"的去重人数（否则会把同一人的两条算成两人）。
   */
  countDistinctReportersInCell(
    cellKey: string,
    from: Date,
    to: Date,
    excludeReporterId?: string,
  ): Promise<number>;

  /** 受限表写入（与公开行同一事务） */
  saveExact(input: CreateExactInput): Promise<ExactSightingModel>;
  /** 受限表读取。**调用方必须写审计**（规格 §2.7） */
  findExact(sightingId: string): Promise<ExactSightingModel | null>;

  /** 已发布观测的公开坐标点（热点/轨迹重算的输入） */
  listPublishedPoints(filter: PublishedPointFilter): Promise<ObservationPoint[]>;
  /** 参与聚合的物种 id 列表 */
  listPublishedSpeciesIds(): Promise<string[]>;
}

export const WILDLIFE_SIGHTING_REPOSITORY = Symbol('KEDAYA_WILDLIFE_SIGHTING_REPOSITORY');

export interface WildlifeMediaRepository {
  create(input: CreateMediaInput): Promise<MediaModel>;
  findById(id: string): Promise<MediaModel | null>;
  findByIds(ids: readonly string[]): Promise<MediaModel[]>;
  findByUploaderAndClientPhotoId(uploadedBy: string, clientPhotoId: string): Promise<MediaModel | null>;
  attachToSighting(mediaIds: readonly string[], sightingId: string): Promise<number>;
  countBySighting(sightingId: string): Promise<number>;
  /** 24 小时未关联的孤儿媒体（规格 §4.5） */
  listOrphans(before: Date, limit: number): Promise<MediaModel[]>;
  deleteByIds(ids: readonly string[]): Promise<number>;
}

export const WILDLIFE_MEDIA_REPOSITORY = Symbol('KEDAYA_WILDLIFE_MEDIA_REPOSITORY');

export interface DerivedSpotInput {
  /**
   * 由应用层生成的 ULID。
   *
   * 为什么不让数据库生成：轨迹的 `spotIds` 必须指向**真正入库**的热点 id，
   * 而 `createMany` 不返回 id。应用层先分配 id、仓储再**按传入顺序**返回，
   * 就能把"第 i 个轨迹点 ↔ 第 i 个热点"这个对应关系钉死。
   */
  id?: string;
  speciesId: string;
  zoneId: string | null;
  centroidLat: number;
  centroidLng: number;
  radiusM: number;
  sightingCount: number;
  distinctReporters: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  hourHistogram: number[];
  confidence: number;
  algorithmVersion: string;
  computedAt: Date;
}

export interface DerivedTrackInput {
  /** 同上：应用层分配 id */
  id?: string;
  speciesId: string;
  individualId: string | null;
  spotIds: string[];
  pathGeoJson: unknown;
  totalDistanceM: number;
  spanStartAt: Date;
  spanEndAt: Date;
  sightingCount: number;
  method: string;
  confidence: number;
  isInferred: boolean;
  algorithmVersion: string;
  computedAt: Date;
}

/**
 * 派生只读资源（热点 / 轨迹）。**没有写端点**，只有 Worker 重算。
 *
 * `replace*` 的返回值**必须与传入数组同序**（按传入的 id 对齐），
 * 这样调用方能安全地用下标建立"轨迹点 ↔ 热点"的映射。
 */
export interface WildlifeDerivedRepository {
  replaceSpotsForSpecies(
    speciesId: string,
    computedAt: Date,
    spots: readonly DerivedSpotInput[],
  ): Promise<SpotModel[]>;
  replaceTracksForSpecies(
    speciesId: string,
    computedAt: Date,
    tracks: readonly DerivedTrackInput[],
  ): Promise<TrackModel[]>;
  listSpots(filter: SpotListFilter): Promise<Page<SpotModel>>;
  listTracks(filter: TrackListFilter): Promise<Page<TrackModel>>;
  findTrackById(id: string): Promise<TrackModel | null>;
}

export const WILDLIFE_DERIVED_REPOSITORY = Symbol('KEDAYA_WILDLIFE_DERIVED_REPOSITORY');

export interface WildlifeIndividualRepository {
  list(filter: {
    cursor?: string;
    limit: number;
    speciesId?: string;
    publishedOnly?: boolean;
  }): Promise<Page<IndividualModel>>;
  findById(id: string): Promise<IndividualModel | null>;
  findByName(speciesId: string, name: string): Promise<IndividualModel | null>;
  create(input: CreateIndividualInput): Promise<IndividualModel>;
  update(id: string, input: Partial<CreateIndividualInput>): Promise<IndividualModel>;
}

export const WILDLIFE_INDIVIDUAL_REPOSITORY = Symbol('KEDAYA_WILDLIFE_INDIVIDUAL_REPOSITORY');

/* ------------------------------------------------------------------ *
 * 对象存储（规格 §4.1）
 * ------------------------------------------------------------------ */

export interface StoredObject {
  key: string;
  /** 可公开访问的 URL */
  url: string;
  byteSize: number;
}

/**
 * 对象存储端口。
 *
 * 失败必须抛 `UpstreamUnavailableError`（→ 502 `UPSTREAM_UNAVAILABLE`，
 * 而不是 500）—— 规格 §10.3 / T45。
 */
export interface MediaStoragePort {
  put(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  /** 读回对象（分类建议需要把图片喂给分类器） */
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  urlFor(key: string): string;
}

export const MEDIA_STORAGE = Symbol('KEDAYA_WILDLIFE_MEDIA_STORAGE');

/* ------------------------------------------------------------------ *
 * 健康异常告警（规格 §8.4）
 * ------------------------------------------------------------------ */

/**
 * 疑似受伤/异常上报的告警端口。
 *
 * 规格 §8.4 的关键：健康异常的通知**不等待审核**（受伤动物不能等审核队列）。
 * **但公开可见仍要审核** —— 内部告警与对外发布是两条独立的路径。
 */
export interface HealthAlertPort {
  /** 立即通知社团管理员。**失败不得阻塞上报**（上报本身比通知重要） */
  notifyHealthConcern(input: {
    sightingId: string;
    reporterId: string;
    zoneId: string | null;
    observedAt: Date;
  }): Promise<void>;
}

export const HEALTH_ALERT_PORT = Symbol('KEDAYA_WILDLIFE_HEALTH_ALERT_PORT');

/**
 * 缩略图生成端口（**非隐私路径**）。
 *
 * 装不上 sharp 时降级为"无缩略图"（`thumbKey === storageKey`），
 * 不影响上传与隐私保证 —— 与 EXIF 剥离刻意分开。
 */
export interface ThumbnailerPort {
  readonly available: boolean;
  /** 生成 400px 长边 WebP；不可用时返回 null */
  render(data: Buffer, edgePx?: number): Promise<Buffer | null>;
}

export const THUMBNAILER = Symbol('KEDAYA_WILDLIFE_THUMBNAILER');

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

export const WILDLIFE_MODULE_ID = 'wildlife';

/** 审核员角色名（`role.port.ts` 的 `KedaYaRole` 需要扩一个成员） */
export const WILDLIFE_MODERATOR_ROLE = 'wildlife_moderator';

/** 审核员环境变量白名单 */
export const WILDLIFE_MODERATOR_ENV_KEY = 'WILDLIFE_MODERATOR_USER_IDS';
