import { formatRelativeTime } from '@kedaya/shared'

/**
 * TechPie 整合（`techpie`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * ## 这个模块到底交付了什么（先读这段，它决定了页面上每一句话怎么说）
 *
 * 真正的「TechPie / GeekPie 整合」需要**对方系统提供接口与凭据**，我们拿不到，
 * 所以本轮**不做任何自动同步**。可交付的真实形态是一份
 * **同学共建的校园技术服务目录**：每条 = 名称 + 分类 + 地址 + 状态 + 最后核对时间。
 *
 * 状态是**人工核对记录**，不是系统探测结果 —— 可达鸭不探测链接能不能打开，
 * 也不宣称与学校官方系统对接。页面固定文案 `TECHPIE_NOTICE` 就是在说这件事。
 *
 * ## 字段与后端逐条对齐（`services/api/src/modules/techpie/domain/techpie.domain.ts`）
 *
 *   · 只有 `key` / `name` / `category` / `url` / `status` + 时间戳。
 *     ⚠️ **没有「说明」列**：任务书里说的「说明」在这张表上不存在，
 *     这里不假装有它 —— 「这条是干什么的」由**分类**承担（见 `TECHPIE_CATEGORY_HINTS`），
 *     输入框也不放一个提交后会被服务端丢掉的假字段。
 *   · `category` 在服务端是自由字符串，**白名单在客户端**（`TECHPIE_CATEGORIES`），
 *     列表 chip 与新建表单共用这一份；白名单外的历史值降级显示为「其他」。
 *   · `status` 同理是自由字符串。服务端只会写出两个值：Prisma 默认 `active`，
 *     以及 `sync` 动作写入的 `synced`（**注意：`sync` 不发起任何外部请求**，
 *     只是把这一列改成那个字面量，真实语义见 `techpie.service.ts`）。
 */

/* ------------------------------------------------------------------ *
 * 分类白名单 —— 单一真相（列表 chip + 新建表单都从这里取）
 * ------------------------------------------------------------------ */

/**
 * 分类短码。
 *
 * 用 ASCII 短码而不是中文标题：分类是**查询条件**（要进 URL、要作为库里的索引值），
 * 中文出现在 query string 里既难排障也容易在不同端被无意改写；
 * 中文标题只在 `TECHPIE_CATEGORY_LABELS` 里给展示用（与 `faq.ts` 同一套做法）。
 *
 * 取值刻意覆盖三处来源，避免出现「数据落在白名单外」这种静默坏事：
 *   1. 后端 `prisma/seed.ts` 的 TechPie 种子：`portal` / `academic` / `community` / `service`；
 *   2. 产品要求的校园服务：教务 / 图书馆 / 正版软件 / VPN / 一卡通 / 报销 / 邮件 / 打印；
 *   3. `other` —— 兜底分类，也是白名单外历史值的展示回落。
 */
export type TechpieCategory =
  | 'academic'
  | 'library'
  | 'software'
  | 'network'
  | 'campus-card'
  | 'finance'
  | 'email'
  | 'service'
  | 'community'
  | 'portal'
  | 'other'

/**
 * 分类白名单。
 *
 * 类型声明成**非空元组**而不是 `readonly TechpieCategory[]`：
 * 新建页需要"默认选第一项"，而 `noUncheckedIndexedAccess` 下普通数组的 `[0]`
 * 是 `| undefined`，会逼出一个假的兜底分支。元组既表达了"白名单永不为空"
 * （这正是 UI 依赖的前提），也让 `TECHPIE_CATEGORIES[0]` 有确切类型。
 */
export const TECHPIE_CATEGORIES: readonly [TechpieCategory, ...TechpieCategory[]] = [
  'academic',
  'library',
  'software',
  'network',
  'campus-card',
  'finance',
  'email',
  'service',
  'community',
  'portal',
  'other',
]

export const TECHPIE_CATEGORY_LABELS: Readonly<Record<TechpieCategory, string>> = {
  academic: '教务与选课',
  library: '图书馆',
  software: '正版软件',
  network: '网络与 VPN',
  'campus-card': '校园卡与一卡通',
  finance: '报销与财务',
  email: '邮箱与账号',
  service: '打印与后勤',
  community: '社团与活动',
  portal: '综合门户',
  other: '其他',
}

/**
 * 分类的一句话说明。
 *
 * 它的存在有一个现实原因：`TechpieLink` 表**没有说明列**（见文件头）。
 * 与其给每条假装一个自由文本说明，不如把「这一类服务是干什么的」写清楚，
 * 并且明确它是**分类级**信息，不是这一条的自述。
 */
export const TECHPIE_CATEGORY_HINTS: Readonly<Record<TechpieCategory, string>> = {
  academic: '选课、成绩、培养方案这类教务相关入口',
  library: '借还书、文献检索、自习预约这类图书馆入口',
  software: '学校购买的正版软件与授权（MATLAB、Office 等）下载、激活入口',
  network: '校园网自助服务与校外访问（VPN）入口',
  'campus-card': '校园卡余额、消费流水、挂失补办这类入口',
  finance: '报销、缴费、发票这类财务相关入口',
  email: '学生邮箱、统一身份认证（SSO）这类账号入口',
  service: '自助打印、宿舍报修、水电充值这类后勤服务入口',
  community: '社团、活动、场地预约这类学生组织入口',
  portal: '面向全校的综合门户与服务大厅',
  other: '暂时没归类的校园技术服务',
}

export function isTechpieCategory(value: unknown): value is TechpieCategory {
  return typeof value === 'string' && (TECHPIE_CATEGORIES as readonly string[]).includes(value)
}

/**
 * 分类标题。白名单外统一显示「其他」，而不是把 `campus-card` 这种内部码怼给用户。
 *
 * ⚠️ 由此带来一个刻意保留的不一致：白名单外的条目**显示**为「其他」，
 * 但点筛选 chip 的「其他」**筛不出**它们（它们真实值不是 `other`）。
 * 这与 `faq.ts` 的做法一致 —— 分类是检索维度，不为了让筛选"看起来对齐"
 * 去改写服务端返回的原始值（那会让筛选条件与数据对不上，更难查）。
 */
export function categoryLabel(category: string): string {
  return isTechpieCategory(category) ? TECHPIE_CATEGORY_LABELS[category] : TECHPIE_CATEGORY_LABELS.other
}

/** 分类说明；白名单外回落到 `other` 的说明，绝不留空 */
export function categoryHint(category: string): string {
  return isTechpieCategory(category) ? TECHPIE_CATEGORY_HINTS[category] : TECHPIE_CATEGORY_HINTS.other
}

/* ------------------------------------------------------------------ *
 * 状态 —— 只认服务端真实会写出的值，其余一律按「待核对」处理
 * ------------------------------------------------------------------ */

/** Prisma 默认值与种子写入的状态 */
export const TECHPIE_STATUS_ACTIVE = 'active'
/** `POST /items/:id/sync` 写入的状态字面量 */
export const TECHPIE_STATUS_SYNCED = 'synced'

export const TECHPIE_STATUS_LABELS = {
  active: '可用',
  synced: '已核对',
  pending: '待核对',
} as const

/** 与 `KdyTagTone` 的结构子集一致（domain 不 import presentation 类型） */
export type TechpieStatusTone = 'success' | 'info' | 'neutral'

/** 是否有人点过「我核对过了」（即服务端写过一次 `sync`） */
export function isReviewed(status: string): boolean {
  return status === TECHPIE_STATUS_SYNCED
}

/**
 * 状态文案。
 *
 * 映射是**刻意的产品判断**：`sync` 在没有真实上游时只等于「有人手工核对过」，
 * 所以 `synced` 显示为「已核对」而不是「已同步」—— 后者会让人以为
 * 可达鸭真的去对方系统拉过数据，那才是吹牛。
 * 未知值一律「待核对」：宁可显得没核对过，也不替服务端编一个"可用"。
 */
export function statusLabel(status: string): string {
  if (status === TECHPIE_STATUS_SYNCED) return TECHPIE_STATUS_LABELS.synced
  if (status === TECHPIE_STATUS_ACTIVE) return TECHPIE_STATUS_LABELS.active
  return TECHPIE_STATUS_LABELS.pending
}

export function statusTone(status: string): TechpieStatusTone {
  if (status === TECHPIE_STATUS_SYNCED) return 'info'
  if (status === TECHPIE_STATUS_ACTIVE) return 'success'
  return 'neutral'
}

/* ------------------------------------------------------------------ *
 * 字段上限（与服务端 createSchema / listQuerySchema 同量级，客户端只会更严）
 * ------------------------------------------------------------------ */

/** 服务名称上限。后端允许 500，客户端收紧到 60：目录条目名不该长过一行 */
export const TECHPIE_NAME_MAX = 60
/** 服务地址上限 */
export const TECHPIE_URL_MAX = 200
/** `key` 上限（客户端自动生成，远小于后端允许的 500） */
export const TECHPIE_KEY_MAX = 80
/** 关键词上限：与后端 `listQuerySchema.q` 的 80 对齐 */
export const TECHPIE_KEYWORD_MAX = 80

/* ------------------------------------------------------------------ *
 * 类型 —— 字段与后端 `TechpieLinkModel` 一一对应，时间以 ISO 字符串传输
 * ------------------------------------------------------------------ */

export interface TechpieLink {
  id: string
  /** 稳定唯一标识。客户端自动生成（用户看不到它），只用来满足后端唯一约束 */
  key: string
  name: string
  /** 分类短码；白名单外的历史值降级显示为「其他」 */
  category: string
  /** 服务地址（http(s) 外链；不在此端打开，见 `presentation/pages/techpie/detail`） */
  url: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface CreateTechpieLinkInput {
  key: string
  name: string
  category: string
  url: string
  status?: string
}

/**
 * 列表筛选条件（`category` 精确 / `q` 关键词模糊）。
 *
 * `q` 在服务端命中的是 `name` + `url` 两列 —— 表里没有说明列（见文件头），
 * 所以这里的注释也不写"搜说明"。
 */
export interface TechpieLinkFilters extends Record<string, unknown> {
  category?: string
  q?: string
}

/** 卡片直接可读的派生视图 —— 列表页不再自己算文案与格式化 */
export interface TechpieLinkSummary {
  id: string
  name: string
  category: string
  categoryLabel: string
  url: string
  /** 地址的域名部分（卡片上比整条 URL 好读） */
  urlHost: string
  statusLabel: string
  statusTone: TechpieStatusTone
  reviewed: boolean
  /** 「最后核对」相对文案：服务端没有单独的核对时间列，它取自 `updatedAt` */
  lastCheckedLabel: string
  createdLabel: string
}

/* ------------------------------------------------------------------ *
 * 固定文案（页面上必须出现，改这里而不是各页各写一份）
 * ------------------------------------------------------------------ */

/**
 * 列表页顶部的一行说明（不做成醒目横幅 —— 这是常驻的事实说明，不是告警）。
 * 详情页底部会把它连同「第三方非官方」一起再说一遍。
 */
export const TECHPIE_NOTICE = '本目录由同学共建维护，状态为人工核对结果，不代表学校官方。'

export const TECHPIE_DISCLAIMER =
  '本目录由同学共建维护，状态是人工核对记录，可达鸭不会探测链接是否真的能打开，也不代表学校官方。可达鸭是第三方非官方校园服务平台。'

/* ------------------------------------------------------------------ *
 * 地址解析与派生视图
 * ------------------------------------------------------------------ */

/**
 * 取地址的域名部分，用于卡片展示。
 *
 * 刻意**不用** `new URL()`：小程序基础库对 `URL` 的支持并不一致，
 * 一个展示辅助函数不该让整个列表在旧基础库上抛错。这里只用正则。
 */
export function urlHost(url: string): string {
  const trimmed = url.trim()
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(trimmed)
  if (match === null) return trimmed
  const host = match[1] ?? ''
  // 去掉端口，`host:port` 里的冒号对用户没有信息量
  const withoutPort = host.replace(/:\d+$/, '')
  return withoutPort === '' ? trimmed : withoutPort
}

/**
 * 是否是「可以拿去浏览器打开」的 http(s) 地址。
 *
 * 只放行 http / https：`javascript:` / `data:` / `file:` 这些方案
 * 复制出去给用户在浏览器里粘贴，轻则打不开、重则是一个钓鱼诱饵。
 * 服务端没有做这个校验（`url` 只是 `z.string()`），所以这一条边界在客户端。
 */
export function isHttpUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) return false
  const rest = trimmed.replace(/^https?:\/\//i, '')
  const hostWithPort = rest.split(/[/?#]/)[0] ?? ''
  if (hostWithPort === '' || /\s/.test(hostWithPort)) return false
  // 先去掉端口再判断：`localhost:4000` 的冒号不该让它被当成"没有域名"
  const host = hostWithPort.replace(/:\d+$/, '')
  // 必须有域名点（或本地联调用的 localhost），避免 `https://` 这种空地址入库
  return host === 'localhost' || host.includes('.')
}

export function summarize(link: TechpieLink, now: Date): TechpieLinkSummary {
  return {
    id: link.id,
    name: link.name,
    category: link.category,
    categoryLabel: categoryLabel(link.category),
    url: link.url,
    urlHost: urlHost(link.url),
    statusLabel: statusLabel(link.status),
    statusTone: statusTone(link.status),
    reviewed: isReviewed(link.status),
    lastCheckedLabel: formatRelativeTime(link.updatedAt, now),
    createdLabel: formatRelativeTime(link.createdAt, now),
  }
}

/* ------------------------------------------------------------------ *
 * 校验（纯函数，用例、mock 仓储与页面共用同一份文案）
 * ------------------------------------------------------------------ */

export function nameProblem(name: string): string | null {
  const text = name.trim()
  if (text.length === 0) return '请填写服务名称'
  if ([...text].length > TECHPIE_NAME_MAX) return `服务名称最多 ${TECHPIE_NAME_MAX} 个字`
  return null
}

/** 分类必须来自白名单：**新建时只能选白名单内**（列表 chip 用同一份） */
export function categoryProblem(category: string): string | null {
  return isTechpieCategory(category) ? null : '请选择一个分类'
}

export function urlProblem(url: string): string | null {
  const trimmed = url.trim()
  if (trimmed === '') return '请填写服务地址'
  if ([...trimmed].length > TECHPIE_URL_MAX) return `服务地址最多 ${TECHPIE_URL_MAX} 个字符`
  if (!isHttpUrl(trimmed)) return '请填写以 http:// 或 https:// 开头的完整网址'
  return null
}

/** `key` 由客户端生成，这里只保证它满足后端 `min(1).max(500)` 的下限形态 */
export function linkKeyProblem(key: string): string | null {
  const trimmed = key.trim()
  if (trimmed.length === 0) return '缺少条目标识'
  if (trimmed.length > TECHPIE_KEY_MAX) return '条目标识过长'
  return null
}

/**
 * 生成一个稳定的 `key`。
 *
 * 为什么由客户端生成而不是让用户填：`key` 是**技术标识**（后端的唯一索引），
 * 让同学为一条服务想一个全局唯一的 slug 是不合理的负担，也必然撞车。
 * 时间戳 + 随机熵足够避免碰撞，且不需要引入新的依赖。
 */
export function generateLinkKey(now: Date, entropy?: string): string {
  const stamp = now.getTime().toString(36)
  const raw = entropy ?? Math.random().toString(36).slice(2, 8)
  const suffix = raw.replace(/[^a-z0-9]/gi, '').slice(0, 8)
  return `tp-${stamp}-${suffix === '' ? 'link' : suffix}`
}
