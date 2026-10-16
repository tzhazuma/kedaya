/**
 * wildlife · data 层（契约 §7：**唯一允许碰 IO 的地方**）
 *
 * 四个仓储实现（目录 / 观测 / 媒体 / 派生），全部实现 `domain/wildlife.domain.ts`
 * 里的端口。domain 层不 import Prisma，映射（含 `Decimal` → `number`）在这里完成。
 *
 * 两个刻意的设计：
 *   · `gridCellKey` 与 `observedAt` 的复合索引让 k-匿名计数**不必扫全表**
 *     （规格 §9.3 ④ 的计数必须落在公开表上，不能去读受限表）；
 *   · 热点/轨迹的替换走 `$transaction([deleteMany, createMany])` ——
 *     规格 §6.4 要求"新结果写入 → 校验 → 事务内替换"，避免读到半成品。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import { PrismaService } from '../../../prisma/prisma.service';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import type { ObservationPoint } from '../domain/cluster';
import type {
  CreateExactInput,
  CreateIndividualInput,
  CreateMediaInput,
  CreateSightingInput,
  DerivedSpotInput,
  DerivedTrackInput,
  ExactSightingModel,
  IndividualModel,
  MediaModel,
  PublishedPointFilter,
  SightingListFilter,
  SightingModel,
  SpeciesModel,
  SpotListFilter,
  SpotModel,
  TrackListFilter,
  TrackModel,
  UpdateSightingInput,
  WildlifeCatalogRepository,
  WildlifeDerivedRepository,
  WildlifeIndividualRepository,
  WildlifeMediaRepository,
  WildlifeSightingRepository,
  ZoneModel,
} from '../domain/wildlife.domain';

/* ------------------------------------------------------------------ *
 * 映射辅助
 * ------------------------------------------------------------------ */

/** Prisma 的 `Decimal` / `string` / `number` 都能安全转成 number */
type DecimalLike = { toString(): string } | number | string | null | undefined;

function num(value: DecimalLike): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function numOrNull(value: DecimalLike): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function date(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function dateOrNull(value: unknown): Date | null {
  return value === null || value === undefined ? null : date(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 游标分页（契约 §6.1：`orderBy id asc` + `take limit+1`，不用 offset） */
async function pageByCursor<TRow extends { id: string }, TModel>(
  delegate: { findMany(args: any): Promise<TRow[]> },
  filter: { cursor?: string; limit: number },
  args: Record<string, unknown>,
  toModel: (row: TRow) => TModel,
): Promise<Page<TModel>> {
  const cursor = decodeCursor(filter.cursor);
  const rows = await delegate.findMany({
    take: filter.limit + 1,
    orderBy: { id: 'asc' },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    ...args,
  });
  const hasMore = rows.length > filter.limit;
  const visible = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = visible.at(-1);
  return {
    items: visible.map(toModel),
    nextCursor: hasMore && last ? encodeCursor(last.id) : null,
  };
}

/* ------------------------------------------------------------------ *
 * 目录：物种 + 区域
 * ------------------------------------------------------------------ */

function toSpecies(row: any): SpeciesModel {
  return {
    id: row.id,
    scientificName: row.scientificName,
    commonNameZh: row.commonNameZh,
    commonNameEn: row.commonNameEn ?? null,
    taxonRank: row.taxonRank,
    parentId: row.parentId ?? null,
    isProtected: Boolean(row.isProtected),
    isNestingSensitive: Boolean(row.isNestingSensitive),
    nestingMonths: Array.isArray(row.nestingMonths) ? row.nestingMonths : [],
    defaultFeedingPolicy: row.defaultFeedingPolicy,
    externalIds: asRecord(row.externalIds),
    iconUrl: row.iconUrl ?? null,
    isActive: row.isActive !== false,
    needsFieldVerification: row.needsFieldVerification !== false,
    verificationNote: row.verificationNote ?? null,
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
    deletedAt: dateOrNull(row.deletedAt),
  };
}

function toZone(row: any): ZoneModel {
  return {
    id: row.id,
    name: row.name,
    speciesIds: Array.isArray(row.speciesIds) ? row.speciesIds : [],
    centerLat: num(row.centerLat),
    centerLng: num(row.centerLng),
    radiusM: num(row.radiusM),
    feedingPolicy: row.feedingPolicy,
    note: row.note ?? null,
    fuzzRadiusM: num(row.fuzzRadiusM),
    isSensitive: Boolean(row.isSensitive),
    sensitiveRing: row.sensitiveRing ?? null,
    noticeText: row.noticeText ?? null,
    sortOrder: num(row.sortOrder),
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
    deletedAt: dateOrNull(row.deletedAt),
  };
}

@Injectable()
export class WildlifeCatalogPrismaRepository implements WildlifeCatalogRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listSpecies(): Promise<SpeciesModel[]> {
    const rows = await (this.prisma as any).speciesTaxonomy.findMany({
      where: { deletedAt: null },
      orderBy: [{ taxonRank: 'asc' }, { commonNameZh: 'asc' }],
    });
    return (rows as any[]).map(toSpecies);
  }

  async findSpeciesById(id: string): Promise<SpeciesModel | null> {
    const row = await (this.prisma as any).speciesTaxonomy.findUnique({ where: { id } });
    return row ? toSpecies(row) : null;
  }

  async listZones(): Promise<ZoneModel[]> {
    const rows = await (this.prisma as any).wildlifeZone.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return (rows as any[]).map(toZone);
  }

  async findZoneById(id: string): Promise<ZoneModel | null> {
    const row = await (this.prisma as any).wildlifeZone.findUnique({ where: { id } });
    return row ? toZone(row) : null;
  }

  async listSensitiveZones(): Promise<ZoneModel[]> {
    const rows = await (this.prisma as any).wildlifeZone.findMany({
      where: { deletedAt: null, isSensitive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return (rows as any[]).map(toZone);
  }
}

/* ------------------------------------------------------------------ *
 * 观测（公开行 + 受限精确行）
 * ------------------------------------------------------------------ */

function toSighting(row: any): SightingModel {
  return {
    id: row.id,
    zoneId: row.zoneId ?? null,
    species: row.species,
    status: row.status,
    geoLat: numOrNull(row.geoLat),
    geoLng: numOrNull(row.geoLng),
    geoFuzzLevel: row.geoFuzzLevel ?? 'grid',
    fuzzRadiusM: num(row.fuzzRadiusM),
    gridCellKey: row.gridCellKey ?? null,
    photoUrls: Array.isArray(row.photoUrls) ? row.photoUrls : [],
    healthConcern: Boolean(row.healthConcern),
    reporterId: row.reporterId,
    observedAt: date(row.observedAt),
    observedAtFuzzed: date(row.observedAtFuzzed),
    publishDelayDays: num(row.publishDelayDays),
    individualId: row.individualId ?? null,
    autoSpeciesId: row.autoSpeciesId ?? null,
    autoConfidence: numOrNull(row.autoConfidence),
    classifiedBy: row.classifiedBy ?? 'manual',
    correctedFromSpeciesId: row.correctedFromSpeciesId ?? null,
    note: row.note ?? null,
    isAnonymous: Boolean(row.isAnonymous),
    moderatedBy: row.moderatedBy ?? null,
    moderatedAt: dateOrNull(row.moderatedAt),
    rejectReason: row.rejectReason ?? null,
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
    deletedAt: dateOrNull(row.deletedAt),
  };
}

function toExact(row: any): ExactSightingModel {
  return {
    sightingId: row.sightingId,
    exactLat: num(row.exactLat),
    exactLng: num(row.exactLng),
    exactAccuracyM: numOrNull(row.exactAccuracyM),
    exactObservedAt: date(row.exactObservedAt),
  };
}

@Injectable()
export class WildlifeSightingPrismaRepository implements WildlifeSightingRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get delegate(): any {
    return (this.prisma as any).wildlifeSighting;
  }

  list(filter: SightingListFilter): Promise<Page<SightingModel>> {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filter.publishedOnly) where.status = 'PUBLISHED';
    if (filter.species) where.species = filter.species;
    if (filter.zoneId) where.zoneId = filter.zoneId;
    if (filter.publishedOnly && filter.now) {
      // 保护物种繁殖期的公开延迟（规格 §9.5）：要么没有延迟，要么已经过了延迟期
      const sevenDaysAgo = new Date(filter.now.getTime() - 7 * 24 * 60 * 60 * 1000);
      where.OR = [{ publishDelayDays: 0 }, { observedAtFuzzed: { lte: sevenDaysAgo } }];
    }
    return pageByCursor(this.delegate, filter, { where }, toSighting);
  }

  async findById(id: string): Promise<SightingModel | null> {
    const row = await this.delegate.findUnique({ where: { id } });
    return row ? toSighting(row) : null;
  }

  async create(input: CreateSightingInput): Promise<SightingModel> {
    const row = await this.delegate.create({ data: { ...input } });
    return toSighting(row);
  }

  async update(id: string, input: UpdateSightingInput): Promise<SightingModel> {
    const row = await this.delegate.update({ where: { id }, data: { ...input } });
    return toSighting(row);
  }

  async softDelete(id: string, at: Date): Promise<void> {
    await this.delegate.update({ where: { id }, data: { deletedAt: at } });
  }

  async countDistinctReportersInCell(
    cellKey: string,
    from: Date,
    to: Date,
    excludeReporterId?: string,
  ): Promise<number> {
    const rows = await this.delegate.findMany({
      where: {
        gridCellKey: cellKey,
        observedAt: { gte: from, lte: to },
        deletedAt: null,
        status: { not: 'REJECTED' },
        ...(excludeReporterId ? { reporterId: { not: excludeReporterId } } : {}),
      },
      select: { reporterId: true },
      distinct: ['reporterId'],
    });
    return (rows as unknown[]).length;
  }

  async saveExact(input: CreateExactInput): Promise<ExactSightingModel> {
    const row = await (this.prisma as any).wildlifeSightingExact.upsert({
      where: { sightingId: input.sightingId },
      create: { ...input },
      update: { ...input },
    });
    return toExact(row);
  }

  async findExact(sightingId: string): Promise<ExactSightingModel | null> {
    const row = await (this.prisma as any).wildlifeSightingExact.findUnique({
      where: { sightingId },
    });
    return row ? toExact(row) : null;
  }

  async listPublishedPoints(filter: PublishedPointFilter): Promise<ObservationPoint[]> {
    const rows = await this.delegate.findMany({
      where: {
        species: filter.speciesId,
        status: 'PUBLISHED',
        deletedAt: null,
        observedAt: { gte: filter.from, lte: filter.to },
        geoLat: { not: null },
        geoLng: { not: null },
        ...(filter.individualId ? { individualId: filter.individualId } : {}),
      },
      // 稳定排序：同输入必须同输出（T19 可复现）
      orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
    });
    return (rows as any[]).map((row) => ({
      id: row.id,
      point: { lat: num(row.geoLat), lng: num(row.geoLng) },
      observedAt: date(row.observedAtFuzzed),
      reporterId: row.reporterId,
    }));
  }

  async listPublishedSpeciesIds(): Promise<string[]> {
    const rows = await this.delegate.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      select: { species: true },
      distinct: ['species'],
    });
    return (rows as any[]).map((row) => row.species as string);
  }
}

/* ------------------------------------------------------------------ *
 * 媒体
 * ------------------------------------------------------------------ */

function toMedia(row: any): MediaModel {
  return {
    id: row.id,
    sightingId: row.sightingId ?? null,
    storageKey: row.storageKey,
    thumbKey: row.thumbKey,
    widthPx: num(row.widthPx),
    heightPx: num(row.heightPx),
    byteSize: num(row.byteSize),
    mimeType: row.mimeType,
    sha256: row.sha256,
    clientPhotoId: row.clientPhotoId,
    sortOrder: num(row.sortOrder),
    uploadedBy: row.uploadedBy ?? null,
    createdAt: date(row.createdAt),
  };
}

@Injectable()
export class WildlifeMediaPrismaRepository implements WildlifeMediaRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get delegate(): any {
    return (this.prisma as any).wildlifeMedia;
  }

  async create(input: CreateMediaInput): Promise<MediaModel> {
    const row = await this.delegate.create({ data: { ...input } });
    return toMedia(row);
  }

  async findById(id: string): Promise<MediaModel | null> {
    const row = await this.delegate.findUnique({ where: { id } });
    return row ? toMedia(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<MediaModel[]> {
    if (ids.length === 0) return [];
    const rows = await this.delegate.findMany({ where: { id: { in: [...ids] } } });
    return (rows as any[]).map(toMedia);
  }

  async findByUploaderAndClientPhotoId(
    uploadedBy: string,
    clientPhotoId: string,
  ): Promise<MediaModel | null> {
    const row = await this.delegate.findFirst({ where: { uploadedBy, clientPhotoId } });
    return row ? toMedia(row) : null;
  }

  async attachToSighting(mediaIds: readonly string[], sightingId: string): Promise<number> {
    if (mediaIds.length === 0) return 0;
    const result = await this.delegate.updateMany({
      where: { id: { in: [...mediaIds] }, sightingId: null },
      data: { sightingId },
    });
    return num(result?.count);
  }

  async countBySighting(sightingId: string): Promise<number> {
    return num(await this.delegate.count({ where: { sightingId } }));
  }

  async listOrphans(before: Date, limit: number): Promise<MediaModel[]> {
    const rows = await this.delegate.findMany({
      where: { sightingId: null, createdAt: { lt: before } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return (rows as any[]).map(toMedia);
  }

  async deleteByIds(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.delegate.deleteMany({ where: { id: { in: [...ids] } } });
    return num(result?.count);
  }
}

/* ------------------------------------------------------------------ *
 * 派生只读：热点 + 轨迹
 * ------------------------------------------------------------------ */

function toSpot(row: any): SpotModel {
  return {
    id: row.id,
    speciesId: row.speciesId,
    zoneId: row.zoneId ?? null,
    centroidLat: num(row.centroidLat),
    centroidLng: num(row.centroidLng),
    radiusM: num(row.radiusM),
    sightingCount: num(row.sightingCount),
    distinctReporters: num(row.distinctReporters),
    firstSeenAt: date(row.firstSeenAt),
    lastSeenAt: date(row.lastSeenAt),
    hourHistogram: Array.isArray(row.hourHistogram) ? row.hourHistogram : [],
    confidence: num(row.confidence),
    algorithmVersion: row.algorithmVersion,
    computedAt: date(row.computedAt),
  };
}

function toTrack(row: any): TrackModel {
  return {
    id: row.id,
    speciesId: row.speciesId,
    individualId: row.individualId ?? null,
    spotIds: Array.isArray(row.spotIds) ? row.spotIds : [],
    pathGeoJson: row.pathGeoJson,
    totalDistanceM: num(row.totalDistanceM),
    spanStartAt: date(row.spanStartAt),
    spanEndAt: date(row.spanEndAt),
    sightingCount: num(row.sightingCount),
    method: row.method ?? 'dbscan-chain',
    confidence: num(row.confidence),
    // 恒为 true：映射层也强制成 true，防止任何写入路径把它写成 false
    isInferred: true,
    algorithmVersion: row.algorithmVersion,
    computedAt: date(row.computedAt),
  };
}

@Injectable()
export class WildlifeDerivedPrismaRepository implements WildlifeDerivedRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get spotDelegate(): any {
    return (this.prisma as any).wildlifeSpot;
  }

  private get trackDelegate(): any {
    return (this.prisma as any).wildlifeTrack;
  }

  async replaceSpotsForSpecies(
    speciesId: string,
    computedAt: Date,
    spots: readonly DerivedSpotInput[],
  ): Promise<SpotModel[]> {
    const create = spots.length
      ? [this.spotDelegate.createMany({ data: spots.map((s) => ({ ...s })) })]
      : [];
    await (this.prisma as any).$transaction([
      this.spotDelegate.deleteMany({ where: { speciesId } }),
      ...create,
    ]);
    return this.readInInputOrder(this.spotDelegate, spots, toSpot);
  }

  async replaceTracksForSpecies(
    speciesId: string,
    computedAt: Date,
    tracks: readonly DerivedTrackInput[],
  ): Promise<TrackModel[]> {
    const create = tracks.length
      ? [this.trackDelegate.createMany({ data: tracks.map((t) => ({ ...t })) })]
      : [];
    await (this.prisma as any).$transaction([
      this.trackDelegate.deleteMany({ where: { speciesId } }),
      ...create,
    ]);
    return this.readInInputOrder(this.trackDelegate, tracks, toTrack);
  }

  /**
   * 按**传入顺序**读回刚写入的行。
   *
   * 为什么需要它：`createMany` 不返回 id，而调用方要用下标建立
   * "轨迹点 ↔ 热点"的映射。因此应用层先分配 id，这里按 id 顺序对齐返回。
   */
  private async readInInputOrder<TRow extends { id: string }, TModel>(
    delegate: { findMany(args: any): Promise<TRow[]> },
    inputs: readonly { id?: string }[],
    toModel: (row: TRow) => TModel,
  ): Promise<TModel[]> {
    const ids = inputs.map((item) => item.id).filter((id): id is string => typeof id === 'string');
    if (ids.length === 0) return [];
    const rows = (await delegate.findMany({ where: { id: { in: ids } } })) as TRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids
      .map((id) => byId.get(id))
      .filter((row): row is TRow => row !== undefined)
      .map(toModel);
  }

  listSpots(filter: SpotListFilter): Promise<Page<SpotModel>> {
    const where: Record<string, unknown> = {
      // ≥24h 聚合延迟：防止平台变成"围观召集工具"（规格 §8.1 E10）
      computedAt: { lte: filter.computedBefore },
      confidence: { gte: filter.minConfidence },
    };
    if (filter.speciesId) where.speciesId = filter.speciesId;
    if (filter.zoneId) where.zoneId = filter.zoneId;
    return pageByCursor(this.spotDelegate, filter, { where }, toSpot);
  }

  listTracks(filter: TrackListFilter): Promise<Page<TrackModel>> {
    const where: Record<string, unknown> = { computedAt: { lte: filter.computedBefore } };
    if (filter.speciesId) where.speciesId = filter.speciesId;
    if (filter.individualId) where.individualId = filter.individualId;
    return pageByCursor(this.trackDelegate, filter, { where }, toTrack);
  }

  async findTrackById(id: string): Promise<TrackModel | null> {
    const row = await this.trackDelegate.findUnique({ where: { id } });
    return row ? toTrack(row) : null;
  }
}

/* ------------------------------------------------------------------ *
 * 命名个体
 * ------------------------------------------------------------------ */

function toIndividual(row: any): IndividualModel {
  return {
    id: row.id,
    name: row.name,
    speciesId: row.speciesId,
    description: row.description ?? null,
    coverPhotoUrl: row.coverPhotoUrl ?? null,
    status: row.status,
    isActive: row.isActive !== false,
    createdBy: row.createdBy,
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
    deletedAt: dateOrNull(row.deletedAt),
  };
}

@Injectable()
export class WildlifeIndividualPrismaRepository implements WildlifeIndividualRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get delegate(): any {
    return (this.prisma as any).wildlifeIndividual;
  }

  list(filter: {
    cursor?: string;
    limit: number;
    speciesId?: string;
    publishedOnly?: boolean;
  }): Promise<Page<IndividualModel>> {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filter.publishedOnly) where.status = 'PUBLISHED';
    if (filter.speciesId) where.speciesId = filter.speciesId;
    return pageByCursor(this.delegate, filter, { where }, toIndividual);
  }

  async findById(id: string): Promise<IndividualModel | null> {
    const row = await this.delegate.findUnique({ where: { id } });
    return row ? toIndividual(row) : null;
  }

  async findByName(speciesId: string, name: string): Promise<IndividualModel | null> {
    const row = await this.delegate.findFirst({ where: { speciesId, name } });
    return row ? toIndividual(row) : null;
  }

  async create(input: CreateIndividualInput): Promise<IndividualModel> {
    const row = await this.delegate.create({ data: { ...input } });
    return toIndividual(row);
  }

  async update(id: string, input: Partial<CreateIndividualInput>): Promise<IndividualModel> {
    const row = await this.delegate.update({ where: { id }, data: { ...input } });
    return toIndividual(row);
  }
}
