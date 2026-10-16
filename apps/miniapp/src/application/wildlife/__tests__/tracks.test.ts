import { describe, expect, it } from 'vitest'
import { err, ok } from '@kedaya/shared'

import {
  createFakeCache,
  createFakeWildlifeRepository,
  fixedClock,
  TEST_NOW_ISO,
  upstreamError,
  wildlifeIndividual,
  wildlifeSpecies,
  wildlifeTrack,
} from '../../__tests__/testDoubles'
import {
  createWildlifeTracksUseCase,
  isCachedWildlifeTracks,
  trackDetailView,
  visibleTracks,
} from '../tracks'

/**
 * 推断轨迹用例测试（规格 §6 / §11.3 T18）。
 *
 * 本页面的存在意义是「诚实地展示不确定性」，因此断言的重点不是折线，
 * 而是**「推断」标注与免责说明不可缺失**。
 */

const CACHE_KEY = 'test:wildlife:tracks'
const formatDate = (iso: string): string => iso.slice(0, 10)

function setup() {
  const repository = createFakeWildlifeRepository({
    species: [ok([wildlifeSpecies('sp-1'), wildlifeSpecies('sp-2')])],
    individuals: [ok([wildlifeIndividual('wi-1', { name: '大橘', speciesId: 'sp-1' })])],
    tracks: [
      ok({
        items: [wildlifeTrack('wt-1', { individualId: 'wi-1' }), wildlifeTrack('wt-2', { speciesId: 'sp-2' })],
        nextCursor: null,
        total: 2,
      }),
    ],
  })
  const cache = createFakeCache()
  const useCase = createWildlifeTracksUseCase({
    repository,
    cache,
    clock: fixedClock(TEST_NOW_ISO),
    cacheKey: CACHE_KEY,
  })
  return { repository, cache, useCase }
}

describe('wildlife · 推断轨迹用例', () => {
  it('契约 §8：hydrate 同步读缓存；load 成功后写缓存', async () => {
    const { useCase, cache } = setup()
    expect(useCase.hydrate().status).toBe('idle')

    const state = await useCase.load()
    expect(state.status).toBe('ready')
    expect(state.tracks).toHaveLength(2)
    expect(state.species).toHaveLength(2)
    expect(isCachedWildlifeTracks(cache.read<unknown>(CACHE_KEY))).toBe(true)
  })

  it('无轨迹 → empty 态（三态齐全）', async () => {
    const repository = createFakeWildlifeRepository({
      species: [ok([wildlifeSpecies('sp-1')])],
      individuals: [ok([])],
      tracks: [ok({ items: [], nextCursor: null, total: 0 })],
    })
    const useCase = createWildlifeTracksUseCase({
      repository,
      cache: createFakeCache(),
      clock: fixedClock(TEST_NOW_ISO),
      cacheKey: CACHE_KEY,
    })
    expect((await useCase.load()).status).toBe('empty')
  })

  it('请求失败且无缓存 → error 态；有缓存 → 静默降级保留旧轨迹（宁可展示旧轨迹，也不展示空地图）', async () => {
    const repository = createFakeWildlifeRepository({
      species: [ok([wildlifeSpecies('sp-1')]), err(upstreamError())],
      individuals: [ok([])],
      tracks: [
        ok({ items: [wildlifeTrack('wt-1')], nextCursor: null, total: 1 }),
        err(upstreamError()),
      ],
    })
    const useCase = createWildlifeTracksUseCase({
      repository,
      cache: createFakeCache(),
      clock: fixedClock(TEST_NOW_ISO),
      cacheKey: CACHE_KEY,
    })

    expect((await useCase.load()).status).toBe('ready')
    const second = await useCase.load()
    expect(second.status).toBe('ready')
    expect(second.fromCache).toBe(true)
    expect(second.error).toBe('网络不可用')
    expect(second.tracks).toHaveLength(1)
  })

  it('selectTrack：列表里已有的轨迹直接用列表数据（不发详情请求）', async () => {
    const { useCase } = setup()
    await useCase.load()

    const state = await useCase.selectTrack('wt-1')
    expect(state.selectedTrack?.id).toBe('wt-1')
    expect(state.selectedTrackId).toBe('wt-1')
  })

  it('selectTrack：不在列表里的轨迹走详情接口；失败则清空选择并报错', async () => {
    const { useCase, repository } = setup()
    await useCase.load()

    repository.trackDetailResult = ok(wildlifeTrack('wt-remote'))
    expect((await useCase.selectTrack('wt-remote')).selectedTrack?.id).toBe('wt-remote')

    repository.trackDetailResult = err({ code: 'NOT_FOUND', message: '轨迹不存在或尚未生成' })
    const failed = await useCase.selectTrack('wt-missing')
    expect(failed.selectedTrack).toBeNull()
    expect(failed.error).toContain('轨迹不存在')
  })

  it('selectTrack(null) 取消叠加', async () => {
    const { useCase } = setup()
    await useCase.load()
    await useCase.selectTrack('wt-1')
    expect((await useCase.selectTrack(null)).selectedTrack).toBeNull()
  })

  it('切换物种筛选会清空列表与选中轨迹，并透传 speciesId', async () => {
    const { useCase, repository } = setup()
    await useCase.load()
    await useCase.selectTrack('wt-1')

    const cleared = useCase.selectSpecies('sp-2')
    expect(cleared.tracks).toHaveLength(0)
    expect(cleared.selectedTrack).toBeNull()
    expect(cleared.activeSpeciesId).toBe('sp-2')

    await useCase.load('sp-2')
    expect(repository.tracksQueue.length).toBe(0)
    expect(useCase.getSnapshot().activeSpeciesId).toBe('sp-2')
  })
})

describe('wildlife · 轨迹详情视图（「这是推断轨迹」不可缺失）', () => {
  it('恒为「推断轨迹」，且 isInferred 为 true（规格 §11.3 T18）', () => {
    const view = trackDetailView(
      wildlifeTrack('wt-1'),
      [wildlifeSpecies('sp-1', { commonNameZh: '猫' })],
      [wildlifeIndividual('wi-1', { name: '大橘' })],
      formatDate,
    )
    expect(view.inferredLabel).toBe('推断轨迹')
    expect(view.isInferred).toBe(true)
    expect(view.disclaimerFromServer).toBe(true)
    expect(view.disclaimer).toContain('并非实测运动路径')
  })

  it('服务端未下发 disclaimer 时回退本地兜底，并标记来源为本地', () => {
    const view = trackDetailView(
      wildlifeTrack('wt-1', { disclaimer: undefined }),
      [wildlifeSpecies('sp-1')],
      [],
      formatDate,
    )
    expect(view.disclaimerFromServer).toBe(false)
    expect(view.disclaimer).toContain('不是')
    // 绝不能是空字符串 —— 空白会被读成「这是实测路径」
    expect(view.disclaimer.length).toBeGreaterThan(10)
  })

  it('个体名与生成方法（明确不做插值）都会展示', () => {
    const view = trackDetailView(
      wildlifeTrack('wt-1', { individualId: 'wi-1' }),
      [wildlifeSpecies('sp-1')],
      [wildlifeIndividual('wi-1', { name: '大橘' })],
      formatDate,
    )
    expect(view.individualName).toBe('大橘')
    expect(view.methodLabel).toContain('不做插值')
    expect(view.pointCount).toBe(2)
  })

  it('totalDistanceM 为 0 时用折线长度兜底（不显示 0 米）', () => {
    const view = trackDetailView(
      wildlifeTrack('wt-1', { totalDistanceM: 0 }),
      [wildlifeSpecies('sp-1')],
      [],
      formatDate,
    )
    expect(view.totalDistanceM).toBeGreaterThan(0)
  })

  it('visibleTracks 按当前物种筛选（防御缓存里的旧筛选条件）', async () => {
    const { useCase } = setup()
    await useCase.load()
    const state = useCase.getSnapshot()
    expect(visibleTracks(state)).toHaveLength(2)
    expect(visibleTracks({ ...state, activeSpeciesId: 'sp-2' })).toHaveLength(1)
  })
})
