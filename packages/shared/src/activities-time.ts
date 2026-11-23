/**
 * 校园活动 · 时刻解析（内部纯函数）
 *
 * 只接受**带时区**的 ISO-8601 时刻（`Z` 或 `±HH:MM`）。
 *
 * 为什么不用 `Date.parse` 直接吃字符串：
 *   · `new Date('2026-10-25')` 会按 **UTC 零点**解释，在上海变成 08:00，
 *     正好是「日期漂移」的经典 bug；
 *   · `new Date('2026-10-25T14:00')` 会按**运行环境时区**解释，CI 在 UTC、
 *     用户在伦敦时各算各的。
 * 活动域的所有时刻字段都应该是绝对时刻；只有日期没有时刻的原文留在
 * `registrationDeadlineRaw`，**不补 23:59**。所以这里直接拒绝没有时区的输入。
 */

/** `2026-10-25T06:00:00.000Z` / `2026-10-25T14:00:00+08:00` / `2026-10-25T06:00Z` */
const INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * 解析绝对时刻；不合规返回 `null`（不猜、不按本地时区补全）。
 */
export function parseActivityInstant(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!INSTANT_RE.test(trimmed)) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

/** 某个时刻在指定 IANA 时区里的墙上时间（用于缺年份推断与展示） */
export interface ActivityWallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function activityFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/**
 * 把一个绝对时刻换算成指定时区的墙上时间。
 *
 * 只接受带时区的 ISO 串 / Date / epoch 毫秒；解析不出返回 `null`。
 */
export function activityWallClockInZone(
  value: string | number | Date,
  timeZone: string,
): ActivityWallClock | null {
  const ms =
    typeof value === 'string'
      ? parseActivityInstant(value)
      : value instanceof Date
        ? value.getTime()
        : value;
  if (ms === null || !Number.isFinite(ms)) return null;

  const parts = activityFormatter(timeZone).formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPartTypes): number | null => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) return null;
    const parsed = Number(part.value);
    return Number.isInteger(parsed) ? parsed : null;
  };

  const year = read('year');
  const month = read('month');
  const day = read('day');
  const hour = read('hour');
  const minute = read('minute');
  if (year === null || month === null || day === null || hour === null || minute === null) {
    return null;
  }
  return { year, month, day, hour, minute };
}

/**
 * 按学校时区格式化成 `YYYY-MM-DD HH:mm`（用于 ICS 描述等**给人看**的地方）。
 *
 * 传输层仍是 UTC ISO；这里只负责展示，不改变语义。
 */
export function formatActivityDateTimeInZone(
  value: string | null | undefined,
  timeZone: string,
): string | null {
  if (typeof value !== 'string') return null;
  const wall = activityWallClockInZone(value, timeZone);
  if (wall === null) return null;
  const pad = (input: number): string => String(input).padStart(2, '0');
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)} ${pad(wall.hour)}:${pad(wall.minute)}`;
}
