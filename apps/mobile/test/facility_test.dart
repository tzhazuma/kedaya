import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/facility_booking.dart';
import 'package:kedaya/domain/models/facility_venue.dart';
import 'package:kedaya/features/facility/data/facility_mock_repository.dart';

/// `facility` 的规则层测试。
///
/// 只测纯函数与内存仓库 —— 页面怎么画不影响这些结论：
///   1. 时段可用性（含今天已开始的时段）；
///   2. 同场馆同时段冲突（**包括自己已经约过的**）；
///   3. 取消后时段释放；
///   4. 跨日期 / 跨场馆互不影响；
///   5. 人数 1–10 的边界。
void main() {
  final DateTime now = DateTime(2026, 11, 24, 8, 30);
  final DateTime today = DateTime(2026, 11, 24);
  final DateTime tomorrow = DateTime(2026, 11, 25);
  final DateTime dayAfter = DateTime(2026, 11, 26);

  FacilitySlot slotAt(int hour) => facilitySlotByStartHour(hour)!;

  FacilityMockRepository repository({
    List<FacilityBooking> seed = const <FacilityBooking>[],
  }) =>
      FacilityMockRepository(clock: () => now, seed: seed);

  FacilityBooking peerBooking({
    String id = 'peer-1',
    String venueId = 'gym',
    DateTime? date,
    int startHour = 10,
    FacilityBookingStatus status = FacilityBookingStatus.booked,
  }) =>
      FacilityBooking(
        id: id,
        venueId: venueId,
        date: date ?? tomorrow,
        slot: slotAt(startHour),
        partySize: 2,
        status: status,
        isMine: false,
        createdAt: now,
      );

  Matcher throwsFacility(FacilityBookingError error) => throwsA(
        isA<FacilityBookingException>()
            .having((FacilityBookingException e) => e.error, 'error', error),
      );

  group('时段定义', () {
    test('每天 08:00-22:00，共 14 个一小时时段', () {
      expect(facilitySlots, hasLength(14));
      expect(facilitySlots.first.startHour, 8);
      expect(facilitySlots.first.label, '08:00-09:00');
      expect(facilitySlots.last.startHour, 21);
      expect(facilitySlots.last.label, '21:00-22:00');
      expect(
        facilitySlots.map((FacilitySlot slot) => slot.index).toList(),
        List<int>.generate(14, (int index) => index),
      );
    });

    test('按小时找时段：08–21 命中，07 / 22 返回 null（不静默兜底）', () {
      expect(facilitySlotByStartHour(8), facilitySlots.first);
      expect(facilitySlotByStartHour(21), facilitySlots.last);
      expect(facilitySlotByStartHour(7), isNull);
      expect(facilitySlotByStartHour(22), isNull);
      expect(facilitySlotByIndex(-1), isNull);
      expect(facilitySlotByIndex(14), isNull);
    });

    test('可预约日期是今天 + 未来 6 天', () {
      final List<DateTime> dates = facilityBookableDates(now);
      expect(dates, hasLength(7));
      expect(dates.first, today);
      expect(dates.last, DateTime(2026, 11, 30));
      expect(
        formatFacilityDateChip(dates.first, now),
        '今天 11/24',
      );
      expect(
        formatFacilityDateChip(dates[1], now),
        '明天 11/25',
      );
      expect(formatFacilityDateWithWeekday(today), '11月24日 周二');
    });

    test('预约日期归一成当天 00:00，备注去空白', () {
      final FacilityBooking booking = FacilityBooking(
        id: 'b-1',
        venueId: 'gym',
        date: DateTime(2026, 11, 25, 18, 45),
        slot: slotAt(10),
        partySize: 1,
        status: FacilityBookingStatus.booked,
        isMine: true,
        createdAt: now,
        note: '  带水  ',
      );
      expect(booking.date, tomorrow);
      expect(booking.note, '带水');
      expect(booking.startsAt, DateTime(2026, 11, 25, 10));
      expect(booking.endsAt, DateTime(2026, 11, 25, 11));
    });
  });

  group('时段可用性', () {
    test('没有任何预约时，未来日期的 14 段全部可选', () {
      final FacilityMockRepository repo = repository();
      for (final FacilitySlot slot in facilitySlots) {
        expect(
          isFacilitySlotAvailable(
            venueId: 'gym',
            date: tomorrow,
            slot: slot,
            bookings: repo.bookings,
            now: now,
          ),
          isTrue,
        );
      }
      expect(
        remainingFacilitySlotCount(
          venueId: 'gym',
          date: tomorrow,
          bookings: repo.bookings,
          now: now,
        ),
        14,
      );
    });

    test('今天已经开始的时段不可选；现在 08:30 时 08:00 段已过、09:00 段可选', () {
      expect(
        isFacilitySlotPast(date: today, slot: slotAt(8), now: now),
        isTrue,
      );
      expect(
        isFacilitySlotPast(date: today, slot: slotAt(9), now: now),
        isFalse,
      );
      expect(
        isFacilitySlotPast(date: tomorrow, slot: slotAt(8), now: now),
        isFalse,
      );
      expect(
        remainingFacilitySlotCount(
          venueId: 'gym',
          date: today,
          bookings: const <FacilityBooking>[],
          now: now,
        ),
        13,
      );
    });

    test('有效预约占用时段；已取消的预约不占用', () {
      final FacilityBooking active = peerBooking(startHour: 10);
      final FacilityBooking cancelled = peerBooking(
        id: 'peer-2',
        startHour: 11,
        status: FacilityBookingStatus.cancelled,
      );

      expect(
        facilitySlotState(
          venueId: 'gym',
          date: tomorrow,
          slot: slotAt(10),
          bookings: <FacilityBooking>[active, cancelled],
          now: now,
        ),
        FacilitySlotState.booked,
      );
      expect(
        facilitySlotState(
          venueId: 'gym',
          date: tomorrow,
          slot: slotAt(11),
          bookings: <FacilityBooking>[active, cancelled],
          now: now,
        ),
        FacilitySlotState.available,
      );
      expect(
        remainingFacilitySlotCount(
          venueId: 'gym',
          date: tomorrow,
          bookings: <FacilityBooking>[active, cancelled],
          now: now,
        ),
        13,
      );
    });
  });

  group('冲突检测（同场馆同时段）', () {
    test('第一次预约成功，第二次（自己重复约）被拒绝并说明是自己的预约', () {
      final FacilityMockRepository repo = repository();
      final FacilityBooking first = repo.book(
        venueId: 'gym',
        date: tomorrow,
        slot: slotAt(10),
        partySize: 2,
      );
      expect(first.isMine, isTrue);
      expect(first.status, FacilityBookingStatus.booked);
      expect(
        isFacilitySlotBooked(
          venueId: 'gym',
          date: tomorrow,
          slot: slotAt(10),
          bookings: repo.bookings,
        ),
        isTrue,
      );

      expect(
        () => repo.book(
          venueId: 'gym',
          date: tomorrow,
          slot: slotAt(10),
          partySize: 1,
        ),
        throwsFacility(FacilityBookingError.conflictWithMine),
      );
    });

    test('别人已约的时段冲突时给出「已被别人约走」', () {
      final FacilityMockRepository repo = repository(
        seed: <FacilityBooking>[peerBooking(startHour: 10)],
      );
      expect(
        () => repo.book(
          venueId: 'gym',
          date: tomorrow,
          slot: slotAt(10),
          partySize: 1,
        ),
        throwsA(
          isA<FacilityBookingException>()
              .having(
                (FacilityBookingException e) => e.error,
                'error',
                FacilityBookingError.conflictWithOthers,
              )
              .having(
                (FacilityBookingException e) => e.userMessage,
                'userMessage',
                contains('别人'),
              ),
        ),
      );
    });

    test('同场馆不同时段 / 不同场馆同时段都允许', () {
      final FacilityMockRepository repo = repository();
      repo.book(
        venueId: 'gym',
        date: tomorrow,
        slot: slotAt(10),
        partySize: 1,
      );
      expect(
        () => repo.book(
          venueId: 'gym',
          date: tomorrow,
          slot: slotAt(11),
          partySize: 1,
        ),
        returnsNormally,
      );
      expect(
        () => repo.book(
          venueId: 'badminton',
          date: tomorrow,
          slot: slotAt(10),
          partySize: 1,
        ),
        returnsNormally,
      );
    });
  });

  group('取消后释放时段', () {
    test('取消自己的预约 → 状态变已取消、时段重新可选、剩余数恢复', () {
      final FacilityMockRepository repo = repository();
      final FacilityBooking booking = repo.book(
        venueId: 'gym',
        date: tomorrow,
        slot: slotAt(12),
        partySize: 3,
      );
      expect(
        remainingFacilitySlotCount(
          venueId: 'gym',
          date: tomorrow,
          bookings: repo.bookings,
          now: now,
        ),
        13,
      );

      final FacilityBooking cancelled = repo.cancel(booking.id);
      expect(cancelled.status, FacilityBookingStatus.cancelled);
      expect(
        isFacilitySlotAvailable(
          venueId: 'gym',
          date: tomorrow,
          slot: slotAt(12),
          bookings: repo.bookings,
          now: now,
        ),
        isTrue,
      );
      expect(
        remainingFacilitySlotCount(
          venueId: 'gym',
          date: tomorrow,
          bookings: repo.bookings,
          now: now,
        ),
        14,
      );
    });

    test('取消幂等；取消别人的预约被拒绝；不存在的预约报 notFound', () {
      final FacilityBooking peer = peerBooking(startHour: 10);
      final FacilityMockRepository repo = repository(
        seed: <FacilityBooking>[peer],
      );

      expect(
        () => repo.cancel(peer.id),
        throwsFacility(FacilityBookingError.notMine),
      );
      expect(
        () => repo.cancel('missing'),
        throwsFacility(FacilityBookingError.notFound),
      );

      final FacilityBooking mine = repo.book(
        venueId: 'gym',
        date: tomorrow,
        slot: slotAt(11),
        partySize: 1,
      );
      final FacilityBooking once = repo.cancel(mine.id);
      final FacilityBooking twice = repo.cancel(mine.id);
      expect(once.status, FacilityBookingStatus.cancelled);
      expect(twice.status, FacilityBookingStatus.cancelled);
    });
  });

  group('跨日期 / 跨场馆互不影响', () {
    test('明天 13:00 的预约不影响后天同一时段', () {
      final FacilityMockRepository repo = repository();
      repo.book(
        venueId: 'gym',
        date: tomorrow,
        slot: slotAt(13),
        partySize: 2,
      );
      expect(
        remainingFacilitySlotCount(
          venueId: 'gym',
          date: dayAfter,
          bookings: repo.bookings,
          now: now,
        ),
        14,
      );
      expect(
        isFacilitySlotAvailable(
          venueId: 'gym',
          date: dayAfter,
          slot: slotAt(13),
          bookings: repo.bookings,
          now: now,
        ),
        isTrue,
      );
      expect(
        findFacilityBookingConflict(
          venueId: 'gym',
          date: dayAfter,
          slot: slotAt(13),
          bookings: repo.bookings,
        ),
        isNull,
      );
    });

    test('同一时段在另一个场馆仍然可选，剩余数互不扣减', () {
      final FacilityMockRepository repo = repository();
      repo.book(
        venueId: 'badminton',
        date: tomorrow,
        slot: slotAt(15),
        partySize: 4,
      );
      expect(
        isFacilitySlotAvailable(
          venueId: 'gym',
          date: tomorrow,
          slot: slotAt(15),
          bookings: repo.bookings,
          now: now,
        ),
        isTrue,
      );
      expect(
        remainingFacilitySlotCount(
          venueId: 'gym',
          date: tomorrow,
          bookings: repo.bookings,
          now: now,
        ),
        14,
      );
      expect(
        remainingFacilitySlotCount(
          venueId: 'badminton',
          date: tomorrow,
          bookings: repo.bookings,
          now: now,
        ),
        13,
      );
    });

    test('取消明天的预约不会误伤后天的同场馆同时段', () {
      final FacilityMockRepository repo = repository();
      final FacilityBooking booking = repo.book(
        venueId: 'piano-room',
        date: tomorrow,
        slot: slotAt(16),
        partySize: 1,
      );
      repo.cancel(booking.id);
      expect(
        remainingFacilitySlotCount(
          venueId: 'piano-room',
          date: dayAfter,
          bookings: repo.bookings,
          now: now,
        ),
        14,
      );
    });
  });

  group('人数边界校验', () {
    test('1 与 10 合法；0、11、负数非法', () {
      expect(isValidFacilityPartySize(1), isTrue);
      expect(isValidFacilityPartySize(10), isTrue);
      expect(isValidFacilityPartySize(0), isFalse);
      expect(isValidFacilityPartySize(11), isFalse);
      expect(isValidFacilityPartySize(-1), isFalse);
    });

    test('validateFacilityBookingDraft 只报人数问题，边界值不报', () {
      expect(
        validateFacilityBookingDraft(partySize: 1),
        isEmpty,
      );
      expect(
        validateFacilityBookingDraft(partySize: 10),
        isEmpty,
      );
      expect(
        validateFacilityBookingDraft(partySize: 0),
        contains(FacilityBookingDraftProblem.partySizeOutOfRange),
      );
      expect(
        validateFacilityBookingDraft(partySize: 11),
        contains(FacilityBookingDraftProblem.partySizeOutOfRange),
      );
    });

    test('仓库拒绝越界人数（在冲突检查之前），边界值可以提交', () {
      final FacilityMockRepository repo = repository();

      expect(
        () => repo.book(
          venueId: 'gym',
          date: tomorrow,
          slot: slotAt(10),
          partySize: 0,
        ),
        throwsFacility(FacilityBookingError.partySizeOutOfRange),
      );
      expect(
        () => repo.book(
          venueId: 'gym',
          date: tomorrow,
          slot: slotAt(10),
          partySize: 11,
        ),
        throwsFacility(FacilityBookingError.partySizeOutOfRange),
      );

      final FacilityBooking one = repo.book(
        venueId: 'gym',
        date: tomorrow,
        slot: slotAt(10),
        partySize: 1,
      );
      final FacilityBooking ten = repo.book(
        venueId: 'gym',
        date: tomorrow,
        slot: slotAt(11),
        partySize: 10,
      );
      expect(one.partySize, 1);
      expect(ten.partySize, 10);
    });

    test('备注空白归一为 null；超过 100 字被拒绝', () {
      expect(normalizeFacilityNote('   '), isNull);
      expect(normalizeFacilityNote('  hi  '), 'hi');
      expect(
        validateFacilityBookingDraft(
          partySize: 2,
          note: '字' * 100,
        ),
        isEmpty,
      );
      expect(
        validateFacilityBookingDraft(
          partySize: 2,
          note: '字' * 101,
        ),
        contains(FacilityBookingDraftProblem.noteTooLong),
      );

      final FacilityMockRepository repo = repository();
      expect(
        () => repo.book(
          venueId: 'gym',
          date: tomorrow,
          slot: slotAt(12),
          partySize: 2,
          note: '字' * 101,
        ),
        throwsFacility(FacilityBookingError.noteTooLong),
      );
    });

    test('今天已经开始的时段在仓库层也会被拒绝', () {
      final FacilityMockRepository repo = repository();
      expect(
        () => repo.book(
          venueId: 'gym',
          date: today,
          slot: slotAt(8),
          partySize: 1,
        ),
        throwsFacility(FacilityBookingError.slotInPast),
      );
      expect(
        () => repo.book(
          venueId: 'gym',
          date: today,
          slot: slotAt(9),
          partySize: 1,
        ),
        returnsNormally,
      );
    });
  });
}
