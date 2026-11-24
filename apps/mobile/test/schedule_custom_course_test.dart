import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/course_session.dart';
import 'package:kedaya/features/schedule/application/schedule_providers.dart';
import 'package:kedaya/features/schedule/data/in_memory_schedule_repository.dart';

CourseSession _course({
  String id = 'c1',
  CourseWeekday weekday = CourseWeekday.monday,
  int start = 8 * 60,
  int end = 9 * 60 + 40,
}) =>
    CourseSession(
      id: id,
      courseName: '程序分析',
      teacher: '李老师',
      location: '信息学院 1-101',
      weekday: weekday,
      startMinutes: start,
      endMinutes: end,
      startPeriod: estimatePeriodForMinutes(start),
      endPeriod: estimatePeriodForMinutes(end),
    );

void main() {
  group('节次估算', () {
    test('08:00 是第 1 节，08:45 是第 2 节', () {
      expect(estimatePeriodForMinutes(8 * 60), 1);
      expect(estimatePeriodForMinutes(8 * 60 + 45), 2);
    });

    test('早于 08:00 与晚于 20:00 都被夹在 1..12', () {
      expect(estimatePeriodForMinutes(6 * 60), 1);
      expect(estimatePeriodForMinutes(23 * 60), 12);
    });
  });

  group('自定义课程（本机内存）', () {
    test('新增后按开始时间重排', () async {
      final InMemoryScheduleRepository repo = InMemoryScheduleRepository(
        sessions: <CourseSession>[
          _course(id: 'late', start: 14 * 60, end: 15 * 60),
        ],
      );
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          scheduleRepositoryProvider.overrideWithValue(repo),
        ],
      );
      addTearDown(container.dispose);

      await container.read(weekScheduleProvider.future);
      await container
          .read(weekScheduleProvider.notifier)
          .addCourse(_course(id: 'early', start: 8 * 60, end: 9 * 60));

      final List<CourseSession> items = container.read(weekScheduleProvider).requireValue;
      expect(items.map((CourseSession c) => c.id), <String>['early', 'late']);
    });

    test('删除后列表里不再有该课程，且重复删除是幂等的', () async {
      final InMemoryScheduleRepository repo = InMemoryScheduleRepository(
        sessions: <CourseSession>[_course(id: 'c1'), _course(id: 'c2')],
      );
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          scheduleRepositoryProvider.overrideWithValue(repo),
        ],
      );
      addTearDown(container.dispose);

      await container.read(weekScheduleProvider.future);
      await container.read(weekScheduleProvider.notifier).removeCourse('c1');
      expect(
        container.read(weekScheduleProvider).requireValue.map((CourseSession c) => c.id),
        <String>['c2'],
      );

      await container.read(weekScheduleProvider.notifier).removeCourse('c1');
      expect(container.read(weekScheduleProvider).requireValue, hasLength(1));
    });
  });
}
