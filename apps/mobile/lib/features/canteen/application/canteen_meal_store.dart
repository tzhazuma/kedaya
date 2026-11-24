/// 餐次记录的本机存储（**不接后端**）。
///
/// 只依赖 `LocalCachePort`（同步 hydrate + 异步写回），因此 mock 运行时、
/// 真机 `SharedPreferences` 与单测里的内存实现共用同一份代码。
///
/// 读取时逐条容错：一条损坏的记录会被跳过，而不是让整个「今日记录」打不开。
library;

import '../../../domain/models/meal_record.dart';
import '../../../domain/ports/local_cache_port.dart';

/// 本机缓存键。改数据结构时请同时升版本号。
const String canteenMealStorageKey = 'canteen.meal-records.v1';

/// 最多保留的记录条数（本机演示用，不追求无限历史）。
const int canteenMealStoreLimit = 200;

final class CanteenMealStore {
  const CanteenMealStore(this._cache);

  final LocalCachePort _cache;

  List<MealRecord> read() {
    final Object? raw = _cache.readJson(canteenMealStorageKey);
    if (raw is! List) return const <MealRecord>[];
    final List<MealRecord> records = <MealRecord>[];
    for (final Object? item in raw) {
      if (item is! Map) continue;
      try {
        records.add(
          MealRecord.fromJson(Map<String, Object?>.from(item)),
        );
      } on Object {
        // 单条损坏不影响其它记录：宁可少一条，也不要把整页打挂。
        continue;
      }
    }
    return records;
  }

  Future<void> write(List<MealRecord> records) => _cache.writeJson(
        canteenMealStorageKey,
        records
            .take(canteenMealStoreLimit)
            .map((MealRecord record) => record.toJson())
            .toList(growable: false),
      );

  Future<void> clear() => _cache.remove(canteenMealStorageKey);
}
