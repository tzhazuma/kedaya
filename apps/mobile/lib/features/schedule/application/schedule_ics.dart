import '../../../domain/models/course_session.dart';
import '../../../domain/models/exam_entry.dart';
import '../../../domain/models/ics_export.dart';

/// 把课表与考试转成 iCalendar 事件。
///
/// 课表是「每周重复」的，所以用 `RRULE:FREQ=WEEKLY;BYDAY=...;UNTIL=...`
/// 而不是展开成 16 条独立事件；考试是单次事件。
///
/// [weeks] 是学期长度，默认 16 周，只影响课表事件的 `UNTIL`。
List<IcsEvent> buildScheduleIcsEvents({
  required List<CourseSession> sessions,
  required List<ExamEntry> exams,
  required DateTime now,
  int weeks = 16,
}) {
  final DateTime today = DateTime(now.year, now.month, now.day);
  final DateTime weekStart =
      today.subtract(Duration(days: today.weekday - 1));
  final List<IcsEvent> events = <IcsEvent>[];

  for (final CourseSession session in sessions) {
    final DateTime day = weekStart
        .add(Duration(days: session.weekday.dateTimeValue - 1));
    final DateTime start =
        day.add(Duration(minutes: session.startMinutes));
    final DateTime end = day.add(Duration(minutes: session.endMinutes));
    final DateTime until = day
        .add(Duration(days: 7 * (weeks - 1)))
        .add(Duration(minutes: session.endMinutes));

    events.add(
      IcsEvent(
        uid: 'course-${session.id}@kedaya',
        summary: session.courseName,
        description: <String>[
          if (session.teacher.trim().isNotEmpty) '教师：${session.teacher}',
          '第 ${session.startPeriod}-${session.endPeriod} 节',
          if ((session.note ?? '').trim().isNotEmpty) '备注：${session.note}',
        ].join('\n'),
        location: session.location,
        startUtc: start.toUtc(),
        endUtc: end.toUtc(),
        recurrence:
            'FREQ=WEEKLY;BYDAY=${_byDay(session.weekday)};UNTIL=${formatIcsUtc(until.toUtc())}',
      ),
    );
  }

  for (final ExamEntry exam in exams) {
    events.add(
      IcsEvent(
        uid: 'exam-${exam.id}@kedaya',
        summary: '考试：${exam.courseName}',
        description: <String>[
          '考试时长 ${exam.durationMinutes} 分钟',
          if ((exam.seat ?? '').trim().isNotEmpty) '座位：${exam.seat}',
          if ((exam.note ?? '').trim().isNotEmpty) exam.note!,
        ].join('\n'),
        location: exam.location,
        startUtc: exam.startsAt.toUtc(),
        endUtc: exam.endsAt.toUtc(),
      ),
    );
  }

  return events;
}

String _byDay(CourseWeekday weekday) => switch (weekday) {
      CourseWeekday.monday => 'MO',
      CourseWeekday.tuesday => 'TU',
      CourseWeekday.wednesday => 'WE',
      CourseWeekday.thursday => 'TH',
      CourseWeekday.friday => 'FR',
      CourseWeekday.saturday => 'SA',
      CourseWeekday.sunday => 'SU',
    };
