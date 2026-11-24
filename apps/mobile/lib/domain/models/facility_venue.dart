/// 场馆预约的静态规则（`facility`，契约 §4.1）。
///
/// 这里只有「场馆」与「时段」两件事，不含任何 HTTP / 存储细节：
/// 六个场馆、每天 08:00–22:00 共 14 个一小时时段，是产品冻结的口径。
library;

import 'package:flutter/foundation.dart';

/// 第一个可预约时段的开始小时（08:00）。
const int facilityFirstSlotHour = 8;

/// 最后一个可预约时段的结束小时（22:00，即 21:00–22:00 这一段）。
const int facilityLastSlotHour = 22;

/// `8 -> "08:00"`。
String formatFacilityHour(int hour) => '${hour.toString().padLeft(2, '0')}:00';

/// 一个 60 分钟的预约时段（例如 08:00–09:00）。
///
/// 用「开始小时」而不是两个 [DateTime] 表示：场馆预约是**按整点切段**的，
/// 存结束时间只会多一个可能与开始时间不一致的字段。
@immutable
final class FacilitySlot {
  const FacilitySlot(this.startHour)
      : assert(startHour >= facilityFirstSlotHour),
        assert(startHour < facilityLastSlotHour);

  final int startHour;

  int get endHour => startHour + 1;

  /// 列表序（0 表示 08:00 这一段）。
  int get index => startHour - facilityFirstSlotHour;

  /// `08:00-09:00`（与产品文案一致，使用半角连字符）。
  String get label =>
      '${formatFacilityHour(startHour)}-${formatFacilityHour(endHour)}';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is FacilitySlot && other.startHour == startHour;

  @override
  int get hashCode => startHour.hashCode;

  @override
  String toString() => 'FacilitySlot($label)';
}

/// 全部 14 个时段：08:00-09:00 … 21:00-22:00。
const List<FacilitySlot> facilitySlots = <FacilitySlot>[
  FacilitySlot(8),
  FacilitySlot(9),
  FacilitySlot(10),
  FacilitySlot(11),
  FacilitySlot(12),
  FacilitySlot(13),
  FacilitySlot(14),
  FacilitySlot(15),
  FacilitySlot(16),
  FacilitySlot(17),
  FacilitySlot(18),
  FacilitySlot(19),
  FacilitySlot(20),
  FacilitySlot(21),
];

/// 按开始小时找时段；不在 08–21 的小时返回 `null`（不静默兜底成第一段）。
FacilitySlot? facilitySlotByStartHour(int hour) {
  for (final FacilitySlot slot in facilitySlots) {
    if (slot.startHour == hour) return slot;
  }
  return null;
}

/// 按列表序找时段；越界返回 `null`。
FacilitySlot? facilitySlotByIndex(int index) {
  if (index < 0 || index >= facilitySlots.length) return null;
  return facilitySlots[index];
}

/// 一个场馆（名称 / 位置 / 开放时间）。
@immutable
final class FacilityVenue {
  const FacilityVenue({
    required this.id,
    required this.name,
    required this.location,
    required this.description,
    this.opensAtHour = facilityFirstSlotHour,
    this.closesAtHour = facilityLastSlotHour,
  });

  final String id;
  final String name;
  final String location;
  final String description;
  final int opensAtHour;
  final int closesAtHour;

  /// 例：`08:00-22:00`。
  String get openHoursLabel =>
      '${formatFacilityHour(opensAtHour)}-${formatFacilityHour(closesAtHour)}';

  @override
  bool operator ==(Object other) =>
      identical(this, other) || other is FacilityVenue && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'FacilityVenue($id, $name)';
}

/// 从任意场馆列表里按 id 查找；找不到返回 `null`，由页面给出「场馆不存在」。
extension FacilityVenueLookup on Iterable<FacilityVenue> {
  FacilityVenue? byId(String id) {
    for (final FacilityVenue venue in this) {
      if (venue.id == id) return venue;
    }
    return null;
  }
}
