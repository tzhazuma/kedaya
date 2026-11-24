/// 偷外卖报备（`takeout-guard`）。
///
/// 产品定位是**本人可见的报备记录**，不是公开举报墙：
/// 条目只用来记录时间、地点和餐品，方便跟楼管 / 平台沟通，
/// 因此模型里没有"被举报人"、没有公开范围，也没有任何申诉流程。
library;

/// 下单平台。
enum TakeoutPlatform {
  meituan('meituan', '美团'),
  eleme('eleme', '饿了么'),
  other('other', '其他');

  const TakeoutPlatform(this.wire, this.label);

  final String wire;
  final String label;

  static TakeoutPlatform fromWire(String wire) {
    for (final TakeoutPlatform platform in TakeoutPlatform.values) {
      if (platform.wire == wire) return platform;
    }
    return TakeoutPlatform.other;
  }
}

/// 报备的跟进状态。
enum TakeoutReportStatus {
  pending('pending', '待跟进'),
  resolved('resolved', '已解决');

  const TakeoutReportStatus(this.wire, this.label);

  final String wire;
  final String label;

  static TakeoutReportStatus fromWire(String wire) {
    for (final TakeoutReportStatus status in TakeoutReportStatus.values) {
      if (status.wire == wire) return status;
    }
    return TakeoutReportStatus.pending;
  }
}

/// 地点上限（楼栋 + 取餐点，例如「3 号楼外卖架」）。
const int takeoutLocationMax = 60;

/// 餐品上限。
const int takeoutMealMax = 40;

/// 备注上限：产品要求 ≤200 字。
const int takeoutNoteMax = 200;

/// 一条本人可见的报备记录。
final class TakeoutReport {
  const TakeoutReport({
    required this.id,
    required this.occurredAt,
    required this.location,
    required this.platform,
    required this.meal,
    required this.status,
    required this.createdAt,
    this.note = '',
    this.contactedBuildingManager = false,
  });

  final String id;

  /// 外卖被拿错 / 丢失的时间。
  final DateTime occurredAt;

  final String location;
  final TakeoutPlatform platform;
  final String meal;
  final String note;

  /// 是否已经联系过楼管（只做记录，不触发任何通知）。
  final bool contactedBuildingManager;

  final TakeoutReportStatus status;

  /// 这条记录写入本地的时间。
  final DateTime createdAt;

  bool get isResolved => status == TakeoutReportStatus.resolved;

  TakeoutReport copyWith({
    String? id,
    DateTime? occurredAt,
    String? location,
    TakeoutPlatform? platform,
    String? meal,
    String? note,
    bool? contactedBuildingManager,
    TakeoutReportStatus? status,
    DateTime? createdAt,
  }) =>
      TakeoutReport(
        id: id ?? this.id,
        occurredAt: occurredAt ?? this.occurredAt,
        location: location ?? this.location,
        platform: platform ?? this.platform,
        meal: meal ?? this.meal,
        note: note ?? this.note,
        contactedBuildingManager:
            contactedBuildingManager ?? this.contactedBuildingManager,
        status: status ?? this.status,
        createdAt: createdAt ?? this.createdAt,
      );

  @override
  bool operator ==(Object other) => other is TakeoutReport && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'TakeoutReport($id, ${status.wire}, $location)';
}

/// 新增报备的草稿（表单字段的封闭集合）。
final class TakeoutReportDraft {
  const TakeoutReportDraft({
    required this.occurredAt,
    required this.location,
    required this.platform,
    required this.meal,
    this.note = '',
    this.contactedBuildingManager = false,
  });

  final DateTime occurredAt;
  final String location;
  final TakeoutPlatform platform;
  final String meal;
  final String note;
  final bool contactedBuildingManager;
}

/// 草稿的校验问题。页面只负责展示，规则集中在这里。
enum TakeoutDraftProblem {
  emptyLocation,
  locationTooLong,
  emptyMeal,
  mealTooLong,
  noteTooLong,
  futureTime,
}

/// 校验草稿；返回空列表表示可以保存。
///
/// [now] 由调用方注入，测试里可以固定，避免「刚好跨秒」造成的抖动。
List<TakeoutDraftProblem> validateTakeoutDraft(
  TakeoutReportDraft draft,
  DateTime now,
) {
  final List<TakeoutDraftProblem> problems = <TakeoutDraftProblem>[];
  final String location = draft.location.trim();
  final String meal = draft.meal.trim();

  if (location.isEmpty) {
    problems.add(TakeoutDraftProblem.emptyLocation);
  } else if (location.runes.length > takeoutLocationMax) {
    problems.add(TakeoutDraftProblem.locationTooLong);
  }

  if (meal.isEmpty) {
    problems.add(TakeoutDraftProblem.emptyMeal);
  } else if (meal.runes.length > takeoutMealMax) {
    problems.add(TakeoutDraftProblem.mealTooLong);
  }

  if (draft.note.trim().runes.length > takeoutNoteMax) {
    problems.add(TakeoutDraftProblem.noteTooLong);
  }

  // 报备的是已经发生的事；留 5 分钟余量，避免用户选「现在」后被误判。
  if (draft.occurredAt.isAfter(now.add(const Duration(minutes: 5)))) {
    problems.add(TakeoutDraftProblem.futureTime);
  }

  return problems;
}

/// 给用户看的问题文案（页面不复制规则）。
String describeTakeoutDraftProblem(TakeoutDraftProblem problem) =>
    switch (problem) {
      TakeoutDraftProblem.emptyLocation => '地点不能为空（写到楼栋 / 取餐点）',
      TakeoutDraftProblem.locationTooLong => '地点最多 $takeoutLocationMax 个字',
      TakeoutDraftProblem.emptyMeal => '餐品不能为空（写清是什么外卖）',
      TakeoutDraftProblem.mealTooLong => '餐品最多 $takeoutMealMax 个字',
      TakeoutDraftProblem.noteTooLong => '备注最多 $takeoutNoteMax 个字',
      TakeoutDraftProblem.futureTime => '时间不能晚于现在',
    };
