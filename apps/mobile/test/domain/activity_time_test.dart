import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/activity_time.dart';

/// 活动的 `startsAt` / `registrationDeadlineAt` 都是 **UTC instant**，
/// 展示一律换算到 Asia/Shanghai（UTC+8，无夏令时）。
///
/// 这组测试守两条线：
///   1. 换算只发生在展示/录入边界，模型里永远存 UTC；
///   2. 录入的墙钟时间（用户在北京时间选的那一格）换回 UTC 时不会漂移。
void main() {
  group('UTC → Asia/Shanghai', () {
    test('UTC 00:30 是北京时间当天 08:30', () {
      final DateTime instant = DateTime.utc(2026, 3, 1, 0, 30);
      expect(formatShanghaiInstant(instant), '2026-03-01 08:30');
      expect(formatShanghaiDate(instant), '2026-03-01');
      expect(formatShanghaiTime(instant), '08:30');
    });

    test('跨年：UTC 12-31 20:00 是北京时间次年 01-01 04:00', () {
      final DateTime instant = DateTime.utc(2026, 12, 31, 20);
      expect(formatShanghaiInstant(instant), '2027-01-01 04:00');
      expect(formatShanghaiDate(instant), '2027-01-01');
    });

    test('展示文案显式标注时区，避免被误读成本机时区', () {
      expect(
        formatShanghaiInstantWithZone(DateTime.utc(2026, 11, 25, 2)),
        '2026-11-25 10:00（北京时间）',
      );
    });
  });

  group('Asia/Shanghai 墙钟 → UTC instant', () {
    test('北京时间 08:30 存成 UTC 00:30', () {
      expect(
        shanghaiWallClockToUtc(DateTime(2026, 3, 1, 8, 30)),
        DateTime.utc(2026, 3, 1, 0, 30),
      );
    });

    test('只读取墙钟的字段，不受 DateTime.isUtc 标记影响', () {
      expect(
        shanghaiWallClockToUtc(DateTime.utc(2026, 11, 25, 10)),
        DateTime.utc(2026, 11, 25, 2),
      );
    });

    test('toShanghaiWallClock 保留同一 instant，只换读数', () {
      final DateTime instant = DateTime.utc(2026, 11, 25, 2);
      final DateTime wall = toShanghaiWallClock(instant);
      expect(wall.hour, 10);
      expect(wall.minute, 0);
      // 墙钟读数只用于展示字段；格式化函数接收的是 **instant**，不要二次换算。
      expect(formatShanghaiInstant(instant), '2026-11-25 10:00');
    });
  });

  group('活动时刻解析：只接受带时区的 ISO-8601 instant', () {
    test('date-only 不当作时刻，不补午夜', () {
      expect(parseActivityInstant('2026-11-25'), isNull);
      expect(parseActivityInstant(' 2026-11-25 '), isNull);
    });

    test('没有时区的墙钟时间也拒绝（不按本机时区猜）', () {
      expect(parseActivityInstant('2026-11-25T10:00'), isNull);
      expect(parseActivityInstant('2026-11-25T10:00:00.000'), isNull);
    });

    test('带 Z 或显式偏移才解析成 UTC instant', () {
      expect(
        parseActivityInstant('2026-11-25T02:00:00.000Z'),
        DateTime.utc(2026, 11, 25, 2),
      );
      expect(
        parseActivityInstant('2026-11-25T10:00:00+08:00'),
        DateTime.utc(2026, 11, 25, 2),
      );
    });

    test('非字符串 / 空串 / 非法值返回 null', () {
      expect(parseActivityInstant(null), isNull);
      expect(parseActivityInstant(42), isNull);
      expect(parseActivityInstant(''), isNull);
      expect(parseActivityInstant('not-a-date'), isNull);
    });
  });

  group('日期选择器的可选项窗口来自注入的 now', () {
    test('默认窗口围绕注入时刻，而不是机器当前时间', () {
      final DateTime now = DateTime.utc(2040, 1, 1);
      final ActivityPickerWindow window = activityPickerWindow(now);

      expect(
        window.firstWall,
        toShanghaiWallClock(now.subtract(const Duration(days: 365))),
      );
      expect(
        window.lastWall,
        toShanghaiWallClock(now.add(const Duration(days: 365 * 5))),
      );
      expect(window.firstWall.isBefore(window.lastWall), isTrue);
    });

    test('显式 first/last 覆盖默认窗口', () {
      final DateTime now = DateTime.utc(2026, 11, 22);
      final ActivityPickerWindow window = activityPickerWindow(
        now,
        firstUtc: DateTime.utc(2026, 12, 1),
        lastUtc: DateTime.utc(2026, 12, 31),
      );
      expect(formatShanghaiDate(window.firstWall), '2026-12-01');
      expect(formatShanghaiDate(window.lastWall), '2026-12-31');
    });
  });

  group('手动录入的默认开始时间', () {
    test('默认是“明天北京时间 19:00”，不是把日期字符串直接 new Date', () {
      final DateTime now = DateTime.utc(2026, 11, 22, 10); // 北京 18:00
      final DateTime start = defaultActivityStart(now);
      expect(start, DateTime.utc(2026, 11, 23, 11)); // 北京 11-23 19:00
      expect(formatShanghaiInstant(start), '2026-11-23 19:00');
    });

    test('深夜也不会落到已经过去的时刻', () {
      final DateTime now = DateTime.utc(2026, 11, 22, 15); // 北京 23:00
      final DateTime start = defaultActivityStart(now);
      expect(start.isAfter(now), isTrue);
      expect(formatShanghaiInstant(start), '2026-11-23 19:00');
    });
  });
}
