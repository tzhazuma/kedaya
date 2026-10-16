import type { Result } from '@kedaya/shared'

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
} from '../models/wildlife'
import type { RepositoryError } from './errors'

/** 游标分页查询（契约 §6.1：不用 offset 分页） */
export interface ListWildlifeQuery {
  cursor?: string | null
  limit?: number
  speciesId?: string | null
  zoneId?: string | null
}

export interface WildlifePage<T> {
  items: T[]
  nextCursor: string | null
  total?: number
}

/** 客户端选好并压缩后的照片（本地临时文件，尚未上传） */
export interface LocalPhoto {
  /** 本地临时路径（`wx.chooseMedia` 的 `tempFilePath`） */
  tempFilePath: string
  widthPx: number
  heightPx: number
  byteSize: number
  mimeType: string
  /** 客户端幂等键（UUID v4）。**重试时必须复用**（规格 §4.5） */
  clientPhotoId: string
}

export interface UploadMediaInput extends LocalPhoto {
  /** 契约 §11.3：写操作必须带 `Idempotency-Key` */
  idempotencyKey?: string
}

/**
 * 野生动物仓储端口 —— 由 `data/repositories/*` 实现（http / mock 两套）。
 *
 * 契约 §7 硬规则 3：所有网络访问必须经过 `data/api/`，
 * `presentation` 禁止直接发请求，只能通过用例层调用本端口。
 *
 * 路径映射（OpenAPI `kedaya.v1.yaml` wildlife 段，规格 §10.1）：
 *
 * ```
 * GET  /wildlife/basemap            底图配置（含 affine / attribution / license）
 * GET  /wildlife/species            物种列表（分类树）
 * GET  /wildlife/zones              区域列表（含 feedingPolicy / noticeText）
 * GET  /wildlife/zones/:id          区域详情
 * GET  /wildlife/spots              聚合热点（派生只读，延迟 ≥24h）
 * GET  /wildlife/tracks             推断轨迹列表
 * GET  /wildlife/tracks/:id         轨迹详情（含 isInferred: true）
 * GET  /wildlife/individuals        已命名个体列表
 * GET  /wildlife/items              观测列表（仅 PUBLISHED，坐标已模糊化）
 * GET  /wildlife/items/:id          观测详情
 * POST /wildlife/media              上传照片（服务端强制剥离 EXIF）
 * POST /wildlife/items              上报观测
 * POST /wildlife/individuals        创建命名个体（"手动给个名字"）
 * POST /wildlife/classify           请求自动分类建议（无能力时返回空数组）
 * ```
 *
 * ⚠️ `WildlifeSpot` / `WildlifeTrack` **没有写端点** —— 它们是派生只读资源。
 *
 * ⚠️ 所有读写路径的坐标一律 **WGS84**。本端口的实现**不得**接受 GCJ-02，
 * 转换在用例层通过 `toApiPoint` / `toMapPoint` 完成（规格 §3.2）。
 */
export interface WildlifeRepository {
  basemap(): Promise<Result<CampusBasemap, RepositoryError>>
  listSpecies(): Promise<Result<WildlifeSpecies[], RepositoryError>>
  listZones(): Promise<Result<WildlifeZone[], RepositoryError>>
  zoneDetail(id: string): Promise<Result<WildlifeZone, RepositoryError>>
  listSpots(query?: ListWildlifeQuery): Promise<Result<WildlifePage<WildlifeSpot>, RepositoryError>>
  listTracks(query?: ListWildlifeQuery): Promise<Result<WildlifePage<WildlifeTrack>, RepositoryError>>
  trackDetail(id: string): Promise<Result<WildlifeTrack, RepositoryError>>
  listIndividuals(speciesId?: string | null): Promise<Result<WildlifeIndividual[], RepositoryError>>
  listSightings(
    query?: ListWildlifeQuery,
  ): Promise<Result<WildlifePage<WildlifeSighting>, RepositoryError>>
  sightingDetail(id: string): Promise<Result<WildlifeSighting, RepositoryError>>
  uploadMedia(input: UploadMediaInput): Promise<Result<WildlifeMedia, RepositoryError>>
  createSighting(
    body: WildlifeSightingCreateBody,
    idempotencyKey?: string,
  ): Promise<Result<WildlifeSighting, RepositoryError>>
  createIndividual(
    body: WildlifeIndividualCreateBody,
    idempotencyKey?: string,
  ): Promise<Result<WildlifeIndividual, RepositoryError>>
  /**
   * 请求自动分类建议。
   *
   * **失败必须降级为「空建议」而不是抛错**（规格 §5.2 / §11.6 T43）：
   * 分类是增强，不是前置条件；没有分类，上报依然完整有效。
   */
  classify(mediaId: string): Promise<Result<WildlifeClassifyResult, RepositoryError>>
}

/**
 * 照片上传端口（multipart）。
 *
 * 为什么单独抽出来：`ApiClient` 只发 JSON（`Content-Type: application/json`），
 * 而照片上传是 `multipart/form-data`，在微信端必须走 `wx.uploadFile`
 * （`wx.request` 不支持传文件）。把它抽成端口后：
 * - 真机实现见 `data/api/mediaUpload.ts`（全项目除 `taroHttpAdapter.ts` 外
 *   唯一直接调用 Taro 网络 API 的地方，且**只**用于文件上传）；
 * - 用例层与页面完全看不到 Taro，测试里用假实现即可。
 *
 * ⚠️ EXIF 剥离由**服务端**执行（规格 §4.3）：只要客户端能绕过就等于没有，
 * 因此这里不做、也不能把「已剥离」当作客户端承诺。
 */
export interface WildlifeMediaUploaderPort {
  upload(input: UploadMediaInput): Promise<Result<WildlifeMedia, RepositoryError>>
}
