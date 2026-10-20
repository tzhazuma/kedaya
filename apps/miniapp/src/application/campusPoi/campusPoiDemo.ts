import type { CampusPoiSupplement, PoiTimeSlot } from '@kedaya/contracts'

/**
 * 校园 POI · **演示数据**（5 条点位 + 各自的下一站）。
 *
 * ## ⚠️ 这不是真实采集
 *
 * - 名字一律以「【演示】」开头，界面上另有横幅说明；用户不会把它当成真实站点。
 * - 坐标只是**落在 `CAMPUS_POI_BOUNDS`（WGS84）范围内的随手点**，不对应任何
 *   真实的快递站 / 车库入口 —— 详见 `packages/contracts/src/campus-poi.ts` 文件头。
 * - `photoUrls` 恒为空、`photoCredit` 为 `null`：本仓库**不内置**任何照片，
 *   演示数据**不带任何照片**；授权照片在 `campusPoiPhotos.ts` 里单独维护。
 * - `source` 是 `unknown`（「还没核实」的契约语义），不冒充 OSM / 校方数据。
 *
 * ## 为什么下一站时间相对 `now` 生成
 *
 * 演示数据写进 storage 后会被反复读取。如果写成固定日期，过几天「下一站」
 * 就全是过去时，看起来像功能坏了。这里用**读取/播种时刻 + 偏移**生成
 * `startsAt/endsAt`，保证 `nextSlotAt()` 每次都能返回一条未来安排。
 */

/** 演示 POI 的构造结果（仓储只负责落盘，不关心这些字段怎么来的） */
export interface CampusPoiDemoData {
  readonly pois: readonly CampusPoiSupplement[]
  readonly slots: readonly PoiTimeSlot[]
}

const MINUTE_MS = 60 * 1000

function isoAfter(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * MINUTE_MS).toISOString()
}

/**
 * 生成 5 条演示 POI。坐标都在 `CAMPUS_POI_BOUNDS` 内（WGS84），
 * 但**没有任何一条**声称对应真实建筑/站点。
 */
export function buildCampusPoiDemo(now: Date = new Date()): CampusPoiDemoData {
  const pois: readonly CampusPoiSupplement[] = [
    {
      id: 'poi-express-station-demo',
      category: 'express-station',
      name: '【演示】快递驿站',
      lat: 31.1764,
      lng: 121.5898,
      floor: 0,
      description: '演示点位，不对应真实快递站；正式数据只能由获授权的录入方提供。',
      openingHours: '09:00-20:00',
      photoUrls: [],
      photoCredit: null,
      verifiedAt: null,
      source: 'unknown',
    },
    {
      id: 'poi-parking-garage-demo',
      category: 'parking-garage',
      name: '【演示】地下车库入口',
      lat: 31.1772,
      lng: 121.5916,
      floor: -1,
      description: '演示点位，不对应真实车库入口；负楼层只允许车库分类。',
      openingHours: '24 小时',
      photoUrls: [],
      photoCredit: null,
      verifiedAt: null,
      source: 'unknown',
    },
    {
      id: 'poi-canteen-menu-demo',
      category: 'canteen-menu',
      name: '【演示】食堂菜单牌',
      lat: 31.1803,
      lng: 121.593,
      floor: 1,
      description: '演示点位；菜单以我们自己的菜品库为准，不依赖任何外站菜单照片。',
      openingHours: '10:30-19:30',
      photoUrls: [],
      photoCredit: null,
      verifiedAt: null,
      source: 'unknown',
    },
    {
      id: 'poi-event-venue-demo',
      category: 'event-venue',
      name: '【演示】活动场地',
      lat: 31.1798,
      lng: 121.5921,
      floor: 2,
      description: '演示点位；活动安排挂在地点上，用来展示「下一站」卡片。',
      openingHours: '按活动预约',
      photoUrls: [],
      photoCredit: null,
      verifiedAt: null,
      source: 'unknown',
    },
    {
      id: 'poi-study-space-demo',
      category: 'study-space',
      name: '【演示】自习空间',
      lat: 31.1774,
      lng: 121.5923,
      floor: 3,
      description: '演示点位；开放时间仅用于展示格式，不是真实场馆公告。',
      openingHours: '08:00-22:00',
      photoUrls: [],
      photoCredit: null,
      verifiedAt: null,
      source: 'unknown',
    },
  ]

  const slots: readonly PoiTimeSlot[] = [
    {
      poiId: 'poi-express-station-demo',
      startsAt: isoAfter(now, 20),
      endsAt: isoAfter(now, 50),
      kind: 'personal',
      title: '取一个演示包裹',
      sourceRef: null,
    },
    {
      poiId: 'poi-parking-garage-demo',
      startsAt: isoAfter(now, 90),
      endsAt: isoAfter(now, 150),
      kind: 'course',
      title: '停车后步行去上课',
      sourceRef: null,
    },
    {
      poiId: 'poi-canteen-menu-demo',
      startsAt: isoAfter(now, 180),
      endsAt: isoAfter(now, 240),
      kind: 'event',
      title: '食堂试吃（演示）',
      sourceRef: null,
    },
    {
      poiId: 'poi-event-venue-demo',
      startsAt: isoAfter(now, 300),
      endsAt: isoAfter(now, 420),
      kind: 'event',
      title: '社团分享会（演示）',
      sourceRef: null,
    },
    {
      poiId: 'poi-study-space-demo',
      startsAt: isoAfter(now, 24 * 60),
      endsAt: isoAfter(now, 24 * 60 + 120),
      kind: 'personal',
      title: '晚自习（演示）',
      sourceRef: null,
    },
  ]

  return { pois, slots }
}

/** 名字带「【演示】」前缀的一律按演示数据处理（界面据此显示横幅）。 */
export function isDemoPoi(poi: CampusPoiSupplement): boolean {
  return poi.name.startsWith('【演示】') || poi.id.endsWith('-demo')
}
