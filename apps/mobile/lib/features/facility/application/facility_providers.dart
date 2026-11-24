/// `facility` 的 Riverpod 装配。
///
/// 数据全部来自 feature 内的内存仓库（[FacilityMockRepository]），
/// **不经过** `app_providers` / 网络 —— 因此这个模块可以独立预览与测试。
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/models/facility_booking.dart';
import '../../../domain/models/facility_venue.dart';
import '../data/facility_fixtures.dart';
import '../data/facility_mock_repository.dart';

/// 「现在」的注入点。
///
/// 「今天还剩几段」「这个时段是不是已经开始了」都依赖它；测试里 override 成
/// 固定时刻后，可用性断言不会跟着真实日历漂移。
final facilityClockProvider =
    Provider<DateTime Function()>((ref) => DateTime.now);

/// 六个场馆（固定集合）。
final facilityVenuesProvider = Provider<List<FacilityVenue>>(
  (ref) => facilityDemoVenues,
);

/// 按 id 取场馆；不存在时返回 `null`（页面显示「场馆不存在」而不是白屏）。
final facilityVenueProvider = Provider.family<FacilityVenue?, String>(
  (ref, String venueId) => ref.watch(facilityVenuesProvider).byId(venueId),
);

/// 内存仓库单例。演示预约按注入的时钟生成，保证「今天」永远有数据。
final facilityRepositoryProvider = Provider<FacilityMockRepository>((ref) {
  final DateTime Function() clock = ref.watch(facilityClockProvider);
  return FacilityMockRepository(
    clock: clock,
    seed: facilityDemoBookings(clock()),
  );
});

/// 全部预约（含别人的与已取消的）。
final facilityBookingsProvider =
    NotifierProvider<FacilityBookingsController, List<FacilityBooking>>(
  FacilityBookingsController.new,
);

final class FacilityBookingsController extends Notifier<List<FacilityBooking>> {
  FacilityMockRepository get _repository =>
      ref.read(facilityRepositoryProvider);

  @override
  List<FacilityBooking> build() {
    // watch：时钟或仓库被替换时，状态跟着重建。
    ref.watch(facilityRepositoryProvider);
    return _repository.bookings;
  }

  /// 新建预约；冲突 / 人数越界 / 时段已过都会抛 [FacilityBookingException]。
  FacilityBooking book({
    required String venueId,
    required DateTime date,
    required FacilitySlot slot,
    required int partySize,
    String? note,
  }) {
    final FacilityBooking booking = _repository.book(
      venueId: venueId,
      date: date,
      slot: slot,
      partySize: partySize,
      note: note,
    );
    state = _repository.bookings;
    return booking;
  }

  /// 取消自己的预约；成功后该时段自动回到可选（可用性计算忽略已取消）。
  FacilityBooking cancel(String bookingId) {
    final FacilityBooking booking = _repository.cancel(bookingId);
    state = _repository.bookings;
    return booking;
  }
}

/// 我的预约（有效在前，其次日期 / 时段，已取消沉底）。
final facilityMyBookingsProvider = Provider<List<FacilityBooking>>((ref) {
  final List<FacilityBooking> mine = ref
      .watch(facilityBookingsProvider)
      .where((FacilityBooking booking) => booking.isMine)
      .toList()
    ..sort(compareFacilityBookings);
  return List<FacilityBooking>.unmodifiable(mine);
});

/// 某场馆的全部预约（详情页算可用性时传入，避免每张 chip 都过滤全量）。
final facilityVenueBookingsProvider =
    Provider.family<List<FacilityBooking>, String>((ref, String venueId) {
  return ref
      .watch(facilityBookingsProvider)
      .where((FacilityBooking booking) => booking.venueId == venueId)
      .toList(growable: false);
});
