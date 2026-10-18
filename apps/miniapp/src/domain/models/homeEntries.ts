import { MODULES } from '@kedaya/contracts'

/**
 * 首页 / 服务大厅的**入口目录**（纯数据 + 纯函数，可在测试里直接断言）。
 *
 * 为什么需要这一层：契约 `MODULES` 是 20 个**业务模块**的注册表，但用户看到的
 * 「首页该有哪些格子」并不等于模块清单 —— 两者有两处真实的差别：
 *
 *   1. **聚合入口**：产品要求一级入口「凑凑」下设「拼单」和「找搭子」
 *      （见 `docs/architecture/07-groupbuy-campus-mvp.md` 的「凑凑入口」）。
 *      聚合入口不是契约模块，不能塞进 `MODULES`，否则三端都会被一个
 *      没有 API 路由的「模块」污染；
 *   2. **分组**：20 个模块平铺成一屏就是「功能太多」的直接来源。
 *      服务大厅按使用场景分组，首页只放用户自己挑的那几个。
 *
 * 因此本文件只做「契约模块 id ↔ 展示入口」的映射与分组，**不新造任何数据**：
 * 标签文案来自契约模块自身（`nameZh` / `summary`），这里只补图标、分组与聚合关系。
 * `__tests__/homeEntries.test.ts` 把「目录 ⊆ 契约」与「契约 ⊆ 目录」两个方向都锁住 ——
 * 契约新增模块却忘了登记入口，测试会红，而不是让新模块在服务大厅里凭空消失。
 */

/** 单个入口（聚合入口或契约模块入口） */
export interface HomeEntry {
  /** 入口 id：契约模块 id，或聚合入口 id（如 `cou`） */
  id: string
  /** 主标题 */
  label: string
  /** 一句话说明 */
  hint: string
  /**
   * 图标 id（仅影响外观，`presentation/components/KdyModuleIcon` 解析）。
   *
   * 与 `id` 分开：聚合入口 `cou` 想复用一个已有图标的观感，
   * 而不必在图标组件里为它写一条 `cou` 分支之外的语义。
   */
  icon: string
  /** 该入口覆盖的契约模块 id（聚合入口可覆盖多个） */
  moduleIds: readonly string[]
  /** 聚合入口的副标题（如「拼单 · 找搭子」）；普通入口为 null */
  subLabel: string | null
  /**
   * 固定入口：**用户不能把它从首页移除**。
   *
   * 两个：
   *   · `cou` —— 产品要求它是**一级入口**（拼单 + 找搭子），所以它既不能
   *     被用户自定义删掉，也不能像普通格子那样被排到后面去；
   *   · `wellbeing` —— 心理支持是安全出口，不能因为一次「自定义」误触
   *     就在首页上彻底消失（首页底部还有一条常驻热线行作为第二重兜底）。
   * 允许排序、不允许删除 —— 这是产品决定，不是权限。
   */
  locked: boolean
  /** 固定入口的原因，用于「不能移除」的提示文案（非固定入口为 `null`） */
  lockedReason: string | null
}

/** 服务大厅的分组 */
export interface HomeSection {
  id: string
  title: string
  entryIds: readonly string[]
}

/**
 * 聚合入口 —— 一个入口覆盖多个契约模块。
 *
 * ⚠️ 被聚合的模块**不再单独出现在目录里**（否则首页/服务大厅会出现
 * 「凑凑」和「拼单」两个都能进拼单的格子）。模块本身仍然是契约模块，
 * 仍然有独立的 API 路由与页面：它们从「凑凑」页进入。
 */
const AGGREGATES: readonly HomeEntry[] = [
  {
    id: 'cou',
    label: '凑凑',
    hint: '一个人凑不齐的，凑一凑就够了：拼单 + 找搭子。',
    icon: 'cou',
    moduleIds: ['groupbuy', 'buddy'],
    subLabel: '拼单 · 找搭子',
    locked: true,
    lockedReason: '一级入口',
  },
]

/** 被聚合覆盖的模块 id（从「模块入口」里排除，避免重复入口） */
const AGGREGATED_MODULE_IDS: readonly string[] = AGGREGATES.flatMap((entry) => entry.moduleIds)

/** 契约模块 → 入口（标签与说明直接取契约，避免两处文案漂移） */
const MODULE_ENTRIES: readonly HomeEntry[] = MODULES.filter(
  (module) => !AGGREGATED_MODULE_IDS.includes(module.id),
).map((module) => ({
  id: module.id,
  label: module.nameZh,
  hint: module.summary,
  icon: module.id,
  moduleIds: [module.id],
  subLabel: null,
  locked: module.id === 'wellbeing',
  lockedReason: module.id === 'wellbeing' ? '安全出口' : null,
}))

/** 全部入口（聚合入口在前，便于首页默认值里「凑凑」排在第一个） */
export const HOME_ENTRIES: readonly HomeEntry[] = [...AGGREGATES, ...MODULE_ENTRIES]

/**
 * 服务大厅分组。
 *
 * 顺序即展示顺序；每组内的顺序即组内展示顺序。**每个入口必须恰好属于一组**，
 * 由测试守住 —— 漏掉一个入口（新增模块时最容易发生）会直接红，
 * 而不是让它在服务大厅里静默消失。
 */
export const HOME_SECTIONS: readonly HomeSection[] = [
  {
    id: 'daily',
    title: '校园日常',
    entryIds: ['cou', 'flea-market', 'errand', 'lost-found', 'canteen', 'wildlife', 'schedule', 'campus-card'],
  },
  {
    id: 'community',
    title: '交流与互助',
    entryIds: ['forum', 'faq', 'dorm-harmony', 'takeout-guard', 'techpie'],
  },
  {
    id: 'care',
    title: '关怀与成长',
    entryIds: ['wellbeing', 'ai-portrait'],
  },
  {
    id: 'account',
    title: '账号与身份',
    entryIds: ['auth', 'profile', 'notifications'],
  },
  {
    id: 'soon',
    title: '尚未上线',
    entryIds: ['facility'],
  },
]

/**
 * 首页默认展示的入口。
 *
 * 只放 9 个：首页的价值是「最常用的那几个一眼可见」，
 * 全部 19 个入口平铺是这次要修掉的问题本身（服务大厅才是「全部」的家）。
 *
 * 顺序必须与 `normalizeHomeEntryIds` 的「固定入口置前」一致
 * （`cou` → `wellbeing` → 其余），否则「默认值 → 规范化」会改变顺序，
 * 用户会觉得"一进首页顺序就自己变了一次"。
 */
export const DEFAULT_HOME_ENTRY_IDS: readonly string[] = [
  'cou',
  'wellbeing',
  'canteen',
  'flea-market',
  'errand',
  'lost-found',
  'wildlife',
  'schedule',
  'campus-card',
]

/** 首页最多展示的入口数：再多就该去服务大厅了（4 列 × 3 行正好三屏内看完） */
export const MAX_HOME_ENTRY_IDS = 12

const BY_ID = new Map(HOME_ENTRIES.map((entry) => [entry.id, entry]))

export function homeEntryById(id: string): HomeEntry | undefined {
  return BY_ID.get(id)
}

export function isHomeEntryId(id: string): boolean {
  return BY_ID.has(id)
}

/** 固定入口 id（不可移除），顺序与目录一致 */
export const LOCKED_HOME_ENTRY_IDS: readonly string[] = HOME_ENTRIES.filter(
  (entry) => entry.locked,
).map((entry) => entry.id)

export function isLockedHomeEntry(id: string): boolean {
  return LOCKED_HOME_ENTRY_IDS.includes(id)
}

/**
 * 把「来自本地缓存 / 用户点击」的任意输入规范化成一份可用的首页入口列表。
 *
 * 这里是**唯一的校验点**：缓存可能来自旧版本（入口已改名 / 分组已调整），
 * 也可能被手工改坏，所以每次读取都过一遍，而不是相信缓存内容。
 *
 * 规则（按顺序）：
 *   1. 不是数组 → 用默认值（读缓存失败的常见形态，不该把首页清空）；
 *   2. 丢掉不认识的 id（旧缓存 / 契约删过的模块）；
 *   3. 去重；
 *   4. 固定入口**强制排在前面**（`cou` 与 `wellbeing` 永远在首页）；
 *   5. 截断到 `MAX_HOME_ENTRY_IDS`（先保固定入口，再按用户顺序）。
 *
 * 允许「只留固定入口」：用户明确清空自己的选择是一种意图，
 * 服务大厅与「全部服务」格仍然进得去，不该被强行塞回默认值。
 */
export function normalizeHomeEntryIds(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return DEFAULT_HOME_ENTRY_IDS

  const picked = raw.filter(
    (item): item is string => typeof item === 'string' && isHomeEntryId(item),
  )
  const ordered = [
    ...LOCKED_HOME_ENTRY_IDS,
    ...picked.filter((id) => !isLockedHomeEntry(id)),
  ]

  return [...new Set(ordered)].slice(0, MAX_HOME_ENTRY_IDS)
}

/** 尚未出现在首页的入口（按目录顺序），用于「首页管理」页的「可添加」列表 */
export function addableHomeEntryIds(selected: readonly string[]): readonly string[] {
  const chosen = new Set(selected)
  return HOME_ENTRIES.filter((entry) => !chosen.has(entry.id)).map((entry) => entry.id)
}

/**
 * 搜索：服务大厅的检索只按**标签与说明**匹配，不猜语义。
 *
 * 空串返回全部；大小写不敏感（`TechPie` 这类英文名也要能被小写命中）。
 */
export function searchHomeEntryIds(keyword: string): readonly string[] {
  const needle = keyword.trim().toLowerCase()
  if (needle === '') return HOME_ENTRIES.map((entry) => entry.id)

  return HOME_ENTRIES.filter((entry) =>
    [entry.label, entry.hint, entry.subLabel ?? ''].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  ).map((entry) => entry.id)
}
