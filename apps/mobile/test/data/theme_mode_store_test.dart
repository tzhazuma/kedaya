import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/in_memory_stores.dart';
import 'package:kedaya/data/storage/cache_theme_mode_store.dart';
import 'package:kedaya/domain/models/theme_mode.dart';

/// 主题模式持久化（契约 §11.5 + §8 第 1 步：同步 hydrate、禁止网络）。
void main() {
  test('未 hydrate 前是"跟随系统"', () {
    final CacheThemeModeStore store = CacheThemeModeStore(InMemoryCacheStore());
    expect(store.current, KedaYaThemeMode.system);
  });

  test('setMode 落盘，新实例能同步 hydrate 回来', () async {
    final InMemoryCacheStore cache = InMemoryCacheStore();
    final CacheThemeModeStore store = CacheThemeModeStore(cache);
    await store.setMode(KedaYaThemeMode.dark);
    expect(cache.readJson(CacheThemeModeStore.cacheKey), 'dark');

    final CacheThemeModeStore reopened = CacheThemeModeStore(cache);
    expect(reopened.current, KedaYaThemeMode.system, reason: 'hydrate 之前不应有值');
    expect(reopened.hydrateFromCache(), KedaYaThemeMode.dark);
    expect(reopened.current, KedaYaThemeMode.dark);
  });

  test('缓存损坏 / 未知取值回落到"跟随系统"，不抛异常', () async {
    final InMemoryCacheStore cache = InMemoryCacheStore();
    final CacheThemeModeStore store = CacheThemeModeStore(cache);

    await cache.writeJson(CacheThemeModeStore.cacheKey, 42);
    expect(store.hydrateFromCache(), KedaYaThemeMode.system);

    await cache.writeJson(CacheThemeModeStore.cacheKey, 'brand-new-mode');
    expect(store.hydrateFromCache(), KedaYaThemeMode.system);

    await cache.writeJson(CacheThemeModeStore.cacheKey, null);
    expect(store.hydrateFromCache(), KedaYaThemeMode.system);
  });

  test('changes 会推送新模式', () async {
    final CacheThemeModeStore store = CacheThemeModeStore(InMemoryCacheStore());
    final Future<KedaYaThemeMode> first = store.changes.first;
    // 等一拍，确保广播流的订阅已经建立。
    await Future<void>.delayed(Duration.zero);
    await store.setMode(KedaYaThemeMode.light);
    expect(await first, KedaYaThemeMode.light);
  });

  test('fromWire 对未知 / 缺失输入回落 system', () {
    expect(KedaYaThemeMode.fromWire('dark'), KedaYaThemeMode.dark);
    expect(KedaYaThemeMode.fromWire('light'), KedaYaThemeMode.light);
    expect(KedaYaThemeMode.fromWire('system'), KedaYaThemeMode.system);
    expect(KedaYaThemeMode.fromWire(null), KedaYaThemeMode.system);
    expect(KedaYaThemeMode.fromWire('nope'), KedaYaThemeMode.system);
  });
}
