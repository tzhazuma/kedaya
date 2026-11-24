/// DDL 聚合（`deadlines`）—— 作业 / 考试 / 报名 / 其他截止日期的本机模型。
///
/// ## 与课表解耦
///
/// 本模块**不写入课程表**，也不从课表推导 DDL：两者是独立的数据源。
/// 模型里因此没有「课程时段」字段，只有来源文字（[DeadlineItem.source]）。
///
/// ## 时间
///
/// 模型只存 [DateTime]；展示用的「今天 / 明天 / 已逾期 N 天」全部由
/// 调用方注入 `now` 的纯函数计算（[describeDeadlineCountdown] 等），
/// 文件里不读时钟 —— 这样逾期与统计都能用固定时刻做确定性测试。
library;

/* ------------------------------------------------------------------ *
 * 1. 类型与筛选
 * ------------------------------------------------------------------ */

/// DDL 类型。
enum DeadlineKind {
  homework('homework', '作业'),
  exam('exam', '考试'),
  registration('registration', '报名'),
  other('other', '其他');

  const DeadlineKind(this.wire, this.label);

  /// 线上标识（与契约的枚举名一致）。
  final String wire;

  /// 面向用户的名字。
  final String label;

  /// 未知取值返回 `null` —— 调用方必须显式处理，不许静默降级成「其他」。
  static DeadlineKind? fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final DeadlineKind kind in DeadlineKind.values) {
      if (kind.wire == normalized) return kind;
    }
    return null;
  }
}

/// 列表筛选（与筛选 chips 一一对应）。
enum DeadlineFilter {
  all('全部'),
  unfinished('未完成'),
  overdue('已逾期'),
  completed('已完成');

  const DeadlineFilter(this.label);

  final String label;
}

/* ------------------------------------------------------------------ *
 * 2. 条目
 * ------------------------------------------------------------------ */

/// 一条 DDL。
final class DeadlineItem {
  const DeadlineItem({
    required this.id,
    required this.title,
    required this.kind,
    required this.dueAt,
    this.source,
    this.note,
    this.completed = false,
  });

  final String id;

  /// 标题（例如「程序分析作业 4：CHA」）。
  final String title;

  final DeadlineKind kind;

  /// 截止时刻（本地时间）。
  final DateTime dueAt;

  /// 课程或来源（例如「程序分析」「教务通知」）；可选。
  final String? source;

  /// 备注；可选。
  final String? note;

  final bool completed;

  bool get isUnfinished => !completed;

  /// 在 [now] 这一刻是否**已逾期**：未完成且已经过了截止时刻。
  ///
  /// 恰好等于截止时刻不算逾期（那一分钟还来得及交）。
  bool isOverdueAt(DateTime now) => !completed && now.isAfter(dueAt);

  /// 剩余时间；已逾期时为负数。
  Duration remainingAt(DateTime now) => dueAt.difference(now);

  /// 逾期天数：满 24 小时算一天，不足一天按 1 天（文案不会出现「已逾期 0 天」）。
  ///
  /// 未逾期返回 0。
  int overdueDaysAt(DateTime now) {
    if (!isOverdueAt(now)) return 0;
    final int wholeDays = now.difference(dueAt).inDays;
    return wholeDays < 1 ? 1 : wholeDays;
  }

  DeadlineItem copyWith({
    String? id,
    String? title,
    DeadlineKind? kind,
    DateTime? dueAt,
    String? source,
    String? note,
    bool? completed,
  }) =>
      DeadlineItem(
        id: id ?? this.id,
        title: title ?? this.title,
        kind: kind ?? this.kind,
        dueAt: dueAt ?? this.dueAt,
        source: source ?? this.source,
        note: note ?? this.note,
        completed: completed ?? this.completed,
      );

  @override
  bool operator ==(Object other) =>
      other is DeadlineItem &&
      other.id == id &&
      other.title == title &&
      other.kind == kind &&
      other.dueAt == dueAt &&
      other.source == source &&
      other.note == note &&
      other.completed == completed;

  @override
  int get hashCode =>
      Object.hash(id, title, kind, dueAt, source, note, completed);

  @override
  String toString() =>
      'DeadlineItem($id, $title, ${kind.wire}, ${dueAt.toIso8601String()}, '
      'completed=$completed)';
}

/* ------------------------------------------------------------------ *
 * 3. 排序 / 筛选 / 统计（纯函数，页面不复制规则）
 * ------------------------------------------------------------------ */

/// 按截止时间升序；同一时刻保留输入顺序（Dart 的 `sort` 不保证稳定，
/// 因此用原始下标兜底）。
List<DeadlineItem> sortDeadlines(List<DeadlineItem> items) {
  final List<int> order =
      List<int>.generate(items.length, (int index) => index);
  order.sort((int a, int b) {
    final int due = items[a].dueAt.compareTo(items[b].dueAt);
    if (due != 0) return due;
    return a.compareTo(b);
  });
  return <DeadlineItem>[
    for (final int index in order) items[index],
  ];
}

/// 按 [filter] 筛选（**不重排**：调用方先 [sortDeadlines] 再筛，
/// 列表顺序就与「按截止时间升序」保持一致）。
List<DeadlineItem> filterDeadlines(
  List<DeadlineItem> items,
  DeadlineFilter filter,
  DateTime now,
) =>
    switch (filter) {
      DeadlineFilter.all => List<DeadlineItem>.unmodifiable(items),
      DeadlineFilter.unfinished => items
          .where((DeadlineItem item) => item.isUnfinished)
          .toList(growable: false),
      DeadlineFilter.overdue => items
          .where((DeadlineItem item) => item.isOverdueAt(now))
          .toList(growable: false),
      DeadlineFilter.completed => items
          .where((DeadlineItem item) => item.completed)
          .toList(growable: false),
    };

/// 统计条需要的一切。
final class DeadlineStats {
  const DeadlineStats({
    required this.unfinishedCount,
    required this.overdueCount,
    required this.nearest,
  });

  /// 未完成条数。
  final int unfinishedCount;

  /// 其中已逾期的条数。
  final int overdueCount;

  /// 未完成里截止最早的一条；全部完成时为 `null`。
  final DeadlineItem? nearest;

  bool get allClear => unfinishedCount == 0;

  /// 「未完成 N 条 · 最近一条还有 X」。
  ///
  /// - 全部完成：`未完成 0 条 · 全部清空`
  /// - 最近一条已逾期：`未完成 N 条 · 最近一条已逾期 M 天`
  /// - 其余：`未完成 N 条 · 最近一条还有 X`
  String summaryAt(DateTime now) {
    if (unfinishedCount == 0) return '未完成 0 条 · 全部清空';
    final DeadlineItem nearestItem = nearest!;
    if (nearestItem.isOverdueAt(now)) {
      return '未完成 $unfinishedCount 条 · '
          '最近一条已逾期 ${nearestItem.overdueDaysAt(now)} 天';
    }
    return '未完成 $unfinishedCount 条 · '
        '最近一条还有 ${describeDeadlineSpan(nearestItem.remainingAt(now))}';
  }

  @override
  bool operator ==(Object other) =>
      other is DeadlineStats &&
      other.unfinishedCount == unfinishedCount &&
      other.overdueCount == overdueCount &&
      other.nearest == nearest;

  @override
  int get hashCode => Object.hash(unfinishedCount, overdueCount, nearest);

  @override
  String toString() => 'DeadlineStats(unfinished=$unfinishedCount, '
      'overdue=$overdueCount, nearest=${nearest?.id})';
}

/// 算统计条（未完成数 / 逾期数 / 最近一条未完成）。
DeadlineStats deadlineStats(List<DeadlineItem> items, DateTime now) {
  int unfinished = 0;
  int overdue = 0;
  DeadlineItem? nearest;
  for (final DeadlineItem item in items) {
    if (item.completed) continue;
    unfinished++;
    if (item.isOverdueAt(now)) overdue++;
    if (nearest == null || item.dueAt.isBefore(nearest.dueAt)) {
      nearest = item;
    }
  }
  return DeadlineStats(
    unfinishedCount: unfinished,
    overdueCount: overdue,
    nearest: nearest,
  );
}

/* ------------------------------------------------------------------ *
 * 4. 文案（注入 now，三处页面共用同一套措辞）
 * ------------------------------------------------------------------ */

/// 剩余时长的人话：`3 天 2 小时` / `5 小时 30 分钟` / `12 分钟`。
String describeDeadlineSpan(Duration span) {
  if (span.inMinutes < 1) return '不到 1 分钟';
  if (span.inMinutes < 60) return '${span.inMinutes} 分钟';
  if (span.inHours < 24) {
    final int restMinutes = span.inMinutes % 60;
    return restMinutes == 0
        ? '${span.inHours} 小时'
        : '${span.inHours} 小时 $restMinutes 分钟';
  }
  final int restHours = span.inHours % 24;
  return restHours == 0 ? '${span.inDays} 天' : '${span.inDays} 天 $restHours 小时';
}

/// 卡片上的剩余时间 / 逾期文案。
///
/// 已完成 → `已完成`；逾期 → `已逾期 N 天`（页面用红色渲染）；
/// 其余 → `还有 X`。
String describeDeadlineCountdown(DeadlineItem item, DateTime now) {
  if (item.completed) return '已完成';
  if (item.isOverdueAt(now)) return '已逾期 ${item.overdueDaysAt(now)} 天';
  final Duration remaining = item.remainingAt(now);
  if (remaining.inMinutes < 1) return '马上截止';
  return '还有 ${describeDeadlineSpan(remaining)}';
}

/// 截止时间：`今天 23:59` / `明天 09:00` / `11月28日 14:00`。
///
/// 跨年时补年份，避免「1月3日」看起来像已过去。
String formatDeadlineDue(DateTime dueAt, DateTime now) {
  final DateTime localDue = dueAt.toLocal();
  final DateTime localNow = now.toLocal();
  // 用 UTC 的「同一年月日」算天数差：跨夏令时也不会算成 0.96 天。
  final int dayDiff = DateTime.utc(localDue.year, localDue.month, localDue.day)
      .difference(DateTime.utc(localNow.year, localNow.month, localNow.day))
      .inDays;
  final String prefix = switch (dayDiff) {
    0 => '今天',
    1 => '明天',
    2 => '后天',
    -1 => '昨天',
    _ => localDue.year == localNow.year
        ? '${localDue.month}月${localDue.day}日'
        : '${localDue.year}年${localDue.month}月${localDue.day}日',
  };
  final String hour = localDue.hour.toString().padLeft(2, '0');
  final String minute = localDue.minute.toString().padLeft(2, '0');
  return '$prefix $hour:$minute';
}

/* ------------------------------------------------------------------ *
 * 5. 草稿与校验
 * ------------------------------------------------------------------ */

const int deadlineTitleMax = 80;
const int deadlineSourceMax = 40;
const int deadlineNoteMax = 200;

/// 新增 DDL 的草稿。
final class DeadlineDraft {
  const DeadlineDraft({
    required this.title,
    required this.kind,
    required this.dueAt,
    this.source,
    this.note,
  });

  final String title;
  final DeadlineKind kind;
  final DateTime dueAt;
  final String? source;
  final String? note;

  /// 去掉首尾空白后的标题（写库与展示都用它）。
  String get normalizedTitle => title.trim();

  String? get normalizedSource {
    final String? value = source?.trim();
    return (value == null || value.isEmpty) ? null : value;
  }

  String? get normalizedNote {
    final String? value = note?.trim();
    return (value == null || value.isEmpty) ? null : value;
  }

  @override
  String toString() =>
      'DeadlineDraft($normalizedTitle, ${kind.wire}, ${dueAt.toIso8601String()})';
}

/// 校验问题码（不是布尔：UI 要给具体提示）。
enum DeadlineDraftProblem {
  titleRequired('title-required'),
  titleTooLong('title-too-long'),
  sourceTooLong('source-too-long'),
  noteTooLong('note-too-long');

  const DeadlineDraftProblem(this.wire);

  /// 稳定标识（日志 / 测试用）。
  final String wire;
}

/// 校验草稿；返回问题列表（空 = 通过）。
///
/// 允许补记**已经逾期**的 DDL：逾期是列表要表达的状态，不是表单错误。
List<DeadlineDraftProblem> validateDeadlineDraft(DeadlineDraft draft) {
  final List<DeadlineDraftProblem> problems = <DeadlineDraftProblem>[];
  final String title = draft.normalizedTitle;
  if (title.isEmpty) {
    problems.add(DeadlineDraftProblem.titleRequired);
  } else if (title.length > deadlineTitleMax) {
    problems.add(DeadlineDraftProblem.titleTooLong);
  }
  final String? source = draft.normalizedSource;
  if (source != null && source.length > deadlineSourceMax) {
    problems.add(DeadlineDraftProblem.sourceTooLong);
  }
  final String? note = draft.normalizedNote;
  if (note != null && note.length > deadlineNoteMax) {
    problems.add(DeadlineDraftProblem.noteTooLong);
  }
  return problems;
}

/// 问题码 → 中文提示。
String describeDeadlineProblem(DeadlineDraftProblem problem) =>
    switch (problem) {
      DeadlineDraftProblem.titleRequired => '标题不能为空，写清要交什么',
      DeadlineDraftProblem.titleTooLong => '标题最多 $deadlineTitleMax 个字',
      DeadlineDraftProblem.sourceTooLong => '来源最多 $deadlineSourceMax 个字',
      DeadlineDraftProblem.noteTooLong => '备注最多 $deadlineNoteMax 个字',
    };
