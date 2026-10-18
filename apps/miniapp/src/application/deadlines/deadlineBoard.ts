import {
  DEADLINE_KIND_LABELS,
  DEADLINE_SOURCE_LABELS,
  type DeadlineItem,
  type DeadlineKind,
  type DeadlineSource,
} from '@kedaya/contracts'
import {
  DEFAULT_SCHOOL_TIME_ZONE,
  deadlineUrgency,
  normalizeDeadlineTitle,
  sortByUrgency,
  summarizeDeadlines,
  type DeadlineSummary,
  type DeadlineUrgency,
} from '@kedaya/shared'

/**
 * 「DDL 聚合」页的用例（本机数据，不碰网络）。
 *
 * ## 这一轮为什么没有后端
 *
 * `packages/contracts` 只冻结了 DDL 的传输形状，采集端（浏览器扩展 / 用户粘贴）
 * 与服务端模块都还没落地。所以这一版**只读本机**：
 *   · 用户粘贴/手动补的条目落在 `DeadlineLocalStore`（微信 storage）；
 *   · 页面不伪造来源、不写「正在同步」，没有网络失败态可演。
 * 等后端模块到位时，替换的只是 `DeadlineLocalStore` 的实现与这里多一个 `load()`，
 * 页面与视图模型不用动。
 *
 * ## 时间：只用 `Asia/Shanghai`
 *
 * `summarizeDeadlines` / `sortByUrgency` / `deadlineUrgency` 的默认时区就是学校时区，
 * 这里仍然**显式传** `timeZone`：默认值在别的城市 / 别的端会变成 8 小时事故，
 * 显式传参让「这一页按北京时间算」变成可检索的事实。
 *
 * ## 视图模型为什么放在 application 而不是页面
 *
 * 相对时间（「还有 3 小时」「已逾期」）、年份补全、筛选分档都是纯计算，
 * 放在页面里就只能靠肉眼验收。这里是纯函数，单测直接喂固定 `now`。
 */

/** 学校时区（无夏令时，恒 +8）。不依赖设备时区。 */
export const SCHOOL_TIME_ZONE = DEFAULT_SCHOOL_TIME_ZONE

/** 列表筛选档位。`all` 是默认；其余三档与汇总的四个数字一一对应。 */
export type DeadlineBoardFilter = 'all' | 'overdue' | 'today' | 'thisWeek'

/** 本机存储端口：写入成功与否由 adapter 决定（微信 storage 满了不应让页面崩）。 */
export interface DeadlineLocalStore {
  read(): DeadlineItem[]
  write(items: readonly DeadlineItem[]): void
  clear(): void
}

export interface DeadlineBoardState {
  /** `idle` = 还没读过本机（页面用它画骨架屏）；读完就是 `ready`（可能是空列表） */
  status: 'idle' | 'ready'
  items: readonly DeadlineItem[]
}

export interface NewDeadlineInput {
  title: string
  courseName: string
  /** 已由 `parseDueText(raw, now, 'Asia/Shanghai')` 解析好的绝对时刻 */
  dueAt: string
  /** 平台/用户给的原文，用于核对 */
  dueAtRaw: string
  source?: DeadlineSource
  kind?: DeadlineKind
}

export interface DeadlineBoardUseCase {
  getSnapshot(): DeadlineBoardState
  subscribe(listener: () => void): () => void
  /** 同步读本机（契约 §8 第 1 步）；每次调用都重读，粘贴页写入后返回本页即可看到 */
  hydrate(): DeadlineBoardState
  /** 新增一条；标题/课程为空或时间不可解析时返回 `null`（页面给表单提示） */
  add(input: NewDeadlineInput): DeadlineItem | null
  remove(id: string): void
  /** 在「已交 / 未交」之间切换（已交的会沉到列表最后，见 `sortByUrgency`） */
  toggleSubmitted(id: string): void
  /** 清空本机全部条目 */
  clear(): void
}

export interface DeadlineBoardDeps {
  store: DeadlineLocalStore
}

const INITIAL_STATE: DeadlineBoardState = { status: 'idle', items: [] }

export function createDeadlineBoardUseCase(deps: DeadlineBoardDeps): DeadlineBoardUseCase {
  const { store } = deps

  let state: DeadlineBoardState = INITIAL_STATE
  const listeners = new Set<() => void>()

  function patch(items: readonly DeadlineItem[], status: DeadlineBoardState['status']): DeadlineBoardState {
    state = { status, items }
    for (const listener of listeners) listener()
    return state
  }

  /** 唯一的写入点：先落本机，再更新内存（顺序反了会出现「界面有、下次进来没了」） */
  function commit(items: readonly DeadlineItem[]): DeadlineBoardState {
    store.write(items)
    return patch(items, 'ready')
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    hydrate(): DeadlineBoardState {
      return patch(store.read(), 'ready')
    },
    add(input: NewDeadlineInput): DeadlineItem | null {
      const title = input.title.trim()
      const courseName = input.courseName.trim()
      if (title === '' || courseName === '') return null
      if (!Number.isFinite(Date.parse(input.dueAt))) return null

      const courseId = `manual:${courseName}`
      const item: DeadlineItem = {
        // 与粘贴解析器同一套思路：同一条 DDL 重复添加得到同一个 id，
        // 这样「再加一次」是覆盖而不是造出两条一模一样的作业。
        id: stableManualId(courseId, title, input.dueAt),
        source: input.source ?? 'manual',
        kind: input.kind ?? 'assignment',
        title,
        courseId,
        courseName,
        dueAt: input.dueAt,
        dueAtRaw: input.dueAtRaw.trim() === '' ? input.dueAt : input.dueAtRaw.trim(),
        sourceUrl: '',
        submitted: false,
        weight: null,
      }

      const rest = state.items.filter((existing) => existing.id !== item.id)
      commit([item, ...rest])
      return item
    },
    remove(id: string): void {
      const next = state.items.filter((item) => item.id !== id)
      if (next.length === state.items.length) return
      commit(next)
    },
    toggleSubmitted(id: string): void {
      commit(
        state.items.map((item) =>
          item.id === id ? { ...item, submitted: !item.submitted } : item,
        ),
      )
    },
    clear(): void {
      store.clear()
      patch([], 'ready')
    },
  }
}

/**
 * 手动条目的稳定 id（幂等：同课程 + 同标题 + 同截止时刻 → 同 id）。
 *
 * 不用 `Date.now()` / 随机数：那会让「同一份 DDL 加两次」变成两条，
 * 汇总数字随之翻倍，用户会以为自己漏了两份作业。
 */
function stableManualId(courseId: string, title: string, dueAt: string): string {
  const text = `${courseId}\u0000${normalizeDeadlineTitle(title)}\u0000${dueAt}`
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `ddl-manual-${hash.toString(16).padStart(8, '0')}`
}

/* ------------------------------------------------------------------ *
 * 视图模型（纯函数，页面只负责画）
 * ------------------------------------------------------------------ */

export interface DeadlineRowView {
  readonly id: string
  readonly title: string
  readonly courseName: string
  /** 来自契约 `DEADLINE_SOURCE_LABELS`，页面不自己编 */
  readonly sourceLabel: string
  readonly kindLabel: string
  /** 「10月20日 周二 23:59」；跨年时带年份 */
  readonly dueLabel: string
  /** 「还有 3 小时」/「已逾期 2 天」/「已提交」 */
  readonly relativeLabel: string
  readonly urgency: DeadlineUrgency
  readonly submitted: boolean
  /** 上一次采集失败、保留的旧数据（契约语义，不是「过期很久」） */
  readonly stale: boolean
}

export interface DeadlineBoardView {
  readonly summary: DeadlineSummary
  readonly rows: readonly DeadlineRowView[]
  /** 一句能帮用户决定「先做哪个」的话 */
  readonly hint: string
}

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * 把截止时刻格式化成**学校时区**的本地时间（`Asia/Shanghai`）。
 *
 * ⚠️ 不用 `new Date(iso).toLocaleString()`：那会按**设备**时区渲染，
 * 学生在伦敦打开就是伦敦时间，和平台上看到的差 8 小时。
 * `Intl.DateTimeFormat` 的 `timeZone` 是显式的，与设备设置无关。
 */
export function formatDueAt(
  iso: string,
  now: Date,
  timeZone: string = SCHOOL_TIME_ZONE,
): string {
  const dueMs = Date.parse(iso)
  if (!Number.isFinite(dueMs)) return '时间待定'

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(dueMs))

  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''

  // 同一学年内不显示年份（作业几乎都在本学期），跨年才补，避免每行都挂一个 2026
  const sameYear = pickSchoolYear(dueMs, timeZone) === pickSchoolYear(now.getTime(), timeZone)
  const yearPart = sameYear ? '' : `${pick('year')}年`
  return `${yearPart}${pick('month')}月${pick('day')}日 ${pick('weekday')} ${pick('hour')}:${pick('minute')}`
}

function pickSchoolYear(epochMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
  }).formatToParts(new Date(epochMs))
  return parts.find((part) => part.type === 'year')?.value ?? ''
}

/**
 * 相对当前时刻的倒计时文案。已逾期时**必须**出现「已逾期」三个字 ——
 * 只写「-3 小时」或把过期条目排在最前面都不够，用户会以为自己还有时间。
 */
export function formatRelativeDue(iso: string, now: Date): string {
  const dueMs = Date.parse(iso)
  if (!Number.isFinite(dueMs)) return '时间待定'

  const diff = dueMs - now.getTime()
  if (diff <= 0) return `已逾期 ${formatSpan(-diff)}`
  return `还有 ${formatSpan(diff)}`
}

/** 时长分档：分钟（向上取整，不显示 0 分钟）→ 小时 → 天（向下取整，不夸大剩余时间） */
function formatSpan(ms: number): string {
  if (ms < HOUR_MS) return `${Math.max(1, Math.ceil(ms / MINUTE_MS))} 分钟`
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)} 小时`
  return `${Math.floor(ms / DAY_MS)} 天`
}

/** 列表排序 + 汇总 + 筛选，一次算完。页面每 30 秒用新的 `now` 重算即可。 */
export function buildDeadlineBoardView(
  items: readonly DeadlineItem[],
  now: Date,
  filter: DeadlineBoardFilter = 'all',
  timeZone: string = SCHOOL_TIME_ZONE,
): DeadlineBoardView {
  const summary = summarizeDeadlines(items, now, timeZone)

  // 排序交给 shared：已逾期 → 今天 → 本周 → 更远 → 已提交 → 时间未知
  const rows = sortByUrgency(items, now, timeZone)
    .map((item) => toRow(item, now, timeZone))
    .filter((row) => matchesFilter(row, filter))

  return { summary, rows, hint: buildHint(summary) }
}

function toRow(item: DeadlineItem, now: Date, timeZone: string): DeadlineRowView {
  const urgency: DeadlineUrgency = item.submitted
    ? 'done'
    : deadlineUrgency(item.dueAt, now, timeZone)

  return {
    id: item.id,
    title: item.title,
    courseName: item.courseName,
    sourceLabel: DEADLINE_SOURCE_LABELS[item.source] ?? item.source,
    kindLabel: DEADLINE_KIND_LABELS[item.kind] ?? item.kind,
    dueLabel: formatDueAt(item.dueAt, now, timeZone),
    relativeLabel: item.submitted ? '已提交' : formatRelativeDue(item.dueAt, now),
    urgency,
    submitted: item.submitted,
    stale: item.stale === true,
  }
}

function matchesFilter(row: DeadlineRowView, filter: DeadlineBoardFilter): boolean {
  if (filter === 'all') return true
  return row.urgency === filter
}

function buildHint(summary: DeadlineSummary): string {
  if (summary.overdue > 0) return `${summary.overdue} 条已经过了截止时间，先处理它们。`
  if (summary.dueToday > 0) return `今天还有 ${summary.dueToday} 条要交。`
  if (summary.dueThisWeek > 0) return `本周还有 ${summary.dueThisWeek} 条，别等到周末。`
  if (summary.total === 0) return '还没有记录，先粘贴或手动加一条。'
  return '没有临期的 DDL，喘口气。'
}
