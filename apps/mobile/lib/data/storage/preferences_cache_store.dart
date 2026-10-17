import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../../domain/ports/local_cache_port.dart';

/// [LocalCachePort] 的 SharedPreferences 实现。
///
/// [readJson] 是**同步**的：`SharedPreferences` 在 `getInstance()` 时已把全部键
/// 读进内存，因此契约 §8 第 1 步的 hydrate 可以零网络、零 await 完成。
final class PreferencesCacheStore implements LocalCachePort {
  PreferencesCacheStore(this._prefs);

  final SharedPreferences _prefs;

  /// 命名空间，保证 [clear] 只清自己的键。
  static const String namespace = 'kedaya.cache.';

  @override
  Object? readJson(String key) {
    final String? raw = _prefs.getString('$namespace$key');
    if (raw == null || raw.isEmpty) return null;
    try {
      return jsonDecode(raw);
    } on FormatException {
      // 缓存损坏一律当作"没有缓存"，不能阻塞启动。
      return null;
    }
  }

  @override
  Future<void> writeJson(String key, Object? value) async {
    if (value == null) {
      await _prefs.remove('$namespace$key');
      return;
    }
    await _prefs.setString('$namespace$key', jsonEncode(value));
  }

  @override
  Future<void> remove(String key) => _prefs.remove('$namespace$key');

  @override
  Future<void> clear() async {
    final List<String> owned = _prefs
        .getKeys()
        .where((String key) => key.startsWith(namespace))
        .toList(growable: false);
    for (final String key in owned) {
      await _prefs.remove(key);
    }
  }
}
