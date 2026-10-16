import type {
  CampusBasemap,
  WildlifeIndividual,
  WildlifeSighting,
  WildlifeSpecies,
  WildlifeSpot,
  WildlifeTrack,
  WildlifeZone,
} from '../../domain/models/wildlife'
import { MOCK_NOW_ISO } from './fixtures'

/**
 * 野生动物 mock 种子数据 —— 保证「没有后端也能跑通」整个垂直切片（契约 §7 硬规则 4）。
 *
 * 设计约束：
 * - **确定性**：所有时间基于 `MOCK_NOW_ISO` 相对推算，测试可复现。
 * - **覆盖三态**：种子含「有坐标的观测」与「敏感区无坐标的观测」，
 *   于是「敏感区只给区域、不给坐标」这条隐私规则在 UI 上真的能看到。
 * - **覆盖投喂政策的三种取值**：`allowed` / `discouraged` / `forbidden`
 *   （黑天鹅所在的人工湖是 `forbidden`），伦理提示不是摆设。
 * - **照片是假 URL**：`https://cdn.kedaya.example/...`，不会真的发起请求。
 *
 * ⚠️ 物种清单是**基于「上科大校园有猫、鸟、黑天鹅」这一前提的合理推测**，
 * **未做实地物种调查**（规格 §2.5 / 未决问题 U2）。真实清单必须由校园动物社团确认。
 *
 * ⚠️ 所有坐标一律 **WGS84**（规格 §3.2）。GCJ-02 只在渲染前由 `toMapPoint` 转换。
 */

function shiftMinutes(baseIso: string, minutes: number): string {
  return new Date(new Date(baseIso).getTime() + minutes * 60_000).toISOString()
}

function shiftHours(baseIso: string, hours: number): string {
  return shiftMinutes(baseIso, hours * 60)
}

function shiftDays(baseIso: string, days: number): string {
  return shiftHours(baseIso, days * 24)
}

/* ------------------------------------------------------------------ *
 * 底图（Phase 1 自绘示意图；学校官方图**未获授权**，规格 §1.3 U1）
 * ------------------------------------------------------------------ */

export const MOCK_WILDLIFE_BASEMAP: CampusBasemap = {
  version: 'mock-basemap-v1',
  // 假 URL —— mock 模式下不会真的加载图片
  imageUrl: 'https://cdn.kedaya.example/wildlife/basemap/campus-sketch-v1.png',
  widthPx: 1600,
  heightPx: 1200,
  // 6 参数仿射（WGS84 → 像素）。⚠️ 占位值，未做实测标定（U3）
  affine: [1.0, 0.0, 0.0, 0.0, -1.0, 0.0],
  // ⚠️ 占位值：真实标定要求 rmsePx < 5 且控制点 ≥6（规格 §1.4 / §11.1 T5）
  calibrationRmsePx: 4.2,
  controlPointCount: 8,
  attribution: '底图为可达鸭项目自绘示意图（非测绘精度）',
  license: 'original',
}

/* ------------------------------------------------------------------ *
 * 物种（规格 §2.5 的推测清单）
 * ------------------------------------------------------------------ */

export const MOCK_WILDLIFE_SPECIES: readonly WildlifeSpecies[] = [
  {
    id: 'sp-cat',
    scientificName: 'Felis catus',
    commonNameZh: '猫（家猫 / 流浪猫）',
    commonNameEn: 'Domestic cat',
    taxonRank: 'species',
    parentId: null,
    isProtected: false,
    isNestingSensitive: false,
    nestingMonths: [],
    defaultFeedingPolicy: 'discouraged',
  },
  {
    id: 'sp-black-swan',
    scientificName: 'Cygnus atratus',
    commonNameZh: '黑天鹅',
    commonNameEn: 'Black swan',
    taxonRank: 'species',
    parentId: null,
    // 外来引进、校方管理资产 —— 审核严格度更高（规格 §2.5）
    isProtected: true,
    isNestingSensitive: true,
    nestingMonths: [3, 4, 5, 6],
    defaultFeedingPolicy: 'forbidden',
  },
  {
    id: 'sp-mallard',
    scientificName: 'Anas platyrhynchos',
    commonNameZh: '绿头鸭',
    commonNameEn: 'Mallard',
    taxonRank: 'species',
    parentId: null,
    isProtected: false,
    isNestingSensitive: true,
    nestingMonths: [4, 5, 6],
    defaultFeedingPolicy: 'discouraged',
  },
  {
    id: 'sp-sparrow',
    scientificName: 'Passer montanus',
    commonNameZh: '麻雀',
    commonNameEn: 'Eurasian tree sparrow',
    taxonRank: 'species',
    parentId: null,
    isProtected: false,
    isNestingSensitive: false,
    nestingMonths: [],
    defaultFeedingPolicy: 'forbidden',
  },
  {
    id: 'sp-dove',
    scientificName: 'Spilopelia chinensis',
    commonNameZh: '珠颈斑鸠',
    commonNameEn: 'Spotted dove',
    taxonRank: 'species',
    parentId: null,
    isProtected: false,
    isNestingSensitive: false,
    nestingMonths: [],
    defaultFeedingPolicy: 'forbidden',
  },
  {
    id: 'sp-egret',
    scientificName: 'Egretta garzetta',
    commonNameZh: '白鹭',
    commonNameEn: 'Little egret',
    taxonRank: 'species',
    parentId: null,
    isProtected: true,
    isNestingSensitive: true,
    nestingMonths: [4, 5, 6],
    defaultFeedingPolicy: 'forbidden',
  },
  {
    id: 'sp-magpie',
    scientificName: 'Pica serica',
    commonNameZh: '喜鹊',
    commonNameEn: 'Oriental magpie',
    taxonRank: 'species',
    parentId: null,
    isProtected: false,
    isNestingSensitive: false,
    nestingMonths: [],
    defaultFeedingPolicy: 'forbidden',
  },
]

/* ------------------------------------------------------------------ *
 * 区域（人工定义 / 管理端维护）
 * ------------------------------------------------------------------ */

/** 黑天鹅专属告示 —— 与 domain 常量同源，mock 只是把它塞进区域数据里 */
const BLACK_SWAN_ZONE_NOTICE =
  '黑天鹅是校园的重要成员，也是校方管理的动物。请勿投喂人类食物，请勿追撵、捕捉或近距离惊扰。'

export const MOCK_WILDLIFE_ZONES: readonly WildlifeZone[] = [
  {
    id: 'wz-lib-lawn',
    name: '图书馆后草坪',
    speciesIds: ['sp-cat', 'sp-sparrow', 'sp-magpie'],
    centerLat: 31.1795,
    centerLng: 121.591,
    radiusM: 80,
    feedingPolicy: 'discouraged',
    noticeText: '这里有流浪猫活动，请不要留下人类食物残渣。',
    fuzzRadiusM: 50,
    isSensitive: false,
    sortOrder: 1,
  },
  {
    id: 'wz-lake',
    name: '人工湖（黑天鹅水域）',
    speciesIds: ['sp-black-swan', 'sp-mallard', 'sp-egret'],
    centerLat: 31.181,
    centerLng: 121.5935,
    radiusM: 120,
    feedingPolicy: 'forbidden',
    noticeText: BLACK_SWAN_ZONE_NOTICE,
    fuzzRadiusM: 50,
    isSensitive: false,
    sortOrder: 2,
  },
  {
    id: 'wz-canteen',
    name: '一食堂后门',
    speciesIds: ['sp-cat', 'sp-dove'],
    centerLat: 31.1772,
    centerLng: 121.5888,
    radiusM: 60,
    feedingPolicy: 'discouraged',
    noticeText: '饭点猫比较多，请勿用剩饭投喂。',
    fuzzRadiusM: 50,
    isSensitive: false,
    sortOrder: 3,
  },
  {
    id: 'wz-sports',
    name: '体育馆西侧步道',
    speciesIds: ['sp-magpie', 'sp-sparrow'],
    centerLat: 31.1832,
    centerLng: 121.5952,
    radiusM: 90,
    feedingPolicy: 'forbidden',
    noticeText: '步道两侧有喜鹊筑巢，请勿靠近巢区。',
    fuzzRadiusM: 50,
    isSensitive: false,
    sortOrder: 4,
  },
  {
    id: 'wz-dorm-3',
    name: '三号宿舍楼北侧（敏感区）',
    speciesIds: ['sp-cat'],
    centerLat: 31.1758,
    centerLng: 121.5862,
    radiusM: 50,
    feedingPolicy: 'forbidden',
    noticeText: '此处为宿舍区，公开信息**不含坐标**，只显示所属区域。',
    // 敏感区内部更粗（规格 §9.3 参数表）
    fuzzRadiusM: 200,
    isSensitive: true,
    sortOrder: 5,
  },
]

/* ------------------------------------------------------------------ *
 * 已命名个体（"手动给个名字"，规格 §5.6 (b)）
 * ------------------------------------------------------------------ */

export const MOCK_WILDLIFE_INDIVIDUALS: readonly WildlifeIndividual[] = [
  {
    id: 'wi-cat-orange',
    name: '大橘',
    speciesId: 'sp-cat',
    note: '橘白相间，右耳有个小缺口，常年在图书馆后草坪。',
    photoMediaId: 'wm-mock-0001',
    status: 'PUBLISHED',
  },
  {
    id: 'wi-cat-black',
    name: '煤球',
    speciesId: 'sp-cat',
    note: '全身黑，只有胸口一撮白毛。',
    status: 'PUBLISHED',
  },
  {
    id: 'wi-swan-e',
    name: '鹅鹅',
    speciesId: 'sp-black-swan',
    note: '人工湖西岸的常驻个体，颈环编号不可见。',
    photoMediaId: 'wm-mock-0002',
    status: 'PUBLISHED',
  },
  {
    id: 'wi-magpie-xixi',
    name: '喜喜',
    speciesId: 'sp-magpie',
    note: '体育馆西侧步道的喜鹊，尾羽偏短。',
    status: 'PENDING',
  },
]

/* ------------------------------------------------------------------ *
 * 观测记录
 * ------------------------------------------------------------------ */

export const MOCK_WILDLIFE_SIGHTINGS: readonly WildlifeSighting[] = [
  {
    id: 'ws-1001',
    speciesId: 'sp-black-swan',
    speciesSource: 'manual',
    observedAt: shiftHours(MOCK_NOW_ISO, -6),
    // 模糊后的公开坐标（WGS84）
    fuzzedGeo: { lat: 31.18105, lng: 121.59348 },
    zoneId: 'wz-lake',
    fuzzLevel: 'grid',
    mediaIds: ['wm-mock-0002'],
    note: '两只在湖心，一只在岸边整理羽毛。',
    status: 'PUBLISHED',
    isInferred: false,
    healthConcern: false,
    isAnonymous: false,
    reporterName: '李同学',
    createdAt: shiftHours(MOCK_NOW_ISO, -5),
  },
  {
    id: 'ws-1002',
    speciesId: 'sp-cat',
    speciesSource: 'corrected',
    observedAt: shiftHours(MOCK_NOW_ISO, -30),
    fuzzedGeo: { lat: 31.17952, lng: 121.59103 },
    zoneId: 'wz-lib-lawn',
    fuzzLevel: 'grid',
    mediaIds: ['wm-mock-0001'],
    note: '大橘今天在草坪晒太阳。',
    status: 'PUBLISHED',
    isInferred: false,
    healthConcern: false,
    isAnonymous: false,
    reporterName: '张同学',
    createdAt: shiftHours(MOCK_NOW_ISO, -29),
  },
  {
    id: 'ws-1003',
    speciesId: 'sp-cat',
    speciesSource: 'manual',
    observedAt: shiftHours(MOCK_NOW_ISO, -52),
    // ⚠️ 敏感区：**没有坐标**，只有 zoneId（规格 §9.3 ①）
    zoneId: 'wz-dorm-3',
    fuzzLevel: 'zone-only',
    mediaIds: [],
    note: '在宿舍楼下，具体位置不公开。',
    status: 'PUBLISHED',
    isInferred: false,
    healthConcern: false,
    isAnonymous: true,
    createdAt: shiftHours(MOCK_NOW_ISO, -51),
  },
  {
    id: 'ws-1004',
    speciesId: 'sp-magpie',
    speciesSource: 'auto',
    observedAt: shiftDays(MOCK_NOW_ISO, -2),
    fuzzedGeo: { lat: 31.18322, lng: 121.59518 },
    zoneId: 'wz-sports',
    fuzzLevel: 'grid',
    mediaIds: ['wm-mock-0003', 'wm-mock-0004'],
    status: 'PUBLISHED',
    isInferred: false,
    healthConcern: false,
    isAnonymous: false,
    reporterName: '王同学',
    createdAt: shiftDays(MOCK_NOW_ISO, -2),
  },
  {
    id: 'ws-1005',
    speciesId: 'sp-sparrow',
    speciesSource: 'manual',
    observedAt: shiftDays(MOCK_NOW_ISO, -3),
    fuzzedGeo: { lat: 31.17948, lng: 121.59092 },
    zoneId: 'wz-lib-lawn',
    fuzzLevel: 'grid',
    mediaIds: [],
    status: 'PUBLISHED',
    isInferred: false,
    healthConcern: false,
    isAnonymous: true,
    createdAt: shiftDays(MOCK_NOW_ISO, -3),
  },
  {
    id: 'ws-1006',
    speciesId: 'sp-dove',
    speciesSource: 'manual',
    observedAt: shiftDays(MOCK_NOW_ISO, -4),
    fuzzedGeo: { lat: 31.17725, lng: 121.58885 },
    zoneId: 'wz-canteen',
    fuzzLevel: 'grid',
    mediaIds: [],
    status: 'PUBLISHED',
    isInferred: false,
    healthConcern: false,
    isAnonymous: false,
    reporterName: '陈同学',
    createdAt: shiftDays(MOCK_NOW_ISO, -4),
  },
  {
    id: 'ws-1007',
    speciesId: 'sp-egret',
    speciesSource: 'manual',
    observedAt: shiftDays(MOCK_NOW_ISO, -5),
    fuzzedGeo: { lat: 31.18115, lng: 121.59362 },
    zoneId: 'wz-lake',
    fuzzLevel: 'coarsened',
    mediaIds: ['wm-mock-0005'],
    note: '白鹭在浅水区，疑似腿部有伤，已标记。',
    status: 'PUBLISHED',
    isInferred: false,
    // 疑似受伤 → 触发社团通知（规格 §8.4），**不等审核**
    healthConcern: true,
    isAnonymous: false,
    reporterName: '刘同学',
    createdAt: shiftDays(MOCK_NOW_ISO, -5),
  },
  {
    id: 'ws-1008',
    speciesId: 'sp-mallard',
    speciesSource: 'manual',
    observedAt: shiftHours(MOCK_NOW_ISO, -2),
    // 待审核的观测**不进公开列表**（列表只返回 PUBLISHED）
    fuzzedGeo: { lat: 31.18092, lng: 121.59331 },
    zoneId: 'wz-lake',
    fuzzLevel: 'grid',
    mediaIds: [],
    status: 'PENDING',
    isInferred: false,
    healthConcern: false,
    isAnonymous: false,
    reporterName: '赵同学',
    createdAt: shiftHours(MOCK_NOW_ISO, -1),
  },
]

/* ------------------------------------------------------------------ *
 * 聚合热点（派生只读，`computedAt` 至少比现在早 24h）
 * ------------------------------------------------------------------ */

export const MOCK_WILDLIFE_SPOTS: readonly WildlifeSpot[] = [
  {
    id: 'wsp-1',
    speciesId: 'sp-cat',
    zoneId: 'wz-lib-lawn',
    fuzzedGeo: { lat: 31.17952, lng: 121.59105 },
    sightingCount: 24,
    distinctReporters: 9,
    firstSeenAt: shiftDays(MOCK_NOW_ISO, -40),
    lastSeenAt: shiftDays(MOCK_NOW_ISO, -1),
    computedAt: shiftDays(MOCK_NOW_ISO, -2),
    confidence: 0.72,
  },
  {
    id: 'wsp-2',
    speciesId: 'sp-black-swan',
    zoneId: 'wz-lake',
    fuzzedGeo: { lat: 31.18102, lng: 121.59355 },
    sightingCount: 31,
    distinctReporters: 12,
    firstSeenAt: shiftDays(MOCK_NOW_ISO, -50),
    lastSeenAt: shiftDays(MOCK_NOW_ISO, -1),
    computedAt: shiftDays(MOCK_NOW_ISO, -2),
    confidence: 0.85,
  },
  {
    id: 'wsp-3',
    speciesId: 'sp-magpie',
    zoneId: 'wz-sports',
    fuzzedGeo: { lat: 31.18325, lng: 121.59522 },
    sightingCount: 11,
    distinctReporters: 5,
    firstSeenAt: shiftDays(MOCK_NOW_ISO, -30),
    lastSeenAt: shiftDays(MOCK_NOW_ISO, -2),
    computedAt: shiftDays(MOCK_NOW_ISO, -2),
    confidence: 0.55,
  },
  {
    id: 'wsp-4',
    speciesId: 'sp-sparrow',
    zoneId: 'wz-lib-lawn',
    fuzzedGeo: { lat: 31.17945, lng: 121.59088 },
    sightingCount: 8,
    distinctReporters: 4,
    firstSeenAt: shiftDays(MOCK_NOW_ISO, -20),
    lastSeenAt: shiftDays(MOCK_NOW_ISO, -3),
    // ⚠️ 这条**故意**是 12 小时前算出来的，用于演示 E10：
    // 「延迟 <24h 的热点不得展示」
    computedAt: shiftHours(MOCK_NOW_ISO, -12),
    confidence: 0.4,
  },
]

/* ------------------------------------------------------------------ *
 * 推断轨迹（⚠️ **不是实测路径**，规格 §6.1）
 * ------------------------------------------------------------------ */

const TRACK_DISCLAIMER_SWAN =
  '本轨迹由 31 次同学上报推断得出，并非实测运动路径，也不代表黑天鹅真实走过的路线。'

const TRACK_DISCLAIMER_CAT =
  '本轨迹由 14 次同学上报推断得出，并非实测运动路径。轨迹断裂处表示期间没有上报，不代表动物没有移动。'

export const MOCK_WILDLIFE_TRACKS: readonly WildlifeTrack[] = [
  {
    id: 'wt-swan-1',
    speciesId: 'sp-black-swan',
    individualId: 'wi-swan-e',
    isInferred: true,
    points: [
      { lat: 31.18095, lng: 121.5934, observedAt: shiftDays(MOCK_NOW_ISO, -12) },
      { lat: 31.18108, lng: 121.59352, observedAt: shiftDays(MOCK_NOW_ISO, -9) },
      { lat: 31.18122, lng: 121.59368, observedAt: shiftDays(MOCK_NOW_ISO, -5) },
      { lat: 31.18105, lng: 121.59348, observedAt: shiftDays(MOCK_NOW_ISO, -1) },
    ],
    pointCount: 4,
    startedAt: shiftDays(MOCK_NOW_ISO, -12),
    endedAt: shiftDays(MOCK_NOW_ISO, -1),
    disclaimer: TRACK_DISCLAIMER_SWAN,
    method: 'dbscan-chain',
    sightingCount: 31,
    totalDistanceM: 62,
    confidence: 0.58,
    algorithmVersion: 'dbscan-v1',
    computedAt: shiftDays(MOCK_NOW_ISO, -2),
  },
  {
    id: 'wt-cat-1',
    speciesId: 'sp-cat',
    individualId: 'wi-cat-orange',
    isInferred: true,
    points: [
      { lat: 31.17725, lng: 121.58885, observedAt: shiftDays(MOCK_NOW_ISO, -10) },
      { lat: 31.17835, lng: 121.59002, observedAt: shiftDays(MOCK_NOW_ISO, -6) },
      { lat: 31.17952, lng: 121.59105, observedAt: shiftDays(MOCK_NOW_ISO, -1) },
    ],
    pointCount: 3,
    startedAt: shiftDays(MOCK_NOW_ISO, -10),
    endedAt: shiftDays(MOCK_NOW_ISO, -1),
    disclaimer: TRACK_DISCLAIMER_CAT,
    method: 'dbscan-chain',
    sightingCount: 14,
    totalDistanceM: 340,
    confidence: 0.61,
    algorithmVersion: 'dbscan-v1',
    computedAt: shiftDays(MOCK_NOW_ISO, -2),
  },
  {
    id: 'wt-magpie-1',
    speciesId: 'sp-magpie',
    individualId: null,
    isInferred: true,
    points: [
      { lat: 31.18298, lng: 121.59492, observedAt: shiftDays(MOCK_NOW_ISO, -8) },
      { lat: 31.18325, lng: 121.59522, observedAt: shiftDays(MOCK_NOW_ISO, -2) },
    ],
    pointCount: 2,
    startedAt: shiftDays(MOCK_NOW_ISO, -8),
    endedAt: shiftDays(MOCK_NOW_ISO, -2),
    disclaimer: '本轨迹由 9 次同学上报推断得出，并非实测运动路径。',
    method: 'dbscan-chain',
    sightingCount: 9,
    totalDistanceM: 46,
    confidence: 0.33,
    algorithmVersion: 'dbscan-v1',
    computedAt: shiftDays(MOCK_NOW_ISO, -2),
  },
]

/* ------------------------------------------------------------------ *
 * 照片（**假 URL**，mock 模式下不会真的加载）
 * ------------------------------------------------------------------ */

/** mediaId → 缩略图假 URL */
export const MOCK_WILDLIFE_PHOTO_URLS: Readonly<Record<string, string>> = {
  'wm-mock-0001': 'https://cdn.kedaya.example/wildlife/mock/wm-mock-0001/thumb.webp',
  'wm-mock-0002': 'https://cdn.kedaya.example/wildlife/mock/wm-mock-0002/thumb.webp',
  'wm-mock-0003': 'https://cdn.kedaya.example/wildlife/mock/wm-mock-0003/thumb.webp',
  'wm-mock-0004': 'https://cdn.kedaya.example/wildlife/mock/wm-mock-0004/thumb.webp',
  'wm-mock-0005': 'https://cdn.kedaya.example/wildlife/mock/wm-mock-0005/thumb.webp',
}

/** 未知 mediaId 的兜底假 URL（保证 UI 永远有图可渲染） */
export function mockPhotoUrl(mediaId: string): string {
  return (
    MOCK_WILDLIFE_PHOTO_URLS[mediaId] ??
    `https://cdn.kedaya.example/wildlife/mock/${encodeURIComponent(mediaId)}/thumb.webp`
  )
}

/** mock 上传返回的固定 sha256 前缀（真实实现由服务端算） */
export const MOCK_MEDIA_SHA256_PREFIX = 'mock-sha256-'
