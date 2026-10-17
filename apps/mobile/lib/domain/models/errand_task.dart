import 'json_read.dart';
import 'money.dart';

/// 跑腿任务状态。
enum ErrandStatus {
  open('open', '待接单'),
  accepted('accepted', '已接单'),
  delivered('delivered', '已送达'),
  completed('completed', '已完成'),
  cancelled('cancelled', '已取消'),
  unknown('unknown', '未知状态');

  const ErrandStatus(this.wire, this.label);

  final String wire;
  final String label;

  static ErrandStatus fromWire(String wire) {
    for (final ErrandStatus status in ErrandStatus.values) {
      if (status.wire == wire) return status;
    }
    return ErrandStatus.unknown;
  }
}

/// 跑腿任务（契约 §4.1 `errand`）。悬赏金额为**整数分**。
final class ErrandTask {
  const ErrandTask({
    required this.id,
    required this.title,
    required this.rewardFen,
    required this.status,
    required this.createdAt,
    this.note,
    this.pickupAddress,
    this.deliveryAddress,
    this.requesterId,
    this.runnerId,
    this.deadline,
  });

  factory ErrandTask.fromJson(Map<String, Object?> json) => ErrandTask(
    id: readString(json, 'id'),
    title: readString(json, 'title'),
    rewardFen: readInt(json, 'rewardFen'),
    status: ErrandStatus.fromWire(readStringOr(json, 'status', 'open')),
    createdAt: readDateTime(json, 'createdAt'),
    note: readStringOrNull(json, 'note'),
    pickupAddress: readStringOrNull(json, 'pickupAddress'),
    deliveryAddress: readStringOrNull(json, 'deliveryAddress'),
    requesterId: readStringOrNull(json, 'requesterId'),
    runnerId: readStringOrNull(json, 'runnerId'),
    deadline: readDateTimeOrNull(json, 'deadline'),
  );

  final String id;
  final String title;
  final int rewardFen;
  final ErrandStatus status;
  final DateTime createdAt;
  final String? note;
  final String? pickupAddress;
  final String? deliveryAddress;
  final String? requesterId;
  final String? runnerId;
  final DateTime? deadline;

  bool get isOpen => status == ErrandStatus.open;

  String get rewardYuan => Money.fenToYuan(rewardFen);

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'title': title,
    'rewardFen': rewardFen,
    'status': status.wire,
    'createdAt': isoUtc(createdAt),
    'note': note,
    'pickupAddress': pickupAddress,
    'deliveryAddress': deliveryAddress,
    'requesterId': requesterId,
    'runnerId': runnerId,
    'deadline': deadline == null ? null : isoUtc(deadline!),
  };

  ErrandTask copyWith({
    String? id,
    String? title,
    int? rewardFen,
    ErrandStatus? status,
    DateTime? createdAt,
    String? note,
    String? pickupAddress,
    String? deliveryAddress,
    String? requesterId,
    String? runnerId,
    DateTime? deadline,
  }) => ErrandTask(
    id: id ?? this.id,
    title: title ?? this.title,
    rewardFen: rewardFen ?? this.rewardFen,
    status: status ?? this.status,
    createdAt: createdAt ?? this.createdAt,
    note: note ?? this.note,
    pickupAddress: pickupAddress ?? this.pickupAddress,
    deliveryAddress: deliveryAddress ?? this.deliveryAddress,
    requesterId: requesterId ?? this.requesterId,
    runnerId: runnerId ?? this.runnerId,
    deadline: deadline ?? this.deadline,
  );

  @override
  bool operator ==(Object other) => other is ErrandTask && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'ErrandTask($id, $title, ${status.wire})';
}

/// 发布跑腿（`POST /api/v1/errand/items`）。
final class CreateErrandCommand {
  const CreateErrandCommand({
    required this.title,
    required this.rewardFen,
    this.note,
    this.pickupAddress,
    this.deliveryAddress,
    this.deadline,
  });

  final String title;
  final int rewardFen;
  final String? note;
  final String? pickupAddress;
  final String? deliveryAddress;
  final DateTime? deadline;

  Map<String, Object?> toJson() => <String, Object?>{
    'title': title,
    'rewardFen': rewardFen,
    'note': note,
    'pickupAddress': pickupAddress,
    'deliveryAddress': deliveryAddress,
    'deadline': deadline == null ? null : isoUtc(deadline!),
  };
}
