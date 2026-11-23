/// 活动时间的展示与录入换算。
///
/// 契约：**存储**一律 UTC ISO-8601 instant，**展示**一律 Asia/Shanghai。
/// 中国自 1991 年起不再使用夏令时，因此这里用固定 `UTC+8`，不引入时区数据库。
///
/// 关键约束：不要拿 `YYYY-MM-DD` 直接 `DateTime.parse` 后当成本地时刻 ——
/// 那会把“日期”误解成“本机时区的零点”，在非东八区机器上产生漂移。
/// 手动录入时，先把用户选的墙钟字段**显式**换算成 UTC instant，再提交。
library;

/// 北京时间相对 UTC 的固定偏移。
const Duration shanghaiUtcOffset = Duration(hours: 8);

/// 活动时刻必须是**带时区**的 ISO-8601 instant。
///
/// 只认 `2026-11-25T02:00:00.000Z` / `2026-11-25T10:00:00+08:00` 这类绝对时刻。
/// `2026-11-25` 与 `2026-11-25T10:00` 都会被拒绝：
/// - 前者会被 `DateTime.parse` 当成本机时区零点，等于凭空补了午夜；
/// - 后者没有时区，在 CI（UTC）与用户机器（东八区）上会解析成不同 instant。
final RegExp activityInstantPattern = RegExp(
  r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?'
  r'(?:Z|[+-]\d{2}:\d{2})$',
);

/// 解析活动绝对时刻；date-only / 无时区 / 非法值返回 `null`（不猜、不补）。
DateTime? parseActivityInstant(Object? value) {
  if (value is! String) return null;
  final String trimmed = value.trim();
  if (!activityInstantPattern.hasMatch(trimmed)) return null;
  return DateTime.tryParse(trimmed)?.toUtc();
}

/// 把一个 instant 换成北京时间墙钟读数（返回值的字段是北京时间）。
///
/// 返回值仍带 `isUtc = true` 标记：它表示“读数是北京时间”，
/// **不要**再对它调用 `toLocal()`，否则会二次偏移。
DateTime toShanghaiWallClock(DateTime instant) =>
    instant.toUtc().add(shanghaiUtcOffset);

/// 把一组北京时间的墙钟字段换回 UTC instant。
///
/// 只读取 [wallClock] 的 year/month/day/hour/minute/second 字段，
/// 不关心它自己的时区标记 —— 这正是日期/时间选择器给出的形状。
DateTime shanghaiWallClockToUtc(DateTime wallClock) => DateTime.utc(
      wallClock.year,
      wallClock.month,
      wallClock.day,
      wallClock.hour,
      wallClock.minute,
      wallClock.second,
    ).subtract(shanghaiUtcOffset);

String _two(int value) => value.toString().padLeft(2, '0');

/// `2026-11-25 10:00`（北京时间）。
String formatShanghaiInstant(DateTime instant) {
  final DateTime wall = toShanghaiWallClock(instant);
  return '${wall.year}-${_two(wall.month)}-${_two(wall.day)} '
      '${_two(wall.hour)}:${_two(wall.minute)}';
}

/// `2026-11-25`（北京时间）。
String formatShanghaiDate(DateTime instant) {
  final DateTime wall = toShanghaiWallClock(instant);
  return '${wall.year}-${_two(wall.month)}-${_two(wall.day)}';
}

/// `10:00`（北京时间）。
String formatShanghaiTime(DateTime instant) {
  final DateTime wall = toShanghaiWallClock(instant);
  return '${_two(wall.hour)}:${_two(wall.minute)}';
}

/// 显式带时区的展示文案，避免被误读成本机时区。
String formatShanghaiInstantWithZone(DateTime instant) =>
    '${formatShanghaiInstant(instant)}（北京时间）';

/// 手动录入的默认开始时间：**明天北京时间 19:00**（校园活动最常见的时间）。
///
/// 返回值是 UTC instant；调用方提交前不需要再做任何转换。
DateTime defaultActivityStart(DateTime now) {
  final DateTime wall = toShanghaiWallClock(now);
  final DateTime tomorrowAt19 = DateTime.utc(
    wall.year,
    wall.month,
    wall.day + 1,
    19,
  );
  return tomorrowAt19.subtract(shanghaiUtcOffset);
}

/// 日期选择器可选的北京时间窗口（首尾都是**墙钟读数**）。
final class ActivityPickerWindow {
  const ActivityPickerWindow({
    required this.firstWall,
    required this.lastWall,
  });

  final DateTime firstWall;
  final DateTime lastWall;
}

/// 由注入的 [now] 计算选择器窗口（默认前后一年 / 五年）。
///
/// 不读 `DateTime.now()`：否则测试与用户在不同机器上会得到不同的可选范围，
/// 而且「默认开始时间」与选择器边界可能落在不同的一天。
ActivityPickerWindow activityPickerWindow(
  DateTime now, {
  DateTime? firstUtc,
  DateTime? lastUtc,
}) {
  final DateTime nowUtc = now.toUtc();
  return ActivityPickerWindow(
    firstWall: toShanghaiWallClock(
      firstUtc ?? nowUtc.subtract(const Duration(days: 365)),
    ),
    lastWall: toShanghaiWallClock(
      lastUtc ?? nowUtc.add(const Duration(days: 365 * 5)),
    ),
  );
}
