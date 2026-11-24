import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/course_session.dart';
import 'package:kedaya/features/schedule/application/schedule_providers.dart';
import 'package:kedaya/features/schedule/data/in_memory_schedule_repository.dart';
import 'package:kedaya/features/schedule/presentation/pages/schedule_page.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

/// 课表（`schedule`）的测试。
///
/// 固定时刻选 **2026-11-24（周二）10:00**：
/// 本周从 11-23（周一）开始，今天筛选与「进行中」都能用常量断言。
void main() {
  final DateTime now = DateTime(2026, 11, 24, 10, 0);

  CourseSession session({
    required String id,
    required String courseName,
    required CourseWeekday weekday,
    required int startHour,
    required int startMinute,
    int durationMinutes = 100,
    String teacher = '张涛',
    String location = '信息学院 1-101',
    int startPeriod = 1,
    int endPeriod = 2,
    String? note,
  }) {
    final int start = startHour * 60 + startMinute;
    return CourseSession(
      id: id,
      courseName: courseName,
      teacher: teacher,
      location: location,
      weekday: weekday,
      startMinutes: start,
      endMinutes: start + durationMinutes,
      startPeriod: startPeriod,
      endPeriod: endPeriod,
      note: note,
    );
  }

  Future<void> pumpSchedule(
    WidgetTester tester, {
    required List<CourseSession> sessions,
    DateTime? clock,
  }) async {
    tester.view.physicalSize = const Size(1200, 3000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          scheduleRepositoryProvider.overrideWithValue(
            InMemoryScheduleRepository(sessions: sessions),
          ),
          scheduleClockProvider.overrideWithValue(() => clock ?? now),
        ],
        child: MaterialApp(
          theme: KedaYaTheme.light(),
          home: const SchedulePage(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  group('规则层', () {
    test('按开始时间升序排序，与输入顺序无关', () {
      final List<CourseSession> sorted = sortCourseSessions(<CourseSession>[
        session(
          id: 'late',
          courseName: '编译原理',
          weekday: CourseWeekday.tuesday,
          startHour: 14,
          startMinute: 0,
        ),
        session(
          id: 'early',
          courseName: '程序分析',
          weekday: CourseWeekday.tuesday,
          startHour: 8,
          startMinute: 0,
        ),
        session(
          id: 'mid',
          courseName: '计算机网络',
          weekday: CourseWeekday.tuesday,
          startHour: 10,
          startMinute: 0,
        ),
      ]);

      expect(
        sorted.map((CourseSession item) => item.courseName).toList(),
        <String>['程序分析', '计算机网络', '编译原理'],
      );
    });

    test('开始时间相同时保留输入顺序（Dart sort 不保证稳定）', () {
      CourseSession first = session(
        id: 'first',
        courseName: '高等数学（下）',
        weekday: CourseWeekday.monday,
        startHour: 8,
        startMinute: 0,
      );
      CourseSession second = session(
        id: 'second',
        courseName: '大学物理 II',
        weekday: CourseWeekday.monday,
        startHour: 8,
        startMinute: 0,
      );

      final List<CourseSession> sorted =
          sortCourseSessions(<CourseSession>[first, second]);

      expect(
        sorted.map((CourseSession item) => item.id).toList(),
        <String>['first', 'second'],
      );
    });

    test('今日筛选只留当天，并保持开始时间升序', () {
      final List<CourseSession> sessions = <CourseSession>[
        session(
          id: 'wed',
          courseName: '嵌入式系统',
          weekday: CourseWeekday.wednesday,
          startHour: 10,
          startMinute: 0,
        ),
        session(
          id: 'tue-late',
          courseName: '编译原理',
          weekday: CourseWeekday.tuesday,
          startHour: 14,
          startMinute: 0,
        ),
        session(
          id: 'tue-early',
          courseName: '程序分析',
          weekday: CourseWeekday.tuesday,
          startHour: 8,
          startMinute: 0,
        ),
      ];

      final List<CourseSession> today =
          sessionsOn(sessions, CourseWeekday.tuesday);

      expect(today.map((CourseSession item) => item.id).toList(),
          <String>['tue-early', 'tue-late']);
    });

    test('进行中判定：开始时刻算上课，结束时刻算下课，别的星期不算', () {
      final CourseSession ongoing = session(
        id: 'ongoing',
        courseName: '程序分析',
        weekday: CourseWeekday.tuesday,
        startHour: 9,
        startMinute: 0,
        durationMinutes: 120,
      );

      expect(ongoing.isOngoingAt(DateTime(2026, 11, 24, 8, 59)), isFalse);
      expect(ongoing.isOngoingAt(DateTime(2026, 11, 24, 9, 0)), isTrue);
      expect(ongoing.isOngoingAt(DateTime(2026, 11, 24, 10, 0)), isTrue);
      expect(ongoing.isOngoingAt(DateTime(2026, 11, 24, 11, 0)), isFalse);
      // 同一时刻但换一天（周一）不算。
      expect(ongoing.isOngoingAt(DateTime(2026, 11, 23, 10, 0)), isFalse);
    });

    test('本周从周一开始，恰好 7 天', () {
      final List<DateTime> week = weekDatesFor(now);

      expect(week.length, 7);
      expect(week.first, DateTime(2026, 11, 23));
      expect(week.last, DateTime(2026, 11, 29));
      expect(week[1], DateTime(2026, 11, 24));
    });
  });

  group('今天 tab', () {
    testWidgets('只显示今天的课，并按开始时间排序', (WidgetTester tester) async {
      await pumpSchedule(
        tester,
        sessions: <CourseSession>[
          session(
            id: 'wed',
            courseName: '嵌入式系统',
            weekday: CourseWeekday.wednesday,
            startHour: 10,
            startMinute: 0,
          ),
          session(
            id: 'tue-late',
            courseName: '编译原理',
            weekday: CourseWeekday.tuesday,
            startHour: 14,
            startMinute: 0,
            teacher: '陈晓',
            location: '信息学院 1-204',
            startPeriod: 5,
            endPeriod: 6,
          ),
          session(
            id: 'tue-early',
            courseName: '程序分析',
            weekday: CourseWeekday.tuesday,
            startHour: 8,
            startMinute: 0,
            teacher: '张涛',
            location: '信息学院 1-101',
          ),
        ],
      );

      expect(find.text('嵌入式系统'), findsNothing);
      expect(find.text('程序分析'), findsOneWidget);
      expect(find.text('编译原理'), findsOneWidget);

      final double early = tester.getTopLeft(find.text('程序分析')).dy;
      final double late = tester.getTopLeft(find.text('编译原理')).dy;
      expect(late, greaterThan(early), reason: '14:00 的课应排在 08:00 之后');

      // 课程名、教师、地点、第几节、起止时间都要在卡片上。
      expect(find.text('张涛'), findsOneWidget);
      expect(find.text('信息学院 1-101'), findsOneWidget);
      expect(find.text('第 1–2 节'), findsOneWidget);
      expect(find.text('08:00–09:40'), findsOneWidget);
    });

    testWidgets('进行中的课高亮并显示「进行中」，其它课没有', (WidgetTester tester) async {
      await pumpSchedule(
        tester,
        sessions: <CourseSession>[
          session(
            id: 'ended',
            courseName: '编译原理',
            weekday: CourseWeekday.tuesday,
            startHour: 8,
            startMinute: 0,
          ),
          session(
            id: 'ongoing',
            courseName: '程序分析',
            weekday: CourseWeekday.tuesday,
            startHour: 9,
            startMinute: 0,
            durationMinutes: 120,
            startPeriod: 3,
            endPeriod: 4,
          ),
          session(
            id: 'later',
            courseName: '计算机网络',
            weekday: CourseWeekday.tuesday,
            startHour: 14,
            startMinute: 0,
          ),
        ],
      );

      expect(find.text('进行中'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey<String>('schedule-today-ongoing')),
          matching: find.text('进行中'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const ValueKey<String>('schedule-today-ended')),
          matching: find.text('进行中'),
        ),
        findsNothing,
      );
    });

    testWidgets('今天没课 → 空态说明「演示课表，真实课表需接入教务」', (WidgetTester tester) async {
      await pumpSchedule(
        tester,
        sessions: <CourseSession>[
          session(
            id: 'mon',
            courseName: '高等数学（下）',
            weekday: CourseWeekday.monday,
            startHour: 8,
            startMinute: 0,
          ),
        ],
      );

      expect(find.text('今天没有课'), findsOneWidget);
      expect(find.textContaining('演示课表，真实课表需接入教务'), findsWidgets);
    });
  });

  group('本周 tab', () {
    testWidgets('周一到周日纵向分组，每门课有时间与地点', (WidgetTester tester) async {
      await pumpSchedule(
        tester,
        sessions: <CourseSession>[
          session(
            id: 'mon',
            courseName: '高等数学（下）',
            weekday: CourseWeekday.monday,
            startHour: 8,
            startMinute: 0,
            location: '教学中心 1-302',
          ),
          session(
            id: 'wed',
            courseName: '嵌入式系统',
            weekday: CourseWeekday.wednesday,
            startHour: 10,
            startMinute: 0,
            location: '信息学院 2-301',
          ),
        ],
      );

      await tester.tap(find.text('本周'));
      await tester.pumpAndSettle();

      // 七天都出现，且周一是第一组、周日是最后一组。
      for (final CourseWeekday weekday in CourseWeekday.values) {
        expect(find.text(weekday.label), findsWidgets);
      }
      expect(
        tester.getTopLeft(find.text('周一')).dy,
        lessThan(tester.getTopLeft(find.text('周三')).dy),
      );
      expect(
        tester.getTopLeft(find.text('周三')).dy,
        lessThan(tester.getTopLeft(find.text('周日')).dy),
      );

      // 课程的时间与地点都在本周列表里。
      expect(find.text('08:00–09:40'), findsOneWidget);
      expect(find.text('教学中心 1-302'), findsOneWidget);
      expect(find.text('10:00–11:40'), findsOneWidget);
      expect(find.text('信息学院 2-301'), findsOneWidget);

      // 周二、周四、周五、周六、周日无课（周一、周三各有一门）。
      expect(find.text('无课'), findsNWidgets(5));
    });

    testWidgets('整周没课 → 空态也说明是演示课表', (WidgetTester tester) async {
      await pumpSchedule(tester, sessions: const <CourseSession>[]);

      await tester.tap(find.text('本周'));
      await tester.pumpAndSettle();

      expect(find.text('本周还没有课程'), findsOneWidget);
      expect(find.textContaining('演示课表，真实课表需接入教务'), findsWidgets);
    });
  });
}
