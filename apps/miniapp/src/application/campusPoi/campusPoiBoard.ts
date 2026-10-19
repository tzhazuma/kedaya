import {
  CAMPUS_POI_CATEGORIES,
  nextSlotAt,
  poiToMapMarker,
  type CampusPoiCategory,
  type CampusPoiSupplement,
  type CampusPoiTone,
  type PoiTimeSlot,
  type PoiTimeSlotKind,
} from '@kedaya/contracts'
import { DEFAULT_SCHOOL_TIME_ZONE, formatRelativeTime } from '@kedaya/shared'

import { buildCampusPoiDemo, isDemoPoi } from './campusPoiDemo'

/**
 * 校园 POI 页的用例（**本机数据，不碰网络**）。
 *
 * ## 为什么这一轮只有 storage
 *
 * 契约 `campus-poi.ts` 已经冻结了 POI 补充层与时间安排，但 `services/` 里
 * 还没有对应的后端模块。于是这一版把数据放在微信 storage：
 *   · 没有存储时播种 **5 条演示数据**（`campusPoiDemo.ts`，名字带「【演示】」）；
 *   · 读取时由仓储层逐条过 `validatePoiSupplement()`，坏数据 / 禁止来源的照片
 *     直接丢弃，页面不会因为一条脏缓存白屏；
 *   · 页面不演「同步失败 / 正在拉取」—— 没有网络请求就没有网络失败态。
 *
 * 等后端接口到位时，替换的是 `store` 的实现与这里多一个 `load()`，
 * 视图模型与页面不用动。
 *
 * ## 视图模型为什么在 application
 *
 * 「楼层怎么显示（负数 → B1）」「下一站是哪个安排」「下一站还有多久」
 * 都是纯计算，放在页面里只能靠肉眼验收。这里是纯函数，单测可以喂固定 `now`。
 */

/** 本机存储端口 —— 由 `data/repositories/campusPoiLocalRepository` 实现。 */
export interface CampusPoiStore {
  readPois(): CampusPoiSupplement[]
  readSlots(): PoiTimeSlot[]
  writePois(pois: readonly CampusPoiSupplement[]): void
  writeSlots(slots: readonly PoiTimeSlot[]): void
}

export interface CampusPoiBoardState {
  /** `idle` = 还没读过本机（页面画 loading）；读完即 `ready`（可能是空列表） */
  status: 'idle' | 'ready'
  pois: readonly CampusPoiSupplement[]
  slots: readonly PoiTimeSlot[]
  /** 当前列表里是否含演示数据（页面据此显示「不是真实采集」横幅） */
  demo: boolean
}

export interface CampusPoiBoardUseCase {
  getSnapshot(): CampusPoiBoardState
  subscribe(listener: () => void): () => void
  /**
   * 同步读本机（契约 §8 第 1 步）。
   *
   * 每次调用都会重读：演示数据被清掉后会重新播种，页面从别的入口返回时
   * 也能立刻看到 storage 的最新内容。幂等，不重复写已有数据。
   */
  hydrate(): CampusPoiBoardState
}

export interface CampusPoiBoardDeps {
  store: CampusPoiStore
  /** 注入时钟便于单测；默认 `() => new Date()` */
  now?: () => Date
}

const INITIAL_STATE: CampusPoiBoardState = {
  status: 'idle',
  pois: [],
  slots: [],
  demo: false,
}

export function createCampusPoiBoardUseCase(deps: CampusPoiBoardDeps): CampusPoiBoardUseCase {
  const { store } = deps
  const now = deps.now ?? (() => new Date())

  let state: CampusPoiBoardState = INITIAL_STATE
  const listeners = new Set<() => void>()

  function patch(next: CampusPoiBoardState): CampusPoiBoardState {
    state = next
    for (const listener of listeners) listener()
    return state
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    hydrate(): CampusPoiBoardState {
      let pois = store.readPois()
      let slots = store.readSlots()

      if (pois.length === 0) {
        const seeded = buildCampusPoiDemo(now())
        store.writePois(seeded.pois)
        store.writeSlots(seeded.slots)
        pois = [...seeded.pois]
        slots = [...seeded.slots]
      }

      return patch({
        status: 'ready',
        pois,
        slots,
        demo: pois.some(isDemoPoi),
      })
    },
  }
}

/* ------------------------------------------------------------------ *
 * 视图模型（纯函数）
 * ------------------------------------------------------------------ */

export type CampusPoiCategoryFilter = CampusPoiCategory | 'all'

/** 一条「下一站」—— `nextSlotAt()` 的展示投影 */
export interface CampusPoiNextSlotView {
  readonly slotId: string
  readonly title: string
  readonly kind: PoiTimeSlotKind
  /** 「10月19日 周一 14:30」（学校时区） */
  readonly whenLabel: string
  /** 「30 分钟后」/「正在进行」 */
  readonly relativeLabel: string
  readonly startsAt: string
}

/** POI 列表行的视图模型 */
export interface CampusPoiRowView {
  readonly id: string
  readonly name: string
  readonly category: CampusPoiCategory
  /** 来自契约 `CAMPUS_POI_CATEGORY_LABELS`（经 `poiToMapMarker`） */
  readonly categoryLabel: string
  /** 语义色调名（不写 hex，渲染层查 `KdyTag` 的 tone） */
  readonly tone: CampusPoiTone
  /** 「B1」/「地面层」/「3 层」/「楼层待核实」 */
  readonly floorLabel: string
  readonly openingHoursLabel: string
  readonly description: string | null
  /** 是否有已授权照片（无照片时页面画占位，不塞图） */
  readonly hasPhotos: boolean
  /** 只取第一张已授权照片；没有则为 `null` */
  readonly photoUrl: string | null
  /** 有照片时的拍摄者署名（版权合规要求随图出现） */
  readonly photoCredit: string | null
  readonly nextSlot: CampusPoiNextSlotView | null
}

/** 「下一站」卡片的一行：每个地点一条（没有安排的也要出现，并说明原因） */
export interface CampusPoiNextStopView {
  readonly poiId: string
  readonly poiName: string
  readonly categoryLabel: string
  readonly tone: CampusPoiTone
  readonly hasSlot: boolean
  readonly slotTitle: string
  readonly whenLabel: string
  readonly relativeLabel: string
  /** 排序用；没有安排的是 `null`（沉到最后） */
  readonly startsAt: string | null
}

const SLOT_KIND_LABELS: Readonly<Record<PoiTimeSlotKind, string>> = {
  course: '课程',
  event: '活动',
  exam: '考试',
  personal: '个人安排',
}

export function poiSlotKindLabel(kind: PoiTimeSlotKind): string {
  return SLOT_KIND_LABELS[kind]
}

/**
 * 楼层展示：负数 → `B1/B2`，地面层 → `地面层`，未知 → `楼层待核实`。
 *
 * 契约只允许车库出现负楼层（`CAMPUS_POI_NEGATIVE_FLOOR_CATEGORIES`），
 * 这里不再重复判断分类 —— 数据入库前已经拦过一次，页面只负责显示。
 */
export function formatPoiFloor(floor: number | null): string {
  if (floor === null || !Number.isInteger(floor)) return '楼层待核实'
  if (floor < 0) return `B${Math.abs(floor)}`
  if (floor === 0) return '地面层'
  return `${floor} 层`
}

/** 开放时间：契约不解析它，页面只把原文显示出来；缺失时明说没核实 */
export function formatPoiOpeningHours(openingHours: string | null): string {
  const trimmed = openingHours?.trim() ?? ''
  return trimmed === '' ? '待核实' : trimmed
}

/**
 * 时间片段 → 学校时区的展示文案。
 *
 * 与课表 / DDL 同一套口径：`Intl.DateTimeFormat` 的 `timeZone` 显式指定
 * `Asia/Shanghai`，不跟着设备时区漂。时间不可解析时返回「时间待定」。
 */
export function formatPoiSlotTime(
  iso: string,
  timeZone: string = DEFAULT_SCHOOL_TIME_ZONE,
): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '时间待定'

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))

  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''

  return `${pick('month')}月${pick('day')}日 ${pick('weekday')} ${pick('hour')}:${pick('minute')}`
}

/**
 * 「还有多久」——进行中的安排显示「正在进行」，而不是「20 分钟前」。
 *
 * `nextSlotAt()` 把**正在进行**的安排也算下一站（不会跳过一堂还在上的课），
 * 所以这里必须单独处理 `startsAt <= now < endsAt`，否则文案会看起来像过期了。
 */
export function formatPoiSlotRelative(slot: PoiTimeSlot, now: Date): string {
  const start = Date.parse(slot.startsAt)
  const end = Date.parse(slot.endsAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '时间待定'
  if (start <= now.getTime() && now.getTime() < end) return '正在进行'
  return formatRelativeTime(slot.startsAt, now)
}

function toNextSlotView(
  poi: CampusPoiSupplement,
  slots: readonly PoiTimeSlot[],
  now: Date,
): CampusPoiNextSlotView | null {
  const slot = nextSlotAt(poi, slots, now)
  if (slot === null) return null

  return {
    slotId: `${slot.poiId}:${slot.startsAt}:${slot.title}`,
    title: slot.title,
    kind: slot.kind,
    whenLabel: formatPoiSlotTime(slot.startsAt),
    relativeLabel: formatPoiSlotRelative(slot, now),
    startsAt: slot.startsAt,
  }
}

/** 一条 POI → 列表行。分类标签与 tone 一律来自 `poiToMapMarker()`。 */
export function buildCampusPoiRow(
  poi: CampusPoiSupplement,
  slots: readonly PoiTimeSlot[],
  now: Date,
): CampusPoiRowView {
  const marker = poiToMapMarker(poi)
  const photoUrl = marker.hasPhotos ? (poi.photoUrls[0] ?? null) : null

  return {
    id: marker.id,
    name: marker.label,
    category: marker.category,
    categoryLabel: marker.categoryLabel,
    tone: marker.tone,
    floorLabel: formatPoiFloor(poi.floor),
    openingHoursLabel: formatPoiOpeningHours(poi.openingHours),
    description: poi.description,
    hasPhotos: marker.hasPhotos,
    photoUrl,
    photoCredit: marker.photoCredit,
    nextSlot: toNextSlotView(poi, slots, now),
  }
}

/** 按分类筛选 + 投影成列表行；`all` 不过滤。 */
export function buildCampusPoiRows(
  pois: readonly CampusPoiSupplement[],
  slots: readonly PoiTimeSlot[],
  now: Date,
  category: CampusPoiCategoryFilter = 'all',
): CampusPoiRowView[] {
  return pois
    .filter((poi) => category === 'all' || poi.category === category)
    .map((poi) => buildCampusPoiRow(poi, slots, now))
}

/**
 * 每个地点的「下一站」。
 *
 * 排序：有时间安排的按开始时间升序，没有安排的沉到最后（按名字稳定排序）。
 * **每个地点都会出现**（没有安排时 `hasSlot: false`），这样卡片回答的是
 * 「每个地点接下来有什么」而不是「碰巧有安排的那几个」。
 */
export function buildCampusPoiNextStops(
  pois: readonly CampusPoiSupplement[],
  slots: readonly PoiTimeSlot[],
  now: Date,
): CampusPoiNextStopView[] {
  const rows: CampusPoiNextStopView[] = pois.map((poi) => {
    const marker = poiToMapMarker(poi)
    const slot = nextSlotAt(poi, slots, now)

    if (slot === null) {
      return {
        poiId: marker.id,
        poiName: marker.label,
        categoryLabel: marker.categoryLabel,
        tone: marker.tone,
        hasSlot: false,
        slotTitle: '暂无安排',
        whenLabel: '—',
        relativeLabel: '没有挂在它上面的安排',
        startsAt: null,
      }
    }

    return {
      poiId: marker.id,
      poiName: marker.label,
      categoryLabel: marker.categoryLabel,
      tone: marker.tone,
      hasSlot: true,
      slotTitle: slot.title,
      whenLabel: formatPoiSlotTime(slot.startsAt),
      relativeLabel: formatPoiSlotRelative(slot, now),
      startsAt: slot.startsAt,
    }
  })

  return rows.sort((a, b) => {
    if (a.startsAt === null && b.startsAt === null) return a.poiName < b.poiName ? -1 : 1
    if (a.startsAt === null) return 1
    if (b.startsAt === null) return -1

    const diff = Date.parse(a.startsAt) - Date.parse(b.startsAt)
    if (diff !== 0) return diff
    return a.poiName < b.poiName ? -1 : 1
  })
}

/**
 * 数据里实际出现过的分类（按契约顺序）。
 *
 * 筛选器只显示有数据的分类：一个点进去必然空的胶囊，是「筛选坏了」的假信号。
 */
export function campusPoiCategoriesPresent(
  pois: readonly CampusPoiSupplement[],
): CampusPoiCategory[] {
  return CAMPUS_POI_CATEGORIES.filter((category) =>
    pois.some((poi) => poi.category === category),
  )
}
