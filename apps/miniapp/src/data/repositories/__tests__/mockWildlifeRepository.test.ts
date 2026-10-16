import { describe, expect, it } from 'vitest'
import { distanceMeters, snapToGrid } from '@kedaya/shared'

import { createMockWildlifeRepository } from '../mockWildlifeRepository'
import { MOCK_WILDLIFE_SIGHTINGS, MOCK_WILDLIFE_ZONES } from '../../mock/wildlifeFixtures'
import { mockNow } from '../../mock/fixtures'
import type { WildlifeSightingCreateBody } from '../../../domain/models/wildlife'

/**
 * Mock 野生动物仓储测试（契约 §7 硬规则 4：无后端也能跑）。
 *
 * 覆盖：游标分页、三态控制面、**隐私流水线真的在跑**（敏感区无坐标 / 网格吸附）、
 * 分类降级、个体命名唯一性。
 */

const NOW = mockNow()

function body(overrides: Partial<WildlifeSightingCreateBody> = {}): WildlifeSightingCreateBody {
  return {
    // 校园内的 WGS84 点（图书馆后草坪附近）
    latitude: 31.1795,
    longitude: 121.591,
    observedAt: '2026-10-16T06:00:00.000Z',
    speciesId: 'sp-cat',
    individualId: null,
    mediaIds: [],
    zoneId: null,
    healthConcern: false,
    isAnonymous: false,
    autoSpeciesId: null,
    autoConfidence: null,
    classifiedBy: 'manual',
    ethicsAcknowledged: true,
    ...overrides,
  }
}

describe('wildlife · mock 仓储 · 读取与分页', () => {
  it('返回确定性种子数据（物种 / 区域 / 热点 / 轨迹 / 个体）', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })

    expect((await repo.listSpecies()).ok && (await repo.listSpecies())).toBeTruthy()
    const species = await repo.listSpecies()
    const zones = await repo.listZones()
    const tracks = await repo.listTracks()
    const individuals = await repo.listIndividuals()

    expect(species.ok && species.value.length).toBe(7)
    expect(zones.ok && zones.value.length).toBe(5)
    expect(tracks.ok && tracks.value.items.length).toBe(3)
    expect(individuals.ok && individuals.value.length).toBe(4)
  })

  it('观测列表**只**返回 PUBLISHED（待审核的不进公开列表）', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    const page = await repo.listSightings({ limit: 100 })

    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(page.value.items.every((item) => item.status === 'PUBLISHED')).toBe(true)
    // 种子里有一条 PENDING（ws-1008）
    expect(page.value.items.some((item) => item.id === 'ws-1008')).toBe(false)
    expect(page.value.items).toHaveLength(MOCK_WILDLIFE_SIGHTINGS.filter((s) => s.status === 'PUBLISHED').length)
  })

  it('E10：computedAt 距今 <24h 的热点不出现在列表里', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    const page = await repo.listSpots({ limit: 100 })

    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(page.value.items.some((item) => item.id === 'wsp-4')).toBe(false)
    for (const spot of page.value.items) {
      expect(NOW.getTime() - new Date(spot.computedAt).getTime()).toBeGreaterThanOrEqual(24 * 3_600_000)
    }
  })

  it('游标分页：limit=1 遍历无重复无跳过（契约 §6.1）', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    const seen: string[] = []
    let cursor: string | null = null

    for (let i = 0; i < 20; i += 1) {
      const page = await repo.listSightings({ limit: 1, cursor })
      if (!page.ok) throw new Error('unexpected')
      const first = page.value.items[0]
      if (first === undefined) break
      seen.push(first.id)
      cursor = page.value.nextCursor
      if (cursor === null) break
    }

    expect(seen.length).toBeGreaterThan(3)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('物种筛选透传（观测 / 热点）', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    const page = await repo.listSightings({ speciesId: 'sp-cat', limit: 100 })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(page.value.items.length).toBeGreaterThan(0)
    expect(page.value.items.every((item) => item.speciesId === 'sp-cat')).toBe(true)
  })

  it('zoneDetail 命中与未命中', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    const found = await repo.zoneDetail('wz-lake')
    expect(found.ok).toBe(true)
    if (found.ok) {
      expect(found.value.feedingPolicy).toBe('forbidden')
      expect(found.value.noticeText).toContain('黑天鹅')
    }
    const missing = await repo.zoneDetail('nope')
    expect(missing.ok).toBe(false)
  })

  it('trackDetail 命中与未命中', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    const found = await repo.trackDetail('wt-swan-1')
    expect(found.ok && found.value.isInferred).toBe(true)
    if (found.ok) expect(found.value.disclaimer).toContain('并非实测运动路径')
    expect((await repo.trackDetail('nope')).ok).toBe(false)
  })
})

describe('wildlife · mock 仓储 · 隐私流水线真的在跑', () => {
  it('敏感区：写入时**不存坐标**，只存 zoneId，且 fuzzLevel=zone-only', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    // 三号宿舍楼（敏感区）中心点
    const sensitive = MOCK_WILDLIFE_ZONES.find((zone) => zone.isSensitive)
    expect(sensitive).toBeDefined()

    const created = await repo.createSighting(
      body({
        latitude: sensitive?.centerLat ?? 0,
        longitude: sensitive?.centerLng ?? 0,
        zoneId: sensitive?.id ?? null,
      }),
    )

    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.zoneId).toBe(sensitive?.id)
    expect(created.value.fuzzedGeo).toBeUndefined()
    expect(created.value.fuzzLevel).toBe('zone-only')
    expect(created.value.status).toBe('PENDING')
  })

  it('普通区域：坐标被**网格吸附**（不落原始精确点）', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    const created = await repo.createSighting(
      body({ latitude: 31.17953, longitude: 121.59107, zoneId: 'wz-lib-lawn' }),
    )

    expect(created.ok).toBe(true)
    if (!created.ok) return

    const fuzzed = created.value.fuzzedGeo
    expect(fuzzed).toBeDefined()
    expect(created.value.fuzzLevel).toBe('grid')

    const expected = snapToGrid({ lat: 31.17953, lng: 121.59107 }, 50)
    expect(fuzzed?.lat).toBeCloseTo(expected.lat, 12)
    expect(fuzzed?.lng).toBeCloseTo(expected.lng, 12)

    // 吸附后仍在校园内，且偏移不超过一个格子（~71 米对角线）
    const drift = distanceMeters({ lat: 31.17953, lng: 121.59107 }, fuzzed as { lat: number; lng: number })
    expect(drift).toBeLessThan(80)
  })

  it('未指定 zoneId 时按坐标自动归属区域', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    const created = await repo.createSighting(
      body({ latitude: 31.181, longitude: 121.5935, zoneId: null }),
    )
    expect(created.ok).toBe(true)
    if (created.ok) expect(created.value.zoneId).toBe('wz-lake')
  })

  it('新上报一律 PENDING（客户端无法直接公开）', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    const created = await repo.createSighting(body())
    expect(created.ok && created.value.status).toBe('PENDING')
  })

  it('物种来源：自动识别 / 用户纠正可区分', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    const auto = await repo.createSighting(
      body({ speciesId: 'sp-cat', autoSpeciesId: 'sp-cat', classifiedBy: 'vision_api' }),
    )
    expect(auto.ok && auto.value.speciesSource).toBe('auto')

    const corrected = await repo.createSighting(
      body({ speciesId: 'sp-black-swan', autoSpeciesId: 'sp-cat', classifiedBy: 'vision_api' }),
    )
    expect(corrected.ok && corrected.value.speciesSource).toBe('corrected')
  })
})

describe('wildlife · mock 仓储 · 上传与分类降级', () => {
  it('uploadMedia 返回形状合法的 mediaId 与**假** thumbUrl，并声明 EXIF 已剥离', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    const uploaded = await repo.uploadMedia({
      tempFilePath: 'wxfile://tmp/a.jpg',
      widthPx: 1200,
      heightPx: 900,
      byteSize: 200_000,
      mimeType: 'image/jpeg',
      clientPhotoId: 'cp-1',
    })

    expect(uploaded.ok).toBe(true)
    if (!uploaded.ok) return
    expect(uploaded.value.mediaId).toMatch(/^wm-mock-/)
    expect(uploaded.value.thumbUrl).toContain('cdn.kedaya.example')
    expect(uploaded.value.clientPhotoId).toBe('cp-1')
    expect(uploaded.value.exifStripped).toBe(true)
  })

  it('默认分类模式为 manual → 返回空建议 + degraded（无 API key 时的降级路径）', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    expect(repo.classifierMode()).toBe('manual')

    const result = await repo.classify('wm-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.degraded).toBe(true)
    expect(result.value.suggestions).toHaveLength(0)
  })

  it('切到 server 模式后有建议（用于演示非降级分支）', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    repo.setClassifierMode('server')

    const result = await repo.classify('wm-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.degraded).toBe(false)
    expect(result.value.suggestions.length).toBeGreaterThan(0)
    expect(result.value.suggestions[0]?.confidence).toBeGreaterThan(0.6)
  })

  it('个体命名：同物种内重名返回 CONFLICT（`@@unique([speciesId, name])`）', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    const duplicated = await repo.createIndividual({ name: '大橘', speciesId: 'sp-cat' })
    expect(duplicated.ok).toBe(false)
    if (!duplicated.ok) {
      expect(duplicated.error.code).toBe('CONFLICT')
      expect(duplicated.error.details).toEqual({ reason: 'INDIVIDUAL_NAME_TAKEN' })
    }

    const created = await repo.createIndividual({ name: '新来的猫', speciesId: 'sp-cat' })
    expect(created.ok).toBe(true)
    if (created.ok) {
      // 防止恶搞命名 → 走 PENDING 审核队列
      expect(created.value.status).toBe('PENDING')
    }
  })
})

describe('wildlife · mock 仓储 · 三态控制面', () => {
  it('failNextRequests(1) 只让下一次请求失败', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    repo.failNextRequests(1)

    const failed = await repo.listZones()
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    expect((await repo.listZones()).ok).toBe(true)
  })

  it('clearAll() → 空态；reset() 恢复种子', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 0 })
    repo.clearAll()

    const empty = await repo.listSightings({ limit: 100 })
    expect(empty.ok && empty.value.items).toHaveLength(0)

    repo.reset()
    const restored = await repo.listSightings({ limit: 100 })
    expect(restored.ok && restored.value.items.length).toBeGreaterThan(0)
  })

  it('setLatency 不改变结果，只影响等待时间', async () => {
    const repo = createMockWildlifeRepository({ latencyMs: 1 })
    const started = Date.now()
    repo.setLatency(0)
    await repo.listSpecies()
    expect(Date.now() - started).toBeLessThan(500)
  })
})
