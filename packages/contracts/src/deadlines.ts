/**
 * 统一课程 DDL · wire 契约
 *
 * 用户诉求原话：「抓取 gradescope、blackboard、ecourse e云平台、piazza 等的信息
 * 来统一给出课程 ddl」。本文件只冻结**跨端传输形状与枚举**，不冻结采集方式。
 *
 * ## 这个文件冻结什么
 *
 *   · 平台来源枚举（`DeadlineSource`）—— 采集端、服务端、三端 UI 共用同一套 key；
 *   · 截止类型枚举（`DeadlineKind`）—— 用于筛选与图标，不参与判重；
 *   · 单条 DDL 的 DTO（`DeadlineItem`）。
 *
 * ## 不冻结什么（以及为什么本模块**不做**采集）
 *
 * 1. **不做网络请求**。采集是独立的事（浏览器扩展 / 用户粘贴 / 服务端任务），
 *    它要处理登录态、验证码、页面结构漂移。把这些混进共享契约，会让一个
 *    「日期解析」bug 的修复范围变成「整条采集链路」。共享层只接收**已经抓到的文本**。
 * 2. **不存任何平台凭据**。`DeadlineItem` 里没有 token / cookie / 学号密码字段，
 *    将来也不要加 —— 凭据只能留在采集端本地（扩展 storage / 系统钥匙串）。
 * 3. **不编平台 API 地址**。`sourceUrl` 是采集端给出的**回源链接**（用户点开去核对），
 *    不是我们调用的接口。各平台是否有稳定 API：**未确认**，不要按「有 API」设计。
 * 4. **采集失败不清空**。采集端在上游失败时必须保留上一次成功的结果，并把这些条目
 *    标 `stale: true`（见下），而不是返回空数组 —— 否则用户会以为作业被取消了。
 *
 * ## 与 `@kedaya/shared` 的关系
 *
 * 解析 / 判重 / 排序 / 汇总的纯函数在 `@kedaya/shared` 的 `deadline-normalize`
 * 模块里。该包按设计**零依赖**（不 import 本包），所以它用结构等价的类型来接收
 * `DeadlineItem`（`DeadlineItemLike` / `MergedDeadlineItem`）。
 * **改这里的字段必须同步改那里**：字段名、可空性、枚举值都要一致。
 */

/**
 * 平台来源（冻结）。
 *
 * `manual` 表示用户手填/粘贴 —— 它不是「失败兜底」，而是合法来源：
 * 拿不到登录态的课程，用户宁可手动补一条也不要看空列表。
 */
export const DEADLINE_SOURCES = Object.freeze([
  'blackboard',
  'gradescope',
  'piazza',
  'ecourse',
  'manual',
] as const);

export type DeadlineSource = (typeof DEADLINE_SOURCES)[number];

/** 来源展示名。UI 只做 i18n 时改这里，不要在各端各写一份 */
export const DEADLINE_SOURCE_LABELS: Readonly<Record<DeadlineSource, string>> = Object.freeze({
  blackboard: 'Blackboard',
  gradescope: 'Gradescope',
  piazza: 'Piazza',
  ecourse: 'e云平台',
  manual: '手动添加',
});

/**
 * 截止类型（冻结）。
 *
 * 只影响展示（图标/筛选），**不参与判重** —— 同一个作业在 BB 标 `assignment`、
 * 在 Piazza 标 `quiz` 时仍应合并成一条（判重看 courseId + 标题 + 时间）。
 */
export const DEADLINE_KINDS = Object.freeze([
  'assignment',
  'quiz',
  'exam',
  'project',
  'reading',
  'other',
] as const);

export type DeadlineKind = (typeof DEADLINE_KINDS)[number];

export const DEADLINE_KIND_LABELS: Readonly<Record<DeadlineKind, string>> = Object.freeze({
  assignment: '作业',
  quiz: '测验',
  exam: '考试',
  project: '项目',
  reading: '阅读',
  other: '其他',
});

/**
 * 一条统一后的课程截止项（wire DTO）。
 *
 * ## 时间字段为什么有两个
 *
 * `dueAt` 是**绝对时刻**（ISO-8601 UTC），用于排序 / 计算「还有几小时」。
 * `dueAtRaw` 是**平台原样文本**（如 `Oct 20, 2026 11:59 PM`），只用于让用户核对。
 *
 * 解析原始文本时**必须显式传学校时区**（`Asia/Shanghai`），不能依赖浏览器本地时区：
 * 这些平台按学校时区渲染，用户在别的时区打开浏览器时若用本地时区解析，
 * 会整体偏移 8 小时。解析函数见 `@kedaya/shared` 的 `parseDueText`。
 *
 * 认不出的文本一律**不猜**：解析函数返回 `null`，采集端不要伪造 `dueAt`，
 * 宁可丢弃该条并提示用户手填。
 */
export interface DeadlineItem {
  /** 稳定 id（采集端生成；跨次采集应保持一致，否则合并会退化成重复项） */
  readonly id: string;
  /** 主来源（同一作业被多平台收录时，合并后取优先级最高的那个） */
  readonly source: DeadlineSource;
  /** 类型（仅展示） */
  readonly kind: DeadlineKind;
  /** 标题（平台原文；合并时以此条为准，判重前会做归一化） */
  readonly title: string;
  /** 课程 id（平台内稳定即可；判重第一依据） */
  readonly courseId: string;
  /** 课程名（展示用；平台文案可能是 `CS101-01` 这类原始串） */
  readonly courseName: string;
  /** 截止绝对时刻，ISO-8601 UTC（`2026-10-20T15:59:00.000Z`） */
  readonly dueAt: string;
  /** 原始日期文本，供核对；不要用它做排序 */
  readonly dueAtRaw: string;
  /** 回源链接：用户点开去该平台上核对/提交 */
  readonly sourceUrl: string;
  /** 是否已提交（平台可见状态；未知时按 `false` 处理并保留原文提示） */
  readonly submitted: boolean;
  /**
   * 占总评比例（%，0–100）。平台不给就是 `null` —— **不要估**。
   * 上游可能给小数（如 `12.5`），因此是 `number` 而不是整数分。
   */
  readonly weight: number | null;
  /**
   * 本条是「上一次成功采集的结果」：本次采集失败，保留旧数据。
   *
   * 语义只有这一个 —— **不要**拿它表示「课程已结束」「数据过期很久」。
   * 没有该字段 = 本次采集正常。采集失败时**不得清空列表**。
   */
  readonly stale?: boolean;
}
