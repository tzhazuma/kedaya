/**
 * 时间 —— 契约冻结：传输层一律 ISO-8601 UTC 字符串，展示层才本地化。
 */

/** 相对时间，例: "3 分钟前" / "2 天后" */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return '';

  const diffMs = now.getTime() - target;
  const future = diffMs < 0;
  const absMs = Math.abs(diffMs);

  const sec = Math.floor(absMs / 1000);
  if (sec < 60) return future ? '即将' : '刚刚';

  const min = Math.floor(sec / 60);
  if (min < 60) return future ? `${min} 分钟后` : `${min} 分钟前`;

  const hour = Math.floor(min / 60);
  if (hour < 24) return future ? `${hour} 小时后` : `${hour} 小时前`;

  const day = Math.floor(hour / 24);
  if (day < 30) return future ? `${day} 天后` : `${day} 天前`;

  const month = Math.floor(day / 30);
  if (month < 12) return future ? `${month} 个月后` : `${month} 个月前`;

  const year = Math.floor(day / 365);
  return future ? `${year} 年后` : `${year} 年前`;
}

/** Date -> ISO-8601 UTC 字符串（传输用） */
export function toIso(date: Date): string {
  return date.toISOString();
}

/** 是否同一天（按本地时区） */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** 距离截止还有多久，用于"还有 3 小时截止" */
export function formatDeadline(iso: string, now: Date = new Date()): string {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return '';
  if (target <= now.getTime()) return '已截止';
  const remaining = formatRelativeTime(new Date(target).toISOString(), now);
  return `还有 ${remaining.replace('后', '').trim()}`;
}

/** 生成 YYYY-MM-DD（本地时区） */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 本地时区当天的起止范围 [from, to) —— 「今日营养汇总」等按天聚合用。
 * 三端共用同一份口径，避免后端按 UTC 切天、前端按本地切天对不上。
 */
export function dayRange(date: Date): { key: string; from: Date; to: Date } {
  return dayRangeWithOffset(date, -date.getTimezoneOffset());
}

/** 一天有多少毫秒 */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 按**指定时区偏移**切天（分钟，东八区 = 480）。
 *
 * 为什么需要显式偏移：服务端容器默认 UTC，`dayRange()` 会按 UTC 切天，
 * 于是北京时间 08:00 之前的早餐被算进「昨天」。
 * 服务端用 `APP_TZ_OFFSET_MINUTES`（默认 480）调用本函数，
 * 小程序按本机时区调用 `dayRange()`，两端口径因此对齐。
 */
export function dayRangeWithOffset(date: Date, offsetMinutes: number): { key: string; from: Date; to: Date } {
  const shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  const wallMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const from = new Date(wallMidnight - offsetMinutes * 60 * 1000);
  return { key: dateKeyAtOffset(date, offsetMinutes), from, to: new Date(from.getTime() + DAY_MS) };
}

/** 指定偏移下的 YYYY-MM-DD */
export function dateKeyAtOffset(date: Date, offsetMinutes: number): string {
  const shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 在指定偏移下把 YYYY-MM-DD 解析成该日零点。
 * 非法输入（含 2026-02-31 这种会被 Date 静默进位的日期）返回 null。
 */
export function parseDateKeyAtOffset(dateKey: string, offsetMinutes: number): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMidnight = Date.UTC(year, month - 1, day);
  const probe = new Date(utcMidnight);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return new Date(utcMidnight - offsetMinutes * 60 * 1000);
}
