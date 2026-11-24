import '../../../domain/models/deadline_item.dart';
import '../../../domain/models/ics_export.dart';

/// 把 DDL 转成日历事件：截止时刻开始、固定 15 分钟，标题前缀 `DDL：`。
///
/// 已完成的 DDL 不导出 —— 日历里留着已经交过的作业只会制造噪音。
List<IcsEvent> buildDeadlineIcsEvents(List<DeadlineItem> items) {
  final List<IcsEvent> events = <IcsEvent>[];
  for (final DeadlineItem item in items) {
    if (item.completed) continue;
    events.add(
      IcsEvent(
        uid: 'ddl-${item.id}@kedaya',
        summary: 'DDL：${item.title}',
        description: <String>[
          '类型：${item.kind.label}',
          if ((item.source ?? '').trim().isNotEmpty) '来源：${item.source}',
          if ((item.note ?? '').trim().isNotEmpty) item.note!,
        ].join('\n'),
        startUtc: item.dueAt.toUtc(),
        endUtc: item.dueAt.add(const Duration(minutes: 15)).toUtc(),
      ),
    );
  }
  return events;
}
