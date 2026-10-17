import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/application/theme_controller.dart';
import 'package:kedaya/data/mock/in_memory_stores.dart';
import 'package:kedaya/data/storage/cache_theme_mode_store.dart';
import 'package:kedaya/domain/models/theme_mode.dart';

/// 主题模式控制器的装配行为：初值来自同步 hydrate，切换会落盘并广播。
void main() {
  ProviderContainer containerWith(CacheThemeModeStore store) {
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[themeModeProvider.overrideWithValue(store)],
    );
    addTearDown(container.dispose);
    return container;
  }

  test('初值来自同步 hydrate 的结果（契约 §8 第 1 步）', () async {
    final InMemoryCacheStore cache = InMemoryCacheStore();
    final CacheThemeModeStore seed = CacheThemeModeStore(cache);
    await seed.setMode(KedaYaThemeMode.dark);

    // 模拟 bootstrap：runApp 之前 hydrate。
    final CacheThemeModeStore store = CacheThemeModeStore(cache);
    expect(store.hydrateFromCache(), KedaYaThemeMode.dark);

    final ProviderContainer container = containerWith(store);
    expect(container.read(themeModeControllerProvider), KedaYaThemeMode.dark);
  });

  test('默认（无缓存）是跟随系统', () {
    final ProviderContainer container = containerWith(
      CacheThemeModeStore(InMemoryCacheStore())..hydrateFromCache(),
    );
    expect(container.read(themeModeControllerProvider), KedaYaThemeMode.system);
  });

  test('setMode 更新状态、落盘，并推给订阅者', () async {
    final InMemoryCacheStore cache = InMemoryCacheStore();
    final CacheThemeModeStore store = CacheThemeModeStore(cache)..hydrateFromCache();
    final ProviderContainer container = containerWith(store);
    expect(container.read(themeModeControllerProvider), KedaYaThemeMode.system);

    await container
        .read(themeModeControllerProvider.notifier)
        .setMode(KedaYaThemeMode.light);

    expect(container.read(themeModeControllerProvider), KedaYaThemeMode.light);
    expect(store.current, KedaYaThemeMode.light);
    expect(cache.readJson(CacheThemeModeStore.cacheKey), 'light');
  });

  test('外部写入（流）会同步到控制器状态', () async {
    final CacheThemeModeStore store = CacheThemeModeStore(InMemoryCacheStore())
      ..hydrateFromCache();
    final ProviderContainer container = containerWith(store);
    expect(container.read(themeModeControllerProvider), KedaYaThemeMode.system);

    await store.setMode(KedaYaThemeMode.dark);
    await Future<void>.delayed(Duration.zero);

    expect(container.read(themeModeControllerProvider), KedaYaThemeMode.dark);
  });
}
