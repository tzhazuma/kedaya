/**
 * 校园活动 · 默认提醒计算（纯函数，三端共用）
 *
 * 默认策略（与 `@kedaya/contracts` 的 `ACTIVITY_DEFAULT_REMINDER_LEADS` 一致）：
 *   · 报名截止前 24 小时；
 *   · 活动开始前 1 小时。
 *
 * ## 三条不能省的规则
 *
 * 1. **目标已过 → 不建**。给昨天截止的活动排一条「明天提醒」只会制造噪音。
 * 2. **计算时刻已过、但目标还在未来 → now + 5min**。
 *    用户刚导入一场 10 分钟后截止报名的活动，按 24h 提前量算出来的时刻是昨天；
 *    这时不能静默丢掉提醒，也不能排到过去（派发器永远扫不到）。
 * 3. **兜底时刻不得晚于目标**。目标只剩 3 分钟时，now + 5min 已经晚于截止；
 *    这种情况把提醒放在目标时刻，至少不会「截止后才提醒」。
 *
 * ## 为什么渠道固定是 inapp
 *
 * MVP 只实现站内信。微信订阅消息 / APNs / FCM / HMS 都**没有**接通，
 * 这里不返回 `wechat-subscribe`，免得调用方把「排了一条提醒」误当成「微信已送达」。
 */

import { parseActivityInstant } from './activities-time';

/** 报名截止前 24 小时 */
export const ACTIVITY_REGISTRATION_LEAD_MS = 24 * 60 * 60 * 1000;

/** 活动开始前 1 小时 */
export const ACTIVITY_START_LEAD_MS = 60 * 60 * 1000;

/** 计算时刻已过但目标未来时的兜底延迟 */
export const ACTIVITY_REMINDER_FALLBACK_MS = 5 * 60 * 1000;

/** 默认提醒只认这两种目标 */
export type ActivityReminderKind = 'registration' | 'start';

/** 提醒渠道。MVP 只产出站内信。 */
export type ActivityReminderChannel = 'inapp' | 'wechat-subscribe';

/** 计算出的提醒（还没有服务端 id / 状态，那是落库之后的事） */
export interface ComputedActivityReminder {
  readonly kind: ActivityReminderKind;
  /** ISO-8601 UTC */
  readonly remindAt: string;
  readonly channel: ActivityReminderChannel;
}

/** 计算提醒只需要两个目标时刻 */
export interface ActivityReminderTarget {
  readonly registrationDeadlineAt: string | null;
  readonly startsAt: string | null;
}

export interface ComputeActivityRemindersOptions {
  /** 基准时刻；必传，避免测试依赖机器时钟 */
  readonly now: Date;
  /** 覆盖报名截止提前量（默认 24h） */
  readonly registrationLeadMs?: number;
  /** 覆盖开始提前量（默认 1h） */
  readonly startLeadMs?: number;
  /** 覆盖兜底延迟（默认 5min） */
  readonly fallbackDelayMs?: number;
}

/**
 * 计算一条活动的默认提醒。
 *
 * @returns 按提醒时刻升序；同一时刻报名提醒排在开始提醒之前。
 *          两个目标都没有 / 都已过时返回空数组。
 */
export function computeActivityReminders(
  target: ActivityReminderTarget,
  options: ComputeActivityRemindersOptions,
): ComputedActivityReminder[] {
  if (!(options.now instanceof Date) || Number.isNaN(options.now.getTime())) {
    throw new RangeError('activities-reminders: now 必须是有效的 Date');
  }

  const nowMs = options.now.getTime();
  const registrationLeadMs = readLead(
    options.registrationLeadMs,
    ACTIVITY_REGISTRATION_LEAD_MS,
    'registrationLeadMs',
  );
  const startLeadMs = readLead(options.startLeadMs, ACTIVITY_START_LEAD_MS, 'startLeadMs');
  const fallbackDelayMs = readLead(
    options.fallbackDelayMs,
    ACTIVITY_REMINDER_FALLBACK_MS,
    'fallbackDelayMs',
  );

  const reminders: ComputedActivityReminder[] = [];

  const registration = schedule(
    'registration',
    parseActivityInstant(target.registrationDeadlineAt),
    registrationLeadMs,
    nowMs,
    fallbackDelayMs,
  );
  if (registration !== null) reminders.push(registration);

  const start = schedule(
    'start',
    parseActivityInstant(target.startsAt),
    startLeadMs,
    nowMs,
    fallbackDelayMs,
  );
  if (start !== null) reminders.push(start);

  return reminders.sort(
    (a, b) =>
      Date.parse(a.remindAt) - Date.parse(b.remindAt) || reminderRank(a.kind) - reminderRank(b.kind),
  );
}

function reminderRank(kind: ActivityReminderKind): number {
  return kind === 'registration' ? 0 : 1;
}

function readLead(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`activities-reminders: ${name} 必须是非负有限数`);
  }
  return value;
}

function schedule(
  kind: ActivityReminderKind,
  targetMs: number | null,
  leadMs: number,
  nowMs: number,
  fallbackDelayMs: number,
): ComputedActivityReminder | null {
  if (targetMs === null || targetMs <= nowMs) return null;

  const leadAt = targetMs - leadMs;
  if (leadAt >= nowMs) {
    return { kind, remindAt: new Date(leadAt).toISOString(), channel: 'inapp' };
  }

  // 兜底不能晚于目标：目标只剩 3 分钟时，now + 5min 已经没有意义。
  const fallbackAt = Math.min(nowMs + fallbackDelayMs, targetMs);
  return { kind, remindAt: new Date(fallbackAt).toISOString(), channel: 'inapp' };
}
