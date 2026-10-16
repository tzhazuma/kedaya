/**
 * wildlife HTTP 仓储 —— 端口 `WildlifeRepository` 的真实实现（规格 §10.1 冻结路由）。
 *
 * 路由形状：
 * ```
 * GET  /api/v1/wildlife/basemap
 * GET  /api/v1/wildlife/species
 * GET  /api/v1/wildlife/zones            GET /zones/:id
 * GET  /api/v1/wildlife/spots
 * GET  /api/v1/wildlife/tracks           GET /tracks/:id
 * GET  /api/v1/wildlife/individuals
 * GET  /api/v1/wildlife/items            GET /items/:id
 * POST /api/v1/wildlife/media            照片上传（multipart，服务端强制剥离 EXIF）
 * POST /api/v1/wildlife/items            上报观测
 * POST /api/v1/wildlife/items/:id/moderate   审核（契约 §11.2 冻结 action）
 * POST /api/v1/wildlife/classify         自动分类建议（无能力时返回空数组）
 * ```
 *
 * ⚠️ **`moderate` 是契约 §11.2 已冻结的动作名**（`wildlife.moderate`），不得自创；
 * `media` / `classify` 是契约 §11.11 允许的**集合路由**（创建资源 / 无状态计算请求），
 * 不是领域动作。
 */
import { modulePath } from '@kedaya/contracts';
import type { ApiError, Page } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import {
  resolveCampusBasemap,
  type CampusBasemap,
} from '@/domain/models/wildlife/basemap';
import type { SpeciesTaxonomy, WildlifeZone } from '@/domain/models/wildlife/species';
import type {
  CreateSightingInput,
  ModerateSightingInput,
  SightingListQuery,
  UploadedMedia,
  WildlifeSighting,
} from '@/domain/models/wildlife/sightings';
import type { WildlifeIndividual, WildlifeSpot, WildlifeTrack } from '@/domain/models/wildlife/tracks';
import type {
  IndividualListQuery,
  SpeciesPrediction,
  SpotListQuery,
  TrackListQuery,
  UploadMediaInput,
  WildlifeRepository,
  ZoneListQuery,
} from '@/domain/ports/wildlife';

import { ApiClientError, type ApiClient } from '../api/client';
import {
  safeParseCampusBasemap,
  safeParseIndividualPage,
  safeParseSighting,
  safeParseSightingPage,
  safeParseSpeciesList,
  safeParseSpeciesPredictions,
  safeParseSpotPage,
  safeParseTrack,
  safeParseTrackPage,
  safeParseUploadedMedia,
  safeParseZone,
  safeParseZonePage,
} from '../schemas/wildlife';

const BASE = `/${modulePath('wildlife')}`;
const ITEMS_PATH = `${BASE}/items`;

/** ApiClientError → 契约 ApiError（端口只认契约错误载荷） */
export function toApiError(cause: ApiClientError): ApiError {
  return cause.details === undefined
    ? { code: cause.code, message: cause.message }
    : { code: cause.code, message: cause.message, details: cause.details };
}

function contractViolation(message: string, issues: string[]): ApiError {
  return { code: 'INTERNAL', message, details: { issues } };
}

/**
 * 由请求体派生的**稳定幂等键**。
 *
 * 为什么不用随机 UUID：TanStack Query / 网络层会对**同一次提交**重试，
 * 随机键会让每次重试都被服务端当成新请求 → 重复上报（正是契约 §11.3 要防的事）。
 * 用内容哈希则"同一份内容重试"复用同一个键，而"用户改了内容再提交"自然换键。
 */
export function stableIdempotencyKey(scope: string, payload: unknown): string {
  const input = `${scope}:${JSON.stringify(payload)}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${scope}-${(hash >>> 0).toString(36)}`;
}

export function createWildlifeHttpRepository(client: ApiClient): WildlifeRepository {
  return {
    async basemap(): Promise<Result<CampusBasemap, ApiError>> {
      const result = await client.get<unknown>(`${BASE}/basemap`);
      if (!result.ok) return err(toApiError(result.error));
      const parsed = safeParseCampusBasemap(result.value);
      if (!parsed.ok) {
        return err(contractViolation('后端返回的底图配置不符合冻结契约', parsed.issues));
      }
      return ok(resolveCampusBasemap(parsed.value));
    },

    async species(): Promise<Result<SpeciesTaxonomy[], ApiError>> {
      const result = await client.get<unknown>(`${BASE}/species`);
      if (!result.ok) return err(toApiError(result.error));
      const parsed = safeParseSpeciesList(result.value);
      if (!parsed.ok) {
        return err(contractViolation('后端返回的物种列表不符合冻结契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async zones(query: ZoneListQuery = {}): Promise<Result<Page<WildlifeZone>, ApiError>> {
      const result = await client.get<unknown>(`${BASE}/zones`, {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.species === undefined ? {} : { species: query.species }),
      });
      if (!result.ok) return err(toApiError(result.error));
      const parsed = safeParseZonePage(result.value);
      if (!parsed.ok) {
        return err(contractViolation('后端返回的区域列表不符合冻结契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async zoneDetail(id: string): Promise<Result<WildlifeZone, ApiError>> {
      const result = await client.get<unknown>(`${BASE}/zones/${encodeURIComponent(id)}`);
      if (!result.ok) return err(toApiError(result.error));
      const parsed = safeParseZone(result.value);
      if (!parsed.ok) {
        return err(contractViolation('后端返回的区域详情不符合冻结契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async spots(query: SpotListQuery = {}): Promise<Result<Page<WildlifeSpot>, ApiError>> {
      const result = await client.get<unknown>(`${BASE}/spots`, {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.species === undefined ? {} : { species: query.species }),
        ...(query.zoneId === undefined ? {} : { zoneId: query.zoneId }),
        ...(query.minConfidence === undefined ? {} : { minConfidence: query.minConfidence }),
      });
      if (!result.ok) return err(toApiError(result.error));
      const parsed = safeParseSpotPage(result.value);
      if (!parsed.ok) {
        return err(contractViolation('后端返回的热点列表不符合冻结契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async tracks(query: TrackListQuery = {}): Promise<Result<Page<WildlifeTrack>, ApiError>> {
      const result = await client.get<unknown>(`${BASE}/tracks`, {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.species === undefined ? {} : { species: query.species }),
        ...(query.individualId === undefined ? {} : { individualId: query.individualId }),
      });
      if (!result.ok) return err(toApiError(result.error));
      const parsed = safeParseTrackPage(result.value);
      if (!parsed.ok) {
        return err(contractViolation('后端返回的轨迹列表不符合冻结契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async trackDetail(id: string): Promise<Result<WildlifeTrack, ApiError>> {
      const result = await client.get<unknown>(`${BASE}/tracks/${encodeURIComponent(id)}`);
      if (!result.ok) return err(toApiError(result.error));
      const parsed = safeParseTrack(result.value);
      if (!parsed.ok) {
        return err(contractViolation('后端返回的轨迹详情不符合冻结契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async individuals(
      query: IndividualListQuery = {},
    ): Promise<Result<Page<WildlifeIndividual>, ApiError>> {
      const result = await client.get<unknown>(`${BASE}/individuals`, {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.species === undefined ? {} : { species: query.species }),
      });
      if (!result.ok) return err(toApiError(result.error));
      const parsed = safeParseIndividualPage(result.value);
      if (!parsed.ok) {
        return err(contractViolation('后端返回的个体列表不符合冻结契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async sightings(
      query: SightingListQuery = {},
    ): Promise<Result<Page<WildlifeSighting>, ApiError>> {
      const result = await client.get<unknown>(ITEMS_PATH, {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.species === undefined ? {} : { species: query.species }),
        ...(query.zoneId === undefined ? {} : { zoneId: query.zoneId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.healthConcernOnly === undefined
          ? {}
          : { healthConcernOnly: query.healthConcernOnly }),
      });
      if (!result.ok) return err(toApiError(result.error));
      const parsed = safeParseSightingPage(result.value);
      if (!parsed.ok) {
        return err(contractViolation('后端返回的观测列表不符合冻结契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async sightingDetail(id: string): Promise<Result<WildlifeSighting, ApiError>> {
      const result = await client.get<unknown>(`${ITEMS_PATH}/${encodeURIComponent(id)}`);
      if (!result.ok) return err(toApiError(result.error));
      const parsed = safeParseSighting(result.value);
      if (!parsed.ok) {
        return err(contractViolation('后端返回的观测详情不符合冻结契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async uploadMedia(input: UploadMediaInput): Promise<Result<UploadedMedia, ApiError>> {
      const form = new FormData();
      form.append('file', input.file);
      form.append('clientPhotoId', input.clientPhotoId);

      const result = await client.upload<unknown>(`${BASE}/media`, form, {
        // 幂等键复用 clientPhotoId：同一张图重试 → 返回同一 mediaId（规格 §4.5）
        idempotencyKey: input.clientPhotoId,
      });
      if (!result.ok) return err(toApiError(result.error));
      const parsed = safeParseUploadedMedia(result.value);
      if (!parsed.ok) {
        return err(contractViolation('后端返回的媒体信息不符合冻结契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async createSighting(input: CreateSightingInput): Promise<Result<WildlifeSighting, ApiError>> {
      const result = await client.post<unknown>(ITEMS_PATH, input, {
        idempotencyKey: stableIdempotencyKey('wildlife-sighting', input),
      });
      if (!result.ok) return err(toApiError(result.error));
      const parsed = safeParseSighting(result.value);
      if (!parsed.ok) {
        return err(contractViolation('后端返回的上报结果不符合冻结契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async moderate(
      id: string,
      input: ModerateSightingInput,
    ): Promise<Result<WildlifeSighting, ApiError>> {
      const result = await client.post<unknown>(
        `${ITEMS_PATH}/${encodeURIComponent(id)}/moderate`,
        {
          decision: input.decision,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
        { idempotencyKey: stableIdempotencyKey('wildlife-moderate', { id, ...input }) },
      );
      if (!result.ok) return err(toApiError(result.error));
      const parsed = safeParseSighting(result.value);
      if (!parsed.ok) {
        return err(contractViolation('后端返回的审核结果不符合冻结契约', parsed.issues));
      }
      return ok(parsed.value);
    },

    async classify(mediaId: string, topK = 3): Promise<Result<SpeciesPrediction[], ApiError>> {
      const result = await client.post<unknown>(
        `${BASE}/classify`,
        { mediaId, topK },
        { idempotencyKey: stableIdempotencyKey('wildlife-classify', { mediaId, topK }) },
      );
      if (!result.ok) return err(toApiError(result.error));
      const parsed = safeParseSpeciesPredictions(result.value);
      if (!parsed.ok) {
        return err(contractViolation('后端返回的分类建议不符合冻结契约', parsed.issues));
      }
      return ok(parsed.value);
    },
  };
}
