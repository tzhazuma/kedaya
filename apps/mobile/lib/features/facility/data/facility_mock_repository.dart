/// 场馆预约的内存仓库（演示用；**不落盘、不联网**）。
///
/// 它刻意只做三件事：保存预约、按规则拒绝冲突、把取消写成状态。
/// 时段是否可选等读侧计算在 `domain/models/facility_booking.dart` 的纯函数里，
/// 这样「什么算冲突」只有一份实现。
library;

import '../../../domain/models/facility_booking.dart';
import '../../../domain/models/facility_venue.dart';

final class FacilityMockRepository {
  FacilityMockRepository({
    required DateTime Function() clock,
    Iterable<FacilityBooking> seed = const <FacilityBooking>[],
  })  : _clock = clock,
        _bookings = List<FacilityBooking>.of(seed);

  final DateTime Function() _clock;
  final List<FacilityBooking> _bookings;
  int _sequence = 0;

  /// 只读快照；调用方不能从外部改到仓库内部状态。
  List<FacilityBooking> get bookings =>
      List<FacilityBooking>.unmodifiable(_bookings);

  /// 新建预约。
  ///
  /// 规则顺序：人数 → 备注 → 时段是否已开始 → 同场馆同时段冲突（含自己）。
  /// 失败一律抛 [FacilityBookingException]，页面直接展示 `userMessage`。
  FacilityBooking book({
    required String venueId,
    required DateTime date,
    required FacilitySlot slot,
    required int partySize,
    String? note,
  }) {
    if (!isValidFacilityPartySize(partySize)) {
      throw const FacilityBookingException(
        FacilityBookingError.partySizeOutOfRange,
      );
    }

    final String? normalizedNote = normalizeFacilityNote(note);
    if (normalizedNote != null &&
        normalizedNote.length > facilityNoteMaxLength) {
      throw const FacilityBookingException(FacilityBookingError.noteTooLong);
    }

    final DateTime now = _clock();
    final DateTime normalizedDate = facilityDateOnly(date);
    if (isFacilitySlotPast(date: normalizedDate, slot: slot, now: now)) {
      throw const FacilityBookingException(FacilityBookingError.slotInPast);
    }

    final FacilityBooking? conflict = findFacilityBookingConflict(
      venueId: venueId,
      date: normalizedDate,
      slot: slot,
      bookings: _bookings,
    );
    if (conflict != null) {
      throw FacilityBookingException(
        conflict.isMine
            ? FacilityBookingError.conflictWithMine
            : FacilityBookingError.conflictWithOthers,
        conflictingBooking: conflict,
      );
    }

    final FacilityBooking booking = FacilityBooking(
      id: 'facility-$venueId-${facilityDateKey(normalizedDate)}-'
          '${slot.startHour}-${_sequence++}',
      venueId: venueId,
      date: normalizedDate,
      slot: slot,
      partySize: partySize,
      status: FacilityBookingStatus.booked,
      isMine: true,
      createdAt: now,
      note: normalizedNote,
    );
    _bookings.add(booking);
    return booking;
  }

  /// 取消自己的预约；已取消的条目幂等返回原状态。
  ///
  /// 取消只是把状态改成 `cancelled`，不删除记录 —— 这样「我的预约」里
  /// 仍能看到「已取消」，而可用性计算会自动忽略它（时段回到可选）。
  FacilityBooking cancel(String bookingId) {
    final int index = _bookings.indexWhere(
      (FacilityBooking booking) => booking.id == bookingId,
    );
    if (index < 0) {
      throw const FacilityBookingException(FacilityBookingError.notFound);
    }
    final FacilityBooking current = _bookings[index];
    if (!current.isMine) {
      throw const FacilityBookingException(FacilityBookingError.notMine);
    }
    if (!current.isActive) return current;

    final FacilityBooking cancelled =
        current.withStatus(FacilityBookingStatus.cancelled);
    _bookings[index] = cancelled;
    return cancelled;
  }
}
