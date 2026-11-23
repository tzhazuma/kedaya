/**
 * 校园活动 · 领域层（零框架依赖）
 *
 * 活动是**独立域**，不写进课表 `/schedule` 的 deadlines：课程作业与校园活动
 * 的生命周期、来源可信度、确认流程都不同。这里只定义活动/提醒的形状与端口，
 * 不 import Nest / Prisma / IMAP。
 *
 * ## 三条硬规则（写死在类型与纯函数里）
 *
 * 1. **来源只有三种**：`campus-mail` / `wechat-mp` / `manual`。
 *    没有"自动发现"来源，也不会从公众号批量抓取。
 * 2. **candidate 不是日程**：导入结果默认 `candidate`，用户确认后才建提醒。
 * 3. **只存活动字段与 ≤200 字证据片段**：不存邮件正文、附件、公众号全文。
 *    证据片段用于解释"为什么识别成这个活动"，不是内容副本。
 */

/* ------------------------------------------------------------------ *
 * 枚举
 * ------------------------------------------------------------------ */

import {
  ACTIVITY_DEFAULT_REMINDER_LEADS,
  ACTIVITY_EVIDENCE_MAX_CHARS,
  ACTIVITY_KINDS,
  ACTIVITY_REMINDER_CHANNELS,
  ACTIVITY_REMINDER_KINDS,
  ACTIVITY_REMINDER_STATUSES,
  ACTIVITY_SOURCES,
  ACTIVITY_STATUSES,
  ACTIVITY_TIMEZONE,
  type ActivityItem as ContractActivityItem,
  type ActivityReminderItem as ContractActivityReminderItem,
  type ActivityKind,
  type ActivityReminderChannel,
  type ActivityReminderKind,
  type ActivityReminderStatus,
  type ActivitySource,
  type ActivityStatus,
} from '@kedaya/contracts';
import { computeActivityReminders } from '@kedaya/shared';

export {
  ACTIVITY_KINDS,
  ACTIVITY_REMINDER_CHANNELS,
  ACTIVITY_REMINDER_KINDS,
  ACTIVITY_REMINDER_STATUSES,
  ACTIVITY_SOURCES,
  ACTIVITY_STATUSES,
  ACTIVITY_TIMEZONE,
};
export type {
  ActivityKind,
  ActivityReminderChannel,
  ActivityReminderKind,
  ActivityReminderStatus,
  ActivitySource,
  ActivityStatus,
};

/** 证据片段上限（码点，与共同契约一致）。超过就截断，绝不在活动表里存正文。 */
export const ACTIVITY_EVIDENCE_MAX = ACTIVITY_EVIDENCE_MAX_CHARS;

/** 标题 / 地点 / 主办方 / 来源名的上限（与共同契约的 maxLength 一致）。 */
export const ACTIVITY_TEXT_MAX = 160;

/** 报名截止原文的上限（与共同契约的 maxLength 一致）。 */
export const ACTIVITY_DEADLINE_RAW_MAX = 200;

/** 派发租约：超过这个时长仍是 `sending` 的行视为上一次派发崩溃，回收重试。 */
export const ACTIVITY_REMINDER_LEASE_MS = 10 * 60 * 1000;

/** 单条提醒最多尝试几次；超过标记 `failed`（可见），不再无限重试。 */
export const ACTIVITY_REMINDER_MAX_ATTEMPTS = 5;

/** 提醒目标仍未来、但计算出的提醒时刻已过时，顺延到 now + 5min（且不晚于目标）。 */
export const ACTIVITY_REMINDER_NOW_SHIFT_MS = ACTIVITY_DEFAULT_REMINDER_LEADS.fallbackDelayMs;

/* ------------------------------------------------------------------ *
 * 对外视图（与共同契约 ActivityItem / ActivityReminderItem 同名同形）
 * ------------------------------------------------------------------ */

/**
 * 活动视图（共同契约的 wire DTO）。时间一律 UTC ISO；展示按 `Asia/Shanghai`。
 * `registrationDeadlineRaw` 在时刻无法确定时保留原文 —— **不补 23:59**。
 */
export type ActivityItem = ContractActivityItem;

export interface ActivityReminderItem extends ContractActivityReminderItem {
  activityId: string;
  activityTitle: string;
}

/* ------------------------------------------------------------------ *
 * 持久化记录
 * ------------------------------------------------------------------ */

/** data 层内部形状：比对外视图多 userId / sourceRef / mailAccountId 等归属字段。 */
export interface ActivityRecord {
  id: string;
  userId: string;
  source: ActivitySource;
  /** 来源内稳定引用：邮件事件 id / 公众号 URL / 粘贴内容哈希 / 手动随机 id */
  sourceRef: string;
  kind: ActivityKind;
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  location: string | null;
  organizer: string | null;
  registrationDeadlineAt: Date | null;
  registrationDeadlineRaw: string | null;
  registrationUrl: string | null;
  evidenceText: string;
  confidence: number;
  status: ActivityStatus;
  sourceUrl: string | null;
  sourceLabel: string | null;
  publishedAt: Date | null;
  stale: boolean;
  /** 由校园邮箱提升而来时记录账户；解绑邮箱时数据库级联删除活动。 */
  mailAccountId: string | null;
  /** 由哪封归一邮件提升而来；换邮箱清理旧邮件时数据库级联删除活动。 */
  mailEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewActivity {
  userId: string;
  source: ActivitySource;
  sourceRef: string;
  kind: ActivityKind;
  title: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  location?: string | null;
  organizer?: string | null;
  registrationDeadlineAt?: Date | null;
  registrationDeadlineRaw?: string | null;
  registrationUrl?: string | null;
  evidenceText: string;
  confidence: number;
  status: ActivityStatus;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  publishedAt?: Date | null;
  stale?: boolean;
  mailAccountId?: string | null;
  mailEventId?: string | null;
}

/** PATCH 可改字段；`status` 走同一套状态机校验。 */
export interface ActivityUpdateData {
  kind?: ActivityKind;
  title?: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  location?: string | null;
  organizer?: string | null;
  registrationDeadlineAt?: Date | null;
  registrationDeadlineRaw?: string | null;
  registrationUrl?: string | null;
  evidenceText?: string;
  status?: ActivityStatus;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  publishedAt?: Date | null;
  stale?: boolean;
}

export interface ActivityListFilters {
  status?: ActivityStatus;
  source?: ActivitySource;
  from?: Date;
  to?: Date;
}

export interface ActivityListPage {
  items: ActivityRecord[];
  nextCursor: string | null;
}

export interface CreateManualActivityInput {
  kind: ActivityKind;
  title: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  location?: string | null;
  organizer?: string | null;
  registrationDeadlineAt?: Date | null;
  registrationDeadlineRaw?: string | null;
  registrationUrl?: string | null;
  evidenceText?: string;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  publishedAt?: Date | null;
}

export interface UpdateActivityInput {
  kind?: ActivityKind;
  title?: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  location?: string | null;
  organizer?: string | null;
  registrationDeadlineAt?: Date | null;
  registrationDeadlineRaw?: string | null;
  registrationUrl?: string | null;
  evidenceText?: string;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  publishedAt?: Date | null;
}

export interface WechatImportCommand {
  url?: string;
  text?: string;
  title?: string;
}

export interface WechatImportResult {
  /** 本次导入的第一条（没有可导入候选时为 null）。 */
  item: ActivityItem | null;
  /** 一篇文章里识别出的全部活动候选（按正文顺序）。 */
  items: ActivityItem[];
  /** 新建的候选数。 */
  created: number;
  /** 已存在（重复导入）而跳过的候选数。 */
  skipped: number;
}

export interface MailImportCommand {
  /** 用户明确勾选的邮件事件 id；不做全箱扫描。 */
  eventIds: string[];
}

export interface MailImportResult {
  /** 本次提升的第一条（移动端动作端点读 `{item}`；没有可提升行时为 null）。 */
  item: ActivityItem | null;
  /** 全部提升结果（小程序批量勾选读 `{items}`）。 */
  items: ActivityItem[];
  created: number;
  skipped: number;
}

export interface ListActivitiesResult {
  items: ActivityItem[];
  nextCursor: string | null;
}

export interface ListRemindersResult {
  items: ActivityReminderItem[];
  nextCursor: string | null;
}

export interface CreateReminderInput {
  kind: ActivityReminderKind;
  remindAt: Date;
  channel?: ActivityReminderChannel;
}

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  cancelled: number;
  /** 派发前回收的、超过租约仍停在 `sending` 的行数。 */
  reclaimed: number;
}

/* ------------------------------------------------------------------ *
 * 端口
 * ------------------------------------------------------------------ */

export interface ActivityRepository {
  create(input: NewActivity): Promise<ActivityRecord>;
  /** `(userId, source, sourceRef)` 幂等：重复导入返回既有行，不产生第二条。 */
  upsertBySourceRef(input: NewActivity): Promise<{ record: ActivityRecord; created: boolean }>;
  findById(userId: string, id: string): Promise<ActivityRecord | null>;
  /** 派发时按提醒上的 activityId 批量取（不再按用户收窄，调用方只用于已抢占的行）。 */
  findByIds(ids: readonly string[]): Promise<ActivityRecord[]>;
  listByUser(
    userId: string,
    filters: ActivityListFilters,
    page: { cursor?: string; limit: number },
  ): Promise<ActivityListPage>;
  update(userId: string, id: string, data: ActivityUpdateData): Promise<ActivityRecord | null>;
}

export const ACTIVITY_REPOSITORY = Symbol('KEDAYA_ACTIVITY_REPOSITORY');

export interface NewActivityReminder {
  userId: string;
  activityId: string;
  kind: ActivityReminderKind;
  remindAt: Date;
  channel: ActivityReminderChannel;
  /** 默认提醒用稳定键（`default:registration` / `default:start`）防重复；自定义为 null。 */
  dedupeKey: string | null;
}

export interface NewActivityReminderInput {
  userId: string;
  activityId: string;
  kind: ActivityReminderKind;
  remindAt: Date;
  channel: ActivityReminderChannel;
  dedupeKey?: string | null;
}

/** 提醒记录带 `activityTitle`（data 层 join 出来，方便列表/派发直接用）。 */
export interface ActivityReminderRecord {
  id: string;
  userId: string;
  activityId: string;
  activityTitle: string;
  kind: ActivityReminderKind;
  remindAt: Date;
  channel: ActivityReminderChannel;
  status: ActivityReminderStatus;
  dedupeKey: string | null;
  /** 已被派发器抢占/尝试的次数（抢占时 +1）。 */
  attempts: number;
  /** 最近一次派发失败的原因（截断，绝不写敏感正文）。 */
  lastError: string | null;
  sentAt: Date | null;
  claimedAt: Date | null;
  createdAt: Date;
}

export interface ClaimedActivityReminder extends ActivityReminderRecord {
  activityStatus: ActivityStatus;
  activityStartsAt: Date | null;
  activityRegistrationDeadlineAt: Date | null;
}

/** `scheduled` 是契约里的查询别名，等价于 pending + sending。 */
export type ReminderListStatus = ActivityReminderStatus | 'scheduled';

export interface ReminderListQuery {
  cursor?: string;
  limit: number;
  status?: ReminderListStatus;
}

export interface ReminderListPage {
  items: ActivityReminderRecord[];
  nextCursor: string | null;
}

export interface ActivityReminderRepository {
  createMany(inputs: readonly NewActivityReminder[]): Promise<number>;
  create(input: NewActivityReminderInput): Promise<ActivityReminderRecord>;
  listByUser(userId: string, query: ReminderListQuery): Promise<ReminderListPage>;
  listByActivity(userId: string, activityId: string): Promise<ActivityReminderRecord[]>;
  findById(userId: string, id: string): Promise<ActivityReminderRecord | null>;
  deleteById(userId: string, id: string): Promise<boolean>;
  /** 忽略/归档时清掉待发提醒（已发送的历史保留）。 */
  deletePendingForActivity(activityId: string): Promise<number>;
  /** 内容时间被编辑时清掉待发的默认提醒，再按新时间重建；可按 kind 只清受影响目标。 */
  deletePendingDefaults(
    activityId: string,
    kinds?: readonly ActivityReminderKind[],
  ): Promise<number>;
  /**
   * 原子抢占到期提醒：`UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING`。
   * 多副本同时跑派发时，同一条提醒只会被一个副本拿到。
   * 只抢 `channel='inapp'`；`attempts` 在抢占时 +1。
   */
  claimDue(now: Date, limit: number): Promise<ClaimedActivityReminder[]>;
  /** 回收超过租约仍停在 `sending` 的行（上次派发崩溃），返回回收条数。 */
  releaseStale(claimedBefore: Date): Promise<number>;
  markSent(id: string, sentAt: Date): Promise<boolean>;
  release(id: string): Promise<boolean>;
  /** 达到重试上限后标记 failed（对用户可见），不再无限重试。 */
  markFailed(id: string, reason: string): Promise<boolean>;
  cancel(id: string): Promise<boolean>;
}

export const ACTIVITY_REMINDER_REPOSITORY = Symbol('KEDAYA_ACTIVITY_REMINDER_REPOSITORY');

export interface ActivityClock {
  now(): Date;
}

export const ACTIVITY_CLOCK = Symbol('KEDAYA_ACTIVITY_CLOCK');

/* ------------------------------------------------------------------ *
 * 默认提醒（纯函数）
 * ------------------------------------------------------------------ */

export interface DefaultReminderDraft {
  kind: 'registration' | 'start';
  remindAt: Date;
  channel: 'inapp';
  dedupeKey: string;
}

/**
 * 默认提醒：报名截止前 24h、开始前 1h。
 *
 * 直接复用 `@kedaya/shared` 的 `computeActivityReminders`，三端只维护一份规则：
 *   · 目标已过（含恰好等于 now）→ 不建；
 *   · 目标仍未来、计算时刻已过 → now+5min，且**不得晚于目标**；
 *   · 渠道固定 inapp（微信订阅消息尚未接通）。
 */
export function buildDefaultReminderDrafts(
  input: { startsAt: Date | null; registrationDeadlineAt: Date | null },
  now: Date,
): DefaultReminderDraft[] {
  const computed = computeActivityReminders(
    {
      startsAt: input.startsAt === null ? null : input.startsAt.toISOString(),
      registrationDeadlineAt:
        input.registrationDeadlineAt === null ? null : input.registrationDeadlineAt.toISOString(),
    },
    { now },
  );

  return computed.map((reminder) => ({
    kind: reminder.kind,
    remindAt: new Date(reminder.remindAt),
    channel: 'inapp',
    dedupeKey: `default:${reminder.kind}`,
  }));
}

/* ------------------------------------------------------------------ *
 * 证据与投影
 * ------------------------------------------------------------------ */

/**
 * 文本字段清洗：去掉控制字符（C0 / DEL / C1），压缩空白，按**码点**截断。
 *
 * 所有进库的活动文本（标题/地点/主办方/来源名/截止原文）都走这里：
 * 控制字符既可能来自公众号正文，也可能来自邮件头；落库前统一清掉，
 * 避免在通知列表或日志里出现不可见字符。
 */
export function sanitizeActivityText(
  value: string | null | undefined,
  max = ACTIVITY_TEXT_MAX,
): string | null {
  if (value === undefined || value === null) return null;
  const cleaned = [...String(value)]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || (code >= 127 && code <= 159) ? ' ' : char;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return null;
  const points = [...cleaned];
  return points.length <= max ? cleaned : points.slice(0, max).join('');
}

/**
 * 证据片段：压缩空白、去控制字符，按**码点**截到 200。
 *
 * 不做 NFKC：`：` 被折成 `:` 会让"原文片段"不再原文。
 */
export function clampEvidence(value: string, max = ACTIVITY_EVIDENCE_MAX): string {
  const normalized = [...String(value ?? '')]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? ' ' : char;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const points = [...normalized];
  if (points.length <= max) return normalized;
  return `${points.slice(0, max - 1).join('')}…`;
}

/** 逐字段显式投影：Prisma 以后加字段也不会悄悄进响应。 */
export function toActivityItem(record: ActivityRecord): ActivityItem {
  return {
    id: record.id,
    source: record.source,
    kind: record.kind,
    title: record.title,
    startsAt: record.startsAt === null ? null : record.startsAt.toISOString(),
    endsAt: record.endsAt === null ? null : record.endsAt.toISOString(),
    location: record.location,
    organizer: record.organizer,
    registrationDeadlineAt:
      record.registrationDeadlineAt === null ? null : record.registrationDeadlineAt.toISOString(),
    registrationDeadlineRaw: record.registrationDeadlineRaw,
    registrationUrl: record.registrationUrl,
    evidenceText: record.evidenceText,
    confidence: record.confidence,
    status: record.status,
    sourceUrl: record.sourceUrl,
    sourceLabel: record.sourceLabel,
    publishedAt: record.publishedAt === null ? null : record.publishedAt.toISOString(),
    stale: record.stale,
  };
}

export function toActivityReminderItem(record: ActivityReminderRecord): ActivityReminderItem {
  return {
    id: record.id,
    activityId: record.activityId,
    activityTitle: record.activityTitle,
    kind: record.kind,
    remindAt: record.remindAt.toISOString(),
    channel: record.channel,
    status: record.status,
  };
}
