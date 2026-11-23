import 'package:flutter/material.dart';

import '../../../../domain/models/activity_time.dart';

/// 选择“北京时间”的日期 + 时刻，返回 UTC instant。
///
/// 选择器给的是墙钟字段；这里显式换算成 UTC，避免把日期字符串直接当成本地
/// 零点造成漂移。用户看到的永远是北京时间。
///
/// [now] 必须由调用方注入（`activitiesClockProvider`），不要在这里读
/// `DateTime.now()` —— 否则可选范围与默认开始时间会来自两个不同的时刻。
typedef ActivityDateTimePicker = Future<DateTime?> Function(
  BuildContext context, {
  required DateTime initialUtc,
  required DateTime now,
  DateTime? firstUtc,
  DateTime? lastUtc,
});

Future<DateTime?> pickActivityDateTime(
  BuildContext context, {
  required DateTime initialUtc,
  required DateTime now,
  DateTime? firstUtc,
  DateTime? lastUtc,
}) async {
  final DateTime initialWall = toShanghaiWallClock(initialUtc);
  final ActivityPickerWindow window = activityPickerWindow(
    now,
    firstUtc: firstUtc,
    lastUtc: lastUtc,
  );
  final DateTime firstWall = window.firstWall;
  final DateTime lastWall = window.lastWall;

  final DateTime initialDate =
      DateTime(initialWall.year, initialWall.month, initialWall.day);
  final DateTime firstDate = DateTime(
    firstWall.year,
    firstWall.month,
    firstWall.day,
  );
  final DateTime lastDate = DateTime(
    lastWall.year,
    lastWall.month,
    lastWall.day,
  );

  final DateTime? date = await showDatePicker(
    context: context,
    initialDate: initialDate.isBefore(firstDate)
        ? firstDate
        : (initialDate.isAfter(lastDate) ? lastDate : initialDate),
    firstDate: firstDate,
    lastDate: lastDate,
    helpText: '选择日期（北京时间）',
  );
  if (date == null || !context.mounted) return null;

  final TimeOfDay? time = await showTimePicker(
    context: context,
    initialTime: TimeOfDay(
      hour: initialWall.hour,
      minute: initialWall.minute,
    ),
    helpText: '选择时刻（北京时间）',
  );
  if (time == null) return null;

  return shanghaiWallClockToUtc(
    DateTime(date.year, date.month, date.day, time.hour, time.minute),
  );
}
