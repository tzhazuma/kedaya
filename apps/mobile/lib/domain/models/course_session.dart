/// 课表（`schedule`）—— 一条**每周重复**的课程时段。
///
/// ## 为什么模型里没有「日期」
///
/// 课表按周重复：同样的「周二 14:00–15:40」每周出现一次。因此
/// [CourseSession] 存的是「星期 + 当天第几分钟」，而不是某个具体日期；
/// 需要具体时刻时用 [CourseSession.startsOn] / [CourseSession.endsOn]
/// 投影到给定日期上。
///
/// 「今天是哪一天」「现在几点」只由调用方注入的 `now` 决定 ——
/// 本文件不读时钟，因此「今天筛选」「进行中判定」都能用固定时刻做确定性测试。
///
/// ## 不写入 DDL
///
/// 课表与 `deadlines` 是**两个独立模块**：这里没有任何「作业 / 考试截止」
/// 字段，也没有提醒。DDL 聚合页另有自己的模型（`deadline_item.dart`）。
library;

/// 一天的分钟数（`00:00` → `24:00`）。
const int minutesPerDay = 24 * 60;

/* ------------------------------------------------------------------ *
 * 1. 星期
 * ------------------------------------------------------------------ */

/// 星期（周一 → 周日，与「本周」的展示顺序一致）。
enum CourseWeekday {
  monday('monday', '周一', DateTime.monday),
  tuesday('tuesday', '周二', DateTime.tuesday),
  wednesday('wednesday', '周三', DateTime.wednesday),
  thursday('thursday', '周四', DateTime.thursday),
  friday('friday', '周五', DateTime.friday),
  saturday('saturday', '周六', DateTime.saturday),
  sunday('sunday', '周日', DateTime.sunday);

  const CourseWeekday(this.wire, this.label, this.dateTimeValue);

  /// 线上标识（与 `DateTime.weekday` 的 1–7 一一对应）。
  final String wire;

  /// 面向用户的名字。
  final String label;

  /// 对应 [DateTime.weekday] 的取值（1 = 周一）。
  final int dateTimeValue;

  bool get isWeekend =>
      this == CourseWeekday.saturday || this == CourseWeekday.sunday;

  /// 未知取值返回 `null` —— 调用方必须显式决定怎么处理，不许静默降级。
  static CourseWeekday? fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final CourseWeekday weekday in CourseWeekday.values) {
      if (weekday.wire == normalized) return weekday;
    }
    return null;
  }

  /// 取某个日期所在的星期。
  static CourseWeekday fromDateTime(DateTime date) => switch (date.weekday) {
        1 => CourseWeekday.monday,
        2 => CourseWeekday.tuesday,
        3 => CourseWeekday.wednesday,
        4 => CourseWeekday.thursday,
        5 => CourseWeekday.friday,
        6 => CourseWeekday.saturday,
        7 => CourseWeekday.sunday,
        _ => throw ArgumentError.value(date, 'date', '不是合法的日期'),
      };
}

/* ------------------------------------------------------------------ *
 * 2. 课程时段
 * ------------------------------------------------------------------ */

/// 一门课的一个上课时段。
///
/// 同一门课一周上两次（例如周一理论课 + 周四实验课）时是两个独立的
/// [CourseSession]，`id` 不同但 `courseName` 相同 —— 课表就是「时段」的集合。
final class CourseSession {
  const CourseSession({
    required this.id,
    required this.courseName,
    required this.teacher,
    required this.location,
    required this.weekday,
    required this.startMinutes,
    required this.endMinutes,
    required this.startPeriod,
    required this.endPeriod,
    this.note,
  })  : assert(startMinutes >= 0 && startMinutes < minutesPerDay),
        assert(endMinutes > startMinutes && endMinutes <= minutesPerDay),
        assert(startPeriod >= 1 && startPeriod <= endPeriod);

  final String id;

  /// 课程名（例如「程序分析」）。
  final String courseName;

  /// 任课教师。
  final String teacher;

  /// 地点（楼 + 房间，例如「信息学院 1-101」）。
  final String location;

  final CourseWeekday weekday;

  /// 开始时刻距当天 `00:00` 的分钟数（`08:00` = 480）。
  final int startMinutes;

  /// 结束时刻距当天 `00:00` 的分钟数（`09:40` = 580）。
  final int endMinutes;

  /// 第几节开始 / 结束（`1` 起）。
  final int startPeriod;
  final int endPeriod;

  /// 补充说明（例如「单周上」「实验课在 3 楼」）；空串归一为 `null`。
  final String? note;

  /// 「第 3 节」/「第 3–4 节」。
  String get periodLabel => startPeriod == endPeriod
      ? '第 $startPeriod 节'
      : '第 $startPeriod–$endPeriod 节';

  /// 「08:00–09:40」。
  String get timeRangeLabel =>
      '${formatMinutesOfDay(startMinutes)}–${formatMinutesOfDay(endMinutes)}';

  /// 投影到 [day] 这一天的开始时刻（本地时区，按 [day] 的年月日）。
  DateTime startsOn(DateTime day) => _atMinutes(day, startMinutes);

  /// 投影到 [day] 这一天的结束时刻。
  DateTime endsOn(DateTime day) => _atMinutes(day, endMinutes);

  /// 在 [now] 这一刻是否**正在进行**。
  ///
  /// 判定：同一星期，且 `开始 <= now < 结束`。恰好等于结束时刻算「已下课」，
  /// 与「上到 09:40」的日常说法一致；开始时刻本身算「已上课」。
  bool isOngoingAt(DateTime now) {
    final DateTime localNow = now.toLocal();
    if (CourseWeekday.fromDateTime(localNow) != weekday) return false;
    final DateTime start = _atMinutes(localNow, startMinutes);
    final DateTime end = _atMinutes(localNow, endMinutes);
    return !localNow.isBefore(start) && localNow.isBefore(end);
  }

  CourseSession copyWith({
    String? id,
    String? courseName,
    String? teacher,
    String? location,
    CourseWeekday? weekday,
    int? startMinutes,
    int? endMinutes,
    int? startPeriod,
    int? endPeriod,
    String? note,
  }) =>
      CourseSession(
        id: id ?? this.id,
        courseName: courseName ?? this.courseName,
        teacher: teacher ?? this.teacher,
        location: location ?? this.location,
        weekday: weekday ?? this.weekday,
        startMinutes: startMinutes ?? this.startMinutes,
        endMinutes: endMinutes ?? this.endMinutes,
        startPeriod: startPeriod ?? this.startPeriod,
        endPeriod: endPeriod ?? this.endPeriod,
        note: note ?? this.note,
      );

  @override
  bool operator ==(Object other) =>
      other is CourseSession &&
      other.id == id &&
      other.courseName == courseName &&
      other.teacher == teacher &&
      other.location == location &&
      other.weekday == weekday &&
      other.startMinutes == startMinutes &&
      other.endMinutes == endMinutes &&
      other.startPeriod == startPeriod &&
      other.endPeriod == endPeriod &&
      other.note == note;

  @override
  int get hashCode => Object.hash(
        id,
        courseName,
        teacher,
        location,
        weekday,
        startMinutes,
        endMinutes,
        startPeriod,
        endPeriod,
        note,
      );

  @override
  String toString() => 'CourseSession($id, $courseName, ${weekday.wire}, '
      '$timeRangeLabel @$location)';
}

/// 把 [day] 的年月日 + 当天的 [minutes] 组合成本地 [DateTime]。
///
/// 用「年月日 + 0 点 + 分钟」而不是 `add(Duration(minutes:))`：
/// 后者在跨夏令时的时间点上会偏移一小时。
DateTime _atMinutes(DateTime day, int minutes) {
  final DateTime local = day.toLocal();
  return DateTime(local.year, local.month, local.day, 0, minutes);
}

/* ------------------------------------------------------------------ *
 * 3. 排序 / 筛选 / 分组（纯函数，页面不复制规则）
 * ------------------------------------------------------------------ */

/// 按开始时间升序；同一开始时间按结束时间；全部相同则保留输入顺序。
///
/// ⚠️ 最后用**原始下标**兜底：Dart 的 `List.sort` 不保证稳定，
/// 没有这层兜底，两条完全相同的时段相对顺序会随机漂移。
List<CourseSession> sortCourseSessions(List<CourseSession> sessions) {
  final List<int> order =
      List<int>.generate(sessions.length, (int index) => index);
  order.sort((int a, int b) {
    final CourseSession sa = sessions[a];
    final CourseSession sb = sessions[b];
    final int start = sa.startMinutes.compareTo(sb.startMinutes);
    if (start != 0) return start;
    final int end = sa.endMinutes.compareTo(sb.endMinutes);
    if (end != 0) return end;
    return a.compareTo(b);
  });
  return <CourseSession>[
    for (final int index in order) sessions[index],
  ];
}

/// 某一天的全部课程（已按开始时间排序）。
List<CourseSession> sessionsOn(
  List<CourseSession> sessions,
  CourseWeekday weekday,
) =>
    sortCourseSessions(
      sessions
          .where((CourseSession session) => session.weekday == weekday)
          .toList(growable: false),
    );

/// 按周一到周日分组；每一天都存在（无课时是空列表），页面不必判空键。
Map<CourseWeekday, List<CourseSession>> groupSessionsByWeekday(
  List<CourseSession> sessions,
) =>
    <CourseWeekday, List<CourseSession>>{
      for (final CourseWeekday weekday in CourseWeekday.values)
        weekday: sessionsOn(sessions, weekday),
    };

/// [now] 所在周的周一到周日（本地时区的 7 个日期）。
List<DateTime> weekDatesFor(DateTime now) {
  final DateTime local = now.toLocal();
  final DateTime monday = DateTime(
    local.year,
    local.month,
    local.day - (local.weekday - DateTime.monday),
  );
  return List<DateTime>.generate(
    7,
    // 用「年月日 + i」而不是 `add(Duration(days: i))`：跨夏令时也不会偏一天。
    (int index) => DateTime(monday.year, monday.month, monday.day + index),
    growable: false,
  );
}

/// 把当天分钟数格式化为 `HH:mm`（允许 `24:00` 表示一天结束）。
String formatMinutesOfDay(int minutes) {
  if (minutes < 0 || minutes > minutesPerDay) {
    throw RangeError.range(minutes, 0, minutesPerDay, 'minutes');
  }
  final String hour = (minutes ~/ 60).toString().padLeft(2, '0');
  final String minute = (minutes % 60).toString().padLeft(2, '0');
  return '$hour:$minute';
}
