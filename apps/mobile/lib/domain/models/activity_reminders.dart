/// 默认提醒规则（共同契约）：
///
/// - 报名截止前 **24 小时**；
/// - 开始前 **1 小时**；
/// - 目标已过 → **不建**（目标恰好等于 `now` 也算已过）；
/// - 计算出的提醒时刻已过、但目标仍未来 → `min(now + 5 分钟, target)`，
///   兜底时刻**不得晚于目标**；
/// - 提前量恰好落在 `now` → 直接使用（与 shared 的 `>= now` 一致）。
///
/// 规则是**纯函数**：调用方注入 `now`，因此服务端、mock 与测试可以逐条对齐。
/// 这里只规划，不落库；是否允许排提醒由
/// `ActivityItem.canScheduleReminders`（仅 confirmed）决定。
library;

import 'activity.dart';

const Duration registrationReminderLead = Duration(hours: 24);
const Duration activityStartReminderLead = Duration(hours: 1);
const Duration overdueReminderGrace = Duration(minutes: 5);

/// 一条待创建的提醒计划。
final class ActivityReminderPlan {
  const ActivityReminderPlan({
    required this.kind,
    required this.targetAt,
    required this.remindAt,
    this.channel = ActivityReminderChannel.inapp,
  });

  final ActivityReminderKind kind;

  /// 被提醒的目标时刻（报名截止或活动开始），UTC。
  final DateTime targetAt;

  /// 实际提醒时刻，UTC。
  final DateTime remindAt;

  final ActivityReminderChannel channel;

  @override
  bool operator ==(Object other) =>
      other is ActivityReminderPlan &&
      other.kind == kind &&
      other.targetAt == targetAt &&
      other.remindAt == remindAt &&
      other.channel == channel;

  @override
  int get hashCode => Object.hash(kind, targetAt, remindAt, channel);

  @override
  String toString() => 'ActivityReminderPlan(${kind.wire}, '
      'target=${targetAt.toIso8601String()}, '
      'remind=${remindAt.toIso8601String()})';
}

/// 按契约计算默认提醒（顺序：报名截止 → 开始）。
///
/// **不会**因为 `registrationDeadlineRaw` 存在就编一个时刻：
/// 只有 [ActivityItem.registrationDeadlineAt] 是可确定 instant 时才排提醒。
List<ActivityReminderPlan> defaultActivityReminders(
  ActivityItem item,
  DateTime now,
) {
  final DateTime nowUtc = now.toUtc();
  final List<ActivityReminderPlan> plans = <ActivityReminderPlan>[];

  void plan(ActivityReminderKind kind, DateTime? target, Duration lead) {
    if (target == null) return;
    final DateTime targetUtc = target.toUtc();
    // 目标已过（恰好等于 now 也算已过）→ 不建。
    if (!targetUtc.isAfter(nowUtc)) return;

    final DateTime computed = targetUtc.subtract(lead);
    // 与 `packages/shared/src/activities-reminders.ts` 对齐：
    // - 提前量**恰好落在 now** 仍算未来，直接使用；
    // - 兜底时刻取 min(now + 5min, target)，绝不能晚于目标。
    final DateTime remindAt;
    if (!computed.isBefore(nowUtc)) {
      remindAt = computed;
    } else {
      final DateTime fallback = nowUtc.add(overdueReminderGrace);
      remindAt = fallback.isAfter(targetUtc) ? targetUtc : fallback;
    }
    plans.add(
      ActivityReminderPlan(
        kind: kind,
        targetAt: targetUtc,
        remindAt: remindAt,
      ),
    );
  }

  plan(
    ActivityReminderKind.registration,
    item.registrationDeadlineAt,
    registrationReminderLead,
  );
  plan(ActivityReminderKind.start, item.startsAt, activityStartReminderLead);

  return plans;
}
