/**
 * 统一课程 DDL · wire 契约
 *
 * ## 问题
 *
 * 上科大学生的截止日期散落在至少五个地方：
 * Blackboard（作业/测验）、Gradescope（编程作业）、Piazza（讨论里的截止）、
 * ecourse e云平台（课件与作业）、教务系统（考试）。每个平台的日期格式、
 * 时区假设、字段名都不同。学生要开五个标签页才能知道"今天有什么要交"。
 *
 * ## 这个契约做什么
 *
 * 把五个来源归一成**一种** `DeadlineItem`，让三端只需要理解一种形状。
 *
 * ## ⚠️ 它明确不做什么
 *
 * 1. **不采集**。本文件只有类型，没有网络请求。采集是独立的事（见下）。
 * 2. **不存凭据**。任何平台的密码、Cookie、session 都不进这个模型。
 * 3. **不猜日期**。认不出的日期文本就是 `null`，由调用方决定是丢弃还是让用户手填。
 *
 * ## 采集该怎么做（重要）
 *
 * **不要**在服务端存学生各平台密码然后代登录 —— 这违反各平台 ToS，
 * 且会让我们的数据库变成高价值攻击目标。
 *
 * 正确的架构是**浏览器扩展读取用户本机已登录的会话**：
 * - 用户先在自己浏览器里手动登录各平台
 * - 扩展只读**课程页面的 DOM**，不碰密码框
 * - 一次性配对码把扩展绑定到用户账号
 * - 只读：不发邮件、不提交作业、不发帖
 *
 * 这条边界与 `docs/architecture/08-reference-merge-plan.md` 的裁决一致。
 */

/* ------------------------------------------------------------------ *
 * 来源
 * ------------------------------------------------------------------ */

export const DEADLINE_SOURCES = ['blackboard', 'gradescope', 'piazza', 'ecourse', 'manual'] as const;
export type DeadlineSource = (typeof DEADLINE_SOURCES)[number];

export const DEADLINE_SOURCE_LABELS: Readonly<Record<DeadlineSource, string>> = {
  blackboard: 'Blackboard',
  gradescope: 'Gradescope',
  piazza: 'Piazza',
  ecourse: 'e云平台（ecourse）',
  manual: '手动添加',
};

/* ------------------------------------------------------------------ *
 * 种类
 * ------------------------------------------------------------------ */

export const DEADLINE_KINDS = [
  'assignment',
  'quiz',
  'exam',
  'project',
  'reading',
  'other',
] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];

export const DEADLINE_KIND_LABELS: Readonly<Record<DeadlineKind, string>> = {
  assignment: '作业',
  quiz: '测验',
  exam: '考试',
  project: '项目',
  reading: '阅读',
  other: '其他',
};

/* ------------------------------------------------------------------ *
 * 数据形状
 * ------------------------------------------------------------------ */

/** 一条归一后的截止事项（wire） */
export interface DeadlineItem {
  /** 稳定 id（跨平台去重后的主键） */
  readonly id: string;
  /** 主来源（多条来源合并时取优先级最高的那个） */
  readonly source: DeadlineSource;
  /**
   * 全部来源。同一作业在 BB 与 Piazza 都出现时这里会有两项，
   * 前端据此显示"也在 Piazza 上"。
   */
  readonly sources: readonly DeadlineSource[];
  readonly kind: DeadlineKind;
  readonly title: string;
  /** 课程标识（各平台自己的 id；跨平台不一定一致） */
  readonly courseId: string | null;
  readonly courseName: string | null;
  /**
   * 截止时刻（ISO 8601，含时区偏移）。
   *
   * ⚠️ **这是绝对时刻，不是本地字面时间**。平台的原始文本在 `dueAtRaw` 里。
   * 解析时区必须是**学校时区**（Asia/Shanghai），不是浏览器时区 ——
   * 详见 `packages/shared/src/deadline-normalize.ts` 的注释。
   */
  readonly dueAt: string | null;
  /** 平台原始日期文本，供用户核对 */
  readonly dueAtRaw: string;
  /** 回源链接（拿不到就省略该键，不下发 null） */
  readonly sourceUrl?: string;
  readonly submitted: boolean;
  /** 占总评的比例（%）。拿不到就省略该键 */
  readonly weightPercent?: number;
  /** 本次采集时刻，用于判断数据新旧 */
  readonly fetchedAt: string;
  /** 数据是否来自缓存（采集失败时保留上次结果） */
  readonly stale: boolean;
}

/** 给首页用的汇总 */
export interface DeadlineSummary {
  readonly overdue: number;
  readonly dueToday: number;
  readonly dueThisWeek: number;
  readonly total: number;
}

/* ------------------------------------------------------------------ *
 * 时区（唯一真相）
 * ------------------------------------------------------------------ */

/**
 * 学校时区。
 *
 * ⚠️ **所有日期解析必须用它**，不能用浏览器/服务器本地时区。
 * 原因：学生在国外访问时，`new Date('2026-10-20 23:59')` 会按他所在时区解释，
 * 于是"今晚 23:59 截止"会变成第二天，直接导致迟到。
 */
export const CAMPUS_TIMEZONE = 'Asia/Shanghai';

/** 学校时区相对 UTC 的固定偏移（上海无夏令时，恒 +8） */
export const CAMPUS_UTC_OFFSET_MINUTES = 8 * 60;

/* ------------------------------------------------------------------ *
 * 边界常量
 * ------------------------------------------------------------------ */

/** 跨平台去重的截止时刻容差（毫秒）。5 分钟内的同一时刻视为同一条。 */
export const DEADLINE_DEDUPE_TOLERANCE_MS = 5 * 60 * 1000;

/** 标题归一后用于判重的最长长度（过长的标题截断后再比，避免尾注差异导致漏判） */
export const DEADLINE_TITLE_DEDUPE_MAX = 80;
