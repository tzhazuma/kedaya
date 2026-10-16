import { describe, expect, it } from 'vitest'
import { wgs84ToGcj02 } from '@kedaya/shared'

import { createFakeCache, createFakeWildlifeRepository, fixedClock, TEST_NOW_ISO, upstreamError } from '../../__tests__/testDoubles'
import {
  buildMapOverlays,
  createWildlifeMapUseCase,
  isCachedWildlifeMap,
  selectedSightingSummary,
  zoneSummary,
} from '../wildlifeMap'
import { err, ok } from '@kedaya/shared'
import {
  wildlifeBasemap,
  wildlifeSighting,
  wildlifeSpecies,
  wildlifeSpot,
  wildlifeTrack,
  wildlifeZone,
} from '../../__tests__/testDoubles'

/**
 * 动物地图用例测试。
 *
 * ⚠️ **最重要的一组断言**：`buildMapOverlays()` 产出的每一个坐标都必须是 **GCJ-02**。
 * `<map>` 组件只认 GCJ-02，而 API 给的是 WGS84 —— 混用会偏移约 470 米。
 * 这里直接对 `wgs84ToGcj02` 的期望值做逐位断言，而不是「看起来差不多」。
 */

const CACHE_KEY = 'test:wildlife:map'
const NOW = new Date(TEST_NOW_ISO)
const COLORS = {
  zoneStroke: '#111111',
  zoneFill: '#222222',
  sensitiveStroke: '#333333',
  sensitiveFill: '#444444',
  track: '#555555',
}

function setup() {
  const repository = createFakeWildlifeRepository({
    basemap: ok(wildlifeBasemap()),
    species: [ok([wildlifeSpecies('sp-1'), wildlifeSpecies('sp-2')])],
    zones: [ok([wildlifeZone('wz-1'), wildlifeZone('wz-sensitive', { isSensitive: true })])],
    spots: [
      ok({
        items: [
          wildlifeSpot('wsp-1', { speciesId: 'sp-1' }),
          // 12 小时前算出来的热点 → 必须被 E10 过滤掉
          wildlifeSpot('wsp-fresh', { speciesId: 'sp-1', computedAt: '2026-10-16T00:00:00.000Z' }),
        ],
        nextCursor: null,
        total: 2,
      }),
    ],
    tracks: [ok({ items: [wildlifeTrack('wt-1')], nextCursor: null, total: 1 })],
    sightings: [
      ok({
        items: [
          wildlifeSighting('ws-1', { speciesId: 'sp-1' }),
          // 敏感区：无坐标
          wildlifeSighting('ws-2', { speciesId: 'sp-1', zoneId: 'wz-sensitive', fuzzLevel: 'zone-only', fuzzedGeo: undefined }),
        ],
        nextCursor: null,
        total: 2,
      }),
    ],
  })
  const cache = createFakeCache()
  const useCase = createWildlifeMapUseCase({
    repository,
    cache,
    clock: fixedClock(TEST_NOW_ISO),
    cacheKey: CACHE_KEY,
  })
  return { repository, cache, useCase }
}

describe('wildlife · 动物地图用例', () => {
  it('契约 §8 启动时序：hydrate 同步读缓存，未命中时保持 idle 且不发请求', () => {
    const { useCase } = setup()
    const hydrated = useCase.hydrate()
    expect(hydrated.status).toBe('idle')
    expect(hydrated.zones).toHaveLength(0)
  })

  it('load() 成功：底图 / 物种 / 区域 / 热点 / 轨迹 / 观测 一次拉齐并写缓存', async () => {
    const { useCase, cache } = setup()
    const state = await useCase.load()

    expect(state.status).toBe('ready')
    expect(state.basemap?.license).toBe('original')
    expect(state.species).toHaveLength(2)
    expect(state.zones).toHaveLength(2)
    expect(state.spots).toHaveLength(2)
    expect(state.tracks).toHaveLength(1)
    expect(state.sightings).toHaveLength(2)
    expect(state.error).toBeNull()

    const cached = cache.read<unknown>(CACHE_KEY)
    expect(isCachedWildlifeMap(cached)).toBe(true)
  })

  it('load() 失败且无缓存 → error 态；有缓存 → 静默降级为 ready + fromCache', async () => {
    const repository = createFakeWildlifeRepository({
      zones: [ok([wildlifeZone('wz-1')]), err(upstreamError())],
      species: [ok([wildlifeSpecies('sp-1')]), err(upstreamError())],
      spots: [ok({ items: [], nextCursor: null, total: 0 }), err(upstreamError())],
      tracks: [ok({ items: [], nextCursor: null, total: 0 }), err(upstreamError())],
      sightings: [ok({ items: [], nextCursor: null, total: 0 }), err(upstreamError())],
    })
    const useCase = createWildlifeMapUseCase({
      repository,
      cache: createFakeCache(),
      clock: fixedClock(TEST_NOW_ISO),
      cacheKey: CACHE_KEY,
    })

    const first = await useCase.load()
    expect(first.status).toBe('ready')

    const second = await useCase.load()
    expect(second.status).toBe('ready')
    expect(second.fromCache).toBe(true)
    expect(second.error).toBe('网络不可用')
  })

  it('空数据集 → empty 态（三态齐全）', async () => {
    const repository = createFakeWildlifeRepository({
      species: [ok([wildlifeSpecies('sp-1')])],
      zones: [ok([])],
      spots: [ok({ items: [], nextCursor: null, total: 0 })],
      tracks: [ok({ items: [], nextCursor: null, total: 0 })],
      sightings: [ok({ items: [], nextCursor: null, total: 0 })],
    })
    const useCase = createWildlifeMapUseCase({
      repository,
      cache: createFakeCache(),
      clock: fixedClock(TEST_NOW_ISO),
      cacheKey: CACHE_KEY,
    })
    expect((await useCase.load()).status).toBe('empty')
  })

  it('物种筛选会透传给仓储，并在快照里留下筛选条件', async () => {
    const { useCase, repository } = setup()
    await useCase.load('sp-2')
    expect(useCase.getSnapshot().activeSpeciesId).toBe('sp-2')
    expect(repository.zonesQueries[0]?.speciesId).toBe('sp-2')
  })

  it('选择 / 取消选择区域与观测点', async () => {
    const { useCase } = setup()
    await useCase.load()
    useCase.selectZone('wz-1')
    expect(useCase.getSnapshot().selectedZoneId).toBe('wz-1')
    useCase.selectSighting('ws-1')
    expect(useCase.getSnapshot().selectedSightingId).toBe('ws-1')
    useCase.selectSighting(null)
    expect(useCase.getSnapshot().selectedSightingId).toBeNull()
  })
})

describe('wildlife · 地图叠加层（WGS84 → GCJ-02）', () => {
  it('区域圈圆心必须是 GCJ-02，半径保持米', async () => {
    const { useCase } = setup()
    const state = await useCase.load()
    const overlays = buildMapOverlays(state, NOW, COLORS)

    const expected = wgs84ToGcj02(31.1795, 121.591)
    const circle = overlays.circles.find((item) => item.radius === 80)
    expect(circle?.latitude).toBe(expected.lat)
    expect(circle?.longitude).toBe(expected.lng)
    // 若忘了转换，圆心会等于 WGS84 原值
    expect(circle?.latitude).not.toBe(31.1795)
  })

  it('观测点 / 热点 marker 必须是 GCJ-02', async () => {
    const { useCase } = setup()
    const state = await useCase.load()
    const overlays = buildMapOverlays(state, NOW, COLORS)

    const expected = wgs84ToGcj02(31.1795, 121.591)
    const spotMarker = overlays.markers.find((item) => item.kind === 'spot')
    expect(spotMarker?.latitude).toBe(expected.lat)
    expect(spotMarker?.longitude).toBe(expected.lng)

    const sightingMarker = overlays.markers.find((item) => item.kind === 'sighting')
    expect(sightingMarker?.latitude).toBe(expected.lat)
  })

  it('marker 分配了数字 markerId（`<map>` 的 id 必须是 Number）', async () => {
    const { useCase } = setup()
    const state = await useCase.load()
    const overlays = buildMapOverlays(state, NOW, COLORS)
    expect(overlays.markers.map((m) => m.markerId)).toEqual(overlays.markers.map((_, i) => i))
  })

  it('E10：computedAt 距今 <24h 的热点被过滤，并计入 hiddenByDelay', async () => {
    const { useCase } = setup()
    const state = await useCase.load()
    const overlays = buildMapOverlays(state, NOW, COLORS)

    const spotMarkers = overlays.markers.filter((item) => item.kind === 'spot')
    expect(spotMarkers).toHaveLength(1)
    expect(spotMarkers[0]?.id).toBe('wsp-1')
    expect(overlays.hiddenByDelay).toBe(1)
  })

  it('敏感区（无坐标）的观测不渲染 marker，但区域圈仍然展示', async () => {
    const { useCase } = setup()
    const state = await useCase.load()
    const overlays = buildMapOverlays(state, NOW, COLORS)

    expect(overlays.markers.some((item) => item.id === 'ws-2')).toBe(false)
    expect(overlays.circles.length).toBe(2)
  })

  it('选中轨迹 → polyline 逐点 GCJ-02，且是虚线（视觉上就不像实测路径）', async () => {
    const { useCase } = setup()
    await useCase.load()
    useCase.selectTrack('wt-1')
    const overlays = buildMapOverlays(useCase.getSnapshot(), NOW, COLORS)

    const track = wildlifeTrack('wt-1')
    const firstPoint = track.points[0]
    const expected = wgs84ToGcj02(firstPoint?.lat ?? 0, firstPoint?.lng ?? 0)

    expect(overlays.polyline?.points[0]?.latitude).toBe(expected.lat)
    expect(overlays.polyline?.dottedLine).toBe(true)
    expect(overlays.polyline?.color).toBe(COLORS.track)
  })

  it('未选中轨迹时 polyline 为 null（不画线）', async () => {
    const { useCase } = setup()
    const state = await useCase.load()
    expect(buildMapOverlays(state, NOW, COLORS).polyline).toBeNull()
  })
})

describe('wildlife · 详情选择器', () => {
  it('selectedSightingSummary 只在选中时返回，且汇总投喂规范与模糊层级', async () => {
    const { useCase } = setup()
    await useCase.load()
    expect(selectedSightingSummary(useCase.getSnapshot(), NOW)).toBeNull()

    useCase.selectSighting('ws-1')
    const summary = selectedSightingSummary(useCase.getSnapshot(), NOW)
    expect(summary?.speciesName).toBe('物种 sp-1')
    expect(summary?.zoneName).toBe('区域 wz-1')
    expect(summary?.fuzzLabel).toContain('模糊')
  })

  it('zoneSummary 明确标注敏感区不公开坐标', async () => {
    const { useCase } = setup()
    const state = await useCase.load()
    const sensitive = state.zones.find((item) => item.id === 'wz-sensitive')
    expect(state.zones).toHaveLength(2)
    expect(sensitive).toBeDefined()

    const summary = zoneSummary(sensitive as never, state.species)
    expect(summary.isSensitive).toBe(true)
    expect(summary.showsCoordinates).toBe(false)
    expect(summary.fuzzRadiusM).toBe(50)
  })
})
