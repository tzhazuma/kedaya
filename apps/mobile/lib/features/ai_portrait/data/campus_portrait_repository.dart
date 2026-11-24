import '../../../domain/models/campus_portrait.dart';
import '../../../domain/ports/local_cache_port.dart';

/// 本机画像的缓存键。
const String campusPortraitStorageKey = 'aiPortrait.current.v1';

/// 本机画像仓库（**只读**）。
///
/// 没有 `save` / `generate` / `infer`：客户端只能读取已有画像或删除它，
/// 不能根据行为在本地拼一份画像出来。
abstract interface class CampusPortraitRepository {
  CampusPortrait? load();

  Future<void> clear();
}

/// 基于 [LocalCachePort] 的本机实现。
final class LocalCampusPortraitRepository implements CampusPortraitRepository {
  const LocalCampusPortraitRepository(this._cache);

  final LocalCachePort _cache;

  @override
  CampusPortrait? load() {
    final Object? raw = _cache.readJson(campusPortraitStorageKey);
    if (raw is! Map) return null;
    try {
      return CampusPortrait.fromJson(Map<String, Object?>.from(raw));
    } on Object {
      // 损坏的画像按「没有画像」处理：页面给空态，不编造标签。
      return null;
    }
  }

  @override
  Future<void> clear() => _cache.remove(campusPortraitStorageKey);
}
