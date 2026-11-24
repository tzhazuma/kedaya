import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/course_session.dart';
import 'package:kedaya/domain/models/deadline_item.dart';
import 'package:kedaya/domain/models/exam_entry.dart';
import 'package:kedaya/domain/models/ics_export.dart';
import 'package:kedaya/features/deadlines/application/deadlines_ics.dart';
import 'package:kedaya/features/schedule/application/schedule_ics.dart';

void main() {
  group('ICS 基础格式', () {
    test('包含 VCALENDAR / VEVENT 且用 CRLF 结尾', () {
      final String ics = buildIcs(
        <IcsEvent>[
          IcsEvent(
            uid: 'a@kedaya',
            summary: '高等数学',
            startUtc: DateTime.utc(2026, 3, 2, 0),
            endUtc: DateTime.utc(2026, 3, 2, 1, 40),
          ),
        ],
        generatedAt: DateTime.utc(2026, 3, 1),
      );
      expect(ics.startsWith('BEGIN:VCALENDAR\r\n'), isTrue);
      expect(ics.endsWith('END:VCALENDAR\r\n'), isTrue);
      expect('BEGIN:VEVENT'.allMatches(ics), hasLength(1));
      expect('END:VEVENT'.allMatches(ics), hasLength(1));
      expect(ics.contains('\n\n'), isFalse);
      expect(ics.contains('DTSTART:20260302T000000Z'), isTrue);
      expect(ics.contains('DTEND:20260302T014000Z'), isTrue);
    });

    test('文本字段转义：逗号、分号、反斜杠、换行', () {
      final String ics = buildIcs(
        <IcsEvent>[
          IcsEvent(
            uid: 'b@kedaya',
            summary: r'数学,物理;实验\A',
            description: '第一行\n第二行',
            startUtc: DateTime.utc(2026, 3, 2),
            endUtc: DateTime.utc(2026, 3, 2, 1),
          ),
        ],
        generatedAt: DateTime.utc(2026, 3, 1),
      );
      expect(ics.contains(r'SUMMARY:数学\,物理\;实验\\A'), isTrue);
      expect(ics.contains(r'DESCRIPTION:第一行\n第二行'), isTrue);
    });

    test('长行折行：续行以空格开头，且不丢内容', () {
      final String desc = '很长的备注' * 30;
      final String ics = buildIcs(
        <IcsEvent>[
          IcsEvent(
            uid: 'c@kedaya',
            summary: 'x',
            description: desc,
            startUtc: DateTime.utc(2026, 3, 2),
            endUtc: DateTime.utc(2026, 3, 2, 1),
          ),
        ],
        generatedAt: DateTime.utc(2026, 3, 1),
      );
      final List<String> lines =
          ics.split('\r\n').where((String l) => l.isNotEmpty).toList();
      for (final String line in lines) {
        expect(line.length, lessThanOrEqualTo(73));
      }
      final String joined = lines.join().replaceAll(' ', '');
      expect(joined.contains(desc.substring(0, 20)), isTrue);
    });
  });

  group('课表与考试导出', () {
    test('课程生成每周重复事件，开始时间转成 UTC', () {
      final DateTime now = DateTime(2026, 3, 2, 7); // 周一
      final List<IcsEvent> events = buildScheduleIcsEvents(
        sessions: <CourseSession>[
          const CourseSession(
            id: 'c1',
            courseName: '高等数学',
            teacher: '王立',
            location: '教学中心 1-302',
            weekday: CourseWeekday.monday,
            startMinutes: 8 * 60,
            endMinutes: 9 * 60 + 40,
            startPeriod: 1,
            endPeriod: 2,
          ),
        ],
        exams: const <ExamEntry>[],
        now: now,
      );
      expect(events, hasLength(1));
      final IcsEvent event = events.single;
      expect(event.uid, 'course-c1@kedaya');
      expect(event.recurrence, contains('FREQ=WEEKLY'));
      expect(event.recurrence, contains('BYDAY=MO'));
      expect(event.recurrence, contains('UNTIL='));
      // 断言用「同一时刻转 UTC」而不是绝对小时：CI 跑在 UTC，
      // 写死 00:00Z 只在 UTC+8 的开发机上成立。
      expect(event.startUtc, DateTime(2026, 3, 2, 8).toUtc());
      expect(event.endUtc, DateTime(2026, 3, 2, 9, 40).toUtc());
    });

    test('考试是单次事件，并带上座位与时长', () {
      final DateTime now = DateTime(2026, 3, 2, 7);
      final List<IcsEvent> events = buildScheduleIcsEvents(
        sessions: const <CourseSession>[],
        exams: <ExamEntry>[
          ExamEntry(
            id: 'e1',
            courseName: '大学物理',
            location: '教学中心 2-105',
            startsAt: DateTime(2026, 3, 20, 9),
            durationMinutes: 120,
            seat: 'A-03',
          ),
        ],
        now: now,
      );
      expect(events.single.summary, '考试：大学物理');
      expect(events.single.description, contains('座位：A-03'));
      expect(events.single.endUtc.difference(events.single.startUtc),
          const Duration(hours: 2));
    });

    test('考试排序与倒计时', () {
      final List<ExamEntry> exams = sortExams(demoExams(DateTime(2026, 3, 2)));
      expect(exams.first.startsAt.isBefore(exams.last.startsAt), isTrue);
      expect(daysUntilExam(exams.first, DateTime(2026, 3, 2)), 9);
      expect(daysUntilExam(exams.first, DateTime(2026, 3, 20)), lessThan(0));
    });
  });

  group('DDL 导出', () {
    test('只导出未完成项，截止时刻作为开始时间', () {
      final DateTime due = DateTime(2026, 3, 5, 23, 59);
      final List<DeadlineItem> items = <DeadlineItem>[
        DeadlineItem(
          id: 'd1',
          title: '作业 3',
          kind: DeadlineKind.homework,
          dueAt: due,
          source: '课程作业',
        ),
        DeadlineItem(
          id: 'd2',
          title: '已交作业',
          kind: DeadlineKind.homework,
          dueAt: due,
          completed: true,
        ),
      ];
      final List<IcsEvent> events = buildDeadlineIcsEvents(items);
      expect(events, hasLength(1));
      expect(events.single.summary, 'DDL：作业 3');
      expect(events.single.startUtc, due.toUtc());
      expect(events.single.endUtc, due.add(const Duration(minutes: 15)).toUtc());
    });
  });
}
