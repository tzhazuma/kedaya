/**
 * 校园活动 · wire 契约
 *
 * 用户诉求：把知枢的「校园活动 / 邮箱通知 / 日程」能力并进可达鸭。
 *
 * ## 为什么活动是**独立域**，不塞进 `deadlines`
 *
 * 课程 DDL 回答「什么时候交作业」，活动回答「什么时候去哪参加什么」。
 * 两者都会出现在日程里，但字段、来源、生命周期完全不同：
 *   · DDL 的来源是课程平台，活动来源是校园邮件 / 公众号单篇 / 手动；
 *   · DDL 创建即生效，活动必须先以 `candidate` 落库，**用户确认后**才进入活动
 *     日程视图并支持 ICS / 系统日历导出与提醒（不写入课程课表）；
 *   · 活动有报名截止、地点、主办方，DDL 没有。
 * 混在一张表里会让「确认门」和「判重逻辑」互相污染，所以单独成域。
 *
 * ## 三条隐私边界（写死在类型里）
 *
 * 1. **只存活动字段 + ≤200 字证据片段**。`evidenceText` 不是邮件正文、不是公众号全文，
 *    只是让用户核对「这条是怎么抽出来的」的一小段。附件、图片正文、完整 HTML 都不进库。
 * 2. **来源只有三种**：校园邮箱（`campus-mail`）、用户主动提交的单篇公众号文章
 *    （`wechat-mp`）、手动（`manual`）。**没有**自动发现、批量历史抓取或反检测来源。
 * 3. **不做「假的已接通」**。提醒渠道枚举里有 `wechat-subscribe`，但 MVP 只实现
 *    `inapp`（站内信）；微信订阅消息 / APNs / FCM / HMS 未接线前不得写成已送达。
 *
 * ## 与 `@kedaya/shared` 的关系
 *
 * 抽取、ICS 导出、默认提醒的纯函数在 `@kedaya/shared` 的 `activities-*` 模块里。
 * 该包按设计零依赖，所以它用结构等价的类型接收条目；**改字段必须同步改那边**。
 */

/* ------------------------------------------------------------------ *
 * 来源 / 类型 / 状态
 * ------------------------------------------------------------------ */

/**
 * 活动来源（冻结）。
 *
 * ⚠️ 不要为了「多抓一点」新增 `wechat-auto` / `email-auto`：
 * 微信没有公开的公众号历史文章 API，邮箱也只做用户已授权账号的只读 IMAP。
 * 自动发现既不合规，也无法保证用户能核对来源。
 */
export const ACTIVITY_SOURCES = Object.freeze(['campus-mail', 'wechat-mp', 'manual'] as const);

export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export const ACTIVITY_SOURCE_LABELS: Readonly<Record<ActivitySource, string>> = Object.freeze({
  'campus-mail': '校园邮箱',
  'wechat-mp': '微信公众号',
  manual: '手动添加',
});

/**
 * 活动类型（仅展示与筛选，不参与判重）。
 *
 * 取值是 API 与小程序两端现有实现的**并集**：
 * API 用 `lecture / meeting / info-session / other`，小程序另有 `sports / club`。
 * 不要为了一端删掉另一端已经在用的值 —— 那会让手动录入在另一端被 422。
 */
export const ACTIVITY_KINDS = Object.freeze([
  'lecture',
  'meeting',
  'info-session',
  'sports',
  'club',
  'other',
] as const);

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Readonly<Record<ActivityKind, string>> = Object.freeze({
  lecture: '讲座',
  meeting: '会议',
  'info-session': '宣讲',
  sports: '体育活动',
  club: '社团活动',
  other: '其他',
});

/**
 * 活动状态（冻结）。
 *
 * `candidate` 是**默认落库状态**：抽取/导入只产生候选，不产生日程。
 * 只有 `confirmed` 才能出现在活动日程视图、ICS 导出与提醒派发里
 * （不写入课程课表）；
 * `dismissed` / `archived` 只是保留审计与「别再来烦我」的语义。
 */
export const ACTIVITY_STATUSES = Object.freeze([
  'candidate',
  'confirmed',
  'dismissed',
  'archived',
] as const);

export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_STATUS_LABELS: Readonly<Record<ActivityStatus, string>> = Object.freeze({
  candidate: '待确认',
  confirmed: '已确认',
  dismissed: '已忽略',
  archived: '已归档',
});

/* ------------------------------------------------------------------ *
 * 提醒
 * ------------------------------------------------------------------ */

export const ACTIVITY_REMINDER_KINDS = Object.freeze([
  'registration',
  'start',
  'custom',
] as const);

export type ActivityReminderKind = (typeof ACTIVITY_REMINDER_KINDS)[number];

/**
 * 提醒渠道。
 *
 * MVP 只接通 `inapp`（站内信）。`wechat-subscribe` 是预留枚举：
 * 在真正拿到用户订阅授权并完成服务端发送之前，**不要**把提醒标成已通过微信送达。
 */
export const ACTIVITY_REMINDER_CHANNELS = Object.freeze(['inapp', 'wechat-subscribe'] as const);

export type ActivityReminderChannel = (typeof ACTIVITY_REMINDER_CHANNELS)[number];

export const ACTIVITY_REMINDER_STATUSES = Object.freeze([
  'pending',
  'sending',
  'sent',
  'failed',
  'cancelled',
] as const);

export type ActivityReminderStatus = (typeof ACTIVITY_REMINDER_STATUSES)[number];

/**
 * 提醒列表的 `status` 查询过滤。
 *
 * `scheduled` 是**别名**，不是落库状态：服务端把它解释为 `pending + sending`
 * （「已排期但还没发完」）。客户端不要把它写进 `ActivityReminderItem.status`。
 */
export const ACTIVITY_REMINDER_STATUS_FILTERS = Object.freeze([
  ...ACTIVITY_REMINDER_STATUSES,
  'scheduled',
] as const);

export type ActivityReminderStatusFilter = (typeof ACTIVITY_REMINDER_STATUS_FILTERS)[number];

/* ------------------------------------------------------------------ *
 * 冻结常量
 * ------------------------------------------------------------------ */

/** 证据片段上限（字）。超过一律截断，不存正文。 */
export const ACTIVITY_EVIDENCE_MAX_CHARS = 200;

/** 学校时区。传输层存 UTC ISO，解析与展示按这里解释。 */
export const ACTIVITY_TIMEZONE = 'Asia/Shanghai';

/**
 * 默认提醒提前量。
 *
 * - 报名截止前 24 小时；
 * - 活动开始前 1 小时；
 * - 若「目标 - 提前量」已过但目标还在未来，则退回 now + 5 分钟
 *   （且不得晚于目标本身）。
 *
 * ⚠️ 与 `@kedaya/shared` 的 `activities-reminders.ts` 保持同步。
 */
export const ACTIVITY_DEFAULT_REMINDER_LEADS = Object.freeze({
  registrationMs: 24 * 60 * 60 * 1000,
  startMs: 60 * 60 * 1000,
  fallbackDelayMs: 5 * 60 * 1000,
});

/* ------------------------------------------------------------------ *
 * DTO
 * ------------------------------------------------------------------ */

/**
 * 一条校园活动（wire DTO）。
 *
 * 时间字段：
 *   · `startsAt` / `endsAt` / `registrationDeadlineAt` 是**绝对时刻**（ISO-8601 UTC），
 *     无法确定就是 `null` —— **不要**编一个「当天 23:59」；
 *   · `registrationDeadlineRaw` 是原文（如 `10月23日`），即使 `registrationDeadlineAt`
 *     为 `null` 也保留，让用户能核对「原文只写了日期」。
 */
export interface ActivityItem {
  /** 稳定 id（服务端生成） */
  readonly id: string;
  /** 来源（冻结枚举；没有自动发现） */
  readonly source: ActivitySource;
  /** 类型（仅展示/筛选） */
  readonly kind: ActivityKind;
  /** 标题 */
  readonly title: string;
  /** 开始时刻，ISO-8601 UTC；未知为 `null` */
  readonly startsAt: string | null;
  /** 结束时刻，ISO-8601 UTC；未知为 `null`（不要猜时长） */
  readonly endsAt: string | null;
  /** 地点；未知为 `null` */
  readonly location: string | null;
  /** 主办方；未知为 `null` */
  readonly organizer: string | null;
  /** 报名截止绝对时刻，ISO-8601 UTC；原文只有日期时为 `null` */
  readonly registrationDeadlineAt: string | null;
  /** 报名截止原文（如 `10月23日`、`本周五`）；没有则 `null` */
  readonly registrationDeadlineRaw: string | null;
  /** 报名链接（已去会话参数）；没有则 `null` */
  readonly registrationUrl: string | null;
  /** ≤200 字证据片段（不是邮件正文 / 公众号全文） */
  readonly evidenceText: string;
  /** 抽取置信度 0–1；仅用于排序/提示，不能替代用户确认 */
  readonly confidence: number;
  /** 状态；新导入默认 `candidate` */
  readonly status: ActivityStatus;
  /** 回源链接（公众号文章 / 邮件原文入口）；没有则 `null` */
  readonly sourceUrl: string | null;
  /** 来源展示名（公众号名 / 邮箱主题前缀 / 手动）；`null` 时客户端回落到来源枚举的默认文案 */
  readonly sourceLabel: string | null;
  /** 原文发布时间，ISO-8601 UTC；未知为 `null` */
  readonly publishedAt: string | null;
  /**
   * 本条来自上一次成功同步：本次拉取失败，保留旧数据。
   * 语义只有这一个 —— 不要拿它表示「活动已结束」。
   */
  readonly stale: boolean;
}

/**
 * 多候选导入的响应（邮件提升 / 批量导入）。
 *
 * `item` 是第一条（没有则为 `null`），`items` 是本次成功落库的全部候选；
 * `created` 是新建条数，`skipped` 是因判重或已存在而跳过的条数。
 *
 * 单篇公众号导入也用它：一篇文章可能识别出多场活动，所以同样是
 * `{ item, items, created, skipped }`，而不是只有一个 `item`。
 */
export interface ActivityImportResult {
  readonly item: ActivityItem | null;
  readonly items: readonly ActivityItem[];
  readonly created: number;
  readonly skipped: number;
}

/** 一条活动提醒（wire DTO） */
export interface ActivityReminderItem {
  readonly id: string;
  readonly kind: ActivityReminderKind;
  /** 提醒时刻，ISO-8601 UTC */
  readonly remindAt: string;
  /** MVP 只会返回 `inapp`；`wechat-subscribe` 未接通前不得假装已发送 */
  readonly channel: ActivityReminderChannel;
  readonly status: ActivityReminderStatus;
  /**
   * 所属活动 id / 标题。只有 `GET /activities/reminders` 列表会带，
   * 详情端点可以省略；客户端不要假设它们一定存在。
   */
  readonly activityId?: string;
  readonly activityTitle?: string;
}

/* ------------------------------------------------------------------ *
 * 路由
 * ------------------------------------------------------------------ */

/** API 基础路径（不含 `/api/v1`） */
export const ACTIVITY_BASE_PATH = '/activities';

/**
 * `/activities` 下的全部路径。
 *
 * 与 OpenAPI 的 path 一一对应；客户端不要手拼字符串 —— id 里出现 `/` 时
 * 手拼会变成另一条路由。
 */
export const ACTIVITY_ROUTES = Object.freeze({
  base: ACTIVITY_BASE_PATH,
  items: `${ACTIVITY_BASE_PATH}/items`,
  item: (id: string): string => `${ACTIVITY_BASE_PATH}/items/${encodeURIComponent(id)}`,
  confirm: (id: string): string =>
    `${ACTIVITY_BASE_PATH}/items/${encodeURIComponent(id)}/confirm`,
  dismiss: (id: string): string =>
    `${ACTIVITY_BASE_PATH}/items/${encodeURIComponent(id)}/dismiss`,
  archive: (id: string): string =>
    `${ACTIVITY_BASE_PATH}/items/${encodeURIComponent(id)}/archive`,
  restore: (id: string): string =>
    `${ACTIVITY_BASE_PATH}/items/${encodeURIComponent(id)}/restore`,
  importWechat: `${ACTIVITY_BASE_PATH}/imports/wechat`,
  importMail: `${ACTIVITY_BASE_PATH}/imports/mail`,
  reminders: `${ACTIVITY_BASE_PATH}/reminders`,
  itemReminders: (id: string): string =>
    `${ACTIVITY_BASE_PATH}/items/${encodeURIComponent(id)}/reminders`,
  reminder: (id: string): string =>
    `${ACTIVITY_BASE_PATH}/reminders/${encodeURIComponent(id)}`,
  dispatch: `${ACTIVITY_BASE_PATH}/reminders/dispatch`,
});
