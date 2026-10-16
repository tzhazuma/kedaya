import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type {
  CampusBasemap,
  WildlifeClassifyResult,
  WildlifeIndividual,
  WildlifeIndividualCreateBody,
  WildlifeMedia,
  WildlifeSighting,
  WildlifeSightingCreateBody,
  WildlifeSpecies,
  WildlifeSpot,
  WildlifeTrack,
  WildlifeZone,
} from '../../domain/models/wildlife'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ListWildlifeQuery,
  UploadMediaInput,
  WildlifeMediaUploaderPort,
  WildlifePage,
  WildlifeRepository,
} from '../../domain/ports/wildlifeRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端野生动物仓储 —— OpenAPI `kedaya.v1.yaml` 的 wildlife 段：
 *
 * ```
 * GET    /api/v1/wildlife/basemap           底图配置
 * GET    /api/v1/wildlife/species           物种列表（分类树）
 * GET    /api/v1/wildlife/zones             区域列表
 * GET    /api/v1/wildlife/zones/:id         区域详情
 * GET    /api/v1/wildlife/spots             聚合热点（只读，延迟 ≥24h）
 * GET    /api/v1/wildlife/tracks            推断轨迹列表
 * GET    /api/v1/wildlife/tracks/:id        轨迹详情
 * GET    /api/v1/wildlife/individuals       已命名个体
 * GET    /api/v1/wildlife/items             观测列表（仅 PUBLISHED）
 * GET    /api/v1/wildlife/items/:id         观测详情
 * POST   /api/v1/wildlife/media             上传照片（multipart，走 uploader 端口）
 * POST   /api/v1/wildlife/items             上报观测
 * POST   /api/v1/wildlife/individuals       创建命名个体
 * POST   /api/v1/wildlife/classify          请求自动分类建议
 * ```
 *
 * 信封解包、Bearer、trace、401 重试全部由 `ApiClient` 负责（契约 §7 硬规则 3）；
 * 这里只做「URL + 类型」映射。所有 `POST` 都带 `Idempotency-Key`（契约 §11.3 必需）。
 *
 * ⚠️ **坐标一律 WGS84**：`createSighting` 收到的 body 已由用例层
 * （`toCreateSightingBody` → `toApiPoint`）从 GCJ-02 归一化过。
 * 本文件**不做**任何坐标系转换 —— 转换只有 domain 层那两个入口，不允许有第三处。
 */
export function createHttpWildlifeRepository(
  client: ApiClient,
  uploader: WildlifeMediaUploaderPort,
): WildlifeRepository {
  function toPage<T>(page: Page<T>): WildlifePage<T> {
    return {
      items: page.items,
      nextCursor: page.nextCursor,
      ...(page.total === undefined ? {} : { total: page.total }),
    }
  }

  function pageQuery(query: ListWildlifeQuery = {}): Record<string, string | number | undefined> {
    return {
      cursor: query.cursor ?? undefined,
      limit: query.limit ?? DEFAULT_PAGE_SIZE,
      speciesId: query.speciesId ?? undefined,
      zoneId: query.zoneId ?? undefined,
    }
  }

  return {
    async basemap(): Promise<Result<CampusBasemap, RepositoryError>> {
      const result = await client.get<CampusBasemap>(modulePath('wildlife', 'basemap'))
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async listSpecies(): Promise<Result<WildlifeSpecies[], RepositoryError>> {
      const result = await client.get<WildlifeSpecies[]>(modulePath('wildlife', 'species'))
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async listZones(): Promise<Result<WildlifeZone[], RepositoryError>> {
      const result = await client.get<WildlifeZone[]>(modulePath('wildlife', 'zones'))
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async zoneDetail(id: string): Promise<Result<WildlifeZone, RepositoryError>> {
      const result = await client.get<WildlifeZone>(
        modulePath('wildlife', 'zones', encodeURIComponent(id)),
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async listSpots(
      query: ListWildlifeQuery = {},
    ): Promise<Result<WildlifePage<WildlifeSpot>, RepositoryError>> {
      const result = await client.get<Page<WildlifeSpot>>(
        modulePath('wildlife', 'spots'),
        pageQuery(query),
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(toPage(result.value))
    },

    async listTracks(
      query: ListWildlifeQuery = {},
    ): Promise<Result<WildlifePage<WildlifeTrack>, RepositoryError>> {
      const result = await client.get<Page<WildlifeTrack>>(
        modulePath('wildlife', 'tracks'),
        pageQuery(query),
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(toPage(result.value))
    },

    async trackDetail(id: string): Promise<Result<WildlifeTrack, RepositoryError>> {
      const result = await client.get<WildlifeTrack>(
        modulePath('wildlife', 'tracks', encodeURIComponent(id)),
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async listIndividuals(
      speciesId?: string | null,
    ): Promise<Result<WildlifeIndividual[], RepositoryError>> {
      const result = await client.get<WildlifeIndividual[]>(modulePath('wildlife', 'individuals'), {
        speciesId: speciesId ?? undefined,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async listSightings(
      query: ListWildlifeQuery = {},
    ): Promise<Result<WildlifePage<WildlifeSighting>, RepositoryError>> {
      const result = await client.get<Page<WildlifeSighting>>(
        modulePath('wildlife', 'items'),
        pageQuery(query),
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(toPage(result.value))
    },

    async sightingDetail(id: string): Promise<Result<WildlifeSighting, RepositoryError>> {
      const result = await client.get<WildlifeSighting>(
        modulePath('wildlife', 'items', encodeURIComponent(id)),
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    uploadMedia(input: UploadMediaInput): Promise<Result<WildlifeMedia, RepositoryError>> {
      // 照片上传是 multipart，`ApiClient` 只发 JSON，因此走独立的 uploader 端口
      return uploader.upload(input)
    },

    async createSighting(
      body: WildlifeSightingCreateBody,
      idempotencyKey?: string,
    ): Promise<Result<WildlifeSighting, RepositoryError>> {
      const result = await client.post<WildlifeSighting, WildlifeSightingCreateBody>(
        modulePath('wildlife', 'items'),
        body,
        idempotencyKey === undefined ? undefined : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async createIndividual(
      body: WildlifeIndividualCreateBody,
      idempotencyKey?: string,
    ): Promise<Result<WildlifeIndividual, RepositoryError>> {
      const result = await client.post<WildlifeIndividual, WildlifeIndividualCreateBody>(
        modulePath('wildlife', 'individuals'),
        body,
        idempotencyKey === undefined ? undefined : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async classify(mediaId: string): Promise<Result<WildlifeClassifyResult, RepositoryError>> {
      const result = await client.post<WildlifeClassifyResult, { mediaId: string }>(
        modulePath('wildlife', 'classify'),
        { mediaId },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
