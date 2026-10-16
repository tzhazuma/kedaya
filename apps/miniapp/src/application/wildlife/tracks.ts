import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { WildlifeRepository } from '../../domain/ports/wildlifeRepository'
import {
  WILDLIFE_TRACK_DISCLAIMER_FALLBACK,
  WILDLIFE_TRACK_INFERRED_LABEL,
  filterBySpecies,
  speciesDisplayName,
  trackLengthMeters,
} from '../../domain/models/wildlife'
import type {
  WildlifeIndividual,
  WildlifeSpecies,
  WildlifeTrack,
} from '../../domain/models/wildlife'

/**
 * 推断轨迹用例（规格 §6）。
 *
 * ⚠️ **本页面的存在意义是「诚实地展示不确定性」**：
 * 我们的数据来自同学偶发上报，不是 GPS 项圈，因此**无法**重建真实运动路径。
 * `WildlifeTrack` 是「由 N 次上报**推断**出的活动走廊」。
 *
 * 因此本用例强制：
 * - `disclaimer` **优先用服务端下发的文案**（规格 §10.5：把合规文案变成接口契约的一部分），
 *   服务端没给才回退到本地兜底；
 * - UI 必须显著标注「推断轨迹，不是实测路径」（规格 §6.1 / §11.3 T18）；
 * - **不做**路径插值 / 样条平滑 / 速度推断 / 地图匹配 —— 那会编造动物没走过的位置。
 */

export type WildlifeTrackStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface WildlifeTracksState {
  status: WildlifeTrackStatus
  tracks: WildlifeTrack[]
  species: WildlifeSpecies[]
  individuals: WildlifeIndividual[]
  activeSpeciesId: string | null
  selectedTrackId: string | null
  selectedTrack: WildlifeTrack | null
  error: string | null
  fromCache: boolean
  updatedAt: string | null
}

export interface CachedWildlifeTracks {
  tracks: WildlifeTrack[]
  species: WildlifeSpecies[]
  individuals: WildlifeIndividual[]
  activeSpeciesId: string | null
  updatedAt: string
}

export interface WildlifeTracksDeps {
  repository: WildlifeRepository
  cache: CachePort
  clock: ClockPort
  cacheKey: string
  defaultLimit?: number
}

export interface WildlifeTracksUseCase {
  getSnapshot(): WildlifeTracksState
  subscribe(listener: () => void): () => void
  hydrate(): WildlifeTracksState
  load(speciesId?: string | null): Promise<WildlifeTracksState>
  selectTrack(trackId: string | null): Promise<WildlifeTracksState>
  selectSpecies(speciesId: string | null): WildlifeTracksState
  reset(): void
}

const INITIAL_STATE: WildlifeTracksState = {
  status: 'idle',
  tracks: [],
  species: [],
  individuals: [],
  activeSpeciesId: null,
  selectedTrackId: null,
  selectedTrack: null,
  error: null,
  fromCache: false,
  updatedAt: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isCachedWildlifeTracks(value: unknown): value is CachedWildlifeTracks {
  if (!isRecord(value)) return false
  return Array.isArray(value.tracks) && typeof value.updatedAt === 'string'
}

export function createWildlifeTracksUseCase(deps: WildlifeTracksDeps): WildlifeTracksUseCase {
  const { repository, cache, clock, cacheKey, defaultLimit } = deps

  let state: WildlifeTracksState = INITIAL_STATE
  let hydrated = false
  const listeners = new Set<() => void>()

  function patch(next: Partial<WildlifeTracksState>): WildlifeTracksState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function hydrate(): WildlifeTracksState {
    if (hydrated) return state
    hydrated = true

    const cached = cache.read<unknown>(cacheKey)
    if (!isCachedWildlifeTracks(cached)) return state

    return patch({
      status: cached.tracks.length === 0 ? 'empty' : 'ready',
      tracks: cached.tracks,
      species: cached.species ?? [],
      individuals: cached.individuals ?? [],
      activeSpeciesId: cached.activeSpeciesId,
      error: null,
      fromCache: true,
      updatedAt: cached.updatedAt,
    })
  }

  async function load(speciesId?: string | null): Promise<WildlifeTracksState> {
    const active = speciesId === undefined ? state.activeSpeciesId : speciesId
    patch({
      status: state.tracks.length > 0 ? 'ready' : 'loading',
      activeSpeciesId: active,
      error: null,
    })

    const query = {
      speciesId: active,
      ...(defaultLimit === undefined ? {} : { limit: defaultLimit }),
    }

    const [tracksResult, speciesResult, individualsResult] = await Promise.all([
      repository.listTracks(query),
      repository.listSpecies(),
      repository.listIndividuals(active),
    ])

    const failure = !tracksResult.ok
      ? tracksResult.error
      : !speciesResult.ok
        ? speciesResult.error
        : null

    if (failure !== null) {
      return patch({
        status: state.tracks.length > 0 ? 'ready' : 'error',
        error: failure.message,
        fromCache: state.tracks.length > 0,
      })
    }

    const tracks = tracksResult.ok ? tracksResult.value.items : []
    const species = speciesResult.ok ? speciesResult.value : []
    const individuals = individualsResult.ok ? individualsResult.value : []

    const updatedAt = clock.now().toISOString()
    cache.write(cacheKey, {
      tracks,
      species,
      individuals,
      activeSpeciesId: active,
      updatedAt,
    } satisfies CachedWildlifeTracks)

    return patch({
      status: tracks.length === 0 ? 'empty' : 'ready',
      tracks,
      species,
      individuals,
      activeSpeciesId: active,
      // 物种筛选变了 → 之前选中的轨迹可能不在列表里了
      selectedTrack: null,
      selectedTrackId: null,
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

    async selectTrack(trackId: string | null): Promise<WildlifeTracksState> {
      if (trackId === null) {
        return patch({ selectedTrackId: null, selectedTrack: null })
      }

      // 列表里已有就用列表数据（避免多余请求），否则拉详情
      const fromList = state.tracks.find((track) => track.id === trackId)
      if (fromList !== undefined) {
        return patch({ selectedTrackId: trackId, selectedTrack: fromList })
      }

      patch({ selectedTrackId: trackId, error: null })
      const result = await repository.trackDetail(trackId)
      if (!result.ok) {
        return patch({ selectedTrackId: null, selectedTrack: null, error: result.error.message })
      }
      return patch({ selectedTrack: result.value })
    },

    selectSpecies(speciesId: string | null): WildlifeTracksState {
      return patch({
        activeSpeciesId: speciesId,
        tracks: [],
        selectedTrack: null,
        selectedTrackId: null,
        status: 'idle',
        fromCache: false,
      })
    },

    reset(): void {
      hydrated = false
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}

/* ------------------------------------------------------------------ *
 * 纯选择器
 * ------------------------------------------------------------------ */

/** 轨迹详情视图 —— 「这是推断轨迹」的文案与数据在这里收口，页面不得自己拼 */
export interface TrackDetailView {
  id: string
  speciesName: string
  individualName: string | null
  /** 恒为「推断轨迹」—— 页面**必须**显著展示（规格 §6.1） */
  inferredLabel: string
  isInferred: true
  /** 服务端下发的免责说明；缺失时回退本地兜底 */
  disclaimer: string
  /** 免责说明是否来自服务端（false = 用了本地兜底，UI 可据此提示） */
  disclaimerFromServer: boolean
  pointCount: number
  sightingCount: number
  totalDistanceM: number
  methodLabel: string
  spanStartLabel: string
  spanEndLabel: string
  confidenceLabel: string
  algorithmVersion: string
}

const METHOD_LABELS: Readonly<Record<WildlifeTrack['method'], string>> = {
  // 只有一种方法，且**明确不做插值**（规格 §6.2 ④）
  'dbscan-chain': '空间聚类后按时间串联（dbscan-chain，不做插值）',
}

export function trackDetailView(
  track: WildlifeTrack,
  species: readonly WildlifeSpecies[],
  individuals: readonly WildlifeIndividual[],
  formatDate: (iso: string) => string,
): TrackDetailView {
  const found = species.find((item) => item.id === track.speciesId)
  const individual =
    track.individualId === null
      ? undefined
      : individuals.find((item) => item.id === track.individualId)

  return {
    id: track.id,
    speciesName: speciesDisplayName(found),
    individualName: individual?.name ?? null,
    inferredLabel: WILDLIFE_TRACK_INFERRED_LABEL,
    isInferred: true,
    disclaimer:
      track.disclaimer !== undefined && track.disclaimer !== ''
        ? track.disclaimer
        : WILDLIFE_TRACK_DISCLAIMER_FALLBACK,
    disclaimerFromServer: track.disclaimer !== undefined && track.disclaimer !== '',
    pointCount: track.pointCount,
    sightingCount: track.sightingCount,
    totalDistanceM: track.totalDistanceM > 0 ? track.totalDistanceM : trackLengthMeters(track),
    methodLabel: METHOD_LABELS[track.method],
    spanStartLabel: formatDate(track.startedAt),
    spanEndLabel: formatDate(track.endedAt),
    confidenceLabel: `${Math.round(track.confidence * 100)}%`,
    algorithmVersion: track.algorithmVersion,
  }
}

/** 列表里按当前物种筛选（防御：仓储已筛选，但缓存可能来自别的筛选条件） */
export function visibleTracks(state: WildlifeTracksState): WildlifeTrack[] {
  return filterBySpecies(state.tracks, state.activeSpeciesId)
}
