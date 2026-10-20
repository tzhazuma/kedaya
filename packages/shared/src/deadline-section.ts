/**
 * 课程 DDL · 作业分区（三端共用）
 *
 * ## 出处（合并声明）
 *
 * 移植自 **campusMate**（`David-goldenman/Shanghaitech-2026-Hackthon`）的
 * `backend/services/campus/assignments.py`（`section()` / `historical()` /
 * `availability()` / `term_rank()`）。来源项目：campusMate（Shanghaitech 2026
 * 黑客松参赛组）。合并授权：项目负责人唐志昊确认三个参赛项目已同意合并。
 *
 * 上游是 Python + FastAPI 的服务端逻辑，这里重写成零依赖纯函数，并**去掉**了
 * 与它自身存储/接口耦合的部分（`filter_issues`、手动覆盖的读写）。判据本身逐条保留，
 * 因为这套判据解决的正是我们最容易犯的错：把「读不到」当成「没交」。
 *
 * ## 为什么我们的 `deadlineUrgency` 不够
 *
 * `deadline-normalize` 的 `deadlineUrgency` 是**纯时间**分档（逾期/今天/本周/更远）。
 * 它回答「什么时候到期」，不回答「这条还需要我做事吗」。两者缺一不可：
 *
 * - 一门**上学期**的课，平台侧还显示 open、提交状态也读不到 —— 纯时间分档会说「逾期」，
 *   于是首页天天飘着上学期的红字；
 * - 一条**已评分**的作业，到期时间在昨天 —— 纯时间分档会说「逾期」，可学生已经交了。
 *
 * 所以本模块在时间之上再叠三个正交信号：**学期**、**提交/评分**、**来源开放状态**。
 *
 * ## 五个分区（与上游一致）
 *
 * | 分区 | 含义 | 判据 |
 * | --- | --- | --- |
 * | `pending` | 待完成 | 本学期、来源开放、未提交、未过截止 |
 * | `late` | 已逾期且未交 | 本学期、来源开放、未提交、已过截止 |
 * | `graded` | 已评分 | 有数值成绩（**0 分也是成绩**） |
 * | `completed` | 已提交待出分 | 已提交、无成绩 |
 * | `ended` | 已结束 | 历史学期 / 来源已关闭 / 开放状态未知且来源明确说不可行动 |
 *
 * 判定顺序**不可调换**（顺序本身就是业务规则）：
 *
 * ```
 * 历史学期 → ended
 * 已提交或有分数 → graded / completed
 * 来源非 open → ended
 * 过了截止 → late，否则 pending
 * ```
 *
 * 「已提交」排在「来源关闭」之前，是因为**提交是终态**：平台后来把作业关了，
 * 不代表学生没交。上游注释里专门写了这一点。
 *
 * ## 与上游的两处有意差异
 *
 * 1. **`availability` 缺省时不拿它判**。
 *    上游每个条目都带 `availability`（读不到时归一成 `unknown`），`unknown != open`
 *    就直接进 `ended`。我们的契约（`@kedaya/contracts` 的 `DeadlineItem`）没有这个字段，
 *    如果照搬，所有条目都会落进 `ended`。所以这里只在**调用方显式给了**状态时才用它：
 *    没给 → 按截止时间判。这不是放宽标准，是把「未知」和「关闭」分开。
 * 2. **学期排名用字符串解析，不查数据库**。上游的 `semester()` 会去读它自己的学分制
 *    元数据；这里只认 `2026-fall` / `Fall 2026` / `2026-秋` 这几种标签形态。
 *    认不出就返回 `null`（不排名），退化为 `semesterStart` 判据 —— 不猜学期。
 *
 * ## 边界
 *
 * - 纯函数：不读时钟（`now` 必传）、不碰数据库、不发请求；
 * - 不改入参，`partitionDeadlines` 返回新数组，组内保持输入顺序（幂等、可快照测试）；
 * - 时区只影响「按自然日比较」，默认学校时区，调用方可以覆盖。
 */

import { DEFAULT_SCHOOL_TIME_ZONE } from './deadline-normalize';

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

/** 五个分区（冻结顺序：UI 的分组顺序就是它） */
export const DEADLINE_SECTIONS = Object.freeze([
  'pending',
  'late',
  'graded',
  'completed',
  'ended',
] as const);

export type DeadlineSection = (typeof DEADLINE_SECTIONS)[number];

/**
 * 来源自己的开放状态。
 *
 * `scheduled` = 还没到开放时间；`closed` = 已结束；`unknown` = 读不到。
 * 三个都不是 `open`，都不该出现在待办里 —— 但**只在调用方明确给了这个字段时**才生效。
 */
export const DEADLINE_AVAILABILITIES = Object.freeze([
  'open',
  'scheduled',
  'closed',
  'unknown',
] as const);

export type DeadlineAvailability = (typeof DEADLINE_AVAILABILITIES)[number];

/** 学期季节。排名用 `spring < summer < fall` */
export type DeadlineTermSeason = 'spring' | 'summer' | 'fall';

/** 解析出的学期 */
export interface DeadlineTermRank {
  readonly year: number;
  readonly season: DeadlineTermSeason;
}

/** 分区判据需要的字段（结构类型，`DeadlineItem` 可以直接传进来） */
export interface DeadlineSectionInput {
  /** 截止时刻（任意 `Date.parse` 认得的写法）；缺省/非法视为「时间待定」 */
  readonly dueAt?: string | null;
  /** 是否已提交。`null` / `undefined` = 读不到（**不是**未提交） */
  readonly submitted?: boolean | null;
  /** 分数。`0` 是合法成绩；`null` / `undefined` = 没出分 */
  readonly score?: number | null;
  /** 来源开放状态。缺省 = 调用方不知道，不影响判定 */
  readonly availability?: DeadlineAvailability | null;
  /** 课程学期标签，如 `Fall 2026` */
  readonly courseTerm?: string | null;
  /** 平台明确标注「这不是本学期课程」时为 `false` */
  readonly courseCurrent?: boolean | null;
}

/** 分区上下文 */
export interface DeadlineSectionContext {
  /** 当前时刻（**必传**，不读时钟） */
  readonly now: Date;
  /** 学校时区，用于「按自然日」比较；默认 `Asia/Shanghai` */
  readonly timeZone?: string;
  /** 当前学期标签 */
  readonly currentTerm?: string | null;
  /** 本学期第一天的 `YYYY-MM-DD`；用于判断「这条属于更早的学期」 */
  readonly semesterStart?: string | null;
}

/* ------------------------------------------------------------------ *
 * 学期
 * ------------------------------------------------------------------ */

const SEASON_ORDER: Readonly<Record<DeadlineTermSeason, number>> = Object.freeze({
  spring: 0,
  summer: 1,
  fall: 2,
});

/**
 * 解析学期标签。
 *
 * 认得的形态：`Fall 2026` / `2026-fall` / `2026-fall-semester` / `2026-秋` /
 * `2026-autumn` / `spring 2027`。**认不出返回 `null`**，不猜。
 * `winter` 不在其中：上科大没有冬季学期，把它当 `fall` 会让跨年判断错。
 */
export function parseTermRank(term: string | null | undefined): DeadlineTermRank | null {
  if (typeof term !== 'string') return null;
  const yearMatch = /(20\d{2})/.exec(term);
  if (yearMatch === null) return null;

  let season: DeadlineTermSeason;
  if (/spring|春/i.test(term)) season = 'spring';
  else if (/summer|暑|夏/i.test(term)) season = 'summer';
  else if (/fall|autumn|秋/i.test(term)) season = 'fall';
  else return null;

  return { year: Number(yearMatch[1]), season };
}

/** 学期是否更早（`null` 参与比较时一律返回 `false` —— 不知道就不判） */
function isEarlierTerm(course: DeadlineTermRank | null, current: DeadlineTermRank | null): boolean {
  if (course === null || current === null) return false;
  if (course.year !== current.year) return course.year < current.year;
  return SEASON_ORDER[course.season] < SEASON_ORDER[current.season];
}

/* ------------------------------------------------------------------ *
 * 自然日比较
 * ------------------------------------------------------------------ */

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

/** 某绝对时刻在指定时区的 `YYYY-MM-DD` */
function localDateKey(epochMs: number, timeZone: string): string | null {
  let formatter = dateFormatterCache.get(timeZone);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      return null; // 非法 IANA 时区：不判，而不是悄悄用本地时区
    }
    dateFormatterCache.set(timeZone, formatter);
  }

  const parts = formatter.formatToParts(new Date(epochMs));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (year === undefined || month === undefined || day === undefined) return null;
  return `${year}-${month}-${day}`;
}

/** `YYYY-MM-DD` 形态校验（只做格式，不做闰年判断 —— 它只用于字符串比较） */
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ *
 * 历史学期
 * ------------------------------------------------------------------ */

/**
 * 是否是「上学期及更早」的作业。
 *
 * 三条判据任意成立即历史：
 * 1. 课程学期排名早于当前学期；
 * 2. 平台明确标了 `courseCurrent === false`；
 * 3. 截止日（按学校时区的自然日）早于本学期第一天。
 *
 * 第 3 条是兜底：很多条目没有学期标签，但有学期起始日。
 * 反过来，**只有** `semesterStart` 而没有截止时间的条目**不算**历史 —— 没时间就不判。
 */
export function isHistoricalDeadline(
  input: DeadlineSectionInput,
  context: DeadlineSectionContext,
): boolean {
  if (input.courseCurrent === false) return true;

  if (isEarlierTerm(parseTermRank(input.courseTerm), parseTermRank(context.currentTerm))) {
    return true;
  }

  const semesterStart = context.semesterStart;
  if (typeof semesterStart !== 'string' || !DATE_KEY_RE.test(semesterStart)) return false;

  const dueMs = typeof input.dueAt === 'string' ? Date.parse(input.dueAt) : Number.NaN;
  if (!Number.isFinite(dueMs)) return false;

  const dueKey = localDateKey(dueMs, context.timeZone ?? DEFAULT_SCHOOL_TIME_ZONE);
  return dueKey !== null && dueKey < semesterStart;
}

/* ------------------------------------------------------------------ *
 * 分区
 * ------------------------------------------------------------------ */

/**
 * 给一条作业分区。
 *
 * 这是首页、课程详情、通知三个地方共用的唯一判定，不要在 UI 里另写一套。
 */
export function classifyDeadlineSection(
  input: DeadlineSectionInput,
  context: DeadlineSectionContext,
): DeadlineSection {
  // 1) 历史学期优先：旧学期即使来源还显示 open、提交状态读不到，也不再提醒
  if (isHistoricalDeadline(input, context)) return 'ended';

  // 2) 提交是终态：已提交有分数 → graded；已提交无分数 → completed
  if (input.submitted === true || (typeof input.score === 'number' && Number.isFinite(input.score))) {
    return typeof input.score === 'number' && Number.isFinite(input.score) ? 'graded' : 'completed';
  }

  // 3) 来源明确说「没开放」→ 不进入待办（缺省时不判，见文件头差异说明）
  const availability = input.availability;
  if (availability !== undefined && availability !== null && availability !== 'open') return 'ended';

  // 4) 时间：过了截止就是 late，否则 pending。时间待定 → pending（可行动）
  const dueMs = typeof input.dueAt === 'string' ? Date.parse(input.dueAt) : Number.NaN;
  if (!Number.isFinite(dueMs)) return 'pending';

  return dueMs <= context.now.getTime() ? 'late' : 'pending';
}

/** 按分区归类（组内保持输入顺序） */
export function partitionDeadlines<T extends DeadlineSectionInput>(
  items: readonly T[],
  context: DeadlineSectionContext,
): Readonly<Record<DeadlineSection, readonly T[]>> {
  const groups: Record<DeadlineSection, T[]> = {
    pending: [],
    late: [],
    graded: [],
    completed: [],
    ended: [],
  };

  for (const item of items) {
    groups[classifyDeadlineSection(item, context)].push(item);
  }

  return groups;
}

/* ------------------------------------------------------------------ *
 * 与上游的字段对照
 * ------------------------------------------------------------------ *
 *
 * | campusMate | 本模块 | 说明 |
 * | --- | --- | --- |
 * | `submitted` (三态) | `submitted?: boolean \| null` | `null` = 读不到 |
 * | `score` | `score?: number \| null` | `0` 是成绩，不是缺失 |
 * | `availability` | `availability?: DeadlineAvailability \| null` | 缺省不判 |
 * | `due_at` | `dueAt?: string \| null` | 任意可解析写法 |
 * | `course.term` / `course.current` | `courseTerm` / `courseCurrent` | 拍平，少一层对象 |
 * | `current`（当前学期） | `currentTerm` | 同上 |
 * | `start`（学期第一天） | `semesterStart` | 只认 `YYYY-MM-DD` |
 */
