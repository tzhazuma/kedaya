import { describe, expect, it } from 'vitest'
import { distanceMeters, gcj02ToWgs84, wgs84ToGcj02 } from '@kedaya/shared'

import {
  CAMPUS_BBOX,
  EMPTY_SIGHTING_DRAFT,
  FEEDING_POLICY_TONES,
  WILDLIFE_AGGREGATION_NOTICE,
  WILDLIFE_ETHICS_ACK_LABEL,
  WILDLIFE_ETHICS_RULES,
  WILDLIFE_MAX_PHOTOS,
  WILDLIFE_NOTE_MAX_LENGTH,
  WILDLIFE_NO_DISTURB_NOTICE,
  WILDLIFE_PRIVACY_NOTICE,
  WILDLIFE_TRACK_DISCLAIMER_FALLBACK,
  WILDLIFE_TRACK_INFERRED_LABEL,
  buildClassificationView,
  confidenceLabel,
  displayReporterName,
  effectiveFeedingPolicy,
  feedingPolicyNotice,
  filterBySpecies,
  findSpecies,
  isInCampus,
  isObservedAtInRange,
  isSpotAggregationDelayed,
  resolveSpeciesSource,
  sightingToMapMarker,
  spotToMapMarker,
  summarizeSighting,
  toApiPoint,
  toCampusMapPoint,
  toCreateSightingBody,
  toMapPoint,
  toMapPoints,
  trackLengthMeters,
  trackToMapPoints,
  validateSightingDraft,
  wasCorrected,
  zoneMatchesSpecies,
  zoneToMapCircle,
} from '../wildlife'
import type { SightingDraft, WildlifeSighting, WildlifeSpot, WildlifeSpecies, WildlifeTrack, WildlifeZone } from '../wildlife'

/**
 * `wildlife` 领域模型单测。
 *
 * ⚠️ **本文件的第一组测试是整个模块最重要的一组**（规格 §3.5 / §11.1）：
 * 坐标系混用会导致约 470 米偏移（足以跨过一栋楼），而且看起来像「数据错了」。
 * 因此这里不仅断言「转换函数被调用」，还断言：
 * - 渲染路径产出的是 **GCJ-02**（与 `wgs84ToGcj02` 逐位一致）；
 * - 上传路径产出的是 **WGS84**（与 `gcj02ToWgs84` 逐位一致，且**不等于**输入）；
 * - 偏移量级在 200–800 米之间 —— 这条能抓住「转换被写成恒等函数」。
 */

const CAMPUS_POINT = { lat: 31.1795, lng: 121.591 }

function species(id: string, overrides: Partial<WildlifeSpecies> = {}): WildlifeSpecies {
  return {
    id,
    scientificName: `S ${id}`,
    commonNameZh: `物种 ${id}`,
    taxonRank: 'species',
    parentId: null,
    isProtected: false,
    isNestingSensitive: false,
    nestingMonths: [],
    defaultFeedingPolicy: 'discouraged',
    ...overrides,
  }
}

function zone(id: string, overrides: Partial<WildlifeZone> = {}): WildlifeZone {
  return {
    id,
    name: `区域 ${id}`,
    speciesIds: ['sp-1'],
    centerLat: 31.1795,
    centerLng: 121.591,
    radiusM: 80,
    feedingPolicy: 'discouraged',
    fuzzRadiusM: 50,
    isSensitive: false,
    sortOrder: 0,
    ...overrides,
  }
}

function draft(overrides: Partial<SightingDraft> = {}): SightingDraft {
  return {
    ...EMPTY_SIGHTING_DRAFT,
    observedAt: '2026-10-16T11:00:00.000Z',
    point: CAMPUS_POINT,
    ...overrides,
  }
}

const NOW = new Date('2026-10-16T12:00:00.000Z')

/* ================================================================== *
 * 1. 坐标系（最高优先级）
 * ================================================================== */

describe('wildlife · 坐标系（规格 §3 / §11.1）', () => {
  it('渲染路径：toMapPoint 产出 GCJ-02，与 wgs84ToGcj02 逐位一致', () => {
    const rendered = toMapPoint(CAMPUS_POINT)
    const expected = wgs84ToGcj02(CAMPUS_POINT.lat, CAMPUS_POINT.lng)

    expect(rendered.lat).toBe(expected.lat)
    expect(rendered.lng).toBe(expected.lng)
    // 必须**不是**恒等 —— 否则就是把 WGS84 直接丢给了 <map>
    expect(rendered.lat).not.toBe(CAMPUS_POINT.lat)
    expect(rendered.lng).not.toBe(CAMPUS_POINT.lng)
  })

  it('渲染路径：toCampusMapPoint 一次给出 GCJ-02 + 契约点形状', () => {
    const campus = toCampusMapPoint(CAMPUS_POINT)
    const rendered = toMapPoint(CAMPUS_POINT)

    expect(campus).toEqual({ latitude: rendered.lat, longitude: rendered.lng })
    // 形状必须是 `latitude` / `longitude`（`KdyCampusMap` 与 campusPixel 的口径）——
    // 少了这一层，页面就会退化成手写 `{ latitude: p.lat, ... }`，然后忘掉转换
    expect(Object.keys(campus).sort()).toEqual(['latitude', 'longitude'])
    expect(campus.latitude).not.toBe(CAMPUS_POINT.lat)
  })

  it('渲染路径：上海范围内偏移量级必须在 200–800 米（抓住「恒等函数」）', () => {
    const offset = distanceMeters(CAMPUS_POINT, toMapPoint(CAMPUS_POINT))
    expect(offset).toBeGreaterThan(200)
    expect(offset).toBeLessThan(800)
    // 实测约 470 米 —— 足以跨过一整栋楼，这就是本模块最大的坑
    expect(offset).toBeGreaterThan(400)
  })

  it('上传路径：地图点选（GCJ-02）必须转回 WGS84，且与 gcj02ToWgs84 一致', () => {
    // 模拟用户在地图上点选得到的 GCJ-02 坐标
    const picked = wgs84ToGcj02(CAMPUS_POINT.lat, CAMPUS_POINT.lng)
    const converted = toApiPoint({ lat: picked.lat, lng: picked.lng }, 'gcj02')
    const expected = gcj02ToWgs84(picked.lat, picked.lng)

    expect(converted.lat).toBe(expected.lat)
    expect(converted.lng).toBe(expected.lng)
    // 必须**不是**原样透传（否则上传的就是 GCJ-02，永久污染数据）
    expect(converted.lat).not.toBe(picked.lat)
    // 转换后应当回到校园内
    expect(isInCampus(converted)).toBe(true)
  })

  it('上传路径：GPS（WGS84）原样透传，绝不二次偏移', () => {
    const converted = toApiPoint(CAMPUS_POINT, 'wgs84')
    expect(converted).toEqual(CAMPUS_POINT)
  })

  it('往返自洽：WGS84 → 渲染 → 点选 → 上传 回到原点（< 1e-6 度，约 0.1 米）', () => {
    const rendered = toMapPoint(CAMPUS_POINT)
    const uploaded = toApiPoint(rendered, 'gcj02')

    expect(Math.abs(uploaded.lat - CAMPUS_POINT.lat)).toBeLessThan(1e-6)
    expect(Math.abs(uploaded.lng - CAMPUS_POINT.lng)).toBeLessThan(1e-6)
  })

  it('toCreateSightingBody 是上传前转换的唯一出口：GCJ-02 草稿产出 WGS84 body', () => {
    const picked = wgs84ToGcj02(CAMPUS_POINT.lat, CAMPUS_POINT.lng)
    const body = toCreateSightingBody(
      draft({ point: { lat: picked.lat, lng: picked.lng }, coordinateSystem: 'gcj02', speciesId: 'sp-1' }),
    )

    expect(body.latitude).toBeCloseTo(CAMPUS_POINT.lat, 9)
    expect(body.longitude).toBeCloseTo(CAMPUS_POINT.lng, 9)
    // 传出去的绝不可能还是 GCJ-02
    expect(body.latitude).not.toBe(picked.lat)
  })

  it('toCreateSightingBody：WGS84 草稿（GPS 定位）原样上传', () => {
    const body = toCreateSightingBody(draft({ coordinateSystem: 'wgs84', speciesId: 'sp-1' }))
    expect(body.latitude).toBe(CAMPUS_POINT.lat)
    expect(body.longitude).toBe(CAMPUS_POINT.lng)
  })

  it('isInCampus 拒绝校园外坐标，且能拒绝 lat/lng 互换（规格 §11.1 T6）', () => {
    expect(isInCampus(CAMPUS_POINT)).toBe(true)
    // lat/lng 互换 → 跑到地球另一处
    expect(isInCampus({ lat: CAMPUS_POINT.lng, lng: CAMPUS_POINT.lat })).toBe(false)
    expect(isInCampus({ lat: CAMPUS_BBOX.maxLat + 0.5, lng: CAMPUS_BBOX.minLng })).toBe(false)
    expect(isInCampus({ lat: 35.68, lng: 139.76 })).toBe(false)
  })

  it('toMapPoints 批量转换与逐点转换一致', () => {
    const points = [CAMPUS_POINT, { lat: 31.181, lng: 121.5935 }]
    expect(toMapPoints(points)).toEqual(points.map(toMapPoint))
  })
})

/* ================================================================== *
 * 2. 地图叠加层派生（全部 GCJ-02）
 * ================================================================== */

describe('wildlife · 地图叠加层派生', () => {
  it('zoneToMapCircle：圆心转 GCJ-02，半径（米）不变', () => {
    const circle = zoneToMapCircle(zone('wz-1'), { stroke: '#000000', fill: '#111111' })
    const expected = toMapPoint({ lat: 31.1795, lng: 121.591 })

    expect(circle.latitude).toBe(expected.lat)
    expect(circle.longitude).toBe(expected.lng)
    expect(circle.radius).toBe(80)
  })

  it('trackToMapPoints：轨迹每个点都转成 GCJ-02', () => {
    const track: WildlifeTrack = {
      id: 'wt-1',
      speciesId: 'sp-1',
      individualId: null,
      isInferred: true,
      points: [
        { lat: 31.1795, lng: 121.591, observedAt: '2026-10-10T00:00:00.000Z' },
        { lat: 31.1805, lng: 121.592, observedAt: '2026-10-11T00:00:00.000Z' },
      ],
      pointCount: 2,
      startedAt: '2026-10-10T00:00:00.000Z',
      endedAt: '2026-10-11T00:00:00.000Z',
      method: 'dbscan-chain',
      sightingCount: 9,
      totalDistanceM: 130,
      confidence: 0.5,
      algorithmVersion: 'dbscan-v1',
      computedAt: '2026-10-14T00:00:00.000Z',
    }

    const rendered = trackToMapPoints(track)
    expect(rendered).toHaveLength(2)
    const first = rendered[0]
    expect(first?.latitude).toBe(toMapPoint(track.points[0] as { lat: number; lng: number }).lat)
    expect(trackLengthMeters(track)).toBeGreaterThan(100)
  })

  it('spotToMapMarker / sightingToMapMarker：WGS84 → GCJ-02', () => {
    const spot: WildlifeSpot = {
      id: 'wsp-1',
      speciesId: 'sp-1',
      zoneId: 'wz-1',
      fuzzedGeo: CAMPUS_POINT,
      sightingCount: 10,
      distinctReporters: 4,
      firstSeenAt: '2026-09-01T00:00:00.000Z',
      lastSeenAt: '2026-10-14T00:00:00.000Z',
      computedAt: '2026-10-14T00:00:00.000Z',
      confidence: 0.7,
    }
    const marker = spotToMapMarker(spot, '猫')
    expect(marker.latitude).toBe(toMapPoint(CAMPUS_POINT).lat)
    expect(marker.kind).toBe('spot')

    const sighting: WildlifeSighting = {
      id: 'ws-1',
      speciesId: 'sp-1',
      speciesSource: 'manual',
      observedAt: '2026-10-16T06:00:00.000Z',
      fuzzedGeo: CAMPUS_POINT,
      zoneId: 'wz-1',
      fuzzLevel: 'grid',
      mediaIds: [],
      status: 'PUBLISHED',
      isInferred: false,
      healthConcern: false,
      isAnonymous: false,
      createdAt: '2026-10-16T07:00:00.000Z',
    }
    const sightingMarker = sightingToMapMarker(sighting, '猫', NOW)
    expect(sightingMarker?.latitude).toBe(toMapPoint(CAMPUS_POINT).lat)
    expect(sightingMarker?.kind).toBe('sighting')
  })

  it('敏感区（zone-only，无坐标）的观测不产出 marker（规格 §9.3 ①）', () => {
    const sensitive: WildlifeSighting = {
      id: 'ws-sensitive',
      speciesId: 'sp-1',
      speciesSource: 'manual',
      observedAt: '2026-10-16T06:00:00.000Z',
      // 敏感区**没有** fuzzedGeo
      zoneId: 'wz-dorm',
      fuzzLevel: 'zone-only',
      mediaIds: [],
      status: 'PUBLISHED',
      isInferred: false,
      healthConcern: false,
      isAnonymous: true,
      createdAt: '2026-10-16T07:00:00.000Z',
    }
    expect(sightingToMapMarker(sensitive, '猫', NOW)).toBeNull()
  })
})

/* ================================================================== *
 * 3. 伦理与隐私文案（硬要求）
 * ================================================================== */

describe('wildlife · 伦理与隐私提示（规格 §8 / §9）', () => {
  it('伦理清单非空、条目数合理，且勾选文案存在', () => {
    expect(WILDLIFE_ETHICS_RULES.length).toBeGreaterThanOrEqual(5)
    for (const rule of WILDLIFE_ETHICS_RULES) {
      expect(rule.length).toBeGreaterThan(0)
    }
    expect(WILDLIFE_ETHICS_ACK_LABEL).toContain('我已阅读')
  })

  it('不打扰提示与位置模糊化说明都必须存在（不是可选项）', () => {
    expect(WILDLIFE_NO_DISTURB_NOTICE).toContain('不要惊扰')
    // 必须**明确告诉用户**看到的是模糊后的位置，否则是误导性的隐私承诺
    expect(WILDLIFE_PRIVACY_NOTICE).toContain('模糊')
    expect(WILDLIFE_AGGREGATION_NOTICE).toContain('24 小时')
  })

  it('轨迹文案必须写「推断」且不是实测路径（规格 §6.1 / T18）', () => {
    expect(WILDLIFE_TRACK_INFERRED_LABEL).toBe('推断轨迹')
    expect(WILDLIFE_TRACK_DISCLAIMER_FALLBACK).toContain('不是')
  })

  it('投喂政策：区域与物种取更严格者，且三种取值都有徽章色调', () => {
    expect(effectiveFeedingPolicy('allowed', 'forbidden')).toBe('forbidden')
    expect(effectiveFeedingPolicy('forbidden', 'allowed')).toBe('forbidden')
    expect(effectiveFeedingPolicy('discouraged', 'discouraged')).toBe('discouraged')
    expect(effectiveFeedingPolicy(undefined, undefined)).toBe('discouraged')
    expect(FEEDING_POLICY_TONES.forbidden).toBe('danger')
    expect(FEEDING_POLICY_TONES.allowed).toBe('success')
  })

  it('投喂规范告示按政策给出不同文案，且 forbidden 明确「禁止」', () => {
    expect(feedingPolicyNotice('forbidden', '黑天鹅')).toContain('禁止投喂黑天鹅')
    expect(feedingPolicyNotice('discouraged', '猫')).toContain('不建议投喂猫')
    expect(feedingPolicyNotice('allowed')).toContain('允许适量投喂')
  })

  it('匿名上报时展示名必须是「匿名同学」，且不暴露 reporterId', () => {
    const anonymous: WildlifeSighting = {
      id: 'ws-1',
      speciesId: 'sp-1',
      speciesSource: 'manual',
      observedAt: '2026-10-16T06:00:00.000Z',
      fuzzedGeo: CAMPUS_POINT,
      zoneId: 'wz-1',
      fuzzLevel: 'grid',
      mediaIds: [],
      status: 'PUBLISHED',
      isInferred: false,
      healthConcern: false,
      isAnonymous: true,
      // 即使后端误带了昵称，也不得展示
      reporterName: '张三',
      createdAt: '2026-10-16T07:00:00.000Z',
    }
    expect(displayReporterName(anonymous)).toBe('匿名同学')
  })

  it('热点延迟 ≥24h 才允许展示（E10 防「围观召集工具」）', () => {
    const fresh: WildlifeSpot = {
      id: 'wsp-fresh',
      speciesId: 'sp-1',
      zoneId: null,
      fuzzedGeo: CAMPUS_POINT,
      sightingCount: 3,
      distinctReporters: 3,
      firstSeenAt: '2026-10-16T00:00:00.000Z',
      lastSeenAt: '2026-10-16T06:00:00.000Z',
      // 仅 12 小时前算出来的 → 不得展示
      computedAt: '2026-10-16T00:00:00.000Z',
      confidence: 0.4,
    }
    expect(isSpotAggregationDelayed(fresh, NOW)).toBe(false)
    expect(isSpotAggregationDelayed({ ...fresh, computedAt: '2026-10-14T00:00:00.000Z' }, NOW)).toBe(true)
  })
})

/* ================================================================== *
 * 4. 自动分类与降级（规格 §5）
 * ================================================================== */

describe('wildlife · 自动分类与降级', () => {
  const speciesList = [species('sp-cat'), species('sp-swan')]

  it('无分类能力（degraded）→ 纯手动，不预选、不报错', () => {
    const view = buildClassificationView({ suggestions: [], degraded: true }, speciesList)
    expect(view.mode).toBe('manual')
    expect(view.degraded).toBe(true)
    expect(view.suggestions).toHaveLength(0)
    expect(view.preselectedSpeciesId).toBeNull()
    expect(view.disclaimer).toContain('仅供参考')
  })

  it('请求失败（null）→ 同样降级为手动，不阻塞上报', () => {
    const view = buildClassificationView(null, speciesList)
    expect(view.mode).toBe('manual')
    expect(view.degraded).toBe(true)
    expect(view.preselectedSpeciesId).toBeNull()
  })

  it('置信度 ≥0.85 → 「很确定」并预选', () => {
    const view = buildClassificationView(
      { suggestions: [{ speciesId: 'sp-cat', confidence: 0.91, provider: 'onnx' }], degraded: false },
      speciesList,
    )
    expect(view.suggestions[0]?.confidenceLabel).toBe('很确定')
    expect(view.suggestions[0]?.preselected).toBe(true)
    expect(view.preselectedSpeciesId).toBe('sp-cat')
  })

  it('置信度 <0.60 → 展示候选但**不预选**（必须用户自己确认）', () => {
    const view = buildClassificationView(
      {
        suggestions: [
          { speciesId: 'sp-cat', confidence: 0.42, provider: 'onnx' },
          { speciesId: 'sp-swan', confidence: 0.31, provider: 'onnx' },
        ],
        degraded: false,
      },
      speciesList,
    )
    expect(view.mode).toBe('server')
    expect(view.preselectedSpeciesId).toBeNull()
    expect(view.suggestions.every((item) => !item.preselected)).toBe(true)
    expect(confidenceLabel(0.42)).toBe('无法确定')
  })

  it('物种来源：自动 / 纠正 / 手动可区分（规格 §5.5 纠正闭环）', () => {
    expect(resolveSpeciesSource('sp-cat', null)).toBe('manual')
    expect(resolveSpeciesSource('sp-cat', 'sp-cat')).toBe('auto')
    expect(resolveSpeciesSource('sp-swan', 'sp-cat')).toBe('corrected')
    expect(wasCorrected('sp-swan', 'sp-cat')).toBe(true)
    expect(wasCorrected('sp-cat', 'sp-cat')).toBe(false)
    expect(wasCorrected('sp-cat', null)).toBe(false)
  })
})

/* ================================================================== *
 * 5. 上报表单校验（纯函数）
 * ================================================================== */

describe('wildlife · 上报表单校验', () => {
  const speciesList = [species('sp-1')]

  it('完整草稿通过校验', () => {
    const errors = validateSightingDraft(
      draft({ speciesId: 'sp-1', ethicsAcknowledged: true }),
      speciesList,
      NOW,
    )
    expect(errors).toHaveLength(0)
  })

  it('缺物种 / 未勾选伦理 / 坐标越界 都会各自报错', () => {
    const missingSpecies = validateSightingDraft(
      draft({ speciesId: null, ethicsAcknowledged: true }),
      speciesList,
      NOW,
    )
    expect(missingSpecies.map((e) => e.reason)).toContain('SPECIES_REQUIRED')

    const noAck = validateSightingDraft(draft({ speciesId: 'sp-1' }), speciesList, NOW)
    expect(noAck.map((e) => e.reason)).toContain('ETHICS_NOT_ACKNOWLEDGED')

    const outOfCampus = validateSightingDraft(
      draft({ speciesId: 'sp-1', ethicsAcknowledged: true, point: { lat: 35.68, lng: 139.76 } }),
      speciesList,
      NOW,
    )
    expect(outOfCampus.map((e) => e.reason)).toContain('COORDINATE_OUT_OF_CAMPUS')
  })

  it('坐标校验**先归一化再判定**：GCJ-02 的校园内点不应被误报越界', () => {
    // 取一个校园内的 WGS84 点，转成 GCJ-02（数值上已偏离约 470 米）
    const picked = wgs84ToGcj02(31.1795, 121.591)
    const errors = validateSightingDraft(
      draft({
        speciesId: 'sp-1',
        ethicsAcknowledged: true,
        point: { lat: picked.lat, lng: picked.lng },
        coordinateSystem: 'gcj02',
      }),
      speciesList,
      NOW,
    )
    expect(errors.map((e) => e.reason)).not.toContain('COORDINATE_OUT_OF_CAMPUS')
  })

  it('发现时间窗口：超过 30 天或晚于当前时间 5 分钟以上都会被拒（契约 §11.10-A）', () => {
    expect(isObservedAtInRange('2026-10-16T11:00:00.000Z', NOW)).toBe(true)
    expect(isObservedAtInRange('2026-09-01T00:00:00.000Z', NOW)).toBe(false)
    expect(isObservedAtInRange('2026-10-16T12:10:00.000Z', NOW)).toBe(false)
    expect(isObservedAtInRange('不是时间', NOW)).toBe(false)

    const errors = validateSightingDraft(
      draft({ speciesId: 'sp-1', ethicsAcknowledged: true, observedAt: '2026-01-01T00:00:00.000Z' }),
      speciesList,
      NOW,
    )
    expect(errors.map((e) => e.reason)).toContain('OBSERVED_AT_OUT_OF_RANGE')
  })

  it('照片数量上限、备注长度、个体名字非法都会被拒', () => {
    const tooMany = validateSightingDraft(
      draft({
        speciesId: 'sp-1',
        ethicsAcknowledged: true,
        mediaIds: ['a', 'b', 'c', 'd'],
      }),
      speciesList,
      NOW,
    )
    expect(tooMany.map((e) => e.reason)).toContain('TOO_MANY_PHOTOS')
    expect(WILDLIFE_MAX_PHOTOS).toBe(3)

    const longNote = validateSightingDraft(
      draft({
        speciesId: 'sp-1',
        ethicsAcknowledged: true,
        note: 'x'.repeat(WILDLIFE_NOTE_MAX_LENGTH + 1),
      }),
      speciesList,
      NOW,
    )
    expect(longNote.map((e) => e.reason)).toContain('NOTE_TOO_LONG')

    const badName = validateSightingDraft(
      draft({ speciesId: 'sp-1', ethicsAcknowledged: true, newIndividualName: '13800138000' }),
      speciesList,
      NOW,
    )
    expect(badName.map((e) => e.reason)).toContain('INDIVIDUAL_NAME_INVALID')
  })

  it('未知物种被拒（UNKNOWN_SPECIES）', () => {
    const errors = validateSightingDraft(
      draft({ speciesId: 'sp-not-exist', ethicsAcknowledged: true }),
      speciesList,
      NOW,
    )
    expect(errors.map((e) => e.reason)).toContain('UNKNOWN_SPECIES')
  })
})

/* ================================================================== *
 * 6. 观测摘要与筛选
 * ================================================================== */

describe('wildlife · 观测摘要与筛选', () => {
  it('summarizeSighting 汇总物种 / 区域 / 投喂规范 / 模糊层级 / 上报人', () => {
    const sighting: WildlifeSighting = {
      id: 'ws-1',
      speciesId: 'sp-swan',
      speciesSource: 'auto',
      observedAt: '2026-10-16T06:00:00.000Z',
      fuzzedGeo: CAMPUS_POINT,
      zoneId: 'wz-lake',
      fuzzLevel: 'grid',
      mediaIds: ['wm-1'],
      note: '两只',
      status: 'PUBLISHED',
      isInferred: false,
      healthConcern: false,
      isAnonymous: false,
      reporterName: '李同学',
      createdAt: '2026-10-16T07:00:00.000Z',
    }
    const summary = summarizeSighting(
      sighting,
      [species('sp-swan', { commonNameZh: '黑天鹅', isProtected: true, defaultFeedingPolicy: 'forbidden' })],
      [zone('wz-lake', { name: '人工湖', feedingPolicy: 'allowed' })],
      NOW,
    )

    expect(summary.speciesName).toBe('黑天鹅')
    expect(summary.zoneName).toBe('人工湖')
    // 区域 allowed + 物种 forbidden → 取更严格的 forbidden
    expect(summary.feedingPolicy).toBe('forbidden')
    expect(summary.feedingPolicyTone).toBe('danger')
    expect(summary.hasCoordinates).toBe(true)
    expect(summary.isProtected).toBe(true)
    expect(summary.photoCount).toBe(1)
    expect(summary.speciesSourceLabel).toBe('自动识别')
  })

  it('敏感区观测的摘要标记为「无坐标」且给出模糊层级文案', () => {
    const sighting: WildlifeSighting = {
      id: 'ws-2',
      speciesId: 'sp-cat',
      speciesSource: 'manual',
      observedAt: '2026-10-16T06:00:00.000Z',
      zoneId: 'wz-dorm',
      fuzzLevel: 'zone-only',
      mediaIds: [],
      status: 'PUBLISHED',
      isInferred: false,
      healthConcern: false,
      isAnonymous: true,
      createdAt: '2026-10-16T07:00:00.000Z',
    }
    const summary = summarizeSighting(
      sighting,
      [species('sp-cat', { commonNameZh: '猫' })],
      [zone('wz-dorm', { name: '宿舍区', isSensitive: true })],
      NOW,
    )
    expect(summary.hasCoordinates).toBe(false)
    expect(summary.fuzzLabel).toContain('不公开坐标')
    expect(summary.reporterName).toBe('匿名同学')
  })

  it('按物种筛选：观测 / 热点 / 区域', () => {
    const sightings = [
      { speciesId: 'sp-1' },
      { speciesId: 'sp-2' },
      { speciesId: null },
    ]
    expect(filterBySpecies(sightings, null)).toHaveLength(3)
    expect(filterBySpecies(sightings, 'sp-1')).toHaveLength(1)
    expect(zoneMatchesSpecies(zone('wz-1', { speciesIds: ['sp-1'] }), 'sp-1')).toBe(true)
    expect(zoneMatchesSpecies(zone('wz-1', { speciesIds: ['sp-1'] }), 'sp-2')).toBe(false)
    expect(zoneMatchesSpecies(zone('wz-1', { speciesIds: [] }), null)).toBe(true)
  })

  it('findSpecies 对 null / 未知 id 返回 undefined（不抛错）', () => {
    expect(findSpecies([species('sp-1')], null)).toBeUndefined()
    expect(findSpecies([species('sp-1')], 'nope')).toBeUndefined()
    expect(findSpecies([species('sp-1')], 'sp-1')?.id).toBe('sp-1')
  })
})
