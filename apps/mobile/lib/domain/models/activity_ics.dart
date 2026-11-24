import 'activity.dart';
import 'ics_export.dart';

/// 默认时长：没有结束时间时按 2 小时排。
///
/// 为什么不排成「全天事件」：活动多为晚上或下午的讲座，全天事件会占满
/// 用户整天的日历，反而更难看出冲突。2 小时是一个可被用户随手改的默认值。
const Duration _defaultDuration = Duration(hours: 2);

/// 把活动转成日历事件。
///
/// 只导出**能落到日历上**的活动：
/// - 没有 `startsAt` 的跳过（时间待确认的活动导出成什么都是错的）；
/// - `candidate` 也允许导出（用户可能先想看看时间冲突），但调用方要提示
///   「还没确认」——本函数不替用户决定，只做格式转换。
///
/// UID 用活动 id：同一条活动重复导出会被日历识别为同一个事件并覆盖，
/// 不会堆出一串重复条目。
List<IcsEvent> buildActivityIcsEvents(List<ActivityItem> activities) {
  final List<IcsEvent> events = <IcsEvent>[];
  for (final ActivityItem activity in activities) {
    final DateTime? start = activity.startsAt;
    if (start == null) continue;

    final DateTime end = activity.endsAt ?? start.add(_defaultDuration);
    // 结束早于等于开始是脏数据：丢掉时长，退回默认值，别产出反向事件。
    final DateTime safeEnd =
        end.isAfter(start) ? end : start.add(_defaultDuration);

    events.add(
      IcsEvent(
        uid: 'activity-${activity.id}@kedaya',
        summary: activity.title,
        startUtc: start.toUtc(),
        endUtc: safeEnd.toUtc(),
        description: _descriptionFor(activity),
        location: activity.location,
      ),
    );
  }
  return events;
}

/// 描述里只放已经在库里、且本来就允许上屏的字段。
///
/// 不拼正文、不拼邮件全文：`evidenceText` 上限 200 字，是这个项目对
/// 「来源证据」的既有约定。
String? _descriptionFor(ActivityItem activity) {
  final List<String> lines = <String>[];
  final String? evidence = activity.evidenceText?.trim();
  if (evidence != null && evidence.isNotEmpty) lines.add(evidence);
  final String? url = activity.sourceUrl;
  if (url != null && url.trim().isNotEmpty) lines.add(url.trim());
  if (activity.isPending) lines.add('（待确认：这条活动还没有加入你的日程）');
  return lines.isEmpty ? null : lines.join('\n\n');
}
