/// 学期考试安排（`schedule` 的只读部分）。
///
/// 和课表一样，这里没有任何「成绩 / 考场须知」字段：只放学生真正要用的
/// 时间、地点、座位。真实数据需接入教务，当前为演示值。
library;

/// 一场考试。
final class ExamEntry {
  const ExamEntry({
    required this.id,
    required this.courseName,
    required this.location,
    required this.startsAt,
    required this.durationMinutes,
    this.seat,
    this.note,
  });

  final String id;
  final String courseName;
  final String location;

  /// 开考时刻（本地时间由调用方保证；导出 ICS 时统一转 UTC）。
  final DateTime startsAt;
  final int durationMinutes;
  final String? seat;
  final String? note;

  DateTime get endsAt => startsAt.add(Duration(minutes: durationMinutes));
}

/// 按开考时间升序。
List<ExamEntry> sortExams(Iterable<ExamEntry> exams) {
  final List<ExamEntry> sorted = exams.toList()
    ..sort((ExamEntry a, ExamEntry b) => a.startsAt.compareTo(b.startsAt));
  return List<ExamEntry>.unmodifiable(sorted);
}

/// 距开考的天数（负数表示已考完）。
int daysUntilExam(ExamEntry exam, DateTime now) {
  final DateTime a = DateTime(exam.startsAt.year, exam.startsAt.month,
      exam.startsAt.day);
  final DateTime b = DateTime(now.year, now.month, now.day);
  return a.difference(b).inDays;
}

/// 演示考试：相对 [now] 生成，测试可注入固定时刻。
List<ExamEntry> demoExams(DateTime now) {
  final DateTime day = DateTime(now.year, now.month, now.day);
  return <ExamEntry>[
    ExamEntry(
      id: 'exam-demo-01',
      courseName: '高等数学（下）',
      location: '教学中心 1-302',
      startsAt: day.add(const Duration(days: 9, hours: 9)),
      durationMinutes: 120,
      seat: 'B-17',
    ),
    ExamEntry(
      id: 'exam-demo-02',
      courseName: '大学物理（上）',
      location: '教学中心 2-105',
      startsAt: day.add(const Duration(days: 12, hours: 14)),
      durationMinutes: 120,
      seat: 'A-03',
      note: '可带一张 A4 手写公式纸',
    ),
    ExamEntry(
      id: 'exam-demo-03',
      courseName: '程序设计基础',
      location: '信息学院 3-401',
      startsAt: day.add(const Duration(days: 16, hours: 9, minutes: 30)),
      durationMinutes: 150,
    ),
  ];
}
