import '../../../domain/models/wellbeing_booking.dart';
import '../../../domain/ports/local_cache_port.dart';

/// 本机预约的缓存键。只存预约本身，不存任何诊断/量表/联系方式原文。
const String wellbeingBookingsStorageKey = 'wellbeing.bookings.v1';

/// 本机预约仓库（读写都只在这台设备上）。
///
/// 抽象出接口是为了让「同意门未通过时**一次都不读取**」可被测试用计数器钉死。
abstract interface class WellbeingBookingsRepository {
  List<WellbeingBooking> load();

  Future<void> save(List<WellbeingBooking> bookings);

  Future<void> clear();
}

/// 基于 [LocalCachePort] 的本机实现（SharedPreferences / 内存缓存）。
final class LocalWellbeingBookingsRepository
    implements WellbeingBookingsRepository {
  const LocalWellbeingBookingsRepository(this._cache);

  final LocalCachePort _cache;

  @override
  List<WellbeingBooking> load() {
    final Object? raw = _cache.readJson(wellbeingBookingsStorageKey);
    if (raw is! List) return const <WellbeingBooking>[];
    final List<WellbeingBooking> bookings = <WellbeingBooking>[];
    for (final Object? item in raw) {
      if (item is! Map) continue;
      try {
        bookings.add(
          WellbeingBooking.fromJson(Map<String, Object?>.from(item)),
        );
      } on Object {
        // 单条损坏只丢这一条，不让整份本机记录消失。
      }
    }
    bookings.sort(
      (WellbeingBooking a, WellbeingBooking b) =>
          b.createdAt.compareTo(a.createdAt),
    );
    return List<WellbeingBooking>.unmodifiable(bookings);
  }

  @override
  Future<void> save(List<WellbeingBooking> bookings) => _cache.writeJson(
        wellbeingBookingsStorageKey,
        <Object?>[
          for (final WellbeingBooking booking in bookings) booking.toJson(),
        ],
      );

  @override
  Future<void> clear() => _cache.remove(wellbeingBookingsStorageKey);
}
