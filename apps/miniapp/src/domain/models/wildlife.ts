/**
 * 野生动物（`wildlife`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 上游：
 * - 功能规格 `docs/features/wildlife-map.md`
 * - 冻结 wire 形状 `packages/contracts/openapi/kedaya.v1.yaml` 的 wildlife 段
 *
 * ⚠️ **本文件承担本模块最容易出错的一件事：坐标系（规格 §3）。**
 *
 * | 数据来源 / 消费方 | 坐标系 |
 * | --- | --- |
 * | `wx.getLocation({ type: 'wgs84' })` / GPS | **WGS84** |
 * | 校园底图（`KdyCampusMap` 的底图与叠加层）/ 原生 `<map>` | **GCJ-02** |
 * | 用户在底图上点选（`onPick` 回调） | **GCJ-02** |
 * | 我们的存储层与全部 API | **WGS84**（单一真相） |
 *
 * 两者在上海相差 **约 470 米** —— 足以跨过一整栋楼，而且混用后看起来像
 * 「数据错了」而不是「坐标系错了」，极难排查。
 *
 * 因此本模块**只暴露两个转换入口**，任何渲染 / 上传都必须经过它们：
 *
 * - [toMapPoint]：WGS84 → GCJ-02（画到底图之前）
 * - [toApiPoint]：GCJ-02 → WGS84（点选后、上传之前；`from` 参数**必填**）
 * - [toCampusMapPoint]：上面两者之外只多一件事 —— 顺手换成契约点形状
 *
 * 页面**禁止**直接 import `@kedaya/shared` 的 `wgs84ToGcj02` / `gcj02ToWgs84`，
 * 否则「忘记转换」又变成靠自觉 —— 这正是规格 §3.2 要避免的。
 */

import {
  containsLikelyPii,
  distanceMeters,
  formatRelativeTime,
  gcj02ToWgs84,
  isLengthWithin,
  wgs84ToGcj02,
} from '@kedaya/shared'
import type { LatLng } from '@kedaya/shared'
import type { CampusPoint } from '@kedaya/contracts'

/* ------------------------------------------------------------------ *
 * 1. 类型（与 OpenAPI wildlife 段逐字对齐）
 * ------------------------------------------------------------------ */

/** 投喂政策（规格 §8.1 E1/E2） */
export type FeedingPolicy = 'allowed' | 'discouraged' | 'forbidden'

/** 坐标的**来源**坐标系。上传路径必须显式声明，不允许"默认"。 */
export type CoordinateSystem = 'gcj02' | 'wgs84'

/** 观测记录的审核状态（与 `02-domain-model.md` §2.10 一致） */
export type WildlifeSightingStatus = 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'WITHDRAWN'

/** 物种是怎么确定的（OpenAPI `WildlifeSighting.speciesSource`） */
export type SpeciesSource = 'manual' | 'auto' | 'corrected'

/** 分类来源（规格 §2.6 `classifiedBy`） */
export type ClassifiedBy = 'manual' | 'vision_api' | 'ondevice' | 'fallback'

/** 实际生效的模糊层级（OpenAPI `WildlifeSighting.fuzzLevel`） */
export type FuzzLevel = 'grid' | 'zone-only' | 'coarsened'

/** 自动分类的运行模式（规格 §5.2 三档） */
export type ClassifierMode = 'manual' | 'server' | 'off'

/** 管理端划定的区域（**不是**观测点，规格 §2.3） */
export interface WildlifeZone {
  id: string
  name: string
  /** 主要物种 `WildlifeSpecies.id` 列表 */
  speciesIds: string[]
  /** 圆心纬度，**WGS84** */
  centerLat: number
  /** 圆心经度，**WGS84** */
  centerLng: number
  radiusM: number
  feedingPolicy: FeedingPolicy
  /** 告示文案（黑天鹅等）。⚠️ 草案，未经校方审核（规格 §8.3 U7） */
  noticeText?: string
  /** 该区域的位置模糊半径，默认 50（规格 §9.3 ②） */
  fuzzRadiusM: number
  /** 敏感区（宿舍 / 保育 / 巢区）→ **不输出任何坐标**，只给 `zoneId`（规格 §9.3 ①） */
  isSensitive: boolean
  sortOrder: number
}

/** 物种（分类树，规格 §2.5） */
export interface WildlifeSpecies {
  id: string
  /** 学名，唯一。如 `Cygnus atratus` */
  scientificName: string
  commonNameZh: string
  commonNameEn?: string
  taxonRank: 'species' | 'genus' | 'family' | 'order'
  parentId: string | null
  isProtected: boolean
  /** 繁殖期敏感 → 模糊半径季节性放大（规格 §9.4） */
  isNestingSensitive: boolean
  nestingMonths: number[]
  defaultFeedingPolicy: FeedingPolicy
}

/** 被命名的个体（"手动给个名字"，规格 §5.6 (b)） */
export interface WildlifeIndividual {
  id: string
  name: string
  speciesId: string
  note?: string
  photoMediaId?: string
  status: WildlifeSightingStatus
}

/** 一条观测上报。坐标字段是**模糊后**的公开坐标。 */
export interface WildlifeSighting {
  id: string
  speciesId: string | null
  speciesSource: SpeciesSource
  /** **发现时间**（观察时刻），区别于 `createdAt`（入库时刻）。契约 §11.10-A */
  observedAt: string
  /** 模糊后的公开坐标（WGS84）。**敏感区内为空**，此时只有 `zoneId` */
  fuzzedGeo?: LatLng
  zoneId: string | null
  fuzzLevel: FuzzLevel
  mediaIds: string[]
  note?: string
  status: WildlifeSightingStatus
  /** 观测记录**不是**推断的（推断只属于 `WildlifeTrack`） */
  isInferred: false
  healthConcern: boolean
  isAnonymous: boolean
  /** 展示名；`isAnonymous` 时必须是「匿名同学」，且不含 `reporterId`（规格 §9.6） */
  reporterName?: string
  createdAt: string
}

/** 聚合热点（**派生只读**，延迟 ≥24h，规格 §8.1 E10） */
export interface WildlifeSpot {
  id: string
  speciesId: string
  zoneId: string | null
  fuzzedGeo: LatLng
  sightingCount: number
  distinctReporters: number
  firstSeenAt: string
  lastSeenAt: string
  computedAt: string
  confidence: number
}

export interface WildlifeTrackPoint extends LatLng {
  observedAt: string
}

/** 推断轨迹（**不是实测路径**，规格 §6.1） */
export interface WildlifeTrack {
  id: string
  speciesId: string
  individualId: string | null
  /** **恒为 `true`**。字段存在的唯一目的是让客户端无法忘记标注它 */
  isInferred: true
  points: WildlifeTrackPoint[]
  pointCount: number
  startedAt: string
  endedAt: string
  /**
   * **服务端下发**的免责说明，客户端必须原样展示（规格 §10.5）。
   *
   * 声明为可选是**防御性**的：正常后端一定会下发，但若某个后端漏了，
   * UI 必须回退到本地兜底文案，而不是显示空白 —— 空白会被读成「这是实测路径」。
   */
  disclaimer?: string
  method: 'dbscan-chain'
  sightingCount: number
  totalDistanceM: number
  confidence: number
  algorithmVersion: string
  computedAt: string
}

/** 自动分类建议（规格 §5.3） */
export interface WildlifeClassification {
  speciesId: string
  confidence: number
  provider: string
}

/** `POST /classify` 的响应 */
export interface WildlifeClassifyResult {
  suggestions: WildlifeClassification[]
  /** `true` 表示分类能力不可用（无 API key / 模型缺失）→ 必须降级为纯手动 */
  degraded: boolean
}

/** `POST /media` 的响应 */
export interface WildlifeMedia {
  mediaId: string
  thumbUrl: string
  /** 服务端已强制剥离 EXIF（含 GPS）—— 客户端承诺不算数（规格 §4.3） */
  exifStripped: boolean
  widthPx: number
  heightPx: number
  byteSize: number
  mimeType: string
  sha256: string
  clientPhotoId: string
}

/** 底图配置（规格 §1.4）。⚠️ 学校官方平面图未获授权，Phase 1 用自绘示意图 */
export interface CampusBasemap {
  version: string
  imageUrl: string
  widthPx: number
  heightPx: number
  affine: [number, number, number, number, number, number]
  calibrationRmsePx: number
  controlPointCount: number
  attribution: string
  license: 'original' | 'odbl' | 'school-authorized'
}

/** `POST /items` 的请求体（OpenAPI `WildlifeSightingCreate` + 规格 §10.3 的补充字段） */
export interface WildlifeSightingCreateBody {
  /** **WGS84**。由 [toCreateSightingBody] 从任意来源坐标系归一化而来 */
  latitude: number
  /** **WGS84** */
  longitude: number
  observedAt: string
  speciesId: string | null
  individualId: string | null
  mediaIds: string[]
  note?: string
  zoneId: string | null
  geoAccuracyM?: number
  healthConcern: boolean
  isAnonymous: boolean
  autoSpeciesId: string | null
  autoConfidence: number | null
  classifiedBy: ClassifiedBy
  /** 规格 §8.2：这是**表单校验**，不是同意门（不产生 `ConsentRecord`） */
  ethicsAcknowledged: boolean
}

/** `POST /individuals` 的请求体（OpenAPI `WildlifeIndividualCreate`） */
export interface WildlifeIndividualCreateBody {
  name: string
  speciesId: string
  note?: string
  photoMediaId?: string
}

/* ------------------------------------------------------------------ *
 * 2. 常量：伦理 / 隐私文案（规格 §8、§9 —— 硬要求，不是可选项）
 * ------------------------------------------------------------------ */

/** 全端统一，禁止各处自行拼字符串（与 `forum` 的 `ANONYMOUS_DISPLAY_NAME` 同源语义） */
export const WILDLIFE_ANONYMOUS_DISPLAY_NAME = '匿名同学'

/**
 * 伦理约束清单（规格 §8.1 E1–E8 的精简版，每条 ≤20 字）。
 *
 * 呈现方式：**首次上报时的一次性伦理提示**，折叠展开、默认展开，
 * 用户需勾选「我已阅读并遵守」才能提交。
 *
 * ⚠️ 这与「同意门」**不是一回事**（规格 §8.2）：
 * - 同意门 = 独立授权状态、可撤回、缺它则整个模块不可用（`CONSENT_REQUIRED`）；
 * - 这里的勾选 = 单次表单的操作确认，缺它则该次提交被拒（`VALIDATION_FAILED`），
 *   但**浏览地图、查看区域、看别人的上报完全不受影响**。
 * `wildlife` 敏感级为 `low`，契约 §9 的同意门只适用于
 * `wellbeing` / `dorm-harmony` / `ai-portrait`。**禁止引入 `CONSENT_REQUIRED`。**
 */
export const WILDLIFE_ETHICS_RULES: readonly string[] = [
  '禁止投喂人类食物（面包、零食）',
  '禁止追撵、捕捉、触摸、抱起',
  '禁止闪光灯拍摄夜行动物',
  '禁止公开巢穴与育雏位置',
  '禁止带走动物或其蛋、幼崽',
  '发现受伤动物请联系社团处理',
  '禁止用食物引诱以获取照片',
]

export const WILDLIFE_ETHICS_TITLE = '不打扰野生动物，是观测的前提'

/** 勾选文案（表单校验用，不是同意门） */
export const WILDLIFE_ETHICS_ACK_LABEL = '我已阅读并遵守以上规范'

/** 规格 §8.1 E3/E4/E6 的集中提示（上报页与详情页都要出现） */
export const WILDLIFE_NO_DISTURB_NOTICE =
  '请保持距离、不要惊扰。拍摄时关闭闪光灯，不要为了拍照而追撵或投喂。'

/**
 * 位置模糊化说明（规格 §9 —— **必须告诉用户"你看到的公开位置是模糊后的"**）。
 *
 * 不写清楚就是误导性的隐私承诺：用户以为自己看到的是精确点。
 */
export const WILDLIFE_PRIVACY_NOTICE =
  '你看到的公开位置是模糊化之后的（网格吸附 + 确定性加噪，默认约 50 米）。' +
  '宿舍区等敏感区不公开任何坐标，只显示所属区域。'

export const WILDLIFE_PRIVACY_NOTICE_SHORT = '公开位置为模糊后坐标，敏感区不公开坐标。'

/** 热点聚合延迟说明（规格 §8.1 E10：平台不做「围观召集工具」） */
export const WILDLIFE_AGGREGATION_NOTICE =
  '热点是按历史上报聚合的，且至少延迟 24 小时；地图不显示实时位置。'

export const WILDLIFE_AGGREGATION_MIN_DELAY_HOURS = 24

/** 自动分类的免责说明（规格 §5.7：识别结果只是**建议**，不保证准确率） */
export const WILDLIFE_CLASSIFY_DISCLAIMER = '识别结果仅供参考，请确认后再提交。'

/** 轨迹标注（规格 §6.1 / §11.3 T18 —— 必须**显著**标注） */
export const WILDLIFE_TRACK_INFERRED_LABEL = '推断轨迹'

/** 服务端未下发 `disclaimer` 时的兜底文案（正常情况下应由服务端下发） */
export const WILDLIFE_TRACK_DISCLAIMER_FALLBACK =
  '本轨迹由同学的上报点推断得出，**不是**实测运动路径，也不代表动物的真实路线。'

/** 黑天鹅专属告示（规格 §8.3，⚠️ 草案，未经校方或社团审核 —— U7） */
export const WILDLIFE_BLACK_SWAN_NOTICE =
  '黑天鹅是校园的重要成员，也是校方管理的动物。请勿投喂人类食物，' +
  '请勿追撵、捕捉或近距离惊扰；繁殖期请勿靠近巢区。发现受伤或异常，请上报标记「疑似受伤」。'

/* ------------------------------------------------------------------ *
 * 3. 常量：业务规则
 * ------------------------------------------------------------------ */

/** 契约 `photoUrls` ≤3（规格 §4.2） */
export const WILDLIFE_MAX_PHOTOS = 3
export const WILDLIFE_NOTE_MAX_LENGTH = 200
/** OpenAPI `WildlifeIndividualCreate.name` maxLength 60；端上按规格 §2.8 收到 24 字 */
export const WILDLIFE_INDIVIDUAL_NAME_MAX_LENGTH = 24
export const WILDLIFE_INDIVIDUAL_NOTE_MAX_LENGTH = 500

/** 发现时间窗口（契约 §11.10-A / 规格 §10.3） */
export const WILDLIFE_OBSERVED_AT_MAX_PAST_DAYS = 30
export const WILDLIFE_OBSERVED_AT_CLOCK_TOLERANCE_MINUTES = 5

/** 置信度阈值（规格 §5.5） */
export const WILDLIFE_CONFIDENCE_HIGH = 0.85
export const WILDLIFE_CONFIDENCE_MIN = 0.6

/** 客户端压缩阈值（规格 §4.2） */
export const WILDLIFE_COMPRESS_MAX_EDGE_PX = 2048
export const WILDLIFE_COMPRESS_MAX_BYTES = 2 * 1024 * 1024
export const WILDLIFE_COMPRESS_QUALITY = 80

/**
 * 校园边界框（WGS84）。⚠️ **占位值，待实测替换**（规格 §3.5 U3）。
 * 用于客户端**预校验**；权威判定在服务端（`assertInCampus`）。
 */
export const CAMPUS_BBOX = {
  minLat: 31.17,
  maxLat: 31.186,
  minLng: 121.582,
  maxLng: 121.598,
} as const

/* ------------------------------------------------------------------ *
 * 4. 坐标系转换（**本模块最重要的两个函数**）
 * ------------------------------------------------------------------ */

/**
 * WGS84 → GCJ-02：**唯一**的「画到底图上之前」转换入口。
 *
 * 所有来自 API / 存储的坐标都是 WGS84，底图（校方校园 GIS 投影 / `campusPixel`）
 * 与原生 `<map>` 一样只认 GCJ-02，因此 markers / polyline / circles 的每一个点
 * 都必须先过这里。
 */
export function toMapPoint(point: LatLng): LatLng {
  return wgs84ToGcj02(point.lat, point.lng)
}

/**
 * WGS84 → GCJ-02 **并**换成契约点形状（`{lat,lng}` → `{latitude,longitude}`）。
 *
 * 为什么单列一个函数：坐标系的转换只有 [toMapPoint] 一处，但**形状**在本仓库里
 * 有两套 —— 存储 / API / `toApiPoint` 用 `{lat,lng}`，`@kedaya/contracts` 的
 * `campus-map`（以及原生 `<map>` 的叠加层）用 `{latitude,longitude}`。
 * 没有这个函数，每个页面都得手写 `{ latitude: p.lat, longitude: p.lng }`，
 * 手写的地方多了就一定会有人把 WGS84 的点也塞进去（少了那一句转换）。
 *
 * ⚠️ 入参必须是 **WGS84**：本函数内部会转换，别再给它已经转好的 GCJ-02。
 */
export function toCampusMapPoint(point: LatLng): CampusPoint {
  const mapped = toMapPoint(point)
  return { latitude: mapped.lat, longitude: mapped.lng }
}

/** 批量版本（轨迹折线 / 多边形） */
export function toMapPoints(points: readonly LatLng[]): LatLng[] {
  return points.map(toMapPoint)
}

/**
 * GCJ-02 → WGS84：**唯一**的「上传之前」转换入口。
 *
 * `from` 是**必填**参数：调用方必须明确声明手上这个点是从哪来的。
 * 从校园底图点选 / `wx.chooseLocation` 拿到的是 GCJ-02（→ 必须转）；
 * 从 `wx.getLocation({ type: 'wgs84' })` 拿到的是 WGS84（→ 原样透传）。
 */
export function toApiPoint(point: LatLng, from: CoordinateSystem): LatLng {
  if (from === 'wgs84') return { lat: point.lat, lng: point.lng }
  return gcj02ToWgs84(point.lat, point.lng)
}

/** 坐标是否落在校园边界框内（WGS84 入参）。`lat`/`lng` 互换会立刻失败 */
export function isInCampus(point: LatLng): boolean {
  return (
    point.lat >= CAMPUS_BBOX.minLat &&
    point.lat <= CAMPUS_BBOX.maxLat &&
    point.lng >= CAMPUS_BBOX.minLng &&
    point.lng <= CAMPUS_BBOX.maxLng
  )
}

/* ------------------------------------------------------------------ *
 * 5. 地图渲染派生（全部返回 **GCJ-02**）
 * ------------------------------------------------------------------ */

export interface MapCircle {
  latitude: number
  longitude: number
  /** 半径，**米**（`<map circles>` 与 `KdyCampusMap` 都按米解释） */
  radius: number
  color: string
  fillColor: string
  strokeWidth: number
  /**
   * 区域名称（如「黑天鹅湖」）。
   *
   * 画在圈上而不是只写进图例：底图上是**一个没有名字的圆**时，
   * 用户唯一能做的就是猜。区域名是公开信息 —— 敏感区被模糊化的是坐标，不是名字。
   */
  label?: string
}

export interface MapMarker {
  /** 业务 id（观测 / 热点），用于点开详情 */
  id: string
  /** 这个 marker 代表什么 —— 决定点击后打开哪个详情面板 */
  kind: 'spot' | 'sighting'
  /**
   * `<map>` 组件要求的**数字** id（Taro 类型为 `marker.id?: number`，
   * 且官方建议用 Number 以保证更新性能）。
   * 由 [buildMapOverlays] 按数组下标分配，页面据此反查业务 id。
   */
  markerId?: number
  latitude: number
  longitude: number
  title: string
  /** 气泡里的摘要 */
  calloutText: string
}

/**
 * 区域圈 → `<map>` 的 `circles`。
 *
 * ⚠️ `radius` 是**米**，与坐标系无关，因此不需要转换；
 * 但圆心必须 WGS84 → GCJ-02。
 * 颜色不在这里写死 —— 返回的色值由调用方从设计令牌注入（本层是纯 domain，不碰 UI 令牌）。
 */
export function zoneToMapCircle(zone: WildlifeZone, colors: { stroke: string; fill: string }): MapCircle {
  const center = toMapPoint({ lat: zone.centerLat, lng: zone.centerLng })
  return {
    latitude: center.lat,
    longitude: center.lng,
    radius: zone.radiusM,
    color: colors.stroke,
    fillColor: colors.fill,
    strokeWidth: 2,
    // 名字带上：地图上的圈必须能自我解释（敏感区模糊的是坐标，不是名字）
    label: zone.name,
  }
}

/** 聚合热点 → `<map>` 的 marker */
export function spotToMapMarker(spot: WildlifeSpot, speciesName: string): MapMarker {
  const point = toMapPoint(spot.fuzzedGeo)
  return {
    id: spot.id,
    kind: 'spot',
    latitude: point.lat,
    longitude: point.lng,
    title: speciesName,
    calloutText: `${speciesName} · ${spot.distinctReporters} 位同学上报过`,
  }
}

/**
 * 观测点 → marker。
 *
 * ⚠️ 敏感区（`fuzzLevel === 'zone-only'`）的观测**没有坐标**，返回 `null`。
 * 规格 §9.3 ①：命中敏感区就**不输出任何坐标**，只给 `zoneId` —— 没有坐标就没有反推的可能。
 */
export function sightingToMapMarker(
  sighting: WildlifeSighting,
  speciesName: string,
  now: Date,
): MapMarker | null {
  if (sighting.fuzzedGeo === undefined) return null
  const point = toMapPoint(sighting.fuzzedGeo)
  return {
    id: sighting.id,
    kind: 'sighting',
    latitude: point.lat,
    longitude: point.lng,
    title: speciesName,
    calloutText: `${speciesName} · ${formatRelativeTime(sighting.observedAt, now)}`,
  }
}

/** 推断轨迹 → `<map>` 的 polyline 点串（WGS84 → GCJ-02） */
export function trackToMapPoints(track: WildlifeTrack): Array<{ latitude: number; longitude: number }> {
  return track.points.map((p) => {
    const point = toMapPoint(p)
    return { latitude: point.lat, longitude: point.lng }
  })
}

/** 轨迹总长度（米，WGS84 上算 —— 坐标系转换不改变距离量级，但顺序不能反） */
export function trackLengthMeters(track: WildlifeTrack): number {
  let total = 0
  for (let i = 1; i < track.points.length; i += 1) {
    const prev = track.points[i - 1]
    const next = track.points[i]
    if (prev === undefined || next === undefined) continue
    total += distanceMeters(prev, next)
  }
  return Math.round(total)
}

/* ------------------------------------------------------------------ *
 * 6. 展示派生（文案 / 标签）
 * ------------------------------------------------------------------ */

export const FEEDING_POLICY_LABELS: Readonly<Record<FeedingPolicy, string>> = {
  allowed: '可投喂（仍需适量）',
  discouraged: '不建议投喂',
  forbidden: '禁止投喂',
}

export type FeedingPolicyTone = 'success' | 'warning' | 'danger'

export const FEEDING_POLICY_TONES: Readonly<Record<FeedingPolicy, FeedingPolicyTone>> = {
  allowed: 'success',
  discouraged: 'warning',
  forbidden: 'danger',
}

/** 区域详情的投喂规范告示（规格 §8.3） */
export function feedingPolicyNotice(policy: FeedingPolicy, speciesName?: string): string {
  const target = speciesName === undefined || speciesName === '' ? '野生动物' : speciesName
  if (policy === 'forbidden') {
    return `该区域禁止投喂${target}。人类食物（面包、零食、含盐含糖食品）会损害它们的健康。`
  }
  if (policy === 'discouraged') {
    return `不建议投喂${target}。请让它们保持自然的觅食行为。`
  }
  return `该区域允许适量投喂，但请使用合适的食物并保持距离。`
}

/**
 * 区域的**生效投喂政策**：区域政策与物种默认政策取**更严格**的一个。
 *
 * 为什么取更严格：黑天鹅在物种层面是 `forbidden`，若某个区域标了 `allowed`，
 * 也不应该让 UI 显示「可投喂」—— 物种的生物学约束不能被区域配置放宽。
 */
export function effectiveFeedingPolicy(
  zonePolicy: FeedingPolicy | undefined,
  speciesPolicy: FeedingPolicy | undefined,
): FeedingPolicy {
  const rank: Record<FeedingPolicy, number> = { allowed: 0, discouraged: 1, forbidden: 2 }
  const zone = zonePolicy ?? 'discouraged'
  const species = speciesPolicy ?? 'discouraged'
  return rank[zone] >= rank[species] ? zone : species
}

export const WILDLIFE_STATUS_LABELS: Readonly<Record<WildlifeSightingStatus, string>> = {
  PENDING: '待审核',
  PUBLISHED: '已公开',
  REJECTED: '未通过',
  WITHDRAWN: '已撤回',
}

export const FUZZ_LEVEL_LABELS: Readonly<Record<FuzzLevel, string>> = {
  grid: '已模糊到片区',
  'zone-only': '仅显示所属区域（敏感区不公开坐标）',
  coarsened: '已进一步粗化',
}

export const SPECIES_SOURCE_LABELS: Readonly<Record<SpeciesSource, string>> = {
  manual: '手动选择',
  auto: '自动识别',
  corrected: '已人工纠正',
}

export function speciesDisplayName(species: WildlifeSpecies | undefined): string {
  if (species === undefined) return '未识别物种'
  return species.commonNameZh
}

export function findSpecies(
  speciesList: readonly WildlifeSpecies[],
  speciesId: string | null | undefined,
): WildlifeSpecies | undefined {
  if (speciesId === null || speciesId === undefined) return undefined
  return speciesList.find((item) => item.id === speciesId)
}

export function findZone(
  zones: readonly WildlifeZone[],
  zoneId: string | null | undefined,
): WildlifeZone | undefined {
  if (zoneId === null || zoneId === undefined) return undefined
  return zones.find((item) => item.id === zoneId)
}

/** 观测点的展示名（规格 §9.6：匿名时**不得**出现 `reporterId`） */
export function displayReporterName(sighting: WildlifeSighting): string {
  if (sighting.isAnonymous) return WILDLIFE_ANONYMOUS_DISPLAY_NAME
  return sighting.reporterName ?? WILDLIFE_ANONYMOUS_DISPLAY_NAME
}

/**
 * 热点是否满足「延迟 ≥24h」的展示前提（规格 §8.1 E10 / §11.3 T24）。
 * 不满足时 UI 必须**不显示**，避免平台变成围观召集工具。
 */
export function isSpotAggregationDelayed(
  spot: WildlifeSpot,
  now: Date,
  minHours: number = WILDLIFE_AGGREGATION_MIN_DELAY_HOURS,
): boolean {
  const computedAt = new Date(spot.computedAt).getTime()
  if (Number.isNaN(computedAt)) return false
  return now.getTime() - computedAt >= minHours * 3_600_000
}

/** 观测详情弹窗的展示模型（物种 / 发现时间 / 照片 / 区域 / 投喂规范） */
export interface SightingSummary {
  id: string
  speciesName: string
  observedAtLabel: string
  observedAt: string
  zoneName: string
  zoneNotice: string
  feedingPolicy: FeedingPolicy
  feedingPolicyLabel: string
  feedingPolicyTone: FeedingPolicyTone
  photoCount: number
  hasCoordinates: boolean
  fuzzLevel: FuzzLevel
  fuzzLabel: string
  healthConcern: boolean
  reporterName: string
  status: WildlifeSightingStatus
  statusLabel: string
  speciesSource: SpeciesSource
  speciesSourceLabel: string
  note: string
  /** 保护物种 / 繁殖期敏感 —— UI 必须额外提示 */
  isProtected: boolean
  isNestingSensitive: boolean
}

export function summarizeSighting(
  sighting: WildlifeSighting,
  speciesList: readonly WildlifeSpecies[],
  zones: readonly WildlifeZone[],
  now: Date,
): SightingSummary {
  const species = findSpecies(speciesList, sighting.speciesId)
  const zone = findZone(zones, sighting.zoneId)
  const policy = effectiveFeedingPolicy(zone?.feedingPolicy, species?.defaultFeedingPolicy)

  return {
    id: sighting.id,
    speciesName: speciesDisplayName(species),
    observedAt: sighting.observedAt,
    observedAtLabel: formatRelativeTime(sighting.observedAt, now),
    zoneName: zone?.name ?? '未划入管理区域',
    zoneNotice: zone?.noticeText ?? '',
    feedingPolicy: policy,
    feedingPolicyLabel: FEEDING_POLICY_LABELS[policy],
    feedingPolicyTone: FEEDING_POLICY_TONES[policy],
    photoCount: sighting.mediaIds.length,
    hasCoordinates: sighting.fuzzedGeo !== undefined,
    fuzzLevel: sighting.fuzzLevel,
    fuzzLabel: FUZZ_LEVEL_LABELS[sighting.fuzzLevel],
    healthConcern: sighting.healthConcern,
    reporterName: displayReporterName(sighting),
    status: sighting.status,
    statusLabel: WILDLIFE_STATUS_LABELS[sighting.status],
    speciesSource: sighting.speciesSource,
    speciesSourceLabel: SPECIES_SOURCE_LABELS[sighting.speciesSource],
    note: sighting.note ?? '',
    isProtected: species?.isProtected ?? false,
    isNestingSensitive: species?.isNestingSensitive ?? false,
  }
}

/* ------------------------------------------------------------------ *
 * 7. 自动分类（规格 §5.2 / §5.5 / §5.7）
 * ------------------------------------------------------------------ */

export interface ClassifySuggestionView {
  speciesId: string
  speciesName: string
  confidence: number
  /** 置信度文案：`很确定` / `可能` / `无法确定` */
  confidenceLabel: string
  /** 是否预选（`< 0.60` 时**不预选**，必须用户自己选） */
  preselected: boolean
}

export interface ClassificationView {
  mode: ClassifierMode
  /** `true` = 分类能力不可用（无 key / 模型缺失）→ 纯手动，**不报错、不阻塞上报** */
  degraded: boolean
  suggestions: ClassifySuggestionView[]
  /** 建议预选的物种；`< 0.60` 或降级时为 `null` */
  preselectedSpeciesId: string | null
  /** `classifiedBy !== 'manual'` 时 UI **必须**显示（规格 §5.7） */
  disclaimer: string
}

/** 置信度文案（规格 §5.5 的三档） */
export function confidenceLabel(confidence: number): string {
  if (confidence >= WILDLIFE_CONFIDENCE_HIGH) return '很确定'
  if (confidence >= WILDLIFE_CONFIDENCE_MIN) return '可能'
  return '无法确定'
}

/**
 * 把 `POST /classify` 的结果转成 UI 视图。
 *
 * 降级路径（**核心设计原则**：分类是增强，不是前置条件）：
 * - 请求失败 / `degraded: true` / `suggestions` 为空 → `mode: 'manual'`，`degraded: true`，
 *   预选为空，用户手动选物种即可完成上报；
 * - 置信度 `< 0.60` → 展示候选但**不预选**（避免用户直接跳过确认）；
 * - 置信度 `≥ 0.60` → 预选 top-1。
 */
export function buildClassificationView(
  result: WildlifeClassifyResult | null,
  speciesList: readonly WildlifeSpecies[],
): ClassificationView {
  if (result === null || result.degraded || result.suggestions.length === 0) {
    return {
      mode: 'manual',
      degraded: true,
      suggestions: [],
      preselectedSpeciesId: null,
      disclaimer: WILDLIFE_CLASSIFY_DISCLAIMER,
    }
  }

  const sorted = [...result.suggestions].sort((a, b) => b.confidence - a.confidence)
  const suggestions: ClassifySuggestionView[] = sorted.map((item) => ({
    speciesId: item.speciesId,
    speciesName: speciesDisplayName(findSpecies(speciesList, item.speciesId)),
    confidence: item.confidence,
    confidenceLabel: confidenceLabel(item.confidence),
    preselected: item.confidence >= WILDLIFE_CONFIDENCE_MIN,
  }))

  const top = suggestions[0]
  const preselectedSpeciesId =
    top !== undefined && top.confidence >= WILDLIFE_CONFIDENCE_MIN ? top.speciesId : null

  return {
    mode: 'server',
    degraded: false,
    suggestions,
    preselectedSpeciesId,
    disclaimer: WILDLIFE_CLASSIFY_DISCLAIMER,
  }
}

/** 用户改了自动分类结果 → 记录纠正来源（规格 §5.5 的标注样本闭环） */
export function resolveSpeciesSource(
  chosenSpeciesId: string | null,
  autoSpeciesId: string | null,
): SpeciesSource {
  if (chosenSpeciesId === null) return 'manual'
  if (autoSpeciesId !== null && chosenSpeciesId !== autoSpeciesId) return 'corrected'
  if (autoSpeciesId !== null) return 'auto'
  return 'manual'
}

/** 用户是否纠正了自动结果（决定是否上报 `correctedFromSpeciesId`） */
export function wasCorrected(
  chosenSpeciesId: string | null,
  autoSpeciesId: string | null,
): boolean {
  return autoSpeciesId !== null && chosenSpeciesId !== null && chosenSpeciesId !== autoSpeciesId
}

/* ------------------------------------------------------------------ *
 * 8. 上报表单校验（纯函数，UI 与用例层共用同一份规则）
 * ------------------------------------------------------------------ */

export type SightingDraftErrorReason =
  | 'SPECIES_REQUIRED'
  | 'UNKNOWN_SPECIES'
  | 'OBSERVED_AT_OUT_OF_RANGE'
  | 'COORDINATE_OUT_OF_CAMPUS'
  | 'ETHICS_NOT_ACKNOWLEDGED'
  | 'NOTE_TOO_LONG'
  | 'TOO_MANY_PHOTOS'
  | 'INDIVIDUAL_NAME_INVALID'
  | 'INVALID_ACCURACY'

export interface SightingDraftError {
  field: string
  reason: SightingDraftErrorReason
  message: string
}

export interface SightingDraft {
  speciesId: string | null
  individualId: string | null
  /** 发现时间（ISO-8601）。默认「现在」，可改 */
  observedAt: string
  /** 定位结果。坐标系由 `coordinateSystem` 声明 —— **不允许**默认 */
  point: LatLng
  coordinateSystem: CoordinateSystem
  mediaIds: string[]
  note: string
  healthConcern: boolean
  anonymous: boolean
  ethicsAcknowledged: boolean
  autoSpeciesId: string | null
  autoConfidence: number | null
  classifiedBy: ClassifiedBy
  zoneId: string | null
  accuracyM?: number
  /** 新建个体（规格 §5.6 (b)）—— 与 `individualId` 二选一 */
  newIndividualName?: string
}

export const EMPTY_SIGHTING_DRAFT: Omit<SightingDraft, 'point' | 'observedAt'> = {
  speciesId: null,
  individualId: null,
  coordinateSystem: 'wgs84',
  mediaIds: [],
  note: '',
  healthConcern: false,
  anonymous: false,
  ethicsAcknowledged: false,
  autoSpeciesId: null,
  autoConfidence: null,
  classifiedBy: 'manual',
  zoneId: null,
}

/** 发现时间是否在允许窗口内（契约 §11.10-A） */
export function isObservedAtInRange(observedAt: string, now: Date): boolean {
  const t = new Date(observedAt).getTime()
  if (Number.isNaN(t)) return false
  const earliest = now.getTime() - WILDLIFE_OBSERVED_AT_MAX_PAST_DAYS * 24 * 3_600_000
  const latest = now.getTime() + WILDLIFE_OBSERVED_AT_CLOCK_TOLERANCE_MINUTES * 60_000
  return t >= earliest && t <= latest
}

/**
 * 表单校验。**顺序有讲究**：先做坐标系归一化，再判校园范围 ——
 * 否则「GCJ-02 的点落在校园外」会被误报成坐标错误。
 */
export function validateSightingDraft(
  draft: SightingDraft,
  speciesList: readonly WildlifeSpecies[],
  now: Date,
): SightingDraftError[] {
  const errors: SightingDraftError[] = []

  if (draft.speciesId === null || draft.speciesId === '') {
    errors.push({
      field: 'speciesId',
      reason: 'SPECIES_REQUIRED',
      message: '请选择物种（自动识别不可用时也可以手动选择）',
    })
  } else if (findSpecies(speciesList, draft.speciesId) === undefined) {
    errors.push({
      field: 'speciesId',
      reason: 'UNKNOWN_SPECIES',
      message: '物种不在可选列表中，请重新选择',
    })
  }

  if (!isObservedAtInRange(draft.observedAt, now)) {
    errors.push({
      field: 'observedAt',
      reason: 'OBSERVED_AT_OUT_OF_RANGE',
      message: `发现时间需在最近 ${WILDLIFE_OBSERVED_AT_MAX_PAST_DAYS} 天内且不晚于当前时间`,
    })
  }

  // 坐标先归一化到 WGS84 再判定（规格 §3.2 的硬要求）
  const wgs84 = toApiPoint(draft.point, draft.coordinateSystem)
  if (!isInCampus(wgs84)) {
    errors.push({
      field: 'point',
      reason: 'COORDINATE_OUT_OF_CAMPUS',
      message: '坐标不在校园范围内（请确认是地图点选还是 GPS 定位）',
    })
  }

  if (!draft.ethicsAcknowledged) {
    errors.push({
      field: 'ethicsAcknowledged',
      reason: 'ETHICS_NOT_ACKNOWLEDGED',
      message: `请先勾选「${WILDLIFE_ETHICS_ACK_LABEL}」`,
    })
  }

  if (draft.mediaIds.length > WILDLIFE_MAX_PHOTOS) {
    errors.push({
      field: 'mediaIds',
      reason: 'TOO_MANY_PHOTOS',
      message: `最多上传 ${WILDLIFE_MAX_PHOTOS} 张照片`,
    })
  }

  if (!isLengthWithin(draft.note, 0, WILDLIFE_NOTE_MAX_LENGTH)) {
    errors.push({
      field: 'note',
      reason: 'NOTE_TOO_LONG',
      message: `备注不超过 ${WILDLIFE_NOTE_MAX_LENGTH} 字`,
    })
  }

  if (draft.accuracyM !== undefined && (draft.accuracyM <= 0 || draft.accuracyM > 10_000)) {
    errors.push({
      field: 'accuracyM',
      reason: 'INVALID_ACCURACY',
      message: '定位精度不合法',
    })
  }

  if (draft.newIndividualName !== undefined && draft.newIndividualName !== '') {
    const name = draft.newIndividualName
    if (
      !isLengthWithin(name, 1, WILDLIFE_INDIVIDUAL_NAME_MAX_LENGTH) ||
      containsLikelyPii(name)
    ) {
      errors.push({
        field: 'newIndividualName',
        reason: 'INDIVIDUAL_NAME_INVALID',
        message: `个体名字需 1–${WILDLIFE_INDIVIDUAL_NAME_MAX_LENGTH} 字，且不要包含学号 / 手机号等个人信息`,
      })
    }
  }

  return errors
}

/**
 * 草稿 → `POST /items` 请求体。
 *
 * ⚠️ **这是 GCJ-02 → WGS84 的唯一出口**：无论坐标来自地图点选（GCJ-02）
 * 还是 GPS（WGS84），这里都归一化成 WGS84 再上线。
 * 规格 §3.2 硬要求 5：GCJ-02 值**只在内存中短暂存在**，绝不上传、绝不入库。
 */
export function toCreateSightingBody(draft: SightingDraft): WildlifeSightingCreateBody {
  const wgs84 = toApiPoint(draft.point, draft.coordinateSystem)
  return {
    latitude: wgs84.lat,
    longitude: wgs84.lng,
    observedAt: draft.observedAt,
    speciesId: draft.speciesId,
    individualId: draft.individualId,
    mediaIds: [...draft.mediaIds],
    zoneId: draft.zoneId,
    healthConcern: draft.healthConcern,
    isAnonymous: draft.anonymous,
    autoSpeciesId: draft.autoSpeciesId,
    autoConfidence: draft.autoConfidence,
    classifiedBy: draft.classifiedBy,
    ethicsAcknowledged: draft.ethicsAcknowledged,
    ...(draft.note === '' ? {} : { note: draft.note }),
    ...(draft.accuracyM === undefined ? {} : { geoAccuracyM: draft.accuracyM }),
  }
}

/** 个体创建请求体（规格 §5.6 (b)） */
export function toIndividualCreateBody(
  name: string,
  speciesId: string,
  note?: string,
  photoMediaId?: string,
): WildlifeIndividualCreateBody {
  return {
    name: name.trim(),
    speciesId,
    ...(note === undefined || note === '' ? {} : { note }),
    ...(photoMediaId === undefined || photoMediaId === '' ? {} : { photoMediaId }),
  }
}

/* ------------------------------------------------------------------ *
 * 9. 物种筛选（地图页 / 列表页共用）
 * ------------------------------------------------------------------ */

/** `null` = 全部物种 */
export function filterBySpecies<T extends { speciesId: string | null }>(
  items: readonly T[],
  speciesId: string | null,
): T[] {
  if (speciesId === null) return [...items]
  return items.filter((item) => item.speciesId === speciesId)
}

export function zoneMatchesSpecies(zone: WildlifeZone, speciesId: string | null): boolean {
  if (speciesId === null) return true
  return zone.speciesIds.includes(speciesId)
}
