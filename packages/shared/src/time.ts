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
