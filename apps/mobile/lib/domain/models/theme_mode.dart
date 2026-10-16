/// 主题模式（冻结契约 §11.5 的暗色模式）。
///
/// 这是 **domain 自有枚举**：`domain` 层零框架依赖，因此不能直接用 Flutter 的
/// `ThemeMode`。映射发生在 `presentation/theme/kedaya_theme.dart` 的
/// `themeModeOf()`（唯一一处转换）。
enum KedaYaThemeMode {
  system('system', '跟随系统'),
  light('light', '浅色'),
  dark('dark', '深色');

  const KedaYaThemeMode(this.wire, this.label);

  /// 持久化用的稳定标识。
  ///
  /// **不要**用 `index` 落盘：枚举顺序一旦调整，旧数据就会被读成另一个模式。
  final String wire;

  /// 面向用户的中文名。
  final String label;

  /// 未知/缺失一律回落到 [system]（旧版本数据、手改缓存都不会让启动失败）。
  static KedaYaThemeMode fromWire(String? wire) {
    for (final KedaYaThemeMode mode in KedaYaThemeMode.values) {
      if (mode.wire == wire) return mode;
    }
    return KedaYaThemeMode.system;
  }
}
