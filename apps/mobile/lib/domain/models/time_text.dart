/// 时间展示（镜像 `packages/shared/src/time.ts`）。
///
/// 契约冻结：**传输层**一律 ISO-8601 UTC 字符串（解析在 `data/api/`），
/// **展示层**才做本地化文案。因此本文件只接受 [DateTime]。
library;

/// 相对时间，例: `'3 分钟前'` / `'2 天后'`。
String formatRelativeTime(DateTime target, {DateTime? now}) {
  final DateTime reference = now ?? DateTime.now();
  final int diffMs = reference.difference(target).inMilliseconds;
  final bool future = diffMs < 0;
  final int absMs = diffMs.abs();

  final int sec = absMs ~/ 1000;
  if (sec < 60) return future ? '即将' : '刚刚';

  final int min = sec ~/ 60;
  if (min < 60) return future ? '$min 分钟后' : '$min 分钟前';

  final int hour = min ~/ 60;
  if (hour < 24) return future ? '$hour 小时后' : '$hour 小时前';

  final int day = hour ~/ 24;
  if (day < 30) return future ? '$day 天后' : '$day 天前';

  final int month = day ~/ 30;
  if (month < 12) return future ? '$month 个月后' : '$month 个月前';

  final int year = day ~/ 365;
  return future ? '$year 年后' : '$year 年前';
}

/// 距离截止还有多久，用于"还有 3 小时截止"。
String formatDeadline(DateTime target, {DateTime? now}) {
  final DateTime reference = now ?? DateTime.now();
  if (!target.isAfter(reference)) return '已截止';
  final String remaining = formatRelativeTime(target, now: reference);
  return '还有 ${remaining.replaceAll('后', '').trim()}';
}

/// Date -> ISO-8601 UTC 字符串（传输用）。
String toIsoUtc(DateTime value) => value.toUtc().toIso8601String();

/// 是否同一天（按本地时区）。
bool isSameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

/// 生成 `YYYY-MM-DD`（本地时区）。
String toDateKey(DateTime date) {
  final String y = date.year.toString();
  final String m = date.month.toString().padLeft(2, '0');
  final String d = date.day.toString().padLeft(2, '0');
  return '$y-$m-$d';
}
