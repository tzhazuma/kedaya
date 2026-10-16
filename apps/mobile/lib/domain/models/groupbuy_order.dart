import 'api_request.dart';
import 'json_read.dart';
import 'money.dart';

/// 拼单状态。
enum GroupbuyStatus {
  recruiting('recruiting', '拼单中'),
  locked('locked', '已锁定'),
  completed('completed', '已成团'),
  cancelled('cancelled', '已取消'),

  /// 后端新增状态而客户端未升级时的兜底，避免整条数据解析失败。
  unknown('unknown', '未知状态');

  const GroupbuyStatus(this.wire, this.label);

  final String wire;
  final String label;

  static GroupbuyStatus fromWire(String wire) {
    for (final GroupbuyStatus status in GroupbuyStatus.values) {
      if (status.wire == wire) return status;
    }
    return GroupbuyStatus.unknown;
  }
}

/// 拼单（契约 §4.1 `groupbuy`）。
///
/// 金额一律**整数分**（[unitPriceFen]），展示时才用 [Money.fenToYuan]。
final class GroupbuyOrder {
  const GroupbuyOrder({
    required this.id,
    required this.title,
    required this.unitPriceFen,
    required this.targetQuantity,
    required this.joinedQuantity,
    required this.status,
    required this.createdAt,
    this.description,
    this.initiatorId,
    this.initiatorName,
    this.pickupLocation,
    this.deadline,
    this.updatedAt,
    this.imageUrls = const <String>[],
  });

  factory GroupbuyOrder.fromJson(Map<String, Object?> json) => GroupbuyOrder(
    id: readString(json, 'id'),
    title: readString(json, 'title'),
    unitPriceFen: readInt(json, 'unitPriceFen'),
    targetQuantity: readInt(json, 'targetQuantity'),
    joinedQuantity: readIntOr(json, 'joinedQuantity', 0),
    status: GroupbuyStatus.fromWire(readStringOr(json, 'status', 'recruiting')),
    createdAt: readDateTime(json, 'createdAt'),
    description: readStringOrNull(json, 'description'),
    initiatorId: readStringOrNull(json, 'initiatorId'),
    initiatorName: readStringOrNull(json, 'initiatorName'),
    pickupLocation: readStringOrNull(json, 'pickupLocation'),
    deadline: readDateTimeOrNull(json, 'deadline'),
    updatedAt: readDateTimeOrNull(json, 'updatedAt'),
    imageUrls: readStringList(json, 'imageUrls'),
  );

  final String id;
  final String title;
  final String? description;

  /// 单价，整数分。
  final int unitPriceFen;

  final int targetQuantity;
  final int joinedQuantity;
  final GroupbuyStatus status;
  final String? initiatorId;
  final String? initiatorName;
  final String? pickupLocation;
  final DateTime? deadline;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final List<String> imageUrls;

  /// 还差几份。
  int get remainingQuantity {
    final int remaining = targetQuantity - joinedQuantity;
    return remaining < 0 ? 0 : remaining;
  }

  bool get isFull => joinedQuantity >= targetQuantity;

  /// 0.0 ~ 1.0，供进度条使用。
  double get progress {
    if (targetQuantity <= 0) return 0;
    final double ratio = joinedQuantity / targetQuantity;
    return ratio < 0 ? 0 : (ratio > 1 ? 1 : ratio);
  }

  /// 成团总额，整数分。
  int get totalFen => unitPriceFen * targetQuantity;

  /// 参团者人均应付，整数分。
  int get perPersonFen => unitPriceFen;

  String get unitPriceYuan => Money.fenToYuan(unitPriceFen);

  String get totalYuan => Money.fenToYuan(totalFen);

  bool isExpiredAt(DateTime now) => deadline != null && !deadline!.isAfter(now.toUtc());

  GroupbuyOrder copyWith({
    String? id,
    String? title,
    String? description,
    int? unitPriceFen,
    int? targetQuantity,
    int? joinedQuantity,
    GroupbuyStatus? status,
    String? initiatorId,
    String? initiatorName,
    String? pickupLocation,
    DateTime? deadline,
    DateTime? createdAt,
    DateTime? updatedAt,
    List<String>? imageUrls,
  }) => GroupbuyOrder(
    id: id ?? this.id,
    title: title ?? this.title,
    description: description ?? this.description,
    unitPriceFen: unitPriceFen ?? this.unitPriceFen,
    targetQuantity: targetQuantity ?? this.targetQuantity,
    joinedQuantity: joinedQuantity ?? this.joinedQuantity,
    status: status ?? this.status,
    initiatorId: initiatorId ?? this.initiatorId,
    initiatorName: initiatorName ?? this.initiatorName,
    pickupLocation: pickupLocation ?? this.pickupLocation,
    deadline: deadline ?? this.deadline,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
    imageUrls: imageUrls ?? this.imageUrls,
  );

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'title': title,
    'description': description,
    'unitPriceFen': unitPriceFen,
    'targetQuantity': targetQuantity,
    'joinedQuantity': joinedQuantity,
    'status': status.wire,
    'initiatorId': initiatorId,
    'initiatorName': initiatorName,
    'pickupLocation': pickupLocation,
    'deadline': deadline == null ? null : isoUtc(deadline!),
    'createdAt': isoUtc(createdAt),
    'updatedAt': updatedAt == null ? null : isoUtc(updatedAt!),
    'imageUrls': imageUrls,
  };

  @override
  bool operator ==(Object other) => other is GroupbuyOrder && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() =>
      'GroupbuyOrder($id, $title, $joinedQuantity/$targetQuantity, ${status.wire})';
}

/// 列表查询参数（契约 §6.1 `PageQuery`）。
final class GroupbuyQuery {
  const GroupbuyQuery({
    this.cursor,
    this.limit = defaultPageSize,
    this.status,
    this.keyword,
  });

  final String? cursor;
  final int limit;
  final GroupbuyStatus? status;
  final String? keyword;

  Map<String, Object?> toQuery() => <String, Object?>{
    ...PageQuery(cursor: cursor, limit: limit).toQuery(),
    if (status != null && status != GroupbuyStatus.unknown) 'status': status!.wire,
    if (keyword != null && keyword!.trim().isNotEmpty) 'keyword': keyword!.trim(),
  };

  GroupbuyQuery copyWith({
    String? cursor,
    int? limit,
    GroupbuyStatus? status,
    String? keyword,
  }) => GroupbuyQuery(
    cursor: cursor ?? this.cursor,
    limit: limit ?? this.limit,
    status: status ?? this.status,
    keyword: keyword ?? this.keyword,
  );
}

/// 发起拼单（`POST /api/v1/groupbuy/items`）。
final class CreateGroupbuyOrderCommand {
  const CreateGroupbuyOrderCommand({
    required this.title,
    required this.unitPriceFen,
    required this.targetQuantity,
    this.description,
    this.pickupLocation,
    this.deadline,
  });

  final String title;
  final int unitPriceFen;
  final int targetQuantity;
  final String? description;
  final String? pickupLocation;
  final DateTime? deadline;

  Map<String, Object?> toJson() => <String, Object?>{
    'title': title,
    'unitPriceFen': unitPriceFen,
    'targetQuantity': targetQuantity,
    'description': description,
    'pickupLocation': pickupLocation,
    'deadline': deadline == null ? null : isoUtc(deadline!),
  };
}
