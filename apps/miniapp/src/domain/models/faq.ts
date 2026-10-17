import { formatRelativeTime } from '@kedaya/shared'

/**
 * 常见问题（`faq`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 与后端 `services/api/src/modules/faq/domain/faq.domain.ts`、
 * `faq.controller.ts`（`createSchema` / `listQuerySchema`）逐条对齐：
 *   · 字段 `question` / `answer` / `category` / `tags` / `helpfulCount`；
 *   · 列表只有两个筛选维度：`category` 精确、`q` 对 question + answer 模糊；
 *   · **分类白名单**（`FAQ_CATEGORIES`）是客户端与页面共用的单一真相：
 *     列表筛选 chip 与新建表单都从这一份取值，页面里不再写第二遍。
 *
 * 「有帮助」（`helpfulCount`）是**无脑 +1** 的热度计数，不是一人一票：
 * 服务端没有投票实体可以查重（`helpfulCount: { increment: 1 }`），
 * 因此「同一台设备不要重复计数」由客户端自己负责 —— 做法见
 * `application/faq/faqUseCases.ts` 的 `markHelpful`。
 */

/**
 * 分类白名单。
 *
 * 取值用 ASCII 短码而不是中文标题：分类是**查询条件**（要进 URL、
 * 要作为数据库索引值），中文出现在 query string / 索引里既难排障
 * 也容易在不同端被无意改写。中文标题只在 `FAQ_CATEGORY_LABELS` 里给展示用。
 */
export type FaqCategory =
  | 'auth'
  | 'schedule'
  | 'dorm'
  | 'library'
  | 'network'
  | 'campus-card'
  | 'privacy'
  | 'life'
  | 'other'

export const FAQ_CATEGORIES: readonly FaqCategory[] = [
  'auth',
  'schedule',
  'dorm',
  'library',
  'network',
  'campus-card',
  'privacy',
  'life',
  'other',
]

export const FAQ_CATEGORY_LABELS: Readonly<Record<FaqCategory, string>> = {
  auth: '账号与登录',
  schedule: '选课与教务',
  dorm: '宿舍与后勤',
  library: '图书与学习',
  network: '校园网与 IT',
  'campus-card': '校园卡与支付',
  privacy: '隐私与数据',
  life: '校园生活',
  other: '其他',
}

/**
 * 文本上限 —— 与后端 `faq.controller.ts` 的 `createSchema` 完全一致。
 *
 * 客户端计数用**码点**（`[...text].length`）而后端 Zod 用 UTF-16 长度：
 * 码点数永远 ≤ UTF-16 长度，所以客户端只会更严，不会出现
 * 「本地通过、服务端 400」这种最烦人的组合。
 */
export const FAQ_QUESTION_MAX = 500
export const FAQ_ANSWER_MAX = 500
export const FAQ_TAGS_MAX = 20
export const FAQ_TAG_MAX = 64

/** 领域模型：字段与后端 `FaqEntryModel` 一一对应，时间以 ISO 字符串传输 */
export interface FaqEntry {
  id: string
  /** 问题（列表卡片的主文案） */
  question: string
  /** 答案（长文本，详情页原样换行展示） */
  answer: string
  /** 分类短码；白名单外的值（历史数据 / 管理端录入）降级显示为「其他」 */
  category: string
  tags: string[]
  /** 「有帮助」计数：服务端自增，客户端只读（+1 走领域动作） */
  helpfulCount: number
  createdAt: string
  updatedAt: string
}

export interface CreateFaqEntryInput {
  question: string
  answer: string
  category: string
  tags?: string[]
}

/** 列表筛选条件：`keyword` 会被用例翻译成后端的 `q` */
export interface FaqEntryFilters extends Record<string, unknown> {
  category?: FaqCategory
  keyword?: string
}

/** 卡片直接可读的派生视图 —— 列表页不再自己算文案 */
export interface FaqEntrySummary {
  id: string
  question: string
  categoryLabel: string
  tags: string[]
  helpfulCount: number
  /** 答案首行摘要（卡片预览用；详情页展示完整答案） */
  answerPreview: string
  createdLabel: string
}

export function isFaqCategory(value: unknown): value is FaqCategory {
  return typeof value === 'string' && (FAQ_CATEGORIES as readonly string[]).includes(value)
}

/**
 * 分类标题。
 *
 * 白名单外统一显示「其他」而不是把 `privacy` 这种内部码怼给用户 ——
 * 分类只是检索维度，用户不需要看到数据层的命名。
 */
export function categoryLabel(category: string): string {
  return isFaqCategory(category) ? FAQ_CATEGORY_LABELS[category] : FAQ_CATEGORY_LABELS.other
}

/** 答案摘要：先把换行/多空格压平，再按码点截断（不会切坏 emoji） */
export function answerPreview(answer: string, limit = 80): string {
  const flattened = answer.replace(/\s+/g, ' ').trim()
  return [...flattened].slice(0, limit).join('')
}

export function summarize(entry: FaqEntry, now: Date): FaqEntrySummary {
  return {
    id: entry.id,
    question: entry.question,
    categoryLabel: categoryLabel(entry.category),
    tags: entry.tags,
    helpfulCount: entry.helpfulCount,
    answerPreview: answerPreview(entry.answer),
    createdLabel: formatRelativeTime(entry.createdAt, now),
  }
}

/* ------------------------------------------------------------------ *
 * 校验（纯函数，用例、mock 仓储与页面共用同一份文案）
 * ------------------------------------------------------------------ */

export function questionProblem(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return '请把问题写清楚（一句话即可）'
  if ([...trimmed].length > FAQ_QUESTION_MAX) return `问题最多 ${FAQ_QUESTION_MAX} 个字`
  return null
}

export function answerProblem(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return '请填写答案'
  if ([...trimmed].length > FAQ_ANSWER_MAX) return `答案最多 ${FAQ_ANSWER_MAX} 个字`
  return null
}

/** 分类必须来自白名单：**新建时只能选白名单内**（列表 chip 用同一份） */
export function categoryProblem(category: string): string | null {
  return isFaqCategory(category) ? null : '分类不在支持范围内'
}

export function tagsProblem(tags: readonly string[]): string | null {
  if (tags.length > FAQ_TAGS_MAX) return `标签最多 ${FAQ_TAGS_MAX} 个`
  for (const tag of tags) {
    const trimmed = tag.trim()
    if (trimmed.length === 0) return '标签不能为空'
    if ([...trimmed].length > FAQ_TAG_MAX) return `单个标签最多 ${FAQ_TAG_MAX} 个字`
  }
  return null
}

/* ------------------------------------------------------------------ *
 * 标签文本 ↔ 数组（表单只收一行文本，但落库是数组）
 * ------------------------------------------------------------------ */

/**
 * 把「校园卡、补办,挂失」这类一行文本切成标签数组。
 *
 * 分隔符同时支持英文/中文逗号、顿号、分号与空白 —— 中文输入法下
 * 用户按出来的大概率是「，」和「、」，只认逗号会让他以为没生效。
 * 这里只做切分与去重，**不做截断**：标签超量要让 `tagsProblem` 报出来，
 * 静默丢掉用户写的东西比报错更糟。
 */
export function parseTagsText(text: string): string[] {
  const parts = text
    .split(/[,，、;；\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  const seen = new Set<string>()
  const tags: string[] = []
  for (const part of parts) {
    if (seen.has(part)) continue
    seen.add(part)
    tags.push(part)
  }
  return tags
}

/** 反向：标签数组 → 表单文本（编辑/回显时用，与 `parseTagsText` 成对） */
export function formatTagsText(tags: readonly string[]): string {
  return tags.join('、')
}

/**
 * 数组形态的规范化：逐项去空格并丢弃空串。
 *
 * 表单用 `parseTagsText` 已经不会产生空标签，但 `tags` 也可能来自
 * 调用方直接传数组（用例 / 仓储）。这里统一在**校验之前**规范化，
 * 免得用户那句「校园卡、」留下的尾分隔符被当成「标签不能为空」怼回去。
 */
export function normalizeTags(tags: readonly string[]): string[] {
  return tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)
}
