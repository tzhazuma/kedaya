import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/models/course_session.dart';
import '../../../domain/models/exam_entry.dart';
import '../data/in_memory_schedule_repository.dart';

/// 「现在」的注入点。
///
/// 「今天上什么课」「哪节正在进行」都依赖它；测试里 override 成固定时刻，
/// 就能对「今天筛选」与「进行中」做确定性断言。
final scheduleClockProvider =
    Provider<DateTime Function()>((ref) => DateTime.now);

/// 课表仓库（当前是 feature 内的本机内存演示数据）。
final scheduleRepositoryProvider = Provider<ScheduleRepository>(
  (ref) => InMemoryScheduleRepository(),
);

/// 整周课表（**已按开始时间排序**）。
final weekScheduleProvider =
    AsyncNotifierProvider<WeekScheduleController, List<CourseSession>>(
  WeekScheduleController.new,
);

final class WeekScheduleController extends AsyncNotifier<List<CourseSession>> {
  @override
  Future<List<CourseSession>> build() => _load();

  /// 手动刷新（「刷新」按钮）。
  Future<void> refresh() async {
    state = const AsyncLoading<List<CourseSession>>();
    state = await AsyncValue.guard<List<CourseSession>>(_load);
  }

  Future<List<CourseSession>> _load() async {
    final ScheduleRepository repository = ref.read(scheduleRepositoryProvider);
    // 排序是纯领域函数：这里只负责把仓库结果排好，不含任何规则副本。
    return sortCourseSessions(await repository.list());
  }

  /// 新增课程后立即重载（列表按开始时间重排）。
  Future<void> addCourse(CourseSession session) async {
    await ref.read(scheduleRepositoryProvider).add(session);
    state = AsyncValue<List<CourseSession>>.data(await _load());
  }

  /// 删除课程；删除失败也要把最新列表刷回来，避免界面与仓库不一致。
  Future<void> removeCourse(String id) async {
    await ref.read(scheduleRepositoryProvider).remove(id);
    state = AsyncValue<List<CourseSession>>.data(await _load());
  }
}

/// 学期考试（演示数据，按开考时间升序）。
final examsProvider = Provider<List<ExamEntry>>((ref) {
  final DateTime now = ref.watch(scheduleClockProvider)();
  return sortExams(demoExams(now));
});
