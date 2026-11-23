/**
 * 校园活动 · ICS 日历导出（纯函数，三端共用）
 *
 * 与 `deadline-ics.ts` 共用同一套折行 / 转义 / UTC 格式化实现，避免两份
 * RFC 5545 细节各自漂移（行分隔必须是 CRLF、每行 ≤75 **字节**、文本要转义）。
 *
 * ## 活动域额外锁住的三件事
 *
 * 1. **只有 `confirmed` 能导出**。`candidate` 还没被用户确认，导出等于替用户
 *    做了「加入日程」的决定 —— 这是产品边界，不是 UI 细节。
 * 2. **绝不编开始时间**。没有 `startsAt` 但有 `registrationDeadlineAt` 时，
 *    导出一个「报名截止」事件（摘要加前缀，提醒按默认 24h 提前量）；两者都没有就跳过。
 * 3. **时区明确**。所有 DTSTART/DTEND 都是 UTC（`...Z`），并写
 *    `X-WR-TIMEZONE:Asia/Shanghai`；描述里的报名截止按 Asia/Shanghai 展示，
 *    不产生 floating time。
 * 4. **零时长不写 DTEND**。RFC 5545 要求 DTEND 晚于 DTSTART；没有结束时刻
 *    （或结束早于开始）时省略 DTEND，而不是写一个非法的 `DTEND == DTSTART`。
 * 5. **提醒与默认策略同源**。VALARM 的 TRIGGER 由 `computeActivityReminders`
 *    计算，目标已过不写、提前量已过走 5 分钟兜底、兜底不晚于目标。
 */

import { truncateActivityEvidence } from './activities-extract';
import {
  escapeIcsText,
  foldIcsLine,
  toIcsUtc,
} from './deadline-ics';
import { sanitizeSourceUrl } from './deadline-source-url';
import { computeActivityReminders } from './activities-reminders';
import { formatActivityDateTimeInZone, parseActivityInstant } from './activities-time';

/** 活动状态（与 `@kedaya/contracts` 的 `ActivityStatus` 一致） */
export type IcsActivityStatus = 'candidate' | 'confirmed' | 'dismissed' | 'archived';

/** ICS 输入条目 —— shared 零依赖，用结构类型接收契约条目 */
export interface IcsActivityInput {
  readonly id: string;
  readonly title: string;
  readonly status: IcsActivityStatus;
  /** 开始时刻，ISO-8601 UTC；未知为 null */
  readonly startsAt: string | null;
  /** 结束时刻，ISO-8601 UTC；未知为 null（不猜时长） */
  readonly endsAt: string | null;
  readonly location: string | null;
  readonly organizer: string | null;
  /** 报名截止时刻，ISO-8601 UTC；原文只有日期时为 null */
  readonly registrationDeadlineAt: string | null;
  readonly registrationUrl: string | null;
  readonly sourceUrl: string | null;
  readonly sourceLabel: string;
  readonly evidenceText: string;
}

export interface IcsActivityBuildOptions {
  /** 日历名（显示在用户的日历列表里） */
  readonly calendarName: string;
  /** 生成时刻，用于 DTSTAMP；不传则用 `new Date()` */
  readonly now?: Date;
}

/** 展示时区（只写进 X-WR-TIMEZONE；事件本身仍是 UTC） */
export const ACTIVITY_ICS_TIME_ZONE = 'Asia/Shanghai';

/**
 * 生成活动 ICS。
 *
 * @returns ICS 字符串（CRLF 行分隔）。没有可导出条目时仍返回合法空日历。
 */
export function buildActivityIcs(
  items: readonly IcsActivityInput[],
  options: IcsActivityBuildOptions,
): string {
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new RangeError('activities-ics: now 必须是有效的 Date');
  }
  const stamp = toIcsUtc(now);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KedaYa//Activities//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
    `X-WR-TIMEZONE:${ACTIVITY_ICS_TIME_ZONE}`,
  ];

  const seenIds = new Set<string>();

  for (const item of items) {
    if (item.status !== 'confirmed') continue;
    const id = item.id.trim();
    if (id === '' || seenIds.has(id)) continue;
    seenIds.add(id);

    const startMs = parseActivityInstant(item.startsAt);
    const deadlineMs = parseActivityInstant(item.registrationDeadlineAt);
    const isDeadlineEvent = startMs === null && deadlineMs !== null;
    const eventStartMs = startMs ?? deadlineMs;
    if (eventStartMs === null) continue;

    const explicitEndMs = parseActivityInstant(item.endsAt);
    const eventEndMs =
      explicitEndMs !== null && explicitEndMs > eventStartMs ? explicitEndMs : null;

    const summary = isDeadlineEvent ? `报名截止：${item.title}` : item.title;
    const description = buildDescription(item, isDeadlineEvent);
    const url = sanitizeSourceUrl(item.registrationUrl) ?? sanitizeSourceUrl(item.sourceUrl);

    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(id)}@kedaya-activities`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsUtc(new Date(eventStartMs))}`,
    );

    // RFC 5545 §3.6.1：DTEND 必须**晚于** DTSTART。没有结束时刻 / 结束早于开始
    // 时省略 DTEND（零时长事件），而不是写一个非法的 DTEND == DTSTART。
    if (eventEndMs !== null) lines.push(`DTEND:${toIcsUtc(new Date(eventEndMs))}`);

    lines.push(`SUMMARY:${escapeIcsText(summary)}`);

    if (item.location !== null && item.location.trim() !== '') {
      lines.push(`LOCATION:${escapeIcsText(item.location.trim())}`);
    }
    lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    // URL 是 URI 值，不是 TEXT：不能把逗号/分号转义成 `\,` / `\;`。
    if (url !== null) lines.push(`URL:${url}`);

    const reminder = selectReminder(item, isDeadlineEvent, now);
    if (reminder !== null) {
      lines.push(
        'BEGIN:VALARM',
        `TRIGGER:${toIcsTrigger(reminder.remindAt, eventStartMs)}`,
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcsText(isDeadlineEvent ? '报名截止提醒' : '活动开始提醒')}`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // 折叠必须在拼接前逐行做 —— 先拼再折会把 CRLF 也折进去
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

function buildDescription(item: IcsActivityInput, isDeadlineEvent: boolean): string {
  const parts: string[] = [];

  if (item.organizer !== null && item.organizer.trim() !== '') {
    parts.push(`主办：${item.organizer.trim()}`);
  }
  if (!isDeadlineEvent && item.registrationDeadlineAt !== null) {
    const formatted = formatActivityDateTimeInZone(
      item.registrationDeadlineAt,
      ACTIVITY_ICS_TIME_ZONE,
    );
    if (formatted !== null) {
      parts.push(`报名截止：${formatted}（${ACTIVITY_ICS_TIME_ZONE}）`);
    }
  }
  parts.push(`来源：${item.sourceLabel}`);
  if (item.evidenceText.trim() !== '') {
    parts.push(`证据：${truncateActivityEvidence(item.evidenceText)}`);
  }
  parts.push('由可达鸭整理；请以主办方通知为准');

  return parts.join('\n');
}

/**
 * 与 `computeActivityReminders` 使用**同一套** clamp 语义：
 * 目标已过 → 不写 VALARM；提前量已过但目标还在未来 → 提醒落到 now + 5min；
 * 兜底不晚于目标（此时 TRIGGER 为 PT0S）。
 */
function selectReminder(
  item: IcsActivityInput,
  isDeadlineEvent: boolean,
  now: Date,
): { readonly remindAt: string } | null {
  const reminders = computeActivityReminders(
    {
      registrationDeadlineAt: item.registrationDeadlineAt,
      startsAt: item.startsAt,
    },
    { now },
  );
  const kind = isDeadlineEvent ? 'registration' : 'start';
  return reminders.find((reminder) => reminder.kind === kind) ?? null;
}

/** `remindAt - DTSTART` → RFC 5545 DURATION（例：`-PT1H`、`-PT24H`、`PT0S`） */
function toIcsTrigger(remindAt: string, eventStartMs: number): string {
  const deltaSeconds = Math.round((Date.parse(remindAt) - eventStartMs) / 1000);
  const sign = deltaSeconds < 0 ? '-' : '';
  const absolute = Math.abs(deltaSeconds);
  if (absolute === 0) return 'PT0S';
  if (absolute % 3600 === 0) return `${sign}PT${absolute / 3600}H`;
  if (absolute % 60 === 0) return `${sign}PT${absolute / 60}M`;
  return `${sign}PT${absolute}S`;
}
