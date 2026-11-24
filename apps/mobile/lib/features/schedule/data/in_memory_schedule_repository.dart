import '../../../domain/models/course_session.dart';

/// 课表仓库（feature 内的最小接口）。
///
/// 真实课表需要接入教务系统；当前实现是**本机内存演示数据**，
/// 因此页面必须写明「演示课表，真实课表需接入教务」。
abstract interface class ScheduleRepository {
  /// 全部课程时段（未排序；排序由 application 层的纯函数负责）。
  Future<List<CourseSession>> list();
}

/// 本机内存课表：启动即有一份演示数据，不读写网络与磁盘。
final class InMemoryScheduleRepository implements ScheduleRepository {
  InMemoryScheduleRepository({List<CourseSession>? sessions})
      : _sessions = List<CourseSession>.of(
          sessions ?? demoWeekSchedule(),
          growable: false,
        );

  final List<CourseSession> _sessions;

  @override
  Future<List<CourseSession>> list() async =>
      List<CourseSession>.unmodifiable(_sessions);

  /// 测试用：仓库里到底有几条。
  int get debugLength => _sessions.length;
}

/// 演示课表：周一到周五有课，周末无课（用来展示「今天没有课」的空态）。
///
/// 时间是**周内重复**的，与具体日期无关；换一天打开应用也只是换一列。
List<CourseSession> demoWeekSchedule() => <CourseSession>[
      const CourseSession(
        id: 'course-demo-01',
        courseName: '高等数学（下）',
        teacher: '王立',
        location: '教学中心 1-302',
        weekday: CourseWeekday.monday,
        startMinutes: 8 * 60,
        endMinutes: 9 * 60 + 40,
        startPeriod: 1,
        endPeriod: 2,
      ),
      const CourseSession(
        id: 'course-demo-02',
        courseName: '大学物理 II',
        teacher: '李敏',
        location: '教学中心 2-205',
        weekday: CourseWeekday.monday,
        startMinutes: 10 * 60,
        endMinutes: 11 * 60 + 40,
        startPeriod: 3,
        endPeriod: 4,
      ),
      const CourseSession(
        id: 'course-demo-03',
        courseName: '程序分析',
        teacher: '张涛',
        location: '信息学院 1-101',
        weekday: CourseWeekday.tuesday,
        startMinutes: 8 * 60,
        endMinutes: 9 * 60 + 40,
        startPeriod: 1,
        endPeriod: 2,
      ),
      const CourseSession(
        id: 'course-demo-04',
        courseName: '编译原理',
        teacher: '陈晓',
        location: '信息学院 1-204',
        weekday: CourseWeekday.tuesday,
        startMinutes: 14 * 60,
        endMinutes: 15 * 60 + 40,
        startPeriod: 5,
        endPeriod: 6,
        note: '带电脑，课堂有随堂练习',
      ),
      const CourseSession(
        id: 'course-demo-05',
        courseName: '嵌入式系统',
        teacher: '周成',
        location: '信息学院 2-301',
        weekday: CourseWeekday.wednesday,
        startMinutes: 10 * 60,
        endMinutes: 11 * 60 + 40,
        startPeriod: 3,
        endPeriod: 4,
      ),
      const CourseSession(
        id: 'course-demo-06',
        courseName: '计算机网络',
        teacher: '刘洋',
        location: '信息学院 1-305',
        weekday: CourseWeekday.thursday,
        startMinutes: 14 * 60,
        endMinutes: 15 * 60 + 40,
        startPeriod: 5,
        endPeriod: 6,
      ),
      const CourseSession(
        id: 'course-demo-07',
        courseName: '程序分析实验',
        teacher: '张涛',
        location: '信息学院 3-机房',
        weekday: CourseWeekday.thursday,
        startMinutes: 16 * 60,
        endMinutes: 17 * 60 + 40,
        startPeriod: 7,
        endPeriod: 8,
      ),
      const CourseSession(
        id: 'course-demo-08',
        courseName: '学术英语',
        teacher: '孙悦',
        location: '教学中心 3-108',
        weekday: CourseWeekday.friday,
        startMinutes: 8 * 60,
        endMinutes: 9 * 60 + 40,
        startPeriod: 1,
        endPeriod: 2,
      ),
    ];
