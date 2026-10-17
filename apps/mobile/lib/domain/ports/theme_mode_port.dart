import '../models/theme_mode.dart';

/// 主题模式持久化端口。
///
/// 契约 §8：主题必须在**启动时同步 hydrate**（只读本地缓存、禁止网络），
/// 否则首帧会用错主题、再闪一下才切到用户的选择。
abstract interface class ThemeModePort {
  /// 当前模式；未 hydrate 前是 [KedaYaThemeMode.system]。
  KedaYaThemeMode get current;

  /// 模式变化流。
  Stream<KedaYaThemeMode> get changes;

  /// 契约 §8 第 1 步：只读本地缓存，**禁止网络**。
  KedaYaThemeMode hydrateFromCache();

  /// 切换并持久化。
  Future<void> setMode(KedaYaThemeMode mode);
}
