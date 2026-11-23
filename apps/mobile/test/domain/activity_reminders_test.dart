import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/activity.dart';
import 'package:kedaya/domain/models/activity_reminders.dart';

ActivityItem _item({
  String status = 'confirmed',
  DateTime? startsAt,
  DateTime? registrationDeadlineAt,
  String? registrationDeadlineRaw,
}) =>
    ActivityItem.fromJson(<String, Object?>{
      'id': 'act-1',
      'source': 'wechat-mp',
      'kind': 'lecture',
      'title': '活动',
      'startsAt': startsAt?.toUtc().toIso8601String(),
      'registrationDeadlineAt':
          registrationDeadlineAt?.toUtc().toIso8601String(),
      'registrationDeadlineRaw': registrationDeadlineRaw,
      'status': status,
    });

void main() {
  final DateTime now = DateTime.utc(2026, 11, 22);

  group('默认提醒规则', () {
    test('报名截止前 24 小时 + 开始前 1 小时', () {
      final ActivityItem item = _item(
        startsAt: DateTime.utc(2026, 11, 25, 2),
        registrationDeadlineAt: DateTime.utc(2026, 11, 24, 2),
      );

      final List<ActivityReminderPlan> plans =
          defaultActivityReminders(item, now);

      expect(plans, hasLength(2));
      expect(plans[0].kind, ActivityReminderKind.registration);
      expect(plans[0].remindAt, DateTime.utc(2026, 11, 23, 2));
      expect(plans[0].channel, ActivityReminderChannel.inapp);
      expect(plans[1].kind, ActivityReminderKind.start);
      expect(plans[1].remindAt, DateTime.utc(2026, 11, 25, 1));
    });

    test('报名截止只有原文、没有可确定时刻 → 不创建截止提醒', () {
      final ActivityItem item = _item(
        startsAt: DateTime.utc(2026, 11, 25, 2),
        registrationDeadlineRaw: '11 月 30 日闭馆前',
      );

      final List<ActivityReminderPlan> plans =
          defaultActivityReminders(item, now);

      expect(plans, hasLength(1));
      expect(plans.single.kind, ActivityReminderKind.start);
    });

    test('目标已过 → 不建提醒；另一个未来目标仍然建', () {
      final ActivityItem item = _item(
        startsAt: DateTime.utc(2026, 11, 20, 2),
        registrationDeadlineAt: DateTime.utc(2026, 11, 24, 2),
      );

      final List<ActivityReminderPlan> plans =
          defaultActivityReminders(item, now);

      expect(plans, hasLength(1));
      expect(plans.single.kind, ActivityReminderKind.registration);
    });

    test('目标恰好等于 now → 视为已过，不建提醒', () {
      final ActivityItem item = _item(startsAt: now);
      expect(defaultActivityReminders(item, now), isEmpty);
    });

    test('提前量刚好落在 now → 直接使用（与 shared 的 >= now 一致）', () {
      final ActivityItem item = _item(
        startsAt: now.add(activityStartReminderLead),
      );

      final ActivityReminderPlan plan =
          defaultActivityReminders(item, now).single;

      expect(plan.kind, ActivityReminderKind.start);
      expect(plan.remindAt, now);
    });

    test('目标只剩 3 分钟 → 兜底提醒不晚于目标', () {
      final DateTime target = now.add(const Duration(minutes: 3));
      final ActivityItem item = _item(startsAt: target);

      final ActivityReminderPlan plan =
          defaultActivityReminders(item, now).single;

      expect(plan.remindAt, target);
      expect(plan.remindAt.isAfter(plan.targetAt), isFalse);
    });

    test('兜底提醒永远不晚于目标（目标 10 分钟 → now + 5 分钟）', () {
      final DateTime target = now.add(const Duration(minutes: 10));
      final ActivityItem item = _item(startsAt: target);

      final ActivityReminderPlan plan =
          defaultActivityReminders(item, now).single;

      expect(plan.remindAt, now.add(overdueReminderGrace));
      expect(plan.remindAt.isAfter(plan.targetAt), isFalse);
    });

    test('计算时刻已过但目标未来 → now + 5 分钟', () {
      final DateTime lateNow = DateTime.utc(2026, 11, 24);
      final ActivityItem item = _item(
        startsAt: DateTime.utc(2026, 11, 24, 2),
        registrationDeadlineAt: DateTime.utc(2026, 11, 24, 1),
      );

      final List<ActivityReminderPlan> plans =
          defaultActivityReminders(item, lateNow);

      expect(plans, hasLength(2));
      expect(plans[0].kind, ActivityReminderKind.registration);
      expect(plans[0].remindAt, lateNow.add(const Duration(minutes: 5)));
      expect(plans[1].kind, ActivityReminderKind.start);
      expect(plans[1].remindAt, DateTime.utc(2026, 11, 24, 1));
    });

    test('没有任何可确定时间 → 不建提醒', () {
      expect(defaultActivityReminders(_item(), now), isEmpty);
    });

    test('计划里的目标时刻保持 UTC', () {
      final ActivityItem item = _item(
        startsAt: DateTime.utc(2026, 11, 25, 2),
      );
      final ActivityReminderPlan plan =
          defaultActivityReminders(item, now).single;
      expect(plan.targetAt.isUtc, isTrue);
      expect(plan.remindAt.isUtc, isTrue);
    });
  });
}
