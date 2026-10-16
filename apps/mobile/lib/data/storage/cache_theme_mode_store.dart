import 'dart:async';

import '../../domain/models/theme_mode.dart';
import '../../domain/ports/local_cache_port.dart';
import '../../domain/ports/theme_mode_port.dart';

/// [ThemeModePort] 的本地缓存实现。
///
/// 复用已有的 [LocalCachePort]（`PreferencesCacheStore` / `InMemoryCacheStore`），
/// 不新增任何存储依赖，也不碰安全存储（主题不是敏感数据）。
final class CacheThemeModeStore implements ThemeModePort {
  CacheThemeModeStore(this._cache);

  /// 缓存键（在 `PreferencesCacheStore` 里会再加 `kedaya.cache.` 命名空间）。
  static const String cacheKey = 'ui.themeMode';

  final LocalCachePort _cache;
  final StreamController<KedaYaThemeMode> _changes =
      StreamController<KedaYaThemeMode>.broadcast();

  KedaYaThemeMode _mode = KedaYaThemeMode.system;

  @override
  KedaYaThemeMode get current => _mode;

  @override
  Stream<KedaYaThemeMode> get changes => _changes.stream;

  @override
  KedaYaThemeMode hydrateFromCache() {
    final Object? raw = _cache.readJson(cacheKey);
    // 只接受字符串；损坏或旧格式一律回落"跟随系统"，绝不让启动失败。
    _mode = raw is String ? KedaYaThemeMode.fromWire(raw) : KedaYaThemeMode.system;
    return _mode;
  }

  @override
  Future<void> setMode(KedaYaThemeMode mode) async {
    _mode = mode;
    await _cache.writeJson(cacheKey, mode.wire);
    if (!_changes.isClosed) _changes.add(mode);
  }

  /// 释放流（`AppRuntime.dispose()` 调用）。
  Future<void> dispose() => _changes.close();
}
