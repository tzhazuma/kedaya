/**
 * wildlife 仓储端口（依赖倒置点 —— 契约 §7）。
 *
 * domain 定义接口，data 层实现（HTTP / mock）。presentation 永远不直接发请求。
 * 错误通道用 `@kedaya/shared` 的 `Result`，错误载荷用契约的 `ApiError`。
 *
 * 路由形状（规格 §10.1，前缀 `/api/v1/wildlife`）：
 *
 * | 端口方法 | 路由 | 登录 |
 * | --- | --- | --- |
 * | `basemap()` | `GET /basemap` | ❌ |
 * | `species()` | `GET /species` | ❌ |
 * | `zones()` / `zoneDetail()` | `GET /zones` `/zones/:id` | ❌ |
 * | `spots()` | `GET /spots` | ❌ |
 * | `tracks()` / `trackDetail()` | `GET /tracks` `/tracks/:id` | ❌ |
 * | `individuals()` | `GET /individuals` | ❌ |
 * | `sightings()` / `sightingDetail()` | `GET /items` `/items/:id` | ❌ |
 * | `uploadMedia()` | `POST /media` | ✅ |
 * | `createSighting()` | `POST /items` | ✅ |
 * | `moderate()` | `POST /items/:id/moderate` | ✅ 审核员 |
 * | `classify()` | `POST /classify` | ✅ |
 *
 * ⚠️ `moderate` 是契约 §11.2 **已冻结**的动作名（`wildlife.moderate`），不得自创。
 * ⚠️ `WildlifeSpot` / `WildlifeTrack` **没有写端点**（派生只读，由 Worker 重算）。
 */
import type { ApiError, Page } from '@kedaya/contracts';
import type { Result } from '@kedaya/shared';

import type { CampusBasemap } from '../models/wildlife/basemap';
import type { SpeciesTaxonomy, WildlifeZone } from '../models/wildlife/species';
import type {
  CreateSightingInput,
  ModerateSightingInput,
  SightingListQuery,
  UploadedMedia,
  WildlifeSighting,
} from '../models/wildlife/sightings';
import type { WildlifeIndividual, WildlifeSpot, WildlifeTrack } from '../models/wildlife/tracks';

/** mock 适配器的可控故障模式（演示三态 UI） */
export type WildlifeFailureMode = 'none' | 'error';

export interface ZoneListQuery {
  cursor?: string;
  limit?: number;
  /** 按物种筛选区域（区域与物种是多对多） */
  species?: string;
}

export interface SpotListQuery {
  cursor?: string;
  limit?: number;
  species?: string;
  zoneId?: string;
  /** 默认 0.3（规格 §10.4） */
  minConfidence?: number;
}

export interface TrackListQuery {
  cursor?: string;
  limit?: number;
  species?: string;
  individualId?: string;
}

export interface IndividualListQuery {
  cursor?: string;
  limit?: number;
  species?: string;
}

/** 分类建议（`POST /classify`；无能力时服务端返回**空数组**，不报 5xx） */
export interface SpeciesPrediction {
  speciesId: string;
  confidence: number;
}

export interface UploadMediaInput {
  file: File;
  /** 客户端幂等键（UUID v4）；重试时**复用**同一个（规格 §4.5） */
  clientPhotoId: string;
}

export interface WildlifeRepository {
  /** 当前底图配置（含 `affine` / `attribution` / `license`） */
  basemap(): Promise<Result<CampusBasemap, ApiError>>;
  species(): Promise<Result<SpeciesTaxonomy[], ApiError>>;
  zones(query?: ZoneListQuery): Promise<Result<Page<WildlifeZone>, ApiError>>;
  zoneDetail(id: string): Promise<Result<WildlifeZone, ApiError>>;
  spots(query?: SpotListQuery): Promise<Result<Page<WildlifeSpot>, ApiError>>;
  tracks(query?: TrackListQuery): Promise<Result<Page<WildlifeTrack>, ApiError>>;
  trackDetail(id: string): Promise<Result<WildlifeTrack, ApiError>>;
  individuals(query?: IndividualListQuery): Promise<Result<Page<WildlifeIndividual>, ApiError>>;
  sightings(query?: SightingListQuery): Promise<Result<Page<WildlifeSighting>, ApiError>>;
  sightingDetail(id: string): Promise<Result<WildlifeSighting, ApiError>>;
  /** 上传照片（服务端强制剥离 EXIF，规格 §4.3） */
  uploadMedia(input: UploadMediaInput): Promise<Result<UploadedMedia, ApiError>>;
  createSighting(input: CreateSightingInput): Promise<Result<WildlifeSighting, ApiError>>;
  /** 审核（`moderate` 为契约 §11.2 冻结动作名） */
  moderate(id: string, input: ModerateSightingInput): Promise<Result<WildlifeSighting, ApiError>>;
  /** 自动分类建议；无能力时返回 `[]`（规格 §5.3 / 验收 T43） */
  classify(mediaId: string, topK?: number): Promise<Result<SpeciesPrediction[], ApiError>>;
}
