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
  }) => LostFoundItem(
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
