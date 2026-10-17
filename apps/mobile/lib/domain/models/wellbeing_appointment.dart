import 'json_read.dart';

/// 咨询方式。
enum WellbeingMode {
  inPerson('in_person', '面询'),
  online('online', '线上'),
  unknown('unknown', '未知方式');

  const WellbeingMode(this.wire, this.label);

  final String wire;
  final String label;

  static WellbeingMode fromWire(String wire) {
    for (final WellbeingMode mode in WellbeingMode.values) {
      if (mode.wire == wire) return mode;
    }
    return WellbeingMode.unknown;
  }
}

/// 预约状态。
enum WellbeingStatus {
  requested('requested', '待确认'),
  confirmed('confirmed', '已确认'),
  completed('completed', '已完成'),
  cancelled('cancelled', '已取消'),
  unknown('unknown', '未知状态');

  const WellbeingStatus(this.wire, this.label);

  final String wire;
  final String label;

  static WellbeingStatus fromWire(String wire) {
    for (final WellbeingStatus status in WellbeingStatus.values) {
      if (status.wire == wire) return status;
    }
    return WellbeingStatus.unknown;
  }
}

/// 危机干预资源（契约 §9：**不可**被埋进二级菜单，必须在 `wellbeing` 首屏可见）。
final class CrisisResource {
  const CrisisResource({
    required this.name,
    required this.phone,
    required this.description,
    this.availability = '7x24',
  });

  factory CrisisResource.fromJson(Map<String, Object?> json) => CrisisResource(
        name: readString(json, 'name'),
        phone: readString(json, 'phone'),
        description: readString(json, 'description'),
        availability: readStringOr(json, 'availability', '7x24'),
      );

  final String name;
  final String phone;
  final String description;
  final String availability;

  Map<String, Object?> toJson() => <String, Object?>{
        'name': name,
        'phone': phone,
        'description': description,
        'availability': availability,
      };
}

/// 心理预约（契约 §4.1 `wellbeing`，敏感级 critical）。
///
/// 契约 §9：本模块数据**不进入**通用画像，`ai-portrait` 不得读取。
final class WellbeingAppointment {
  const WellbeingAppointment({
    required this.id,
    required this.counselorName,
    required this.startsAt,
    required this.endsAt,
    required this.status,
    required this.createdAt,
    this.mode = WellbeingMode.inPerson,
    this.location,
    this.note,
  });

  factory WellbeingAppointment.fromJson(Map<String, Object?> json) =>
      WellbeingAppointment(
        id: readString(json, 'id'),
        counselorName: readString(json, 'counselorName'),
        startsAt: readDateTime(json, 'startsAt'),
        endsAt: readDateTime(json, 'endsAt'),
        status:
            WellbeingStatus.fromWire(readStringOr(json, 'status', 'requested')),
        createdAt: readDateTime(json, 'createdAt'),
        mode: WellbeingMode.fromWire(readStringOr(json, 'mode', 'in_person')),
        location: readStringOrNull(json, 'location'),
        note: readStringOrNull(json, 'note'),
      );

  final String id;
  final String counselorName;
  final DateTime startsAt;
  final DateTime endsAt;
  final WellbeingStatus status;
  final DateTime createdAt;
  final WellbeingMode mode;
  final String? location;

  /// 用户备注（敏感，仅本人与咨询师可见）。
  final String? note;

  bool get isActive =>
      status == WellbeingStatus.requested ||
      status == WellbeingStatus.confirmed;

  Duration get duration => endsAt.difference(startsAt);

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'counselorName': counselorName,
        'startsAt': isoUtc(startsAt),
        'endsAt': isoUtc(endsAt),
        'status': status.wire,
        'createdAt': isoUtc(createdAt),
        'mode': mode.wire,
        'location': location,
        'note': note,
      };

  WellbeingAppointment copyWith({
    String? id,
    String? counselorName,
    DateTime? startsAt,
    DateTime? endsAt,
    WellbeingStatus? status,
    DateTime? createdAt,
    WellbeingMode? mode,
    String? location,
    String? note,
  }) =>
      WellbeingAppointment(
        id: id ?? this.id,
        counselorName: counselorName ?? this.counselorName,
        startsAt: startsAt ?? this.startsAt,
        endsAt: endsAt ?? this.endsAt,
        status: status ?? this.status,
        createdAt: createdAt ?? this.createdAt,
        mode: mode ?? this.mode,
        location: location ?? this.location,
        note: note ?? this.note,
      );

  @override
  bool operator ==(Object other) =>
      other is WellbeingAppointment && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() =>
      'WellbeingAppointment($id, $counselorName, ${status.wire})';
}

/// 预约咨询（`POST /api/v1/wellbeing/items`）。
final class BookWellbeingAppointmentCommand {
  const BookWellbeingAppointmentCommand({
    required this.startsAt,
    required this.endsAt,
    this.mode = WellbeingMode.inPerson,
    this.note,
  });

  final DateTime startsAt;
  final DateTime endsAt;
  final WellbeingMode mode;
  final String? note;

  Map<String, Object?> toJson() => <String, Object?>{
        'startsAt': isoUtc(startsAt),
        'endsAt': isoUtc(endsAt),
        'mode': mode.wire,
        'note': note,
      };
}
