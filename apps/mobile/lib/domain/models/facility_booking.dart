/// 场馆预约的领域规则：预约、时段可用性、冲突检测与人数校验。
///
/// **页面里不放规则副本**：卡片上「今日剩余 N 段」、时段 chip 的置灰、
/// 提交前的 1–10 人校验、以及「同场馆同时段只能有一条」都调用这里的纯函数。
library;

import 'package:flutter/foundation.dart';

import 'facility_venue.dart';

/// 使用人数下限。
const int facilityMinPartySize = 1;

/// 使用人数上限。
const int facilityMaxPartySize = 10;

/// 备注最大长度（按 trim 后的字符数）。
const int facilityNoteMaxLength = 100;

/// 可预约天数：今天 + 未来 6 天。
const int facilityBookableDayCount = 7;

/// `date` 的日期部分（本地时区，00:00）。
DateTime facilityDateOnly(DateTime date) =>
    DateTime(date.year, date.month, date.day);

/// `YYYY-MM-DD`（本地时区；用于路由 query 与分组 key）。
String facilityDateKey(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-'
    '${date.month.toString().padLeft(2, '0')}-'
    '${date.day.toString().padLeft(2, '0')}';

/// 是否同一天（忽略时间与时区标记）。
bool isSameFacilityDate(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

/// 从 [now] 起连续 [days] 天的日期（含今天；均为 00:00）。
///
/// 用 `DateTime(y, m, d + i)` 而不是 `add(Duration(days: i))`：
/// 后者在夏令时切换日会偏一小时，日期可能落到前一天。
List<DateTime> facilityBookableDates(
  DateTime now, {
  int days = facilityBookableDayCount,
}) =>
    <DateTime>[
      for (int i = 0; i < days; i++) DateTime(now.year, now.month, now.day + i),
    ];

/// `11月24日`。
String formatFacilityDate(DateTime date) => '${date.month}月${date.day}日';

/// `11月24日 周二`。
String formatFacilityDateWithWeekday(DateTime date) {
  const List<String> weekdays = <String>[
    '周一',
    '周二',
    '周三',
    '周四',
    '周五',
    '周六',
    '周日',
  ];
  return '${formatFacilityDate(date)} ${weekdays[date.weekday - 1]}';
}

/// `今天` / `明天` / `周三`（与 [now] 的日期差决定）。
String formatFacilityRelativeDay(DateTime date, DateTime now) {
  final DateTime today = facilityDateOnly(now);
  final DateTime target = facilityDateOnly(date);
  final int diff = target.difference(today).inDays;
  if (diff == 0) return '今天';
  if (diff == 1) return '明天';
  const List<String> weekdays = <String>[
    '周一',
    '周二',
    '周三',
    '周四',
    '周五',
    '周六',
    '周日',
  ];
  return weekdays[target.weekday - 1];
}

/// 日期 chip 的紧凑文案：`今天 11/24`。
String formatFacilityDateChip(DateTime date, DateTime now) =>
    '${formatFacilityRelativeDay(date, now)} ${date.month}/${date.day}';

/// 预约状态（产品只要求两种：已预约 / 已取消）。
enum FacilityBookingStatus {
  booked('booked', '已预约'),
  cancelled('cancelled', '已取消');

  const FacilityBookingStatus(this.wire, this.label);

  final String wire;
  final String label;

  bool get isActive => this == FacilityBookingStatus.booked;

  static FacilityBookingStatus? fromWire(String wire) {
    for (final FacilityBookingStatus status in FacilityBookingStatus.values) {
      if (status.wire == wire) return status;
    }
    return null;
  }
}

/// 一条场馆预约。
///
/// 构造时会把 [date] 归一成当天 00:00、把空白 [note] 归一成 `null`，
/// 因此「同一天」的判定不需要每个调用点自己写一遍。
@immutable
final class FacilityBooking {
  factory FacilityBooking({
    required String id,
    required String venueId,
    required DateTime date,
    required FacilitySlot slot,
    required int partySize,
    required FacilityBookingStatus status,
    required bool isMine,
    required DateTime createdAt,
    String? note,
  }) =>
      FacilityBooking._(
        id: id,
        venueId: venueId,
        date: facilityDateOnly(date),
        slot: slot,
        partySize: partySize,
        status: status,
        isMine: isMine,
        createdAt: createdAt,
        note: normalizeFacilityNote(note),
      );

  const FacilityBooking._({
    required this.id,
    required this.venueId,
    required this.date,
    required this.slot,
    required this.partySize,
    required this.status,
    required this.isMine,
    required this.createdAt,
    required this.note,
  });

  final String id;
  final String venueId;

  /// 已归一为本地时区当天 00:00。
  final DateTime date;
  final FacilitySlot slot;
  final int partySize;
  final FacilityBookingStatus status;

  /// 是否属于「我」。演示数据里同时有别人的预约，用于展示「已约满」。
  final bool isMine;
  final DateTime createdAt;
  final String? note;

  bool get isActive => status.isActive;

  DateTime get startsAt =>
      DateTime(date.year, date.month, date.day, slot.startHour);

  DateTime get endsAt => startsAt.add(const Duration(hours: 1));

  FacilityBooking withStatus(FacilityBookingStatus next) => FacilityBooking._(
        id: id,
        venueId: venueId,
        date: date,
        slot: slot,
        partySize: partySize,
        status: next,
        isMine: isMine,
        createdAt: createdAt,
        note: note,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) || other is FacilityBooking && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() =>
      'FacilityBooking($id, $venueId, ${facilityDateKey(date)} ${slot.label}, '
      '${status.wire})';
}

/// 时段在界面上的三种状态（已预约优先于「已过」，因为「约满」更需要被看见）。
enum FacilitySlotState {
  available('可预约'),
  booked('已约满'),
  past('已过');

  const FacilitySlotState(this.label);

  final String label;
}

/// 该时段是否已被**有效**预约占用（已取消的不算）。
bool isFacilitySlotBooked({
  required String venueId,
  required DateTime date,
  required FacilitySlot slot,
  required Iterable<FacilityBooking> bookings,
}) {
  for (final FacilityBooking booking in bookings) {
    if (!booking.isActive) continue;
    if (booking.venueId != venueId) continue;
    if (booking.slot.startHour != slot.startHour) continue;
    if (!isSameFacilityDate(booking.date, date)) continue;
    return true;
  }
  return false;
}

/// 该时段是否已经开始（含正在进行的时段）。
///
/// 今天 08:29 时，08:00-09:00 这一段已经开始，不能再约；未来的日期永远为 `false`。
bool isFacilitySlotPast({
  required DateTime date,
  required FacilitySlot slot,
  required DateTime now,
}) {
  final DateTime startsAt =
      DateTime(date.year, date.month, date.day, slot.startHour);
  return !startsAt.isAfter(now);
}

/// 该时段现在是否可选：没被占用、且还没开始。
bool isFacilitySlotAvailable({
  required String venueId,
  required DateTime date,
  required FacilitySlot slot,
  required Iterable<FacilityBooking> bookings,
  required DateTime now,
}) =>
    !isFacilitySlotBooked(
      venueId: venueId,
      date: date,
      slot: slot,
      bookings: bookings,
    ) &&
    !isFacilitySlotPast(date: date, slot: slot, now: now);

/// 界面用的三态。
FacilitySlotState facilitySlotState({
  required String venueId,
  required DateTime date,
  required FacilitySlot slot,
  required Iterable<FacilityBooking> bookings,
  required DateTime now,
}) {
  if (isFacilitySlotBooked(
    venueId: venueId,
    date: date,
    slot: slot,
    bookings: bookings,
  )) {
    return FacilitySlotState.booked;
  }
  if (isFacilitySlotPast(date: date, slot: slot, now: now)) {
    return FacilitySlotState.past;
  }
  return FacilitySlotState.available;
}

/// 某场馆某一天还剩多少个可预约时段（今天会自动扣掉已经开始的时段）。
int remainingFacilitySlotCount({
  required String venueId,
  required DateTime date,
  required Iterable<FacilityBooking> bookings,
  required DateTime now,
}) {
  int count = 0;
  for (final FacilitySlot slot in facilitySlots) {
    if (isFacilitySlotAvailable(
      venueId: venueId,
      date: date,
      slot: slot,
      bookings: bookings,
      now: now,
    )) {
      count += 1;
    }
  }
  return count;
}

/// 找到与 `(venueId, date, slot)` 冲突的有效预约；没有冲突返回 `null`。
///
/// **包含自己已约的**：同一场馆同一时段只允许一条预约，对自己也不例外。
FacilityBooking? findFacilityBookingConflict({
  required String venueId,
  required DateTime date,
  required FacilitySlot slot,
  required Iterable<FacilityBooking> bookings,
}) {
  for (final FacilityBooking booking in bookings) {
    if (!booking.isActive) continue;
    if (booking.venueId != venueId) continue;
    if (booking.slot.startHour != slot.startHour) continue;
    if (!isSameFacilityDate(booking.date, date)) continue;
    return booking;
  }
  return null;
}

/// 冲突提示：要区分「你自己已经约了」与「被别人约走了」。
String describeFacilityBookingConflict(FacilityBooking conflict) =>
    conflict.isMine ? '你在同一场馆、同一时段已经有一条预约，不能重复预约。' : '这个时段已经被别人约走了，换一个时段吧。';

/// 人数是否在 1–10 之间。
bool isValidFacilityPartySize(int value) =>
    value >= facilityMinPartySize && value <= facilityMaxPartySize;

/// 预约草稿的问题码（提交前一次性告诉用户哪里不对）。
enum FacilityBookingDraftProblem {
  partySizeOutOfRange('partySizeOutOfRange', '使用人数需在 1–10 人之间'),
  noteTooLong('noteTooLong', '备注最多 100 字');

  const FacilityBookingDraftProblem(this.wire, this.message);

  final String wire;
  final String message;
}

/// 校验人数与备注；返回空列表表示可以提交。
List<FacilityBookingDraftProblem> validateFacilityBookingDraft({
  required int partySize,
  String? note,
}) {
  final List<FacilityBookingDraftProblem> problems =
      <FacilityBookingDraftProblem>[];
  if (!isValidFacilityPartySize(partySize)) {
    problems.add(FacilityBookingDraftProblem.partySizeOutOfRange);
  }
  final String? normalizedNote = normalizeFacilityNote(note);
  if (normalizedNote != null && normalizedNote.length > facilityNoteMaxLength) {
    problems.add(FacilityBookingDraftProblem.noteTooLong);
  }
  return problems;
}

/// 去首尾空白；空白串归一成 `null`（避免列表里出现一个空的「备注」）。
String? normalizeFacilityNote(String? note) {
  final String? trimmed = note?.trim();
  if (trimmed == null || trimmed.isEmpty) return null;
  return trimmed;
}

/// 写操作失败的原因。所有文案都在这里，页面只负责展示 [userMessage]。
enum FacilityBookingError {
  partySizeOutOfRange,
  noteTooLong,
  slotInPast,
  conflictWithMine,
  conflictWithOthers,
  notFound,
  notMine,
}

extension FacilityBookingErrorMessage on FacilityBookingError {
  String get userMessage => switch (this) {
        FacilityBookingError.partySizeOutOfRange => '使用人数需在 1–10 人之间。',
        FacilityBookingError.noteTooLong => '备注最多 100 字，请精简一下。',
        FacilityBookingError.slotInPast => '这个时段已经开始，不能再预约了。',
        FacilityBookingError.conflictWithMine => '你在同一场馆、同一时段已经有一条预约，不能重复预约。',
        FacilityBookingError.conflictWithOthers => '这个时段已经被别人约走了，换一个时段吧。',
        FacilityBookingError.notFound => '这条预约不存在，可能已经被删除。',
        FacilityBookingError.notMine => '不能取消别人的预约。',
      };
}

/// 预约写操作失败。
final class FacilityBookingException implements Exception {
  const FacilityBookingException(
    this.error, {
    this.conflictingBooking,
  });

  final FacilityBookingError error;

  /// 冲突时带上已有的那条预约，页面可据此给出更具体的提示。
  final FacilityBooking? conflictingBooking;

  String get userMessage => error.userMessage;

  @override
  String toString() => 'FacilityBookingException(${error.name})';
}

/// 我的预约列表排序：有效在前；同状态按日期、时段升序；已取消沉底。
int compareFacilityBookings(FacilityBooking a, FacilityBooking b) {
  if (a.isActive != b.isActive) return a.isActive ? -1 : 1;
  final int byDate = a.date.compareTo(b.date);
  if (byDate != 0) return byDate;
  final int bySlot = a.slot.startHour.compareTo(b.slot.startHour);
  if (bySlot != 0) return bySlot;
  return a.createdAt.compareTo(b.createdAt);
}
