/**
 * wildlife 传输层校验（zod）—— data 层职责：**校验不可信输入**。
 *
 * domain 模型是类型真相；这里用类型级断言保证 schema 输出与 domain 模型
 * 双向可赋值 —— schema 一旦漂移，`tsc` 立刻报错。
 *
 * ⚠️ 关于隐私的两个**硬断言**（规格 §2.7 / §11.2 T15）：
 * 1. `WildlifeSighting` 的 schema **没有** `reporterId` / `exactLat` / `exactLng` /
 *    `exactObservedAt` 字段。后端多返回的字段会被 zod 丢弃（strip 模式），
 *    客户端**结构上不存在**精确坐标与上报人 id 的落点。
 * 2. `geo` 允许为 `null`（敏感区 / k-匿名不足）—— 这是**正常情况**，不是脏数据。
 */
import { z } from 'zod';

import type { CampusBasemapResponse } from '@/domain/models/wildlife/basemap';
import type { FeedingPolicy, SpeciesTaxonomy, TaxonRank, WildlifeZone } from '@/domain/models/wildlife/species';
import type {
  ClassificationSource,
  GeoWithheldReason,
  SightingStatus,
  UploadedMedia,
  WildlifeSighting,
} from '@/domain/models/wildlife/sightings';
import type { WildlifeIndividual, WildlifeSpot, WildlifeTrack } from '@/domain/models/wildlife/tracks';

/** 类型级断言：From 必须可赋值给 To（不产生运行时代码） */
type AssertAssignable<From extends To, To> = true;

/* ------------------------------------------------------------------ *
 * 基础枚举
 * ------------------------------------------------------------------ */

export const feedingPolicySchema = z.enum(['allowed', 'discouraged', 'forbidden']);
export const taxonRankSchema = z.enum(['species', 'genus', 'family', 'order']);
export const sightingStatusSchema = z.enum(['PENDING', 'PUBLISHED', 'REJECTED']);
export const classificationSourceSchema = z.enum(['manual', 'vision_api', 'ondevice', 'fallback']);
export const geoWithheldSchema = z.enum(['sensitive-zone', 'k-anonymity']);
export const basemapLicenseSchema = z.enum(['original', 'odbl', 'school-authorized']);

const latLngSchema = z.object({ lat: z.number(), lng: z.number() });

/* ------------------------------------------------------------------ *
 * 底图（规格 §1.4）
 * ------------------------------------------------------------------ */

export const campusBasemapSchema = z.object({
  version: z.string().min(1),
  imageUrl: z.string().min(1),
  widthPx: z.int().positive(),
  heightPx: z.int().positive(),
  affine: z.tuple([
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
  ]),
  calibrationRmsePx: z.number().nonnegative(),
  controlPointCount: z.int().nonnegative(),
  attribution: z.string(),
  license: basemapLicenseSchema,
});

/* ------------------------------------------------------------------ *
 * 物种（规格 §2.5）
 * ------------------------------------------------------------------ */

export const speciesSchema = z.object({
  id: z.string().min(1),
  scientificName: z.string().min(1),
  commonNameZh: z.string().min(1),
  commonNameEn: z.string().nullish(),
  taxonRank: taxonRankSchema,
  parentId: z.string().nullish(),
  isProtected: z.boolean(),
  isNestingSensitive: z.boolean(),
  nestingMonths: z.array(z.int().min(1).max(12)),
  defaultFeedingPolicy: feedingPolicySchema,
  externalIds: z.record(z.string(), z.union([z.string(), z.number()])),
  iconUrl: z.string().nullish(),
  isActive: z.boolean(),
});

/* ------------------------------------------------------------------ *
 * 区域（规格 §2.2）
 * ------------------------------------------------------------------ */

export const wildlifeZoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  speciesIds: z.array(z.string()),
  geo: latLngSchema.extend({ radiusM: z.number().positive() }),
  feedingPolicy: feedingPolicySchema,
  note: z.string().nullish(),
  fuzzRadiusM: z.int().positive(),
  isSensitive: z.boolean(),
  noticeText: z.string().nullish(),
  sortOrder: z.int(),
});

/* ------------------------------------------------------------------ *
 * 观测（规格 §2.6）—— 注意这里**没有**精确坐标与 reporterId
 * ------------------------------------------------------------------ */

export const wildlifeSightingSchema = z.object({
  id: z.string().min(1),
  zoneId: z.string().nullish(),
  species: z.string().min(1),
  speciesNameZh: z.string(),
  status: sightingStatusSchema,
  /** 模糊化后的公开坐标；`null` = 坐标被扣留（敏感区 / k-匿名不足） */
  geo: latLngSchema.nullable(),
  geoWithheld: geoWithheldSchema.nullish(),
  observedAt: z.iso.datetime(),
  observedAtFuzzed: z.iso.datetime(),
  individualId: z.string().nullish(),
  autoSpeciesId: z.string().nullish(),
  autoConfidence: z.number().min(0).max(1).nullish(),
  classifiedBy: classificationSourceSchema,
  correctedFromSpeciesId: z.string().nullish(),
  note: z.string().nullish(),
  isAnonymous: z.boolean(),
  reporterLabel: z.string(),
  photoUrls: z.array(z.string()),
  healthConcern: z.boolean(),
  createdAt: z.iso.datetime(),
  moderatedBy: z.string().nullish(),
  moderatedAt: z.iso.datetime().nullish(),
  rejectReason: z.string().nullish(),
});

/* ------------------------------------------------------------------ *
 * 热点与轨迹（规格 §2.3 / §2.4）
 * ------------------------------------------------------------------ */

export const wildlifeSpotSchema = z.object({
  id: z.string().min(1),
  speciesId: z.string().min(1),
  speciesNameZh: z.string(),
  zoneId: z.string().nullish(),
  centroid: latLngSchema,
  radiusM: z.number().nonnegative(),
  sightingCount: z.int().nonnegative(),
  distinctReporters: z.int().nonnegative(),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  hourHistogram: z.array(z.int().nonnegative()),
  confidence: z.number().min(0).max(1),
  computedAt: z.iso.datetime(),
  /** 契约的一部分：客户端**无法**把聚合热点当实时位置展示 */
  isAggregated: z.literal(true),
  aggregationDelayHours: z.int().positive(),
});

export const geoJsonLineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});

export const wildlifeTrackSchema = z.object({
  id: z.string().min(1),
  speciesId: z.string().min(1),
  speciesNameZh: z.string(),
  individualId: z.string().nullish(),
  spotIds: z.array(z.string()),
  path: geoJsonLineStringSchema,
  totalDistanceM: z.number().nonnegative(),
  spanStartAt: z.iso.datetime(),
  spanEndAt: z.iso.datetime(),
  sightingCount: z.int().nonnegative(),
  method: z.literal('dbscan-chain'),
  confidence: z.number().min(0).max(1),
  /** **恒为 true**（规格 §2.4）—— schema 层面也不允许 false */
  isInferred: z.literal(true),
  disclaimer: z.string().min(1),
  computedAt: z.iso.datetime(),
});

export const wildlifeIndividualSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  speciesId: z.string().min(1),
  speciesNameZh: z.string(),
  description: z.string().nullish(),
  coverPhotoUrl: z.string().nullish(),
  status: sightingStatusSchema,
  isActive: z.boolean(),
});

/* ------------------------------------------------------------------ *
 * 媒体与分类（规格 §4.5 / §5.3）
 * ------------------------------------------------------------------ */

export const uploadedMediaSchema = z.object({
  mediaId: z.string().min(1),
  thumbUrl: z.string(),
  widthPx: z.int().positive(),
  heightPx: z.int().positive(),
  sha256: z.string().min(1),
  clientPhotoId: z.string().min(1),
});

export const speciesPredictionSchema = z.object({
  speciesId: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

/* ------------------------------------------------------------------ *
 * 分页信封
 * ------------------------------------------------------------------ */

function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.int().nonnegative().optional(),
  });
}

export const speciesPageSchema = pageSchema(speciesSchema);
export const wildlifeZonePageSchema = pageSchema(wildlifeZoneSchema);
export const wildlifeSightingPageSchema = pageSchema(wildlifeSightingSchema);
export const wildlifeSpotPageSchema = pageSchema(wildlifeSpotSchema);
export const wildlifeTrackPageSchema = pageSchema(wildlifeTrackSchema);
export const wildlifeIndividualPageSchema = pageSchema(wildlifeIndividualSchema);
export const speciesPredictionListSchema = z.array(speciesPredictionSchema);

/* ------------------------------------------------------------------ *
 * 编译期一致性断言（schema ↔ domain）
 * ------------------------------------------------------------------ */

export type __FeedingPolicyMatches = AssertAssignable<
  z.infer<typeof feedingPolicySchema>,
  FeedingPolicy
>;
export type __TaxonRankMatches = AssertAssignable<z.infer<typeof taxonRankSchema>, TaxonRank>;
export type __SightingStatusMatches = AssertAssignable<
  z.infer<typeof sightingStatusSchema>,
  SightingStatus
>;
export type __ClassificationSourceMatches = AssertAssignable<
  z.infer<typeof classificationSourceSchema>,
  ClassificationSource
>;
export type __GeoWithheldMatches = AssertAssignable<
  z.infer<typeof geoWithheldSchema>,
  GeoWithheldReason
>;

export type __BasemapSchemaIsDomain = AssertAssignable<
  z.infer<typeof campusBasemapSchema>,
  CampusBasemapResponse
>;

export type __SpeciesSchemaIsDomain = AssertAssignable<
  z.infer<typeof speciesSchema>,
  SpeciesTaxonomy
>;
export type __SpeciesDomainIsSchema = AssertAssignable<
  SpeciesTaxonomy,
  z.infer<typeof speciesSchema>
>;

export type __ZoneSchemaIsDomain = AssertAssignable<z.infer<typeof wildlifeZoneSchema>, WildlifeZone>;
export type __ZoneDomainIsSchema = AssertAssignable<WildlifeZone, z.infer<typeof wildlifeZoneSchema>>;

export type __SightingSchemaIsDomain = AssertAssignable<
  z.infer<typeof wildlifeSightingSchema>,
  WildlifeSighting
>;
export type __SightingDomainIsSchema = AssertAssignable<
  WildlifeSighting,
  z.infer<typeof wildlifeSightingSchema>
>;

export type __SpotSchemaIsDomain = AssertAssignable<z.infer<typeof wildlifeSpotSchema>, WildlifeSpot>;
export type __SpotDomainIsSchema = AssertAssignable<WildlifeSpot, z.infer<typeof wildlifeSpotSchema>>;

export type __TrackSchemaIsDomain = AssertAssignable<
  z.infer<typeof wildlifeTrackSchema>,
  WildlifeTrack
>;
export type __TrackDomainIsSchema = AssertAssignable<
  WildlifeTrack,
  z.infer<typeof wildlifeTrackSchema>
>;

export type __IndividualSchemaIsDomain = AssertAssignable<
  z.infer<typeof wildlifeIndividualSchema>,
  WildlifeIndividual
>;
export type __IndividualDomainIsSchema = AssertAssignable<
  WildlifeIndividual,
  z.infer<typeof wildlifeIndividualSchema>
>;

export type __MediaSchemaIsDomain = AssertAssignable<
  z.infer<typeof uploadedMediaSchema>,
  UploadedMedia
>;
export type __MediaDomainIsSchema = AssertAssignable<
  UploadedMedia,
  z.infer<typeof uploadedMediaSchema>
>;

/* ------------------------------------------------------------------ *
 * 解析助手
 * ------------------------------------------------------------------ */

/** 校验失败时的可读问题清单 */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

export interface ParseOk<T> {
  ok: true;
  value: T;
}
export interface ParseFail {
  ok: false;
  issues: string[];
}

function parseWith<T>(schema: z.ZodType<T>, input: unknown): ParseOk<T> | ParseFail {
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: formatZodIssues(result.error) };
}

export function safeParseCampusBasemap(input: unknown): ParseOk<CampusBasemapResponse> | ParseFail {
  return parseWith(campusBasemapSchema, input);
}

export function safeParseSpeciesList(input: unknown): ParseOk<SpeciesTaxonomy[]> | ParseFail {
  return parseWith(z.array(speciesSchema), input);
}

export function safeParseZone(input: unknown): ParseOk<WildlifeZone> | ParseFail {
  return parseWith(wildlifeZoneSchema, input);
}

export function safeParseZonePage(
  input: unknown,
): ParseOk<{ items: WildlifeZone[]; nextCursor: string | null; total?: number }> | ParseFail {
  return parseWith(wildlifeZonePageSchema, input);
}

export function safeParseSighting(input: unknown): ParseOk<WildlifeSighting> | ParseFail {
  return parseWith(wildlifeSightingSchema, input);
}

export function safeParseSightingPage(
  input: unknown,
): ParseOk<{ items: WildlifeSighting[]; nextCursor: string | null; total?: number }> | ParseFail {
  return parseWith(wildlifeSightingPageSchema, input);
}

export function safeParseSpotPage(
  input: unknown,
): ParseOk<{ items: WildlifeSpot[]; nextCursor: string | null; total?: number }> | ParseFail {
  return parseWith(wildlifeSpotPageSchema, input);
}

export function safeParseTrack(input: unknown): ParseOk<WildlifeTrack> | ParseFail {
  return parseWith(wildlifeTrackSchema, input);
}

export function safeParseTrackPage(
  input: unknown,
): ParseOk<{ items: WildlifeTrack[]; nextCursor: string | null; total?: number }> | ParseFail {
  return parseWith(wildlifeTrackPageSchema, input);
}

export function safeParseIndividualPage(
  input: unknown,
): ParseOk<{ items: WildlifeIndividual[]; nextCursor: string | null; total?: number }> | ParseFail {
  return parseWith(wildlifeIndividualPageSchema, input);
}

export function safeParseUploadedMedia(input: unknown): ParseOk<UploadedMedia> | ParseFail {
  return parseWith(uploadedMediaSchema, input);
}

export function safeParseSpeciesPredictions(input: unknown): ParseOk<{ speciesId: string; confidence: number }[]> | ParseFail {
  return parseWith(speciesPredictionListSchema, input);
}
