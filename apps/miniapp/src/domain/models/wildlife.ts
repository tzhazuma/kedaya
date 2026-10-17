import { formatRelativeTime } from '@kedaya/shared'

/**
 * 校园动物观察点（`wildlife`，契约 §4「猫鸟黑天鹅」）领域模型 —— 纯 TypeScript，
 * 零框架依赖（契约 §7）。
 *
 * 与后端 `services/api/src/modules/wildlife/` 逐条对齐，三件事必须一起读：
 *
 *   1. **字段**与 `domain/wildlife.domain.ts` 的 `WildlifeSpotModel` 一一对应
 *      （`species` / `place` / `lat` / `lng` / `note` / `reportedBy` / `status` + 时间戳），
 *      时间一律用 ISO 字符串传输。
 *   2. **`status` 是自由字符串，这里不建白名单**。后端 Prisma 默认写 `active`，
 *      `POST /items/:id/confirm` 写 `confirmed`，但后端没有把取值收紧成 enum，
 *      所以客户端只做一件确定的事：认出 `confirmed`，其它一律按「待确认」展示。
 *      —— 编一份"合法状态表"放进客户端，等于凭空造出后端的规则。
 *   3. **本模块匿名**：后端 `create` 刻意忽略登录主体（`reportedBy` 保持请求体里
 *      的值，客户端不发），因此客户端没有「我上报的」这类归属概念，
 *      也就没有编辑 / 删除动作。观察点是**大家共建的公共信息**，
 *      `confirm` 改的是共享状态而不是"我的标记"。
 *
 * 规则与文案集中在这一个文件里，用例、mock 仓储与三个页面共用同一份判定，
 * 避免各写一遍之后悄悄漂移。
 */

/** 文字上限：与后端 `wildlife.controller.ts` 的 `createSchema`（500/500/500）逐字一致 */
export const WILDLIFE_SPECIES_MAX = 500
export const WILDLIFE_PLACE_MAX = 500
export const WILDLIFE_NOTE_MAX = 500

/** `confirm` 写入的状态字面量（后端 `wildlife.service.ts` 里同一个值） */
export const WILDLIFE_STATUS_CONFIRMED = 'confirmed'

export const WILDLIFE_STATUS_LABELS = {
  pending: '待确认',
  confirmed: '已确认',
} as const

/**
 * 建议物种 —— **只是输入建议与筛选兜底候选，不是后端词典**。
 *
 * 后端没有物种字典（`species` 是自由文本），所以这些值**不参与任何校验**：
 * 同学写「橘猫」「中华田园犬」「不知道什么鸟」都应该能上报成功。
 * 列在这里的唯一目的是让第一次来的人不用凭空想一个词。
 */
export const WILDLIFE_SPECIES_SUGGESTIONS: readonly string[] = [
  '橘猫',
  '三花猫',
  '狸花猫',
  '黑天鹅',
  '白鹭',
  '喜鹊',
  '松鼠',
]

/** 筛选胶囊最多显示多少个（再多就成一堵墙了；筛选是辅助，不是目录） */
export const WILDLIFE_SPECIES_OPTION_LIMIT = 12

/**
 * 校园中心（上科大），与 `services/api/prisma/seed.ts` 的观察点、
 * 拼单详情页的 `CAMPUS_POINT` 落在同一片区域。
 *
 * 用途只有一个：上报时坐标留空的**兜底**。它不是"精确位置"，
 * 页面上必须如实说明（平台当前没有「获取当前位置」能力）。
 */
export const WILDLIFE_CAMPUS_CENTER = {
  latitude: 31.179_431,
  longitude: 121.592_605,
  name: '上海科技大学',
} as const

/**
 * 列表顶部的**固定**保护提示。
 *
 * 不做成醒目横幅（那会让整页看起来像告警），但必须是常驻的一句话：
 * 校园动物的最大伤害来自投喂和追拍，而不是来自"看不到它们在哪儿"。
 */
export const WILDLIFE_GUARD_HINT = '观察不打扰，请勿投喂'

/** 领域模型：字段与后端 `WildlifeSpotModel` 一一对应，时间以 ISO 字符串传输 */
export interface WildlifeSpot {
  id: string
  /** 物种（自由文本，后端没有字典） */
  species: string
  /** 观察地点（校园里能认出来的名字，例如「图书馆后门」） */
  place: string
  /** 纬度（gcj02，与微信 `openLocation` 同一坐标系） */
  lat: number
  /** 经度（gcj02） */
  lng: number
  note: string | null
  /** 上报者；本模块匿名，通常为 null */
  reportedBy: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export interface CreateWildlifeSpotInput {
  species: string
  place: string
  lat: number
  lng: number
  note?: string | null
}

/**
 * 列表筛选条件。
 *
 * 只有一个维度，和后端 `listQuerySchema` 一样：`status` 在后端是自由字符串，
 * 没有白名单就先不做筛选条件（见文件头第 2 条）。
 */
export interface WildlifeSpotFilters extends Record<string, unknown> {
  /** 物种包含匹配（后端 `contains` + `mode: 'insensitive'`） */
  species?: string
}

/** 卡片 / 列表直接可读的派生视图 —— UI 不再自己算文案与格式 */
export interface WildlifeSpotSummary {
  id: string
  species: string
  place: string
  /** 备注前 60 字（列表预览用） */
  notePreview: string
  /** 上报时间相对文案 */
  createdLabel: string
  confirmed: boolean
  statusLabel: string
  /** `31.17943, 121.59261`（页面直接展示，不重复实现格式化） */
  coordinateLabel: string
  latitude: number
  longitude: number
}

/** 是否已被确认（只认 `confirmed`，其它值一律按未确认处理） */
export function isConfirmed(status: string): boolean {
  return status === WILDLIFE_STATUS_CONFIRMED
}

export function statusLabel(status: string): string {
  return isConfirmed(status) ? WILDLIFE_STATUS_LABELS.confirmed : WILDLIFE_STATUS_LABELS.pending
}

/**
 * 坐标格式化：只在经纬度真的是有限数字时才格式化。
 *
 * 为什么容忍非法值而不是直接崩：列表可能来自**旧版本缓存的载荷**，
 * 缓存守卫只校验到"items 是数组"。一个坏条目应该是显示成 `—`，
 * 而不是让整个列表页白屏。
 */
export function formatCoordinate(latitude: number, longitude: number): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '—'
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
}

export function summarize(item: WildlifeSpot, now: Date): WildlifeSpotSummary {
  return {
    id: item.id,
    species: item.species,
    place: item.place,
    notePreview: (item.note ?? '').slice(0, 60),
    createdLabel: formatRelativeTime(item.createdAt, now),
    confirmed: isConfirmed(item.status),
    statusLabel: statusLabel(item.status),
    coordinateLabel: formatCoordinate(item.lat, item.lng),
    latitude: item.lat,
    longitude: item.lng,
  }
}

/**
 * 物种筛选胶囊的候选值。
 *
 * 两个来源，顺序有意义：
 *   1. `active` —— 当前选中的筛选值。**必须**留在候选里，否则用户一旦选中它，
 *      这个胶囊就从列表里消失，想点回「全部」之外再无退路；
 *   2. `loaded` —— 列表里**已经出现过的**物种。同学当下最可能想点的就是
 *      自己刚刚在屏幕上看到的那个物种，所以它优先于下面的通用建议；
 *   3. `WILDLIFE_SPECIES_SUGGESTIONS` —— 兜底建议（数据为空时也不至于无选项）。
 *
 * 去重按 trim 后的文本；超过 `WILDLIFE_SPECIES_OPTION_LIMIT` 就截断。
 */
export function mergeSpeciesOptions(loaded: readonly string[], active?: string): string[] {
  const seen = new Set<string>()
  const options: string[] = []

  const push = (value: string): void => {
    const text = value.trim()
    if (text === '' || seen.has(text)) return
    seen.add(text)
    options.push(text)
  }

  if (active !== undefined) push(active)
  for (const species of loaded) {
    if (options.length >= WILDLIFE_SPECIES_OPTION_LIMIT) break
    push(species)
  }
  for (const species of WILDLIFE_SPECIES_SUGGESTIONS) {
    if (options.length >= WILDLIFE_SPECIES_OPTION_LIMIT) break
    push(species)
  }

  return options
}

/* ------------------------------------------------------------------ *
 * 校验（纯函数，用例、mock 仓储与页面共用同一份文案）
 * ------------------------------------------------------------------ */

export function speciesProblem(species: string): string | null {
  const text = species.trim()
  if (text.length === 0) return '请填写动物种类'
  if ([...text].length > WILDLIFE_SPECIES_MAX) {
    return `动物种类最多 ${WILDLIFE_SPECIES_MAX} 个字`
  }
  return null
}

export function placeProblem(place: string): string | null {
  const text = place.trim()
  if (text.length === 0) return '请填写观察地点'
  if ([...text].length > WILDLIFE_PLACE_MAX) return `观察地点最多 ${WILDLIFE_PLACE_MAX} 个字`
  return null
}

/** 选填长文本：空串等价于「没填」（与后端 `normalizeText` 的 null 一致） */
export function noteProblem(note: string): string | null {
  if ([...note.trim()].length > WILDLIFE_NOTE_MAX) return `备注最多 ${WILDLIFE_NOTE_MAX} 个字`
  return null
}

/**
 * 坐标文本 → 数字；没填返回 null。
 *
 * 必须先判空串再 `Number()`：`Number('')` 是 0，直接转换会把「没填」
 * 变成「格林尼治附近的 0,0」—— 一个看起来很像真的错误坐标。
 */
export function parseCoordinate(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/**
 * 坐标校验。返回 `null` 表示可以提交。
 *
 * 产品选择（页面上要如实说明）：平台**没有**「获取当前位置」能力，
 * 所以坐标是可选手填；两个都留空就用校园中心兜底（用于地图定位，
 * 不是精确定位）。但只填一个是没有意义的 —— 那既不是"没填"，
 * 也点不开一个正确的地图位置。
 */
export function coordinateProblem(latitudeText: string, longitudeText: string): string | null {
  const latitudeBlank = latitudeText.trim() === ''
  const longitudeBlank = longitudeText.trim() === ''

  if (latitudeBlank && longitudeBlank) return null
  if (latitudeBlank !== longitudeBlank) return '经纬度要么都填，要么都留空（默认用校园中心）'

  const latitude = parseCoordinate(latitudeText)
  const longitude = parseCoordinate(longitudeText)
  if (latitude === null || longitude === null) return '经纬度请填数字，例如 31.17943'
  if (latitude < -90 || latitude > 90) return '纬度要在 -90 到 90 之间'
  if (longitude < -180 || longitude > 180) return '经度要在 -180 到 180 之间'
  return null
}

/**
 * 草稿 → 真正要提交的坐标。
 *
 * 走到这里时 `coordinateProblem` 已经放行，但这里仍然兜底回校园中心：
 * 绝不把 `NaN` 或 `0,0` 写进库（错坐标比"大概位置"更糟 —— 它会把人指到海里去）。
 */
export function resolveCoordinate(
  latitudeText: string,
  longitudeText: string,
): { latitude: number; longitude: number } {
  const latitude = parseCoordinate(latitudeText)
  const longitude = parseCoordinate(longitudeText)
  if (latitude === null || longitude === null) {
    return {
      latitude: WILDLIFE_CAMPUS_CENTER.latitude,
      longitude: WILDLIFE_CAMPUS_CENTER.longitude,
    }
  }
  return { latitude, longitude }
}
