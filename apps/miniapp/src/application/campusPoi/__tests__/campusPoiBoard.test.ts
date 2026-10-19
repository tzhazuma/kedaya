import {
  isPoiWithinCampusBounds,
  nextSlotAt,
  poiToMapMarker,
  validatePoiSupplement,
  type CampusPoiSupplement,
  type PoiTimeSlot,
} from '@kedaya/contracts'
import { describe, expect, it } from 'vitest'

import {
  buildCampusPoiNextStops,
  buildCampusPoiRows,
  createCampusPoiBoardUseCase,
  formatPoiFloor,
  formatPoiSlotRelative,
  type CampusPoiStore,
} from '../campusPoiBoard'
import { buildCampusPoiDemo } from '../campusPoiDemo'

const NOW = new Date('2026-10-19T03:00:00.000Z')

describe('校园 POI · 演示数据', () => {
  it('5 条都带「【演示】」前缀、通过契约校验、坐标落在 WGS84 校园范围内', () => {
    const { pois } = buildCampusPoiDemo(NOW)

    expect(pois).toHaveLength(5)
    for (const poi of pois) {
      expect(poi.name.startsWith('【演示】'), poi.name).toBe(true)
      expect(poi.photoUrls, `${poi.name} 不得内置照片`).toEqual([])
      expect(poi.photoCredit, `${poi.name} 无照片时不应有署名`).toBeNull()
      expect(poi.source).toBe('unknown')
      expect(validatePoiSupplement(poi)).toEqual([])
      expect(isPoiWithinCampusBounds(poi.lat, poi.lng), `${poi.name} 坐标越界`).toBe(true)
    }
  })

  it('每个地点都有下一站，且顺序按开始时间递增', () => {
    const { pois, slots } = buildCampusPoiDemo(NOW)
    const stops = buildCampusPoiNextStops(pois, slots, NOW)

    expect(stops).toHaveLength(5)
    expect(stops.every((stop) => stop.hasSlot)).toBe(true)

    const starts = stops.map((stop) => Date.parse(stop.startsAt ?? ''))
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('分类标签与 tone 来自 poiToMapMarker（不写死色值）', () => {
    const { pois, slots } = buildCampusPoiDemo(NOW)
    const rows = buildCampusPoiRows(pois, slots, NOW)

    for (const row of rows) {
      const poi = pois.find((candidate) => candidate.id === row.id)
      expect(poi).toBeDefined()
      const marker = poiToMapMarker(poi as CampusPoiSupplement)
      expect(row.categoryLabel).toBe(marker.categoryLabel)
      expect(row.tone).toBe(marker.tone)
    }
  })

  it('按分类筛选只留下该分类；未知分类组合不会抛错', () => {
    const { pois, slots } = buildCampusPoiDemo(NOW)

    const parking = buildCampusPoiRows(pois, slots, NOW, 'parking-garage')
    expect(parking).toHaveLength(1)
    expect(parking[0]?.category).toBe('parking-garage')
    expect(buildCampusPoiRows(pois, slots, NOW, 'other')).toEqual([])
  })
})

describe('校园 POI · 展示格式', () => {
  it('负楼层显示 B1/B2，地面层与未知楼层有明确文案', () => {
    expect(formatPoiFloor(-1)).toBe('B1')
    expect(formatPoiFloor(-2)).toBe('B2')
    expect(formatPoiFloor(0)).toBe('地面层')
    expect(formatPoiFloor(3)).toBe('3 层')
    expect(formatPoiFloor(null)).toBe('楼层待核实')
    expect(formatPoiFloor(1.5)).toBe('楼层待核实')
  })

  it('进行中的安排显示「正在进行」，而不是「20 分钟前」', () => {
    const slot: PoiTimeSlot = {
      poiId: 'poi-express-station-demo',
      startsAt: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(),
      endsAt: new Date(NOW.getTime() + 10 * 60 * 1000).toISOString(),
      kind: 'personal',
      title: '进行中的演示安排',
      sourceRef: null,
    }

    expect(formatPoiSlotRelative(slot, NOW)).toBe('正在进行')
    expect(nextSlotAt(buildCampusPoiDemo(NOW).pois[0] as CampusPoiSupplement, [slot], NOW)).toBe(
      slot,
    )
  })
})

describe('校园 POI · 本机用例', () => {
  it('storage 为空时播种演示数据；已有点位时不重复写', () => {
    const writtenPois: CampusPoiSupplement[] = []
    const writtenSlots: PoiTimeSlot[] = []
    let pois: CampusPoiSupplement[] = []
    let slots: PoiTimeSlot[] = []

    const store: CampusPoiStore = {
      readPois: () => pois,
      readSlots: () => slots,
      writePois: (value) => {
        pois = [...value]
        writtenPois.push(...value)
      },
      writeSlots: (value) => {
        slots = [...value]
        writtenSlots.push(...value)
      },
    }

    const board = createCampusPoiBoardUseCase({ store, now: () => NOW })
    const first = board.hydrate()

    expect(first.status).toBe('ready')
    expect(first.demo).toBe(true)
    expect(first.pois).toHaveLength(5)
    expect(first.slots).toHaveLength(5)
    expect(writtenPois).toHaveLength(5)
    expect(writtenSlots).toHaveLength(5)

    const second = board.hydrate()
    expect(second.pois).toHaveLength(5)
    // 第二次 hydrate 不应再播种（否则每次进页面都会覆盖 storage）
    expect(writtenPois).toHaveLength(5)
    expect(writtenSlots).toHaveLength(5)
  })

  it('列表状态是外部 store：hydrate 后订阅者会被通知', () => {
    const demo = buildCampusPoiDemo(NOW)
    let pois: CampusPoiSupplement[] = [...demo.pois]
    let slots: PoiTimeSlot[] = [...demo.slots]

    const board = createCampusPoiBoardUseCase({
      store: {
        readPois: () => pois,
        readSlots: () => slots,
        writePois: (value) => {
          pois = [...value]
        },
        writeSlots: (value) => {
          slots = [...value]
        },
      },
      now: () => NOW,
    })

    let notified = 0
    const unsubscribe = board.subscribe(() => {
      notified += 1
    })

    expect(board.getSnapshot().status).toBe('idle')
    board.hydrate()
    expect(notified).toBe(1)
    expect(board.getSnapshot().status).toBe('ready')

    unsubscribe()
    board.hydrate()
    expect(notified).toBe(1)
  })
})
