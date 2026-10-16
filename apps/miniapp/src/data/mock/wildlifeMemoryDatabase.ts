import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@kedaya/contracts'
import { distanceMeters, err, ok, snapToGrid, type LatLng, type Result } from '@kedaya/shared'

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
import { resolveSpeciesSource } from '../../domain/models/wildlife'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ListWildlifeQuery,
  LocalPhoto,
  WildlifePage,
} from '../../domain/ports/wildlifeRepository'
import {
  MOCK_WILDLIFE_BASEMAP,
  MOCK_WILDLIFE_INDIVIDUALS,
  MOCK_WILDLIFE_SIGHTINGS,
  MOCK_WILDLIFE_SPECIES,
  MOCK_WILDLIFE_SPOTS,
  MOCK_WILDLIFE_TRACKS,
  MOCK_WILDLIFE_ZONES,
  MOCK_MEDIA_SHA256_PREFIX,
  mockPhotoUrl,
} from './wildlifeFixtures'

/**
 * 野生动物 mock 内存数据库 —— mock repository 的存储内核。
 *
 * 游标分页语义与后端保持一致（契约 §6.1）：`cursor` 是**上一条记录的 id**，
 * 不是 offset。这样 UI 的分页逻辑在切到真后端时不需要改。
 *
 * ⚠️ **隐私流水线在 mock 里也要真的跑**（否则 UI 会展示未模糊的坐标）：
 * - 写入时对坐标做**网格吸附**（`snapToGrid`，规格 §9.3 ②）；
 * - 命中**敏感区**的观测**不存坐标**，只存 `zoneId`（规格 §9.3 ①）。
 *
 * ⚠️ **确定性加噪（HMAC）与 k-匿名检查只在服务端做**
 * （`packages/shared/src/geo/index.ts` 的分层说明）。mock 不模拟它们，
 * 因此 mock 的模糊强度**弱于**真实后端 —— 这是有意的，不假装实现了没有的东西。
 */

/** mock 的分类器模式（对应服务端 `WILDLIFE_CLASSIFIER`，规格 §5.4） */
export type MockClassifierMode = 'manual' | 'server' | 'off'

export interface WildlifeMemoryDatabase {
  basemap(): CampusBasemap
  listSpecies(): WildlifeSpecies[]
  listZones(): WildlifeZone[]
  findZone(id: string): WildlifeZone | null
  listSpots(query?: ListWildlifeQuery, now?: Date): WildlifePage<WildlifeSpot>
  listTracks(query?: ListWildlifeQuery): WildlifePage<WildlifeTrack>
  findTrack(id: string): WildlifeTrack | null
  listIndividuals(speciesId?: string | null): WildlifeIndividual[]
  listSightings(query?: ListWildlifeQuery): WildlifePage<WildlifeSighting>
  findSighting(id: string): WildlifeSighting | null
  uploadMedia(photo: LocalPhoto, now: Date): WildlifeMedia
  createSighting(
    body: WildlifeSightingCreateBody,
    now: Date,
  ): Result<WildlifeSighting, RepositoryError>
  createIndividual(
    body: WildlifeIndividualCreateBody,
    now: Date,
  ): Result<WildlifeIndividual, RepositoryError>
  classify(mediaId: string): WildlifeClassifyResult
  classifierMode(): MockClassifierMode
  setClassifierMode(mode: MockClassifierMode): void
  clear(): void
  reset(): void
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return DEFAULT_PAGE_SIZE
  return Math.min(Math.floor(limit), MAX_PAGE_SIZE)
}

/** 通用游标分页：`cursor` = 上一条的 id */
function paginate<T extends { id: string }>(
  items: readonly T[],
  cursor: string | null | undefined,
  limit: number | undefined,
): WildlifePage<T> {
  const size = clampLimit(limit)
  const startIndex =
    cursor === null || cursor === undefined
      ? 0
      : items.findIndex((item) => item.id === cursor) + 1
  const page = items.slice(startIndex, startIndex + size)
  const hasMore = startIndex + size < items.length
  const last = page.length > 0 ? page[page.length - 1] : undefined

  return {
    items: page.map(clone),
    nextCursor: hasMore && last !== undefined ? last.id : null,
    total: items.length,
  }
}

/** 找到包含该点的区域（含半径判定），优先非敏感区 */
function locateZone(zones: readonly WildlifeZone[], point: LatLng): WildlifeZone | null {
  const hits = zones.filter((zone) => {
    const center = { lat: zone.centerLat, lng: zone.centerLng }
    return distanceMeters(center, point) <= zone.radiusM
  })
  if (hits.length === 0) return null
  return hits.find((zone) => !zone.isSensitive) ?? hits[0] ?? null
}

export function createWildlifeMemoryDatabase(): WildlifeMemoryDatabase {
  let species: WildlifeSpecies[] = MOCK_WILDLIFE_SPECIES.map(clone)
  let zones: WildlifeZone[] = MOCK_WILDLIFE_ZONES.map(clone)
  let individuals: WildlifeIndividual[] = MOCK_WILDLIFE_INDIVIDUALS.map(clone)
  let sightings: WildlifeSighting[] = MOCK_WILDLIFE_SIGHTINGS.map(clone)
  let spots: WildlifeSpot[] = MOCK_WILDLIFE_SPOTS.map(clone)
  let tracks: WildlifeTrack[] = MOCK_WILDLIFE_TRACKS.map(clone)
  let classifierMode: MockClassifierMode = 'manual'
  let mediaSeq = 100
  let sightingSeq = 2000
  let individualSeq = 100

  return {
    basemap: () => clone(MOCK_WILDLIFE_BASEMAP),

    listSpecies: () => species.map(clone),

    listZones: () =>
      [...zones].sort((a, b) => a.sortOrder - b.sortOrder).map(clone),

    findZone(id: string): WildlifeZone | null {
      const found = zones.find((zone) => zone.id === id)
      return found === undefined ? null : clone(found)
    },

    listSpots(query: ListWildlifeQuery = {}, now: Date = new Date()): WildlifePage<WildlifeSpot> {
      // 规格 §8.1 E10 / §11.3 T24：`computedAt` 与当前时间差 <24h 的热点**不得展示**，
      // 否则平台会变成「围观召集工具」。
      const visible = spots
        .filter((spot) => now.getTime() - new Date(spot.computedAt).getTime() >= 24 * 3_600_000)
        .filter((spot) => query.speciesId == null || spot.speciesId === query.speciesId)
        .filter((spot) => query.zoneId == null || spot.zoneId === query.zoneId)
        .sort((a, b) => b.computedAt.localeCompare(a.computedAt))

      return paginate(visible, query.cursor, query.limit)
    },

    listTracks(query: ListWildlifeQuery = {}): WildlifePage<WildlifeTrack> {
      const filtered = tracks
        .filter((track) => query.speciesId == null || track.speciesId === query.speciesId)
        .sort((a, b) => b.computedAt.localeCompare(a.computedAt))

      return paginate(filtered, query.cursor, query.limit)
    },

    findTrack(id: string): WildlifeTrack | null {
      const found = tracks.find((track) => track.id === id)
      return found === undefined ? null : clone(found)
    },

    listIndividuals(speciesId?: string | null): WildlifeIndividual[] {
      return individuals
        .filter((item) => speciesId == null || item.speciesId === speciesId)
        .map(clone)
    },

    listSightings(query: ListWildlifeQuery = {}): WildlifePage<WildlifeSighting> {
      // 公开列表**只**返回 PUBLISHED（规格 §10.1 第 9 项）
      const visible = sightings
        .filter((item) => item.status === 'PUBLISHED')
        .filter((item) => query.speciesId == null || item.speciesId === query.speciesId)
        .filter((item) => query.zoneId == null || item.zoneId === query.zoneId)
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt))

      return paginate(visible, query.cursor, query.limit)
    },

    findSighting(id: string): WildlifeSighting | null {
      const found = sightings.find((item) => item.id === id)
      return found === undefined ? null : clone(found)
    },

    uploadMedia(photo: LocalPhoto, _now: Date): WildlifeMedia {
      mediaSeq += 1
      const mediaId = `wm-mock-${String(mediaSeq).padStart(4, '0')}`
      return {
        mediaId,
        thumbUrl: mockPhotoUrl(mediaId),
        // mock 没有真实图片处理，但**契约形状**必须与服务端一致：
        // 服务端强制剥离 EXIF（规格 §4.3），mock 直接声明已剥离。
        exifStripped: true,
        widthPx: photo.widthPx,
        heightPx: photo.heightPx,
        byteSize: photo.byteSize,
        mimeType: photo.mimeType,
        sha256: `${MOCK_MEDIA_SHA256_PREFIX}${mediaId}`,
        clientPhotoId: photo.clientPhotoId,
      }
    },

    createSighting(
      body: WildlifeSightingCreateBody,
      now: Date,
    ): Result<WildlifeSighting, RepositoryError> {
      const point: LatLng = { lat: body.latitude, lng: body.longitude }
      const zone =
        body.zoneId === null
          ? locateZone(zones, point)
          : (zones.find((item) => item.id === body.zoneId) ?? null)

      // ① 敏感区判定（最强保证）：**不输出任何坐标**
      const isSensitive = zone?.isSensitive === true
      const fuzzLevel = isSensitive ? 'zone-only' : 'grid'
      // ② 网格吸附（规格 §9.3 ②）。③ 加噪与 ④ k-匿名在服务端做。
      const fuzzed = isSensitive
        ? undefined
        : snapToGrid(point, zone?.fuzzRadiusM ?? 50)

      sightingSeq += 1
      const created: WildlifeSighting = {
        id: `ws-${sightingSeq}`,
        speciesId: body.speciesId,
        speciesSource: resolveSpeciesSource(body.speciesId, body.autoSpeciesId),
        observedAt: body.observedAt,
        ...(fuzzed === undefined ? {} : { fuzzedGeo: fuzzed }),
        zoneId: zone?.id ?? null,
        fuzzLevel,
        mediaIds: [...body.mediaIds],
        ...(body.note === undefined ? {} : { note: body.note }),
        // 新上报一律 PENDING（状态机不允许客户端直接 PUBLISHED）
        status: 'PENDING',
        isInferred: false,
        healthConcern: body.healthConcern,
        isAnonymous: body.isAnonymous,
        ...(body.isAnonymous ? {} : { reporterName: '我' }),
        createdAt: now.toISOString(),
      }

      sightings = [created, ...sightings]
      return ok(clone(created))
    },

    createIndividual(
      body: WildlifeIndividualCreateBody,
      _now: Date,
    ): Result<WildlifeIndividual, RepositoryError> {
      // `@@unique([speciesId, name])` —— 同物种内名字唯一（规格 §2.8）
      const duplicated = individuals.some(
        (item) => item.speciesId === body.speciesId && item.name === body.name,
      )
      if (duplicated) {
        return err({
          code: 'CONFLICT',
          message: `「${body.name}」在这个物种下已经有人命名过了`,
          details: { reason: 'INDIVIDUAL_NAME_TAKEN' },
        })
      }

      individualSeq += 1
      const created: WildlifeIndividual = {
        id: `wi-new-${individualSeq}`,
        name: body.name,
        speciesId: body.speciesId,
        ...(body.note === undefined ? {} : { note: body.note }),
        ...(body.photoMediaId === undefined ? {} : { photoMediaId: body.photoMediaId }),
        // 防止恶搞命名 → 走 PENDING 审核队列（规格 §2.8）
        status: 'PENDING',
      }

      individuals = [...individuals, created]
      return ok(clone(created))
    },

    classify(mediaId: string): WildlifeClassifyResult {
      // `manual`（默认）与 `off` 都返回**空建议 + degraded: true**，
      // 这正是「无 API key 时自动降级为纯手动」的行为（规格 §5.2 / §11.6 T43）。
      if (classifierMode !== 'server') {
        return { suggestions: [], degraded: true }
      }
      // 仅用于演示「服务端有分类能力」的分支；不声称任何真实准确率（U5）
      void mediaId
      return {
        suggestions: [
          { speciesId: 'sp-cat', confidence: 0.91, provider: 'mock-onnx' },
          { speciesId: 'sp-magpie', confidence: 0.42, provider: 'mock-onnx' },
          { speciesId: 'sp-sparrow', confidence: 0.18, provider: 'mock-onnx' },
        ],
        degraded: false,
      }
    },

    classifierMode: () => classifierMode,

    setClassifierMode(mode: MockClassifierMode): void {
      classifierMode = mode
    },

    clear(): void {
      sightings = []
      spots = []
      tracks = []
      individuals = []
      zones = []
      species = []
    },

    reset(): void {
      species = MOCK_WILDLIFE_SPECIES.map(clone)
      zones = MOCK_WILDLIFE_ZONES.map(clone)
      individuals = MOCK_WILDLIFE_INDIVIDUALS.map(clone)
      sightings = MOCK_WILDLIFE_SIGHTINGS.map(clone)
      spots = MOCK_WILDLIFE_SPOTS.map(clone)
      tracks = MOCK_WILDLIFE_TRACKS.map(clone)
      classifierMode = 'manual'
    },
  }
}
