/**
 * wildlife mock 适配器（契约 §7 硬规则 4：必须有 mock，UI 才能脱离后端开发）。
 *
 * 行为对齐真实后端的**契约形状**：
 * - 返回 `Result<Page<...>, ApiError>`，错误码用冻结的 `ApiErrorCode`；
 * - 所有出站数据都过一遍 zod schema —— mock 也不能绕过契约校验；
 * - **隐私规则在 mock 里也真的执行**（不是假动作）：
 *   · 敏感区上报 → 公开坐标 `null`，只给 `zoneId`（规格 §9.3 ①）
 *   · 普通区上报 → 网格吸附到区域的 `fuzzRadiusM`（规格 §9.3 ②）
 *   · 不满足 k-匿名（< 3 位不同上报人）的热点**不进公开列表**（规格 §9.3 ④）
 *   · 保护物种的 `moderate(PUBLISHED)` **必须两名审核员**（规格 §2.10）
 *
 * 未实现（如实说明）：确定性加噪的 HMAC 部分在**服务端**（需要密钥，规格 §9.3 ③），
 * mock 只做网格吸附 —— 因此 mock 的模糊强度**弱于**真实后端，不能拿 mock 做隐私评估。
 */
import type { ApiError, ApiErrorCode, Page } from '@kedaya/contracts';
import { coarseTime, err, ok, snapToGrid, type Result } from '@kedaya/shared';

import {
  WILDLIFE_BASEMAP,
  isInCampus,
  resolveCampusBasemap,
  type CampusBasemap,
} from '@/domain/models/wildlife/basemap';
import { strictestFeedingPolicy, type SpeciesTaxonomy, type WildlifeZone } from '@/domain/models/wildlife/species';
import {
  SIGHTING_LIMITS,
  filterSightings,
  sortSightingsByObservedDesc,
  type CreateSightingInput,
  type ModerateSightingInput,
  type SightingListQuery,
  type UploadedMedia,
  type WildlifeSighting,
} from '@/domain/models/wildlife/sightings';
import { spotMeetsKAnonymity, type WildlifeIndividual, type WildlifeSpot, type WildlifeTrack } from '@/domain/models/wildlife/tracks';
import type {
  IndividualListQuery,
  SpeciesPrediction,
  SpotListQuery,
  TrackListQuery,
  UploadMediaInput,
  WildlifeFailureMode,
  WildlifeRepository,
  ZoneListQuery,
} from '@/domain/ports/wildlife';

import {
  safeParseCampusBasemap,
  safeParseIndividualPage,
  safeParseSighting,
  safeParseSightingPage,
  safeParseSpeciesList,
  safeParseSpotPage,
  safeParseTrack,
  safeParseTrackPage,
  safeParseUploadedMedia,
  safeParseZone,
  safeParseZonePage,
} from '../schemas/wildlife';
import { slicePage } from './cursor';
import {
  createIndividualSeed,
  createSightingSeed,
  createSpeciesSeed,
  createSpotSeed,
  createTrackSeed,
  createZoneSeed,
} from './fixtures/wildlife';

export interface MockWildlifeOptions {
  /** 注入时钟（测试用固定时间） */
  now?: () => Date;
  /** 模拟网络延迟，用于演示骨架屏 */
  latencyMs?: number;
  /** 故障演练：'error' 时所有请求返回 UPSTREAM_UNAVAILABLE */
  failureMode?: WildlifeFailureMode;
  /**
   * 分类能力（规格 §5.4 三档模式）：
   * - `'manual'`（默认）→ `classify()` 返回**空数组**（验收 T43）
   * - `'server'` → 返回 top-K 建议（演示"自动分类为可选增强"）
   */
  classifierMode?: 'manual' | 'server' | 'off';
}

export interface MockWildlifeRepository extends WildlifeRepository {
  setFailureMode(mode: WildlifeFailureMode): void;
  getFailureMode(): WildlifeFailureMode;
  setClassifierMode(mode: 'manual' | 'server' | 'off'): void;
  getClassifierMode(): 'manual' | 'server' | 'off';
  /** 当前内存中的待审核条数（管理端显示"本次会话新增"用） */
  pendingCount(): number;
  /** 恢复到初始数据集 */
  reset(): void;
}

function apiError(code: ApiErrorCode, message: string, details?: unknown): ApiError {
  return details === undefined ? { code, message } : { code, message, details };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** mock 用的确定性"内容哈希"（真实后端是 sha256；这里不引入 crypto 依赖） */
export function fakeSha256(name: string, size: number): string {
  let hash = 2166136261;
  const input = `${name}:${size}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `${hex}${hex}${hex}${hex}`.slice(0, 64);
}

export function createMockWildlifeRepository(
  options: MockWildlifeOptions = {},
): MockWildlifeRepository {
  const now = options.now ?? (() => new Date());
  const latencyMs = options.latencyMs ?? 240;
  let failureMode: WildlifeFailureMode = options.failureMode ?? 'none';
  let classifierMode: 'manual' | 'server' | 'off' = options.classifierMode ?? 'manual';

  const initialSpecies = (): SpeciesTaxonomy[] => createSpeciesSeed();
  const initialZones = (): WildlifeZone[] => createZoneSeed();
  const initialIndividuals = (): WildlifeIndividual[] => createIndividualSeed();

  let species: SpeciesTaxonomy[] = initialSpecies();
  let zones: WildlifeZone[] = initialZones();
  let individuals: WildlifeIndividual[] = initialIndividuals();
  let sightings: WildlifeSighting[] = createSightingSeed(now());
  let spots: WildlifeSpot[] = createSpotSeed(now());
  let tracks: WildlifeTrack[] = createTrackSeed(now());

  let mediaSeq = 0;
  const mediaStore = new Map<string, UploadedMedia>();
  /** 已关联到某条 sighting 的 mediaId（防止一图多报，规格 §10.3） */
  const linkedMedia = new Set<string>();
  /** 保护物种双人复核的第一票（moderatorId） */
  const firstModeratorVote = new Map<string, string>();
  /** 上报落在"禁投喂"区域的历史（演示 E1+E2 同时生效；真实后端会用于告示与统计） */
  const forbiddenZoneHits: string[] = [];

  const delay = async (): Promise<void> => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
  };

  const failIfNeeded = (): ApiError | null =>
    failureMode === 'error'
      ? apiError('UPSTREAM_UNAVAILABLE', '动物地图服务暂时不可用（mock 故障演练）')
      : null;

  const speciesOf = (id: string): SpeciesTaxonomy | undefined => species.find((s) => s.id === id);
  const zoneOf = (id: string | null | undefined): WildlifeZone | undefined =>
    id ? zones.find((z) => z.id === id) : undefined;

  const ensure = <T>(
    parsed: { ok: true; value: T } | { ok: false; issues: string[] },
    label: string,
  ): Result<T, ApiError> =>
    parsed.ok
      ? ok(parsed.value)
      : err(apiError('INTERNAL', `mock 数据不符合冻结契约（${label}）`, { issues: parsed.issues }));

  return {
    async basemap(): Promise<Result<CampusBasemap, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      const parsed = safeParseCampusBasemap({
        version: WILDLIFE_BASEMAP.version,
        imageUrl: WILDLIFE_BASEMAP.imageUrl,
        widthPx: WILDLIFE_BASEMAP.widthPx,
        heightPx: WILDLIFE_BASEMAP.heightPx,
        affine: [...WILDLIFE_BASEMAP.affine],
        calibrationRmsePx: WILDLIFE_BASEMAP.calibrationRmsePx,
        controlPointCount: WILDLIFE_BASEMAP.controlPointCount,
        attribution: WILDLIFE_BASEMAP.attribution,
        license: WILDLIFE_BASEMAP.license,
      });
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 底图配置不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(resolveCampusBasemap(parsed.value));
    },

    async species(): Promise<Result<SpeciesTaxonomy[], ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      return ensure(safeParseSpeciesList(clone(species)), 'species');
    },

    async zones(query: ZoneListQuery = {}): Promise<Result<Page<WildlifeZone>, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      const filtered = [...zones]
        .filter((zone) => (query.species ? zone.speciesIds.includes(query.species) : true))
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const page = slicePage(filtered, query.cursor, query.limit, 20);
      return ensure(safeParseZonePage(clone(page)), 'zones');
    },

    async zoneDetail(id: string): Promise<Result<WildlifeZone, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      const found = zoneOf(id);
      if (!found) return err(apiError('NOT_FOUND', `区域不存在：${id}`));
      return ensure(safeParseZone(clone(found)), 'zone');
    },

    async spots(query: SpotListQuery = {}): Promise<Result<Page<WildlifeSpot>, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      const minConfidence = query.minConfidence ?? 0.3;
      const filtered = spots
        // ⚠️ k-匿名（规格 §9.3 ④）：不足 3 位不同上报人的热点**不公开**
        .filter((spot) => spotMeetsKAnonymity(spot))
        .filter((spot) => (query.species ? spot.speciesId === query.species : true))
        .filter((spot) => (query.zoneId ? spot.zoneId === query.zoneId : true))
        .filter((spot) => spot.confidence >= minConfidence)
        .sort((a, b) => b.confidence - a.confidence);
      const page = slicePage(filtered, query.cursor, query.limit, 50);
      return ensure(safeParseSpotPage(clone(page)), 'spots');
    },

    async tracks(query: TrackListQuery = {}): Promise<Result<Page<WildlifeTrack>, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      const filtered = tracks
        .filter((track) => (query.species ? track.speciesId === query.species : true))
        .filter((track) =>
          query.individualId === undefined ? true : track.individualId === query.individualId,
        );
      const page = slicePage(filtered, query.cursor, query.limit, 20);
      return ensure(safeParseTrackPage(clone(page)), 'tracks');
    },

    async trackDetail(id: string): Promise<Result<WildlifeTrack, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      const found = tracks.find((t) => t.id === id);
      if (!found) return err(apiError('NOT_FOUND', `轨迹不存在：${id}`));
      return ensure(safeParseTrack(clone(found)), 'track');
    },

    async individuals(
      query: IndividualListQuery = {},
    ): Promise<Result<Page<WildlifeIndividual>, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      const filtered = individuals
        .filter((individual) => individual.isActive)
        .filter((individual) => (query.species ? individual.speciesId === query.species : true));
      const page = slicePage(filtered, query.cursor, query.limit, 20);
      return ensure(safeParseIndividualPage(clone(page)), 'individuals');
    },

    async sightings(
      query: SightingListQuery = {},
    ): Promise<Result<Page<WildlifeSighting>, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      // 公开列表只给 PUBLISHED；显式传 status 时按该状态过滤（审核队列用，见 README 偏差说明）
      const status = query.status ?? 'PUBLISHED';
      const filtered = sortSightingsByObservedDesc(
        filterSightings(sightings, {
          status,
          ...(query.species === undefined ? {} : { species: query.species }),
          ...(query.zoneId === undefined ? {} : { zoneId: query.zoneId }),
          ...(query.healthConcernOnly === undefined
            ? {}
            : { healthConcernOnly: query.healthConcernOnly }),
        }),
      );
      const page = slicePage(filtered, query.cursor, query.limit, 20);
      return ensure(safeParseSightingPage(clone(page)), 'sightings');
    },

    async sightingDetail(id: string): Promise<Result<WildlifeSighting, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      const found = sightings.find((s) => s.id === id);
      if (!found) return err(apiError('NOT_FOUND', `观测记录不存在：${id}`));
      return ensure(safeParseSighting(clone(found)), 'sighting');
    },

    async uploadMedia(input: UploadMediaInput): Promise<Result<UploadedMedia, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      if (!input.clientPhotoId.trim()) {
        return err(apiError('VALIDATION_FAILED', '缺少客户端幂等键 clientPhotoId'));
      }
      // 幂等：同一个 clientPhotoId 重试 → 返回**相同** mediaId（规格 §4.5 / 验收 T37）
      const existing = mediaStore.get(input.clientPhotoId);
      if (existing) return ensure(safeParseUploadedMedia(clone(existing)), 'media');

      const mime = input.file.type;
      if (!(SIGHTING_LIMITS.mediaMimeTypes as readonly string[]).includes(mime)) {
        return err(
          apiError('VALIDATION_FAILED', '只接受 JPEG / PNG / WebP 图片', {
            reason: 'MEDIA_UNSUPPORTED_TYPE',
          }),
        );
      }
      if (input.file.size > SIGHTING_LIMITS.mediaByteMax) {
        return err(
          apiError('VALIDATION_FAILED', '单张照片不能超过 5 MB', { reason: 'MEDIA_TOO_LARGE' }),
        );
      }

      mediaSeq += 1;
      const media: UploadedMedia = {
        mediaId: `wm-mock-${mediaSeq}`,
        // 真实后端会返回剥离 EXIF 后的缩略图 URL（规格 §4.3）
        thumbUrl: `/wildlife/photos/wm-mock-${mediaSeq}.webp`,
        widthPx: 1200,
        heightPx: 900,
        sha256: fakeSha256(input.file.name, input.file.size),
        clientPhotoId: input.clientPhotoId,
      };
      mediaStore.set(input.clientPhotoId, media);
      return ensure(safeParseUploadedMedia(clone(media)), 'media');
    },

    async createSighting(input: CreateSightingInput): Promise<Result<WildlifeSighting, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const speciesRef = speciesOf(input.species);
      if (!speciesRef || !speciesRef.isActive) {
        return err(
          apiError('VALIDATION_FAILED', '所选物种不存在或已下架', { reason: 'UNKNOWN_SPECIES' }),
        );
      }

      const observed = new Date(input.observedAt);
      if (Number.isNaN(observed.getTime())) {
        return err(
          apiError('VALIDATION_FAILED', '发现时间格式不正确', { reason: 'OBSERVED_AT_OUT_OF_RANGE' }),
        );
      }
      const earliest = now().getTime() - SIGHTING_LIMITS.observedPastDays * 24 * 60 * 60 * 1000;
      const latest = now().getTime() + SIGHTING_LIMITS.observedFutureMinutes * 60 * 1000;
      if (observed.getTime() < earliest || observed.getTime() > latest) {
        return err(
          apiError('VALIDATION_FAILED', '发现时间必须在过去 30 天内且不晚于当前时间', {
            reason: 'OBSERVED_AT_OUT_OF_RANGE',
          }),
        );
      }

      // ⚠️ 写入路径必须过校园边界（规格 §3.5 V5：这条能抓住 lat/lng 颠倒）
      if (!isInCampus(input.geo)) {
        return err(
          apiError('VALIDATION_FAILED', '坐标不在校园范围内', {
            reason: 'COORDINATE_OUT_OF_CAMPUS',
          }),
        );
      }

      if (input.mediaIds.length > SIGHTING_LIMITS.mediaMax) {
        return err(
          apiError('VALIDATION_FAILED', `最多 ${SIGHTING_LIMITS.mediaMax} 张照片`, {
            reason: 'MEDIA_TOO_MANY',
          }),
        );
      }
      const alreadyLinked = input.mediaIds.find((id) => linkedMedia.has(id));
      if (alreadyLinked) {
        return err(
          apiError('VALIDATION_FAILED', '该照片已关联到其它上报', { reason: 'MEDIA_ALREADY_LINKED' }),
        );
      }

      if (input.note && input.note.length > SIGHTING_LIMITS.noteMax) {
        return err(
          apiError('VALIDATION_FAILED', `备注不超过 ${SIGHTING_LIMITS.noteMax} 字`, {
            reason: 'CONTENT_REJECTED',
          }),
        );
      }

      if (input.ethicsAcknowledged !== true) {
        return err(
          apiError('VALIDATION_FAILED', '请先确认伦理守则', { reason: 'ETHICS_NOT_ACKNOWLEDGED' }),
        );
      }

      const zone = zoneOf(input.zoneId);
      // 区域投喂政策与物种默认政策取**较严者**（规格 §8.1 E1 + E2 同时生效）
      const effectivePolicy = strictestFeedingPolicy(
        zone?.feedingPolicy ?? 'allowed',
        speciesRef.defaultFeedingPolicy,
      );

      // —— 隐私：敏感区不给坐标；普通区网格吸附（规格 §9.3 ①②）——
      const gridM = zone?.fuzzRadiusM ?? 50;
      const publicGeo = zone?.isSensitive ? null : snapToGrid(input.geo, gridM);
      const observedAtFuzzed = coarseTime(observed.toISOString(), zone?.isSensitive ? 'day' : 'hour');

      let individualId = input.individualId;
      if (input.individualName) {
        const name = input.individualName.trim();
        const duplicate = individuals.some(
          (individual) => individual.speciesId === input.species && individual.name === name,
        );
        if (duplicate) {
          return err(apiError('CONFLICT', `该物种下已有个体叫「${name}」`, { reason: 'INDIVIDUAL_EXISTS' }));
        }
        const created: WildlifeIndividual = {
          id: `wi-mock-${individuals.length + 1}`,
          name,
          speciesId: input.species,
          speciesNameZh: speciesRef.commonNameZh,
          description: null,
          coverPhotoUrl: null,
          // 个体命名需审核后才公开（规格 §2.8）
          status: 'PENDING',
          isActive: true,
        };
        individuals = [...individuals, created];
        individualId = created.id;
      }

      const created: WildlifeSighting = {
        id: `ws-mock-${sightings.length + 1}`,
        zoneId: input.zoneId,
        species: input.species,
        speciesNameZh: speciesRef.commonNameZh,
        status: 'PENDING',
        geo: publicGeo,
        geoWithheld: publicGeo === null ? 'sensitive-zone' : null,
        observedAt: observed.toISOString(),
        observedAtFuzzed,
        individualId,
        autoSpeciesId: input.autoSpeciesId,
        autoConfidence: input.autoConfidence,
        classifiedBy: input.classifiedBy,
        correctedFromSpeciesId:
          input.autoSpeciesId && input.autoSpeciesId !== input.species ? input.autoSpeciesId : null,
        note: input.note,
        isAnonymous: input.isAnonymous,
        reporterLabel: input.isAnonymous ? '匿名同学' : '鸭鸭先冲',
        photoUrls: input.mediaIds.map((id) => `/wildlife/photos/${id}.webp`),
        healthConcern: input.healthConcern,
        createdAt: now().toISOString(),
        moderatedBy: null,
        moderatedAt: null,
        rejectReason: null,
      };

      // 记录"该区域禁投喂"这一事实（不是错误；规格 §8.1 E1/E2 同时生效）
      if (effectivePolicy === 'forbidden' && zone) {
        forbiddenZoneHits.push(zone.id);
      }

      for (const id of input.mediaIds) linkedMedia.add(id);
      sightings = [created, ...sightings];

      const parsed = safeParseSighting(clone(created));
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 创建的上报不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(parsed.value);
    },

    async moderate(
      id: string,
      input: ModerateSightingInput,
    ): Promise<Result<WildlifeSighting, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const index = sightings.findIndex((s) => s.id === id);
      const current = index >= 0 ? sightings[index] : undefined;
      if (!current) return err(apiError('NOT_FOUND', `观测记录不存在：${id}`));

      if (current.status === 'REJECTED') {
        return err(apiError('CONFLICT', '该记录已被拒绝，不能再次审核'));
      }
      if (input.decision === 'REJECTED' && !input.reason?.trim()) {
        return err(
          apiError('VALIDATION_FAILED', '拒绝必须填写理由（仅审核端可见）', {
            reason: 'REJECT_REASON_REQUIRED',
          }),
        );
      }

      const speciesRef = speciesOf(current.species);
      const isProtected = Boolean(speciesRef?.isProtected);
      const firstVote = firstModeratorVote.get(id);

      // 保护物种：**必须两名审核员**（规格 §2.10；单人通过返回 FORBIDDEN）
      if (input.decision === 'PUBLISHED' && isProtected) {
        if (!firstVote) {
          firstModeratorVote.set(id, input.moderatorId);
          const next = { ...current, moderatedBy: input.moderatorId };
          sightings = sightings.map((s, i) => (i === index ? next : s));
          return err(
            apiError('FORBIDDEN', '保护物种需要两名审核员复核，已记录你的第一票', {
              reason: 'SECOND_MODERATOR_REQUIRED',
            }),
          );
        }
        if (firstVote === input.moderatorId) {
          return err(
            apiError('FORBIDDEN', '保护物种需要另一名审核员复核，不能由同一人二次确认', {
              reason: 'SECOND_MODERATOR_REQUIRED',
            }),
          );
        }
      }

      const next: WildlifeSighting = {
        ...current,
        status: input.decision,
        moderatedBy: input.moderatorId,
        moderatedAt: now().toISOString(),
        rejectReason: input.decision === 'REJECTED' ? (input.reason?.trim() ?? null) : null,
      };
      sightings = sightings.map((s, i) => (i === index ? next : s));
      if (input.decision === 'PUBLISHED') firstModeratorVote.delete(id);

      const parsed = safeParseSighting(clone(next));
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 审核结果不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(parsed.value);
    },

    async classify(mediaId: string, topK = 3): Promise<Result<SpeciesPrediction[], ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      // 规格 §5.3 / 验收 T43：**无能力时返回空数组，不报 5xx**
      if (classifierMode !== 'server') return ok([]);
      if (!mediaId.trim()) return ok([]);
      const all: SpeciesPrediction[] = [
        { speciesId: 'sp-swan', confidence: 0.78 },
        { speciesId: 'sp-duck', confidence: 0.41 },
        { speciesId: 'sp-egret', confidence: 0.12 },
      ];
      return ok(all.slice(0, Math.max(1, Math.min(topK, all.length))));
    },

    setFailureMode(mode: WildlifeFailureMode): void {
      failureMode = mode;
    },

    getFailureMode(): WildlifeFailureMode {
      return failureMode;
    },

    setClassifierMode(mode: 'manual' | 'server' | 'off'): void {
      classifierMode = mode;
    },

    getClassifierMode(): 'manual' | 'server' | 'off' {
      return classifierMode;
    },

    pendingCount(): number {
      return sightings.filter((s) => s.status === 'PENDING').length;
    },

    reset(): void {
      species = initialSpecies();
      zones = initialZones();
      individuals = initialIndividuals();
      sightings = createSightingSeed(now());
      spots = createSpotSeed(now());
      tracks = createTrackSeed(now());
      mediaStore.clear();
      linkedMedia.clear();
      firstModeratorVote.clear();
      forbiddenZoneHits.length = 0;
      mediaSeq = 0;
      failureMode = 'none';
      classifierMode = options.classifierMode ?? 'manual';
    },
  };
}

