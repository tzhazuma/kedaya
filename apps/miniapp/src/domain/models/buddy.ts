/**
 * 找搭子（`buddy`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 上游：
 * - 功能规格 `docs/features/buddy-matching.md`（§2 领域模型 / §3 匹配算法 / §5 API / §6 隐私）
 * - 冻结契约 `docs/architecture/00-FROZEN-CONTRACT.md`
 *   §6.1 信封与 CRUD 形状 / §9 隐私 / §11.2 动作名 / §11.10-D joinedCount / §11.10-G 三板块
 *
 * ⚠️ **本文件承担本模块最容易出错的两件事**：
 *
 * 1. **封闭标签表（规格 §3.2）**：`interestTags` / `activityTags` / `BuddyPost.tags`
 *    **一律取自服务端维护的封闭标签表**，不允许自由文本进入匹配特征。
 *    理由是自由文本会让「羽毛球」/「打羽毛球」/「badminton」互不匹配 ——
 *    共同标签数是本模块最精确、最可解释的特征，一旦被自由文本污染就彻底失效。
 *    因此客户端只有 [validateTagKeys] 一个入口，页面**不得**自己拼标签。
 *
 * 2. **可用时段（规格 §3.3 F7）**：时段重叠是**硬过滤**，判定必须与服务端同源
 *    （`@kedaya/shared` 的 `overlapsAvailability`）。跨零点的活动
 *    （`end > 1440`）必须按**次日**处理 —— 只比当天时段会漏掉「明明有空却被过滤掉」。
 *
 * 匹配打分（`ruleScoreFor` / `explainMatch` / `feedbackAdjustment`）**不在本文件**：
 * 它们是三端共用的纯函数，已存在于 `@kedaya/shared`。客户端必须用同一套，
 * 否则用户看到的推荐理由会与服务端排序不一致。
 */

import {
  formatRelativeTime,
  isLengthWithin,
  overlapsAvailability,
  zonedDowAndMinute,
} from '@kedaya/shared'
import type { AvailabilitySlot, BuddySection } from '@kedaya/shared'
import { BUDDY_TAGS as BUDDY_TAGS_SOURCE } from '@kedaya/contracts'

/* ------------------------------------------------------------------ *
 * 1. 板块与活动类型（规格 §2.3 / 契约 §11.10-G）
 * ------------------------------------------------------------------ */

export type { BuddySection }

/** 三板块。**刻意没有 `dating`** —— 契约 §11.10-G 裁决不做。 */
export const BUDDY_SECTIONS: readonly BuddySection[] = ['academic', 'daily', 'sport']

export const BUDDY_SECTION_LABELS: Readonly<Record<BuddySection, string>> = {
  academic: '学术自习',
  daily: '日常搭子',
  sport: '运动组队',
}

export const BUDDY_SECTION_DESCRIPTIONS: Readonly<Record<BuddySection, string>> = {
  academic: '自习、刷题、赶 DDL、课程互助',
  daily: '吃饭、出行、拼车、逛超市',
  sport: '球类、跑步、健身、游泳',
}

/** `BuddyPost.activity`（契约 `02-domain-model.md` §2.3 已冻结） */
export type BuddyActivity = 'sport' | 'study' | 'meal' | 'travel' | 'game' | 'other'

export const BUDDY_ACTIVITIES: readonly BuddyActivity[] = [
  'sport',
  'study',
  'meal',
  'travel',
  'game',
  'other',
]

export const BUDDY_ACTIVITY_LABELS: Readonly<Record<BuddyActivity, string>> = {
  sport: '运动',
  study: '自习',
  meal: '吃饭',
  travel: '出行',
  game: '游戏',
  other: '其它',
}

/**
 * `activity` → `section` 的**唯一**映射（规格 §2.3 表 / 验收 T2）。
 *
 * ⚠️ `BuddyPost` **不存** `section` 字段 —— 板块由 `activity` 派生，
 * 避免同一信息两处存储导致不一致。页面与用例一律调用本函数，不得自己判断。
 */
export function sectionOf(activity: BuddyActivity): BuddySection {
  switch (activity) {
    case 'study':
      return 'academic'
    case 'sport':
    case 'game':
      return 'sport'
    case 'meal':
    case 'travel':
    case 'other':
      return 'daily'
    default:
      // 穷尽性：新增 activity 会在这里编译报错
      throw new Error(`sectionOf: 未知活动类型 ${String(activity)}`)
  }
}

/** 板块内的活动类型（用于发布页联动筛选） */
export function activitiesOf(section: BuddySection): BuddyActivity[] {
  return BUDDY_ACTIVITIES.filter((activity) => sectionOf(activity) === section)
}

/* ------------------------------------------------------------------ *
 * 2. 封闭标签表（规格 §3.2）
 * ------------------------------------------------------------------ */

/** 标签分组，供 UI 分栏（规格 §3.2 表） */
export type BuddyTagGroup = 'sport' | 'study' | 'meal' | 'travel' | 'interest'

export const BUDDY_TAG_GROUP_LABELS: Readonly<Record<BuddyTagGroup, string>> = {
  sport: '运动',
  study: '学习',
  meal: '吃饭',
  travel: '出行',
  interest: '兴趣',
}

export const BUDDY_TAG_GROUPS: readonly BuddyTagGroup[] = [
  'sport',
  'study',
  'meal',
  'travel',
  'interest',
]

export interface BuddyTag {
  /** 机器值（唯一），例如 `badminton` */
  key: string
  /** 中文显示名，例如 `羽毛球` */
  label: string
  group: BuddyTagGroup
  /**
   * 别名词表，**仅用于搜索**，不用于匹配（规格 §3.2）。
   * 可选 —— 与**服务端** `BuddyTagDef.aliases?: readonly string[]` 保持一致，
   * 这样本文件可以逐行 diff 服务端的权威表（多一个必填字段会让 diff 全是噪声）。
   */
  aliases?: readonly string[]
  /** 下架标签不删除（历史数据仍引用） */
  isActive: boolean
}

/**
 * 封闭标签表（服务端权威表的**逐字镜像**）。
 *
 * 权威来源是服务端 `services/api/src/modules/buddy/domain/tags.ts` 的
 * `BUDDY_TAGS`（62 项，服务端用它做 `UNKNOWN_TAG:<key>` 校验）。这份副本有两个用途：
 *
 * 1. mock 模式下的数据源（无后端也能跑，契约 §7 硬规则 4）；
 * 2. 真后端标签表拉取失败时的**只读兜底** —— 让用户至少能从已知标签里选，
 *    而不是被迫输入自由文本（自由文本是本模块明确要杜绝的）。
 *
 * ## ⚠️ 为什么必须逐字镜像服务端，而不是"自己维护一份差不多的"
 *
 * 客户端一旦提供**服务端不认**的 key，用户点了一个看起来完全正常的标签，
 * 提交时却收到 `UNKNOWN_TAG:xxx` —— 这是最难排查的一类问题（UI 与后端各说各话）。
 * 本端初版凭规格文字自拟了 37 个 key，其中 `fitness` / `airport-pickup` /
 * `grocery` / `badminton-indoor` / `course-help` / `paper-reading` / `dating-night`
 * **在服务端表里并不存在**；同时服务端有 33 个 key 本端没有。
 * 现已改为从服务端表逐字复制（见交付说明的「跨端标签表漂移」一项）。
 *
 * ## 与 `GET /api/v1/buddy/tags` 的关系
 *
 * ⚠️ 规格 §3.2 说标签表"存在 DB（可运营）"，契约 §11.11 也允许
 * `GET /<mod>/<collection>`。但**服务端当前并未提供该端点**
 * （`buddy.controller.ts` 的路由表里没有 `tags`）。因此：
 * - 真后端模式下 `listTags()` 会 404 → 用例层**回落到本副本**并如实提示；
 * - 建议服务端补 `GET /buddy/tags`（§11.11 形状，无需登记动作名）。
 *
 * ⚠️ 新增/下架标签必须走服务端 migration + 审计（规格 §3.2），
 * 这里的副本只应作为**同步镜像**更新，不得成为第二真相。
 */
/**
 * 封闭标签表 —— **来自唯一真相 `@kedaya/contracts`**。
 *
 * ⚠️ 这里**不再自己维护数据**。收敛前四端各有一份且互不相同
 * （服务端 62 / 小程序 62 / **Web 46**），后果是 **Web 用户选到的标签会被后端
 * `UNKNOWN_TAG` 拒**。根因不是"某端少写了几条"，而是**没有唯一真相** ——
 * 所以修法是收敛到一处，而不是把 Web 补成 62 条（那样下次加标签还会漂移）。
 *
 * Dart 端无法 import TS，沿用 `tokens` 的做法：TS 是真相，Dart 由脚本生成镜像。
 */
export const BUDDY_TAGS: readonly BuddyTag[] = BUDDY_TAGS_SOURCE.map((tag) => ({
  key: tag.key,
  label: tag.label,
  group: tag.group,
  aliases: tag.aliases,
  // 唯一真相里 `isActive` 缺省即"上架"
  isActive: tag.isActive !== false,
}))

/**
 * 本端镜像里的**可用**标签（下架项已剔除）。
 *
 * 用途：真后端模式下 `GET /buddy/tags` **当前不存在**（服务端路由表里没有它），
 * 拉取会 404。此时用例层回落到本函数而不是把标签列表清空 ——
 * 因为镜像就是服务端权威表的逐字副本，用它选出来的 key 服务端一定认。
 *
 * ⚠️ 这与"自由输入"是两件相反的事：回落的是**封闭表**，不是文本框。
 */
export function activeBuddyTags(): BuddyTag[] {
  return BUDDY_TAGS.filter((tag) => tag.isActive).map((tag) => ({ ...tag }))
}

/** 标签 key → 标签；未登记返回 `null` */
export function findBuddyTag(key: string): BuddyTag | null {
  return BUDDY_TAGS.find((tag) => tag.key === key) ?? null
}

/** 标签 key → 中文显示名（未登记时**原样返回 key**，便于排查而不是显示空白） */
export function buddyTagLabel(key: string): string {
  return findBuddyTag(key)?.label ?? key
}

/** 仅用于搜索的匹配：命中 key / label / aliases 任一即算命中（规格 §3.2） */
export function matchesTagQuery(tag: BuddyTag, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return (
    tag.key.toLowerCase().includes(needle) ||
    tag.label.includes(query.trim()) ||
    (tag.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle))
  )
}

/** 标签校验失败原因（与规格 §5.4 的 `details.reason` 对齐） */
export interface TagValidationError {
  /** 未登记的 key（自由文本会落在这里） */
  unknown: string[]
  /** 已下架的 key */
  inactive: string[]
  /** 超出数量上限 */
  overflow: boolean
  /** 供 UI 直接展示的中文文案；通过时为 `null` */
  message: string | null
}

export interface TagValidationResult {
  ok: boolean
  /** 通过校验的 key（保持原顺序、去重） */
  value: string[]
  error: TagValidationError
}

/**
 * **封闭标签校验 —— 本模块唯一的标签入口**（规格 §3.2 / 验收「自由文本被拒」）。
 *
 * 自由文本在这里被拒绝：`'打羽毛球'` / `'badminton'` 之外的任意字符串都不在
 * 封闭表里，因此 `unknown` 非空 → `ok: false`，错误码对齐服务端的
 * `VALIDATION_FAILED` + `details.reason = 'UNKNOWN_TAG:<key>'`。
 *
 * 页面**不得**绕过本函数直接把用户输入当标签用。
 */
export function validateTagKeys(
  keys: readonly string[],
  max: number,
  /** 校验所依据的标签表；默认 [BUDDY_TAGS]（服务端权威表的镜像） */
  table: readonly BuddyTag[] = BUDDY_TAGS,
): TagValidationResult {
  const unknown: string[] = []
  const inactive: string[] = []
  const accepted: string[] = []
  const seen = new Set<string>()

  for (const raw of keys) {
    const key = raw.trim()
    if (key === '' || seen.has(key)) continue
    seen.add(key)

    const tag = table.find((item) => item.key === key) ?? null
    if (tag === null) {
      unknown.push(key)
      continue
    }
    if (!tag.isActive) {
      inactive.push(key)
      continue
    }
    accepted.push(key)
  }

  const overflow = accepted.length > max
  const ok = unknown.length === 0 && inactive.length === 0 && !overflow

  const parts: string[] = []
  if (unknown.length > 0) parts.push(`未登记的标签：${unknown.join('、')}`)
  if (inactive.length > 0) parts.push(`已下架的标签：${inactive.join('、')}`)
  if (overflow) parts.push(`最多选择 ${max} 个标签`)

  return {
    ok,
    value: ok ? accepted : accepted.slice(0, max),
    error: {
      unknown,
      inactive,
      overflow,
      message: parts.length === 0 ? null : parts.join('；'),
    },
  }
}

/** 标签数量的硬上限（规格 §3.2） */
export const BUDDY_TAG_LIMITS = {
  /** `BuddyProfile.interestTags` ≤20 */
  interestTags: 20,
  /** `BuddyProfile.activityTags` ≤10 */
  activityTags: 10,
  /** `BuddyPost.tags` ≤8 */
  postTags: 8,
} as const

/* ------------------------------------------------------------------ *
 * 3. 校园地点与院系（规格 §3.2 / U10）
 * ------------------------------------------------------------------ */

/**
 * 常去区域 / 活动地点白名单（`preferredAreas` / `location`）。
 *
 * **逐字镜像服务端的** `services/api/src/modules/buddy/domain/tags.ts` 的
 * `CAMPUS_LOCATIONS`（25 项）—— 服务端用它校验 `location`，客户端若提供
 * 服务端不认的地点，用户会拿到 `UNKNOWN_LOCATION`。
 *
 * ⚠️ **未决项 U10 仍然成立**：服务端那份清单自己就标注了
 * 「真实清单必须由产品 + 运营确认后替换」，因此这**仍是占位内容**。
 * 这里镜像它，是为了让客户端与服务端**至少彼此一致**（否则连 mock 都对不上），
 * 而不是宣称它已经是真实清单。真实清单确定后，两端一起替换。
 */
export const CAMPUS_AREAS: readonly string[] = [
  '图书馆',
  '一食堂',
  '二食堂',
  '三食堂',
  '体育馆',
  '羽毛球馆',
  '游泳馆',
  '田径场',
  '篮球场',
  '网球场',
  '健身房',
  '教学楼A',
  '教学楼B',
  '教学楼C',
  '学生活动中心',
  '学术交流中心',
  '创管学院',
  '信息学院',
  '物质学院',
  '生命学院',
  '宿舍区',
  '湖畔草坪',
  '咖啡厅',
  '校门口',
  '张江地铁站',
]

/** 区域白名单校验（`location` 必填 / `preferredAreas` ≤5） */
export function isKnownArea(area: string): boolean {
  return CAMPUS_AREAS.includes(area)
}

export const PREFERRED_AREA_LIMIT = 5

/**
 * 院系**建议清单**（`BuddyProfile.department`，`academic` 板块的同院系规则用）。
 *
 * 规格 §3.3 明确用「院系」而不是「专业」：专业粒度在小程序端填报质量不可控
 * （会出现「计算机」/「CS」/「计算机科学与技术」三种写法），
 * 精确字符串相等极其脆弱。
 *
 * ⚠️ **服务端对 `department` 只约束 ≤64 字（不校验白名单）**
 * （`services/api/src/modules/buddy/domain/profile-sync.ts` 的 `DEPARTMENT_MAX_LEN`），
 * 因此这是 UI 的**下拉建议值**而非硬白名单 —— 与 Web 端的
 * `BUDDY_DEPARTMENTS`（`apps/web/src/domain/models/buddy.ts:341`）**逐字一致**，
 * 否则两端用户会填出不同的字符串，`same-department` 规则就永远不命中。
 */
export const SHTU_DEPARTMENTS: readonly string[] = [
  '信息科学与技术学院',
  '物质科学与技术学院',
  '生命科学与技术学院',
  '数学科学研究所',
  '创业与管理学院',
  '生物医学工程学院',
  '创意与艺术学院',
  '人文科学研究院',
  '免疫化学研究所',
  '通识教育中心',
  '其他',
]

/* ------------------------------------------------------------------ *
 * 4. 技能水平与性别偏好
 * ------------------------------------------------------------------ */

export type BuddySkillLevel = 'beginner' | 'casual' | 'regular' | 'competitive'

export const BUDDY_SKILL_LEVELS: readonly BuddySkillLevel[] = [
  'beginner',
  'casual',
  'regular',
  'competitive',
]

export const BUDDY_SKILL_LEVEL_LABELS: Readonly<Record<BuddySkillLevel, string>> = {
  beginner: '入门',
  casual: '休闲',
  regular: '经常',
  competitive: '竞技',
}

/**
 * 技能等级序（越小越初级）—— 规格 §3.3 F6 硬过滤用。
 * 与 `@kedaya/shared` 的 `applyHardFilters` 的 `skillRank` 回调配套。
 */
export const BUDDY_SKILL_RANK: Readonly<Record<BuddySkillLevel, number>> = {
  beginner: 0,
  casual: 1,
  regular: 2,
  competitive: 3,
}

export function skillRank(level: string): number {
  return BUDDY_SKILL_RANK[level as BuddySkillLevel] ?? 0
}

/** 发起人的准入约束（契约已冻结，**不是**打分特征，规格 §1.2 N5） */
export type BuddyGenderPreference = 'any' | 'same' | 'other'

export const BUDDY_GENDER_PREFERENCES: readonly BuddyGenderPreference[] = ['any', 'same', 'other']

export const BUDDY_GENDER_PREFERENCE_LABELS: Readonly<Record<BuddyGenderPreference, string>> = {
  any: '不限性别',
  same: '仅同性',
  other: '仅异性',
}

/* ------------------------------------------------------------------ *
 * 5. `BuddyPost`（契约 §2.3 冻结 + 规格新增可选字段）
 * ------------------------------------------------------------------ */

export type BuddyPostStatus = 'OPEN' | 'FULL' | 'CLOSED' | 'EXPIRED' | 'CANCELLED'

export const BUDDY_POST_STATUS_LABELS: Readonly<Record<BuddyPostStatus, string>> = {
  OPEN: '招募中',
  FULL: '已满员',
  CLOSED: '已关闭',
  EXPIRED: '已过期',
  CANCELLED: '已取消',
}

/** 发起人公开信息（**不含**任何联系方式，规格 §6.1） */
export interface BuddyCreator {
  id: string
  nickname: string
  avatarUrl: string | null
}

export interface BuddyPost {
  id: string
  activity: BuddyActivity
  status: BuddyPostStatus
  title: string
  description: string | null
  location: string
  /** ISO-8601 UTC */
  startsAt: string
  /** 预计时长（分钟），30–480；缺省时按 [DEFAULT_DURATION_MIN] 处理 */
  durationMin: number | null
  /** 含发起人的总人数，2–20（契约 §11.10-D） */
  capacity: number
  /** 含发起人，初值为 1（契约 §11.10-D） */
  joinedCount: number
  genderPreference: BuddyGenderPreference
  tags: string[]
  /** 仅 `sport`；作为**硬过滤**，不是打分（规格 §2.3） */
  minSkillLevel: BuddySkillLevel | null
  creator: BuddyCreator
  createdAt: string
  updatedAt: string
  /** 我自己的申请状态（详情页用；列表页恒为 `null`） */
  myApplication: BuddyApplication | null
}

/** 时长缺省值：`durationMin` 为 null 时用于 F7 时段重叠判定 */
export const DEFAULT_DURATION_MIN = 60

export const BUDDY_DURATION_RANGE = { min: 30, max: 480 } as const
export const BUDDY_CAPACITY_RANGE = { min: 2, max: 20 } as const
export const BUDDY_TITLE_MAX = 60
export const BUDDY_DESCRIPTION_MAX = 1000

/** 列表卡片展示用的派生摘要 —— UI 只读这个，避免在组件里重复计算 */
export interface BuddyPostSummary {
  id: string
  title: string
  section: BuddySection
  sectionLabel: string
  activity: BuddyActivity
  activityLabel: string
  status: BuddyPostStatus
  statusLabel: string
  location: string
  startsAt: string
  /** 「10 月 24 日 14:00」这类本地时间文案 */
  startsAtLabel: string
  durationMin: number
  tagKeys: string[]
  tagLabels: string[]
  capacity: number
  joinedCount: number
  remainingSlots: number
  genderPreference: BuddyGenderPreference
  genderPreferenceLabel: string
  minSkillLevel: BuddySkillLevel | null
  creatorName: string
  createdAtLabel: string
  /** 当前是否还能申请 */
  joinable: boolean
}

/**
 * 剩余名额（含发起人的总人数语义，契约 §11.10-D）。
 *
 * ⚠️ 名字带 `Buddy` 前缀是**刻意的**：`groupbuy` 也有 `remainingSlots`，
 * 而 `domain/models/index.ts` 用 `export *` 汇总 —— 同名会让 barrel 导出歧义
 * （TS2308），进而让消费方拿到错误的那一个。两个模块的语义确实不同
 * （拼单按「份数」，搭子按「人数」），因此不该共用一个名字。
 */
export function buddyRemainingSlots(post: Pick<BuddyPost, 'capacity' | 'joinedCount'>): number {
  return Math.max(0, post.capacity - post.joinedCount)
}

/** 活动是否已过开始时间（`groupbuy.isExpired` 的搭子版，同样刻意改名避免 barrel 歧义） */
export function isBuddyPostExpired(post: Pick<BuddyPost, 'startsAt'>, now: Date): boolean {
  const at = new Date(post.startsAt).getTime()
  if (Number.isNaN(at)) return false
  return at <= now.getTime()
}

/**
 * 由「状态 + 人数 + 时间」推导运行时状态（规格 §2.8 状态机的展示侧）。
 *
 * 终态（`CLOSED` / `CANCELLED`）**不会被推导覆盖** —— 发起人的显式动作优先。
 * `FULL` 在有人退出后会回到 `OPEN`，因此可以由人数推导。
 */
export function derivePostStatus(
  post: Pick<BuddyPost, 'status' | 'capacity' | 'joinedCount' | 'startsAt'>,
  now: Date,
): BuddyPostStatus {
  if (post.status === 'CANCELLED' || post.status === 'CLOSED') return post.status
  if (isBuddyPostExpired(post, now)) return 'EXPIRED'
  if (post.joinedCount >= post.capacity) return 'FULL'
  return 'OPEN'
}

/* ------------------------------------------------------------------ *
 * 6. `BuddyPost` 状态机（规格 §2.8，与契约 02-domain-model.md:535-548 逐字一致）
 * ------------------------------------------------------------------ */

const POST_TRANSITIONS: Readonly<Record<BuddyPostStatus, readonly BuddyPostStatus[]>> = {
  OPEN: ['FULL', 'CLOSED', 'EXPIRED', 'CANCELLED'],
  FULL: ['OPEN', 'CLOSED', 'EXPIRED'],
  CLOSED: [],
  EXPIRED: [],
  CANCELLED: [],
}

/**
 * 状态流转判定 —— 唯一入口（契约 `02-domain-model.md:36` 规则 2：
 * 状态流转只走纯函数，页面与用例不得自己写 `if (status === ...)`）。
 *
 * 自反（`from === to`）返回 `false`：状态机里没有自环。
 */
export function canTransitionPost(from: BuddyPostStatus, to: BuddyPostStatus): boolean {
  return POST_TRANSITIONS[from].includes(to)
}

export const BUDDY_POST_STATUSES: readonly BuddyPostStatus[] = [
  'OPEN',
  'FULL',
  'CLOSED',
  'EXPIRED',
  'CANCELLED',
]

/* ------------------------------------------------------------------ *
 * 7. `BuddyApplication`（契约 §2.3 / 规格 §2.8）
 * ------------------------------------------------------------------ */

export type BuddyApplicationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN'

export const BUDDY_APPLICATION_STATUS_LABELS: Readonly<Record<BuddyApplicationStatus, string>> = {
  PENDING: '待审批',
  ACCEPTED: '已通过',
  REJECTED: '未通过',
  WITHDRAWN: '已撤回',
}

export interface BuddyApplication {
  id: string
  postId: string
  applicantId: string
  applicantName: string
  /** 申请留言（可选，≤200 字）。**仅发起人与本人可见**（规格 §6.1） */
  message: string | null
  status: BuddyApplicationStatus
  createdAt: string
  decidedAt: string | null
}

const APPLICATION_TRANSITIONS: Readonly<
  Record<BuddyApplicationStatus, readonly BuddyApplicationStatus[]>
> = {
  PENDING: ['ACCEPTED', 'REJECTED', 'WITHDRAWN'],
  WITHDRAWN: ['PENDING'],
  ACCEPTED: [],
  REJECTED: [],
}

/** 申请状态流转（`WITHDRAWN → PENDING` 是对契约的补充，规格 §2.8 / 未决 U7） */
export function canTransitionApplication(
  from: BuddyApplicationStatus,
  to: BuddyApplicationStatus,
): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to)
}

export const BUDDY_APPLICATION_STATUSES: readonly BuddyApplicationStatus[] = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
]

/* ------------------------------------------------------------------ *
 * 8. 申请资格（F1–F6 的客户端预校验；F7 见第 9 节）
 * ------------------------------------------------------------------ */

export type BuddyJoinEligibility =
  | { allowed: true }
  | {
      allowed: false
      reason:
        | 'not-open'
        | 'full'
        | 'expired'
        | 'own-post'
        | 'already-applied'
        | 'gender-mismatch'
        | 'skill-too-low'
        | 'not-logged-in'
      message: string
    }

export interface JoinEligibilityOptions {
  /** 我的技能水平（仅 sport 用于 F6） */
  mySkillLevel?: BuddySkillLevel | null
  /** F5：性别准入是否相容。缺省视为相容（客户端不采集性别，见下） */
  genderCompatible?: boolean
}

/**
 * 申请资格判定 —— 纯函数，UI 与用例层共用同一份规则，避免规则漂移。
 *
 * 对齐规格 §3.3 的硬过滤：
 * - F1 `status = OPEN` 且 `joinedCount < capacity`
 * - F2 `startsAt > now()`
 * - F3 `creatorId != me`
 * - F4 我未申请过（无 `PENDING` / `ACCEPTED`）
 * - F5 性别相容
 * - F6 `minSkillLevel` 存在时我的 `skillLevel` ≥ 它（仅 `sport`）
 *
 * ⚠️ **F5 的诚实说明**：`BuddyProfile` **不采集性别**（规格 §6.3「不采集敏感属性」），
 * 因此客户端**无法**独立判定 F5，只能：
 * - 由服务端在 `join` 时返回 `FORBIDDEN` / `GENDER_PREFERENCE_MISMATCH`；
 * - 或在调用方确实知道性别时通过 `genderCompatible` 传入。
 * 缺省为 `true`（不拦截），把最终判定交给服务端 —— 客户端的角色是**提前给出好文案**，
 * 不是替代服务端校验。
 */
export function canApplyToPost(
  post: Pick<
    BuddyPost,
    'status' | 'capacity' | 'joinedCount' | 'startsAt' | 'creator' | 'minSkillLevel' | 'myApplication'
  >,
  userId: string | null,
  now: Date,
  options: JoinEligibilityOptions = {},
): BuddyJoinEligibility {
  if (userId === null) {
    return { allowed: false, reason: 'not-logged-in', message: '登录后才能申请加入' }
  }

  const status = derivePostStatus(post, now)

  if (status === 'CANCELLED') {
    return { allowed: false, reason: 'not-open', message: '该招募已被发起人取消' }
  }
  if (status === 'CLOSED') {
    return { allowed: false, reason: 'not-open', message: '该招募已被发起人关闭' }
  }
  if (status === 'EXPIRED') {
    return { allowed: false, reason: 'expired', message: '活动时间已过' }
  }
  if (status === 'FULL') {
    return { allowed: false, reason: 'full', message: '人数已满，来晚了一步' }
  }

  if (post.creator.id === userId) {
    return { allowed: false, reason: 'own-post', message: '这是你自己发布的招募' }
  }

  const mine = post.myApplication
  if (mine !== null && (mine.status === 'PENDING' || mine.status === 'ACCEPTED')) {
    return {
      allowed: false,
      reason: 'already-applied',
      message: mine.status === 'PENDING' ? '你已提交申请，等待发起人审批' : '你已被接受',
    }
  }

  if (options.genderCompatible === false) {
    return { allowed: false, reason: 'gender-mismatch', message: '发起人设置了性别准入条件' }
  }

  if (
    post.minSkillLevel !== null &&
    options.mySkillLevel != null &&
    skillRank(options.mySkillLevel) < skillRank(post.minSkillLevel)
  ) {
    return {
      allowed: false,
      reason: 'skill-too-low',
      message: `该活动要求「${BUDDY_SKILL_LEVEL_LABELS[post.minSkillLevel]}」及以上水平`,
    }
  }

  return { allowed: true }
}

/* ------------------------------------------------------------------ *
 * 9. 可用时段（规格 §3.3 F7 / §2.2）
 * ------------------------------------------------------------------ */

export type BuddyAvailabilitySlot = AvailabilitySlot

export const AVAILABILITY_DOW_LABELS: readonly string[] = [
  '周日',
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
]

/** 分钟数 → `HH:mm` */
export function formatMinuteOfDay(minute: number): string {
  const normalized = ((Math.floor(minute) % 1440) + 1440) % 1440
  const h = Math.floor(normalized / 60)
  const m = normalized % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** `HH:mm` → 分钟数；非法返回 `null` */
export function parseMinuteOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

/**
 * 单个时段是否合法（规格 §2.2 的约束）。
 *
 * `dow` 0–6；`startMin` / `endMin` 0–1439；`endMin > startMin`。
 * ⚠️ **时段本身不允许跨零点** —— 跨零点由「活动跨零点」表达（第 9 节末），
 * 时段跨零点会让「周内分钟数」的换算产生歧义（同一天会有两个区间）。
 */
export function isValidAvailabilitySlot(slot: BuddyAvailabilitySlot): boolean {
  return (
    Number.isInteger(slot.dow) &&
    slot.dow >= 0 &&
    slot.dow <= 6 &&
    Number.isInteger(slot.startMin) &&
    Number.isInteger(slot.endMin) &&
    slot.startMin >= 0 &&
    slot.startMin <= 1439 &&
    slot.endMin >= 0 &&
    slot.endMin <= 1439 &&
    slot.endMin > slot.startMin
  )
}

/** 时段文案：「周一 18:00–22:00」 */
export function describeSlot(slot: BuddyAvailabilitySlot): string {
  return `${AVAILABILITY_DOW_LABELS[slot.dow] ?? '未知'} ${formatMinuteOfDay(
    slot.startMin,
  )}–${formatMinuteOfDay(slot.endMin)}`
}

/** 全部时段文案（按 dow 升序、startMin 升序） */
export function describeAvailability(slots: readonly BuddyAvailabilitySlot[]): string[] {
  return [...slots]
    .sort((a, b) => a.dow - b.dow || a.startMin - b.startMin)
    .map(describeSlot)
}

/** 时段去重 + 排序（发布/保存前的规范化） */
export function normalizeAvailability(
  slots: readonly BuddyAvailabilitySlot[],
): BuddyAvailabilitySlot[] {
  const seen = new Set<string>()
  const out: BuddyAvailabilitySlot[] = []
  for (const slot of slots) {
    if (!isValidAvailabilitySlot(slot)) continue
    const key = `${slot.dow}:${slot.startMin}:${slot.endMin}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ dow: slot.dow, startMin: slot.startMin, endMin: slot.endMin })
  }
  return out.sort((a, b) => a.dow - b.dow || a.startMin - b.startMin)
}

/** 某时刻（按时区）的「周内分钟数」，从**周日 00:00** 起算 */
export function minuteOfWeek(at: Date, tz = 'Asia/Shanghai'): number {
  const { dow, minuteOfDay } = zonedDowAndMinute(at, tz)
  return dow * 1440 + minuteOfDay
}

/**
 * F7：活动时间窗是否与我的可用时段有交集。
 *
 * **直接调用 `@kedaya/shared` 的 `overlapsAvailability`** —— 与服务端同一套实现。
 * 自己再写一份「时段重叠」是本模块最容易产生的算法漂移，
 * 而 F7 是**硬过滤**：漂移的后果是「推荐了根本没法参加的活动」。
 *
 * 跨零点：`durationMin` 使活动结束时刻超过当日 24:00 时，
 * `overlapsAvailability` 会把窗口延伸到次日并检查**次日**的时段
 * （例如周一 23:30 踢 90 分钟 → 落到周二 01:00，命中周二 00:00–02:00 的时段）。
 */
export function availabilityOverlapsPost(
  availability: readonly BuddyAvailabilitySlot[],
  post: Pick<BuddyPost, 'startsAt' | 'durationMin'>,
  tz = 'Asia/Shanghai',
): boolean {
  if (availability.length === 0) return false
  const startsAt = new Date(post.startsAt)
  if (Number.isNaN(startsAt.getTime())) return false
  const duration = post.durationMin ?? DEFAULT_DURATION_MIN
  return overlapsAvailability(availability, startsAt, duration, tz)
}

/* ------------------------------------------------------------------ *
 * 10. `BuddyProfile`（规格 §2.2）
 * ------------------------------------------------------------------ */

export interface BuddyProfile {
  userId: string
  sections: BuddySection[]
  interestTags: string[]
  activityTags: string[]
  skillLevel: BuddySkillLevel
  availability: BuddyAvailabilitySlot[]
  preferredAreas: string[]
  department: string | null
  bio: string | null
  /** **默认关闭**：不主动开启就不进推荐池（规格 §6.3） */
  matchEnabled: boolean
  updatedAt: string
}

export const BUDDY_BIO_MAX = 200

/** 空资料（新建时的初值）—— `matchEnabled: false`，与规格 §6.3 一致 */
export function emptyBuddyProfile(userId: string): BuddyProfile {
  return {
    userId,
    sections: [],
    interestTags: [],
    activityTags: [],
    skillLevel: 'casual',
    availability: [],
    preferredAreas: [],
    department: null,
    bio: null,
    matchEnabled: false,
    updatedAt: new Date(0).toISOString(),
  }
}

/** 校验错误（`field` 供页面高亮对应输入） */
export interface BuddyProfileError {
  field:
    | 'sections'
    | 'interestTags'
    | 'activityTags'
    | 'availability'
    | 'preferredAreas'
    | 'department'
    | 'bio'
    | 'skillLevel'
  message: string
}

export interface ProfileValidationResult {
  ok: boolean
  errors: BuddyProfileError[]
}

/**
 * 匹配资料校验（规格 §2.2 的约束表）。
 *
 * 关键约束（**全部是硬上限，不是建议**）：
 * - `interestTags` ≤20 / `activityTags` ≤10（且必须是封闭标签表里的 key）
 * - `availability` 每段 `dow` 0–6、`startMin`/`endMin` 0–1439、`endMin > startMin`
 * - `preferredAreas` ≤5 且取自校园地点白名单
 * - `skillLevel` **仅 `sport` 板块有意义**：不参与 `sport` 时不得用它作为特征
 * - 开启匹配（`matchEnabled`）时 `sections` 至少 1 项，否则进了推荐池也没有板块
 */
export function validateBuddyProfile(profile: BuddyProfile): ProfileValidationResult {
  const errors: BuddyProfileError[] = []

  const sections = profile.sections.filter((s) => BUDDY_SECTIONS.includes(s))
  if (profile.matchEnabled && sections.length === 0) {
    errors.push({ field: 'sections', message: '开启匹配前请至少选择一个板块' })
  }

  const interests = validateTagKeys(profile.interestTags, BUDDY_TAG_LIMITS.interestTags)
  if (!interests.ok) {
    errors.push({ field: 'interestTags', message: interests.error.message ?? '兴趣标签不合法' })
  }

  const activities = validateTagKeys(profile.activityTags, BUDDY_TAG_LIMITS.activityTags)
  if (!activities.ok) {
    errors.push({ field: 'activityTags', message: activities.error.message ?? '活动标签不合法' })
  }

  const badSlots = profile.availability.filter((slot) => !isValidAvailabilitySlot(slot))
  if (badSlots.length > 0) {
    errors.push({
      field: 'availability',
      message: `有 ${badSlots.length} 个时段不合法（结束时间必须晚于开始时间）`,
    })
  }

  if (profile.preferredAreas.length > PREFERRED_AREA_LIMIT) {
    errors.push({
      field: 'preferredAreas',
      message: `常去区域最多选 ${PREFERRED_AREA_LIMIT} 个`,
    })
  }
  const unknownAreas = profile.preferredAreas.filter((area) => !isKnownArea(area))
  if (unknownAreas.length > 0) {
    errors.push({ field: 'preferredAreas', message: `未知区域：${unknownAreas.join('、')}` })
  }

  if (profile.department !== null && [...profile.department].length > 64) {
    errors.push({ field: 'department', message: '院系名称不能超过 64 字' })
  }

  if (profile.bio !== null && [...profile.bio].length > BUDDY_BIO_MAX) {
    errors.push({ field: 'bio', message: `自述不能超过 ${BUDDY_BIO_MAX} 字` })
  }
  if (profile.bio !== null && detectContactInfo(profile.bio) !== null) {
    errors.push({ field: 'bio', message: '自述里不要写联系方式，匹配成功后由站内信交换' })
  }

  if (!BUDDY_SKILL_LEVELS.includes(profile.skillLevel)) {
    errors.push({ field: 'skillLevel', message: '运动水平取值非法' })
  }

  return { ok: errors.length === 0, errors }
}

/** 把（可能来自网络的）未知形状收敛成合法 `BuddyProfile` */
export function normalizeBuddyProfile(raw: BuddyProfile): BuddyProfile {
  return {
    ...raw,
    sections: raw.sections.filter((s) => BUDDY_SECTIONS.includes(s)),
    interestTags: validateTagKeys(raw.interestTags, BUDDY_TAG_LIMITS.interestTags).value,
    activityTags: validateTagKeys(raw.activityTags, BUDDY_TAG_LIMITS.activityTags).value,
    availability: normalizeAvailability(raw.availability),
    preferredAreas: raw.preferredAreas.filter(isKnownArea).slice(0, PREFERRED_AREA_LIMIT),
    skillLevel: BUDDY_SKILL_LEVELS.includes(raw.skillLevel) ? raw.skillLevel : 'casual',
  }
}

/* ------------------------------------------------------------------ *
 * 11. 联系方式检测（规格 §6.4）
 * ------------------------------------------------------------------ */

export type ContactInfoKind = 'mobile' | 'wechat' | 'qq'

export interface ContactInfoHit {
  kind: ContactInfoKind
  /** 命中的原文（供页面提示；**不**回显到公开字段） */
  matched: string
}

/**
 * 联系方式模式检测（规格 §6.4）。
 *
 * 为什么**不**复用 `@kedaya/shared` 的 `containsLikelyPii`：那条规则包含
 * `\b\d{8}\b`（学号）与邮箱，会把「20261024 周六下午」这类正常时间文本
 * 判成 PII，在组队场景下**误报率过高**（发起人写日期是常态）。
 * 规格 §6.4 要求的是三类**具体**模式：手机号 / 微信 / QQ。
 *
 * ⚠️ 这只是**前端预校验**，权威判定在服务端（`CONTACT_INFO_IN_DESCRIPTION`）。
 */
export function detectContactInfo(text: string): ContactInfoHit | null {
  const mobile = /1[3-9]\d{9}/.exec(text)
  if (mobile !== null) return { kind: 'mobile', matched: mobile[0] }

  // 「微信/微 信/vx/wechat/wx: xxx」
  const wechat = /(?:微信|微\s*信|wechat|weixin|vx|wx)\s*[:：]?\s*([A-Za-z0-9_-]{5,})/i.exec(text)
  if (wechat !== null) return { kind: 'wechat', matched: wechat[0] }

  const qq = /(?:qq|扣扣)\s*[:：]?\s*(\d{5,12})/i.exec(text)
  if (qq !== null) return { kind: 'qq', matched: qq[0] }

  return null
}

/* ------------------------------------------------------------------ *
 * 12. 发布表单校验（规格 §5.4）
 * ------------------------------------------------------------------ */

export interface BuddyPostDraft {
  activity: BuddyActivity
  title: string
  description: string
  location: string
  /** `YYYY-MM-DDTHH:mm` 本地时间（小程序 `<Picker mode='date'|'time'>` 的形状） */
  startsAtLocal: string
  durationMin: number
  capacity: number
  genderPreference: BuddyGenderPreference
  tags: string[]
  minSkillLevel: BuddySkillLevel | null
}

export interface BuddyPostDraftError {
  field: keyof BuddyPostDraft
  message: string
}

export const EMPTY_BUDDY_POST_DRAFT: BuddyPostDraft = {
  activity: 'sport',
  title: '',
  description: '',
  location: '',
  startsAtLocal: '',
  durationMin: 120,
  capacity: 4,
  genderPreference: 'any',
  tags: [],
  minSkillLevel: null,
}

/** 把 `YYYY-MM-DDTHH:mm` 当成 `Asia/Shanghai` 本地时间解析成 UTC Date */
export function parseShanghaiLocal(parts: { date: string; time: string }): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parts.date) || !/^\d{1,2}:\d{2}$/.test(parts.time)) return null
  const [h, m] = parts.time.split(':')
  const iso = `${parts.date}T${String(h).padStart(2, '0')}:${m}:00+08:00`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 校验发布表单；`now` 由调用方注入（可测） */
export function validateBuddyPostDraft(
  draft: BuddyPostDraft,
  now: Date,
): BuddyPostDraftError[] {
  const errors: BuddyPostDraftError[] = []

  if (!isLengthWithin(draft.title, 1, BUDDY_TITLE_MAX)) {
    errors.push({ field: 'title', message: `标题 1–${BUDDY_TITLE_MAX} 字` })
  }

  if ([...draft.description].length > BUDDY_DESCRIPTION_MAX) {
    errors.push({ field: 'description', message: `说明不能超过 ${BUDDY_DESCRIPTION_MAX} 字` })
  }

  const contact = detectContactInfo(`${draft.title}\n${draft.description}`)
  if (contact !== null) {
    errors.push({
      field: 'description',
      message: '请勿在标题或说明里写联系方式，申请通过后会通过站内信交换',
    })
  }

  if (!isKnownArea(draft.location)) {
    errors.push({ field: 'location', message: '请从校园地点列表里选择' })
  }

  const startsAt = parseShanghaiLocal({
    date: draft.startsAtLocal.slice(0, 10),
    time: draft.startsAtLocal.slice(11),
  })
  if (startsAt === null) {
    errors.push({ field: 'startsAtLocal', message: '请选择活动时间' })
  } else if (startsAt.getTime() <= now.getTime()) {
    errors.push({ field: 'startsAtLocal', message: '活动时间必须晚于当前时间' })
  }

  if (
    !Number.isInteger(draft.durationMin) ||
    draft.durationMin < BUDDY_DURATION_RANGE.min ||
    draft.durationMin > BUDDY_DURATION_RANGE.max
  ) {
    errors.push({
      field: 'durationMin',
      message: `时长 ${BUDDY_DURATION_RANGE.min}–${BUDDY_DURATION_RANGE.max} 分钟`,
    })
  }

  if (
    !Number.isInteger(draft.capacity) ||
    draft.capacity < BUDDY_CAPACITY_RANGE.min ||
    draft.capacity > BUDDY_CAPACITY_RANGE.max
  ) {
    errors.push({
      field: 'capacity',
      message: `人数 ${BUDDY_CAPACITY_RANGE.min}–${BUDDY_CAPACITY_RANGE.max} 人（含发起人）`,
    })
  }

  const tags = validateTagKeys(draft.tags, BUDDY_TAG_LIMITS.postTags)
  if (!tags.ok) {
    errors.push({ field: 'tags', message: tags.error.message ?? '标签不合法' })
  }

  if (draft.minSkillLevel !== null && sectionOf(draft.activity) !== 'sport') {
    errors.push({ field: 'minSkillLevel', message: '运动水平要求仅适用于运动板块' })
  }

  return errors
}

/* ------------------------------------------------------------------ *
 * 13. 派生摘要
 * ------------------------------------------------------------------ */

/** 本地时间文案（`Asia/Shanghai`），例如「10月24日 周六 14:00」 */
export function formatStartsAt(iso: string, tz = 'Asia/Shanghai'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '时间待定'
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return fmt.format(date)
}

export function summarizeBuddyPost(post: BuddyPost, now: Date): BuddyPostSummary {
  const section = sectionOf(post.activity)
  const status = derivePostStatus(post, now)
  return {
    id: post.id,
    title: post.title,
    section,
    sectionLabel: BUDDY_SECTION_LABELS[section],
    activity: post.activity,
    activityLabel: BUDDY_ACTIVITY_LABELS[post.activity],
    status,
    statusLabel: BUDDY_POST_STATUS_LABELS[status],
    location: post.location,
    startsAt: post.startsAt,
    startsAtLabel: formatStartsAt(post.startsAt),
    durationMin: post.durationMin ?? DEFAULT_DURATION_MIN,
    tagKeys: post.tags,
    tagLabels: post.tags.map(buddyTagLabel),
    capacity: post.capacity,
    joinedCount: post.joinedCount,
    remainingSlots: buddyRemainingSlots(post),
    genderPreference: post.genderPreference,
    genderPreferenceLabel: BUDDY_GENDER_PREFERENCE_LABELS[post.genderPreference],
    minSkillLevel: post.minSkillLevel,
    creatorName: post.creator.nickname,
    createdAtLabel: formatRelativeTime(post.createdAt, now),
    joinable: status === 'OPEN' && post.myApplication === null,
  }
}

/* ------------------------------------------------------------------ *
 * 14. 隐私提示（规格 §6，**硬要求**）
 * ------------------------------------------------------------------ */

/**
 * 隐私说明正文（规格 §6）。
 *
 * 这是**硬要求**，不是可选的装饰：`BuddyProfile` 里的「兴趣 + 可用时段」
 * 是典型的画像输入，用户必须能清楚知道
 *
 * 1. 哪些信息会展示给他人（只有活动信息与昵称）；
 * 2. 联系方式**如何**交换（申请被接受后由站内信，不进 `description`）；
 * 3. 匹配资料**可随时撤回**（`DELETE /buddy/profile` 硬删，立即移出推荐池）。
 *
 * 三句话缺一不可 —— 少任何一句都会让用户对「我的资料去哪了」产生错误预期。
 */
export const BUDDY_PRIVACY_NOTICE =
  '你的匹配资料（院系、兴趣/活动标签、可用时段、常去区域、运动水平）不会展示给任何人，' +
  '包括活动发起人 —— 它只被推荐算法使用，对外只输出「同一个院系」「共同兴趣 3 项」这类聚合短语。' +
  '活动列表与详情只公开活动信息、你的昵称与头像，不公开任何联系方式；' +
  '联系方式在申请被接受后通过站内信交换，不会写进活动说明。' +
  '你可以随时在本页关闭匹配或删除整份匹配资料，删除后立即从推荐池移除。'

export const BUDDY_PRIVACY_NOTICE_SHORT =
  '匹配资料只被算法使用，不对任何人展示；联系方式在申请通过后经站内信交换。'

/** 匹配开关的说明（默认关闭，规格 §6.3） */
export const BUDDY_MATCH_ENABLED_NOTICE =
  '开启后，你的匹配资料会参与「找搭子」的推荐计算（仅用于排序，不对外展示）。' +
  '默认关闭；关闭后你仍然可以正常发布和申请搭子。'

/** 联系方式交换说明（规格 §6.2） */
export const BUDDY_CONTACT_NOTICE =
  '为防爬取，活动说明里不允许写微信号 / 手机号 / QQ。' +
  '申请被发起人接受后，双方会各收到一条站内信用于交换联系方式。'

/** 隐私提示必须展示的条目（供组件与测试断言「三句话都在」） */
export const BUDDY_PRIVACY_POINTS: readonly string[] = [
  '匹配资料（兴趣/可用时段/院系）不对任何人展示，只被算法使用',
  '活动只公开活动信息、昵称与头像；联系方式在申请通过后经站内信交换',
  '匹配资料可随时撤回：关闭匹配或删除后立即移出推荐池',
]

/* ------------------------------------------------------------------ *
 * 15. 复用：可能含 PII 的文本（保留给页面的即时提示）
 * ------------------------------------------------------------------ */

/**
 * 说明文本的即时提示：命中联系方式模式返回中文提示，否则 `null`。
 * 与 [detectContactInfo] 的区别是它返回**面向用户**的文案。
 */
export function contactWarning(text: string): string | null {
  const hit = detectContactInfo(text)
  if (hit === null) return null
  if (hit.kind === 'mobile') return '检测到手机号，请删除后发布'
  if (hit.kind === 'wechat') return '检测到微信号，请删除后发布'
  return '检测到 QQ 号，请删除后发布'
}
