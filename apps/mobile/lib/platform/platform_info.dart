import 'package:flutter/foundation.dart';

/// 可达鸭支持的平台（冻结契约 §1：iOS / Android / 鸿蒙 + 桌面开发用）。
enum KedaYaPlatform {
  ios('iOS'),
  android('Android'),
  harmony('HarmonyOS'),
  web('Web'),
  macos('macOS'),
  windows('Windows'),
  linux('Linux'),
  unknown('未知平台');

  const KedaYaPlatform(this.label);

  final String label;

  bool get isMobile =>
      this == KedaYaPlatform.ios ||
      this == KedaYaPlatform.android ||
      this == KedaYaPlatform.harmony;
}

/// 平台探测（契约 §7：`platform/` 承载平台差异）。
///
/// 刻意用 `TargetPlatform.name` 字符串比较而不是 `switch (defaultTargetPlatform)`：
/// 鸿蒙的 Flutter 分支（OHOS fork）给 `TargetPlatform` 增加了 `ohos` 成员，
/// 对枚举做穷尽 switch 会在那个分支上编译失败。
abstract final class PlatformInfo {
  const PlatformInfo._();

  static KedaYaPlatform get current {
    if (kIsWeb) return KedaYaPlatform.web;
    return switch (defaultTargetPlatform.name) {
      'iOS' => KedaYaPlatform.ios,
      'android' => KedaYaPlatform.android,
      'macOS' => KedaYaPlatform.macos,
      'windows' => KedaYaPlatform.windows,
      'linux' => KedaYaPlatform.linux,
      // 仅 OHOS fork 会上报 'ohos'；上游 Flutter 不会出现该值。
      'ohos' => KedaYaPlatform.harmony,
      _ => KedaYaPlatform.unknown,
    };
  }

  /// 是否运行在鸿蒙的 Flutter 分支上（用于提示"需要 OHOS fork"）。
  static bool get isHarmonyFork => defaultTargetPlatform.name == 'ohos';
}
