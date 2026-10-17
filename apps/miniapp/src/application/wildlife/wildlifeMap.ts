import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { WildlifeRepository } from '../../domain/ports/wildlifeRepository'
import {
  WILDLIFE_AGGREGATION_NOTICE,
  filterBySpecies,
  isSpotAggregationDelayed,
  sightingToMapMarker,
  speciesDisplayName,
  spotToMapMarker,
  summarizeSighting,
  trackToMapPoints,
  zoneMatchesSpecies,
  zoneToMapCircle,
} from '../../domain/models/wildlife'
import type {
  CampusBasemap,
  MapCircle,
  MapMarker,
  SightingSummary,
  WildlifeIndividual,
  WildlifeSighting,
  WildlifeSpecies,
  WildlifeSpot,
  WildlifeTrack,
  WildlifeZone,
} from '../../domain/models/wildlife'

/**
 * 动物地图用例 —— 契约 §8 启动时序的落点：
 *
 * 1. `hydrate()`：**同步**读本地缓存（禁止网络）→ 页面立刻有内容
 * 2. 页面先渲染 `hydrate()` 的结果
 * 3. `load()`：后台拉取 → 成功替换、失败静默保留缓存
 *
 * ⚠️ **坐标系**：本用例存储的**全部**坐标都是 WGS84（来自 API）。
 * 渲染前必须经过 [buildMapOverlays]（内部调用 `toMapPoint` → GCJ-02）。
 * 页面**禁止**自己拼 markers —— 否则「忘记转换」会再次变成靠自觉。
 *
 * ⚠️ **伦理约束 E10**（规格 §8.1）：地图**不得**显示近实时的点位。
 * 因此 [buildMapOverlays] 会**过滤掉** `computedAt` 距今 <24h 的热点，
 * 并且**不**把单条 `WildlifeSighting` 当作实时点位渲染（只作为历史聚合的输入）。
 */

export type WildlifeMapStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface WildlifeMapState {
  status: WildlifeMapStatus
  basemap: CampusBasemap | null
  species: WildlifeSpecies[]
  zones: WildlifeZone[]
  spots: WildlifeSpot[]
  tracks: WildlifeTrack[]
  sightings: WildlifeSighting[]
  /**
   * 已命名个体（"野生居民"）。
   *
   * 地图本身不画个体（一个个体的位置不是一条观测，画上去就等于实时定位），
   * 它服务于**档案页**的「常住居民」：谁被起了名字、属于哪个物种。
   * 因为档案与地图是同一个模块的两面、数据也一起变，所以放在同一份 state 里，
   * 而不是再建一个只差一次请求的用例（那样两边会各拉一次、页面上还会先后跳一下）。
   */
  individuals: WildlifeIndividual[]
  /** `null` = 全部物种 */
  activeSpeciesId: string | null
  /** 用户在地图上点选的区域（详情面板） */
  selectedZoneId: string | null
  /** 用户点选的观测点（详情弹窗） */
  selectedSightingId: string | null
  /** 当前在地图上叠加的推断轨迹（`null` = 不叠加） */
  selectedTrackId: string | null
  error: string | null
  fromCache: boolean
  updatedAt: string | null
}

export interface CachedWildlifeMap {
  basemap: CampusBasemap | null
  species: WildlifeSpecies[]
  zones: WildlifeZone[]
  spots: WildlifeSpot[]
  tracks: WildlifeTrack[]
  sightings: WildlifeSighting[]
  /** 旧版本缓存没有这一项 → 读的时候回落到 `[]`（见 `hydrate`） */
  individuals?: WildlifeIndividual[]
  activeSpeciesId: string | null
  updatedAt: string
}

export interface WildlifeMapDeps {
  repository: WildlifeRepository
  cache: CachePort
  clock: ClockPort
  /** 缓存 key 由装配层注入 —— application 不感知存储实现 */
  cacheKey: string
  defaultLimit?: number
}

export interface WildlifeMapUseCase {
  getSnapshot(): WildlifeMapState
  subscribe(listener: () => void): () => void
  hydrate(): WildlifeMapState
  load(speciesId?: string | null): Promise<WildlifeMapState>
  selectSpecies(speciesId: string | null): WildlifeMapState
  selectZone(zoneId: string | null): WildlifeMapState
  selectSighting(sightingId: string | null): WildlifeMapState
  /** 在地图上叠加某条推断轨迹（`null` = 取消叠加） */
  selectTrack(trackId: string | null): WildlifeMapState
  reset(): void
}

const INITIAL_STATE: WildlifeMapState = {
  status: 'idle',
  basemap: null,
  species: [],
  zones: [],
  spots: [],
  tracks: [],
  sightings: [],
  individuals: [],
  activeSpeciesId: null,
  selectedZoneId: null,
  selectedSightingId: null,
  selectedTrackId: null,
  error: null,
  fromCache: false,
  updatedAt: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 缓存可能由旧版本写入，必须做形状校验后再用 */
export function isCachedWildlifeMap(value: unknown): value is CachedWildlifeMap {
  if (!isRecord(value)) return false
  return (
    Array.isArray(value.species) &&
    Array.isArray(value.zones) &&
    Array.isArray(value.spots) &&
    typeof value.updatedAt === 'string'
  )
}

export function createWildlifeMapUseCase(deps: WildlifeMapDeps): WildlifeMapUseCase {
  const { repository, cache, clock, cacheKey, defaultLimit } = deps

  let state: WildlifeMapState = INITIAL_STATE
  let hydrated = false
  const listeners = new Set<() => void>()

  function patch(next: Partial<WildlifeMapState>): WildlifeMapState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function hydrate(): WildlifeMapState {
    if (hydrated) return state
    hydrated = true

    const cached = cache.read<unknown>(cacheKey)
    if (!isCachedWildlifeMap(cached)) return state

    const total = cached.zones.length + cached.spots.length + cached.sightings.length
    return patch({
      status: total === 0 ? 'empty' : 'ready',
      basemap: cached.basemap,
      species: cached.species,
      zones: cached.zones,
      spots: cached.spots,
      tracks: cached.tracks ?? [],
      sightings: cached.sightings ?? [],
      individuals: cached.individuals ?? [],
      activeSpeciesId: cached.activeSpeciesId,
      error: null,
      fromCache: true,
      updatedAt: cached.updatedAt,
    })
  }

  async function load(speciesId?: string | null): Promise<WildlifeMapState> {
    const active = speciesId === undefined ? state.activeSpeciesId : speciesId
    patch({
      status: state.zones.length > 0 ? 'ready' : 'loading',
      activeSpeciesId: active,
      error: null,
    })

    const query = {
      speciesId: active,
      ...(defaultLimit === undefined ? {} : { limit: defaultLimit }),
    }

    // 地图首屏需要「底图 + 物种 + 区域 + 热点 + 轨迹 + 个体」齐了才有意义，因此并发拉取
    const [
      basemapResult,
      speciesResult,
      zonesResult,
      spotsResult,
      tracksResult,
      sightingsResult,
      individualsResult,
    ] = await Promise.all([
      repository.basemap(),
      repository.listSpecies(),
      repository.listZones(),
      repository.listSpots(query),
      repository.listTracks(query),
      repository.listSightings(query),
      repository.listIndividuals(active),
    ])

    // 契约 §8：失败静默降级 —— 有缓存就继续用缓存，只把错误文案挂上
    const failure =
      !basemapResult.ok
        ? basemapResult.error
        : !speciesResult.ok
          ? speciesResult.error
          : !zonesResult.ok
            ? zonesResult.error
            : !spotsResult.ok
              ? spotsResult.error
              : !tracksResult.ok
                ? tracksResult.error
                : !sightingsResult.ok
                  ? sightingsResult.error
                  : !individualsResult.ok
                    ? individualsResult.error
                    : null

    if (failure !== null) {
      return patch({
        status: state.zones.length > 0 ? 'ready' : 'error',
        error: failure.message,
        fromCache: state.zones.length > 0,
      })
    }

    // 到这里七个结果都成功（failure === null 蕴含全部 ok）
    const basemap = basemapResult.ok ? basemapResult.value : null
    const species = speciesResult.ok ? speciesResult.value : []
    const zones = zonesResult.ok ? zonesResult.value : []
    const spots = spotsResult.ok ? spotsResult.value.items : []
    const tracks = tracksResult.ok ? tracksResult.value.items : []
    const sightings = sightingsResult.ok ? sightingsResult.value.items : []
    const individuals = individualsResult.ok ? individualsResult.value : []

    const updatedAt = clock.now().toISOString()
    cache.write(cacheKey, {
      basemap,
      species,
      zones,
      spots,
      tracks,
      sightings,
      individuals,
      activeSpeciesId: active,
      updatedAt,
    } satisfies CachedWildlifeMap)

    const total = zones.length + spots.length + sightings.length
    return patch({
      status: total === 0 ? 'empty' : 'ready',
      basemap,
      species,
      zones,
      spots,
      tracks,
      sightings,
      individuals,
      activeSpeciesId: active,
      error: null,
      fromCache: false,
      updatedAt,
    })
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    hydrate,
    load,

    selectSpecies(speciesId: string | null): WildlifeMapState {
      // 只改筛选条件；重新拉取由调用方接着 `load()`（与论坛版块切换一致）
      return patch({ activeSpeciesId: speciesId, selectedSightingId: null })
    },

    selectZone(zoneId: string | null): WildlifeMapState {
      return patch({ selectedZoneId: zoneId })
    },

    selectSighting(sightingId: string | null): WildlifeMapState {
      return patch({ selectedSightingId: sightingId })
    },

    selectTrack(trackId: string | null): WildlifeMapState {
      return patch({ selectedTrackId: trackId })
    },

    reset(): void {
      hydrated = false
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}

/* ------------------------------------------------------------------ *
 * 纯选择器（页面直接用；**所有坐标在这里完成 WGS84 → GCJ-02**）
 * ------------------------------------------------------------------ */

/** 区域圈的颜色由调用方从设计令牌注入（domain / application 不碰 UI 令牌） */
export interface OverlayColors {
  zoneStroke: string
  zoneFill: string
  sensitiveStroke: string
  sensitiveFill: string
  track: string
}

export interface MapOverlays {
  circles: MapCircle[]
  markers: MapMarker[]
  polyline: {
    points: Array<{ latitude: number; longitude: number }>
    color: string
    width: number
    arrowLine: boolean
    dottedLine: boolean
  } | null
  /** 被 E10 过滤掉的热点数（UI 可以提示「有 N 个热点尚未达到展示延迟」） */
  hiddenByDelay: number
}

/**
 * 把 WGS84 状态转成 `<map>` 组件可用的叠加层（**全部 GCJ-02**）。
 *
 * 这是「渲染前必须转换」的**唯一**落点：
 * - 区域圈 → `circles`（圆心转 GCJ-02；半径是米，不转）
 * - 聚合热点 → `markers`（转 GCJ-02；**延迟 <24h 的被过滤**，E10）
 * - 观测点 → `markers`（转 GCJ-02；敏感区无坐标的**不渲染**）
 * - 选中轨迹 → `polyline`（逐点转 GCJ-02）
 */
export function buildMapOverlays(
  state: WildlifeMapState,
  now: Date,
  colors: OverlayColors,
): MapOverlays {
  const zones = state.zones.filter((zone) => zoneMatchesSpecies(zone, state.activeSpeciesId))
  const spots = filterBySpecies(state.spots, state.activeSpeciesId)
  const sightings = filterBySpecies(state.sightings, state.activeSpeciesId)

  const circles: MapCircle[] = zones.map((zone) =>
    zoneToMapCircle(
      zone,
      zone.isSensitive
        ? { stroke: colors.sensitiveStroke, fill: colors.sensitiveFill }
        : { stroke: colors.zoneStroke, fill: colors.zoneFill },
    ),
  )

  let hiddenByDelay = 0
  const markers: MapMarker[] = []

  for (const spot of spots) {
    // 规格 §8.1 E10：热点至少延迟 24h 才公开，防止平台变成「围观召集工具」
    if (!isSpotAggregationDelayed(spot, now)) {
      hiddenByDelay += 1
      continue
    }
    markers.push(spotToMapMarker(spot, speciesDisplayName(findSpeciesById(state.species, spot.speciesId))))
  }

  for (const sighting of sightings) {
    // 敏感区（`zone-only`）没有坐标 → `sightingToMapMarker` 返回 null，不渲染点位
    // （规格 §9.3 ①：没有坐标就没有反推的可能）
    const marker = sightingToMapMarker(
      sighting,
      speciesDisplayName(findSpeciesById(state.species, sighting.speciesId)),
      now,
    )
    if (marker !== null) markers.push(marker)
  }

  const selectedTrack = state.tracks.find((track) => track.id === state.selectedTrackId)
  const polyline =
    selectedTrack === undefined
      ? null
      : {
          points: trackToMapPoints(selectedTrack),
          color: colors.track,
          width: 4,
          arrowLine: true,
          // 虚线是刻意的：让「推断轨迹」在视觉上就不像实测路径（规格 §6.1）
          dottedLine: true,
        }

  return {
    circles,
    // `<map>` 的 marker.id 必须是 Number（Taro 类型 + 官方性能建议），
    // 因此这里按数组下标分配 markerId，页面用 markerId → 业务 id 反查。
    markers: markers.map((marker, index) => ({ ...marker, markerId: index })),
    polyline,
    hiddenByDelay,
  }
}

function findSpeciesById(
  species: readonly WildlifeSpecies[],
  speciesId: string | null,
): WildlifeSpecies | undefined {
  if (speciesId === null) return undefined
  return species.find((item) => item.id === speciesId)
}

/** 当前选中观测点的展示模型（详情弹窗：物种 / 发现时间 / 照片 / 区域 / 投喂规范） */
export function selectedSightingSummary(
  state: WildlifeMapState,
  now: Date,
): SightingSummary | null {
  const found = state.sightings.find((item) => item.id === state.selectedSightingId)
  if (found === undefined) return null
  return summarizeSighting(found, state.species, state.zones, now)
}

/** 当前选中区域的展示模型 */
export interface ZoneSummary {
  id: string
  name: string
  radiusM: number
  speciesNames: string[]
  feedingPolicy: WildlifeZone['feedingPolicy']
  noticeText: string
  isSensitive: boolean
  fuzzRadiusM: number
  /** 敏感区**不公开坐标** —— UI 必须显式说明 */
  showsCoordinates: boolean
}

export function zoneSummary(zone: WildlifeZone, species: readonly WildlifeSpecies[]): ZoneSummary {
  return {
    id: zone.id,
    name: zone.name,
    radiusM: zone.radiusM,
    speciesNames: zone.speciesIds.map((id) => speciesDisplayName(findSpeciesById(species, id))),
    feedingPolicy: zone.feedingPolicy,
    noticeText: zone.noticeText ?? '',
    isSensitive: zone.isSensitive,
    fuzzRadiusM: zone.fuzzRadiusM,
    showsCoordinates: !zone.isSensitive,
  }
}

/** 地图底部的聚合延迟说明（E10，必须展示） */
export function aggregationNotice(): string {
  return WILDLIFE_AGGREGATION_NOTICE
}
