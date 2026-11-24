import 'json_read.dart';

/// 失物招领的两侧：丢失 / 拾获。
enum LostFoundKind {
  lost('lost', '丢失'),
  found('found', '拾获');

  const LostFoundKind(this.wire, this.label);

  final String wire;
  final String label;

  static LostFoundKind fromWire(String wire) {
    for (final LostFoundKind kind in LostFoundKind.values) {
      if (kind.wire == wire) return kind;
    }
    return LostFoundKind.lost;
  }
}

/// 条目状态。
enum LostFoundStatus {
  open('open', '进行中'),
  matched('matched', '已匹配'),
  resolved('resolved', '已解决'),
  closed('closed', '已关闭'),
  unknown('unknown', '未知状态');

  const LostFoundStatus(this.wire, this.label);

  final String wire;
  final String label;

  static LostFoundStatus fromWire(String wire) {
    for (final LostFoundStatus status in LostFoundStatus.values) {
      if (status.wire == wire) return status;
    }
    return LostFoundStatus.unknown;
  }
}

/// 失物招领条目（契约 §4.1 `lost-found`）。
final class LostFoundItem {
  const LostFoundItem({
    required this.id,
    required this.kind,
    required this.title,
    required this.status,
    required this.createdAt,
    this.description,
    this.location,
    this.occurredAt,
    this.contact,
    this.imageUrls = const <String>[],
  });

  factory LostFoundItem.fromJson(Map<String, Object?> json) => LostFoundItem(
        id: readString(json, 'id'),
        kind: LostFoundKind.fromWire(readStringOr(json, 'kind', 'lost')),
        title: readString(json, 'title'),
        status: LostFoundStatus.fromWire(readStringOr(json, 'status', 'open')),
        createdAt: readDateTime(json, 'createdAt'),
        description: readStringOrNull(json, 'description'),
        location: readStringOrNull(json, 'location'),
        occurredAt: readDateTimeOrNull(json, 'occurredAt'),
        contact: readStringOrNull(json, 'contact'),
        imageUrls: readStringList(json, 'imageUrls'),
      );

  final String id;
  final LostFoundKind kind;
  final String title;
  final LostFoundStatus status;
  final DateTime createdAt;
  final String? description;
  final String? location;
  final DateTime? occurredAt;

  /// 联系方式；契约 §9 数据最小化 —— 只在条目详情页展示。
  final String? contact;

  final List<String> imageUrls;

  bool get isOpen => status == LostFoundStatus.open;

  /// 「已解决」在界面层同时覆盖 [LostFoundStatus.resolved] 与
  /// [LostFoundStatus.closed]（关闭也是不再需要跟进）。
  bool get isResolved =>
      status == LostFoundStatus.resolved || status == LostFoundStatus.closed;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'kind': kind.wire,
        'title': title,
        'status': status.wire,
        'createdAt': isoUtc(createdAt),
        'description': description,
        'location': location,
        'occurredAt': occurredAt == null ? null : isoUtc(occurredAt!),
        'contact': contact,
        'imageUrls': imageUrls,
      };

  LostFoundItem copyWith({
    String? id,
    LostFoundKind? kind,
    String? title,
    LostFoundStatus? status,
    DateTime? createdAt,
    String? description,
    String? location,
    DateTime? occurredAt,
    String? contact,
    List<String>? imageUrls,
  }) =>
      LostFoundItem(
        id: id ?? this.id,
        kind: kind ?? this.kind,
        title: title ?? this.title,
        status: status ?? this.status,
        createdAt: createdAt ?? this.createdAt,
        description: description ?? this.description,
        location: location ?? this.location,
        occurredAt: occurredAt ?? this.occurredAt,
        contact: contact ?? this.contact,
        imageUrls: imageUrls ?? this.imageUrls,
      );

  @override
  bool operator ==(Object other) => other is LostFoundItem && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'LostFoundItem($id, ${kind.wire}, $title)';
}

/// 登记失物/拾获（`POST /api/v1/lost-found/items`）。
final class CreateLostFoundItemCommand {
  const CreateLostFoundItemCommand({
    required this.kind,
    required this.title,
    this.description,
    this.location,
    this.occurredAt,
    this.contact,
  });

  final LostFoundKind kind;
  final String title;
  final String? description;
  final String? location;
  final DateTime? occurredAt;
  final String? contact;

  Map<String, Object?> toJson() => <String, Object?>{
        'kind': kind.wire,
        'title': title,
        'description': description,
        'location': location,
        'occurredAt': occurredAt == null ? null : isoUtc(occurredAt!),
        'contact': contact,
      };
}

/// 标题最少字数（空标题单独报 `emptyTitle`）。
const int lostFoundTitleMin = 2;

/// 标题上限。
const int lostFoundTitleMax = 40;

/// 地点上限。
const int lostFoundLocationMax = 60;

/// 描述 / 备注上限。
const int lostFoundDescriptionMax = 300;

/// 联系方式上限（自由文本）。
const int lostFoundContactMax = 100;

/// 发布失物招领的草稿（表单字段的封闭集合）。
final class LostFoundDraft {
  const LostFoundDraft({
    required this.kind,
    required this.title,
    required this.location,
    required this.occurredAt,
    this.description = '',
    this.contact = '',
  });

  final LostFoundKind kind;
  final String title;
  final String location;
  final DateTime occurredAt;
  final String description;

  /// 自由文本。**不做手机号格式校验**：产品只要求提示发布者自行脱敏。
  final String contact;
}

/// 草稿的校验问题。
enum LostFoundDraftProblem {
  emptyTitle,
  titleTooShort,
  titleTooLong,
  emptyLocation,
  locationTooLong,
  descriptionTooLong,
  contactTooLong,
}

/// 校验草稿；返回空列表表示可以发布。
List<LostFoundDraftProblem> validateLostFoundDraft(LostFoundDraft draft) {
  final List<LostFoundDraftProblem> problems = <LostFoundDraftProblem>[];
  final String title = draft.title.trim();
  final String location = draft.location.trim();

  if (title.isEmpty) {
    problems.add(LostFoundDraftProblem.emptyTitle);
  } else if (title.runes.length < lostFoundTitleMin) {
    problems.add(LostFoundDraftProblem.titleTooShort);
  } else if (title.runes.length > lostFoundTitleMax) {
    problems.add(LostFoundDraftProblem.titleTooLong);
  }

  if (location.isEmpty) {
    problems.add(LostFoundDraftProblem.emptyLocation);
  } else if (location.runes.length > lostFoundLocationMax) {
    problems.add(LostFoundDraftProblem.locationTooLong);
  }

  if (draft.description.trim().runes.length > lostFoundDescriptionMax) {
    problems.add(LostFoundDraftProblem.descriptionTooLong);
  }

  if (draft.contact.trim().runes.length > lostFoundContactMax) {
    problems.add(LostFoundDraftProblem.contactTooLong);
  }

  return problems;
}

/// 给用户看的问题文案。
String describeLostFoundDraftProblem(LostFoundDraftProblem problem) =>
    switch (problem) {
      LostFoundDraftProblem.emptyTitle => '标题不能为空（一句话说明丢了 / 捡到了什么）',
      LostFoundDraftProblem.titleTooShort => '标题至少 $lostFoundTitleMin 个字',
      LostFoundDraftProblem.titleTooLong => '标题最多 $lostFoundTitleMax 个字',
      LostFoundDraftProblem.emptyLocation => '地点不能为空（写清楼栋 / 房间）',
      LostFoundDraftProblem.locationTooLong => '地点最多 $lostFoundLocationMax 个字',
      LostFoundDraftProblem.descriptionTooLong =>
        '描述最多 $lostFoundDescriptionMax 个字',
      LostFoundDraftProblem.contactTooLong => '联系方式最多 $lostFoundContactMax 个字',
    };
