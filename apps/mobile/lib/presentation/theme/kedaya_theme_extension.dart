import 'package:flutter/material.dart';

import 'kedaya_tokens.dart';

/// 品牌色在 `ThemeData` 里的载体（冻结契约 §6.2 / §11.5）。
///
/// 亮暗两套都从**生成的设计令牌**派生：
///   - 亮色：`KedaYaTokens.resolveColor(key, isDark: false)`；
///   - 暗色：`KedaYaTokens.darkColors` 覆盖表（契约 §11.5）。
///
/// 字段清单**只写一次**（[_fromTokens] 的初始化列表），因此亮暗两套在结构上
/// 不可能漂移；暗色缺键会直接抛错，而不是静默退回亮色。
@immutable
final class KedaYaColors extends ThemeExtension<KedaYaColors> {
  const KedaYaColors({
    required this.brand,
    required this.brandStrong,
    required this.brandSoft,
    required this.ink,
    required this.inkSoft,
    required this.bg,
    required this.surface,
    required this.surfaceAlt,
    required this.text,
    required this.textMuted,
    required this.textInverse,
    required this.border,
    required this.success,
    required this.warning,
    required this.danger,
    required this.info,
  });

  /// 亮色主题（默认）。
  static final KedaYaColors light = KedaYaColors._fromTokens(isDark: false);

  /// 暗色主题（契约 §11.5）。
  static final KedaYaColors dark = KedaYaColors._fromTokens(isDark: true);

  /// Flutter 端「现代」亮色（2026-11-24 视觉改版）。
  ///
  /// 只影响 `apps/mobile`：不改 `packages/design-tokens/tokens.json`，
  /// 因为小程序/Web 仍使用「校园贴纸簿」体系（根 AGENTS.md 要求两端独立）。
  /// 取色参考 TechPie 的分组表面 + iOS 系统色，品牌仍是可达鸭琥珀色。
  static const KedaYaColors modernLight = KedaYaColors(
    brand: Color(0xFFE8A33D),
    brandStrong: Color(0xFFC6821F),
    brandSoft: Color(0xFFFBEED6),
    ink: Color(0xFF171717),
    inkSoft: Color(0xFF3A3A3C),
    bg: Color(0xFFF2F2F7),
    surface: Color(0xFFFFFFFF),
    surfaceAlt: Color(0xFFF2F2F7),
    text: Color(0xFF171717),
    textMuted: Color(0xFF8E8E93),
    textInverse: Color(0xFFFFFFFF),
    border: Color(0xFFE5E5EA),
    success: Color(0xFF34C759),
    warning: Color(0xFFFF9F0A),
    danger: Color(0xFFFF3B30),
    info: Color(0xFF007AFF),
  );

  /// Flutter 端「现代」暗色（AMOLED 友好的中性黑）。
  static const KedaYaColors modernDark = KedaYaColors(
    brand: Color(0xFFF5C065),
    brandStrong: Color(0xFFE8A33D),
    brandSoft: Color(0xFF3A2F12),
    ink: Color(0xFF0A0A0A),
    inkSoft: Color(0xFF1C1C1E),
    bg: Color(0xFF0A0A0A),
    surface: Color(0xFF1C1C1E),
    surfaceAlt: Color(0xFF2C2C2E),
    text: Color(0xFFF2F2F7),
    textMuted: Color(0xFF8E8E93),
    textInverse: Color(0xFF0A0A0A),
    border: Color(0xFF38383A),
    success: Color(0xFF30D158),
    warning: Color(0xFFFF9F0A),
    danger: Color(0xFFFF453A),
    info: Color(0xFF0A84FF),
  );

  /// 令牌键名清单，亮暗共用。
  ///
  /// 必须与 `KedaYaTokens.darkColors` 的键集合一致 —— 由
  /// `test/presentation/kedaya_theme_test.dart` 交叉校验：生成器新增暗色令牌时，
  /// 这里必须同步补字段，否则测试失败。
  static const List<String> tokenKeys = <String>[
    'brand',
    'brandStrong',
    'brandSoft',
    'ink',
    'inkSoft',
    'bg',
    'surface',
    'surfaceAlt',
    'text',
    'textMuted',
    'textInverse',
    'border',
    'success',
    'warning',
    'danger',
    'info',
  ];

  KedaYaColors._fromTokens({required bool isDark})
      : brand = _resolve('brand', isDark: isDark),
        brandStrong = _resolve('brandStrong', isDark: isDark),
        brandSoft = _resolve('brandSoft', isDark: isDark),
        ink = _resolve('ink', isDark: isDark),
        inkSoft = _resolve('inkSoft', isDark: isDark),
        bg = _resolve('bg', isDark: isDark),
        surface = _resolve('surface', isDark: isDark),
        surfaceAlt = _resolve('surfaceAlt', isDark: isDark),
        text = _resolve('text', isDark: isDark),
        textMuted = _resolve('textMuted', isDark: isDark),
        textInverse = _resolve('textInverse', isDark: isDark),
        border = _resolve('border', isDark: isDark),
        success = _resolve('success', isDark: isDark),
        warning = _resolve('warning', isDark: isDark),
        danger = _resolve('danger', isDark: isDark),
        info = _resolve('info', isDark: isDark);

  /// 取令牌值。
  ///
  /// 暗色**必须**命中 `KedaYaTokens.darkColors`；缺键直接抛 [StateError]。
  /// 静默退回亮色会让"暗色主题里出现白底黑字"这类 bug 极难定位。
  static Color _resolve(String key, {required bool isDark}) {
    if (!isDark) {
      return KedaYaTokens.resolveColor(key, isDark: false);
    }
    final Color? value = KedaYaTokens.darkColors[key];
    if (value == null) {
      throw StateError(
        'KedaYaTokens.darkColors 缺少 "$key" —— 契约 §11.5 的暗色覆盖表不完整',
      );
    }
    return value;
  }

  final Color brand;
  final Color brandStrong;
  final Color brandSoft;
  final Color ink;
  final Color inkSoft;
  final Color bg;
  final Color surface;
  final Color surfaceAlt;
  final Color text;
  final Color textMuted;
  final Color textInverse;
  final Color border;
  final Color success;
  final Color warning;
  final Color danger;
  final Color info;

  /// 字段名 -> 色值。测试用它比对亮暗字段集合，调试时也便于打印。
  Map<String, Color> toMap() => <String, Color>{
        'brand': brand,
        'brandStrong': brandStrong,
        'brandSoft': brandSoft,
        'ink': ink,
        'inkSoft': inkSoft,
        'bg': bg,
        'surface': surface,
        'surfaceAlt': surfaceAlt,
        'text': text,
        'textMuted': textMuted,
        'textInverse': textInverse,
        'border': border,
        'success': success,
        'warning': warning,
        'danger': danger,
        'info': info,
      };

  @override
  KedaYaColors copyWith({
    Color? brand,
    Color? brandStrong,
    Color? brandSoft,
    Color? ink,
    Color? inkSoft,
    Color? bg,
    Color? surface,
    Color? surfaceAlt,
    Color? text,
    Color? textMuted,
    Color? textInverse,
    Color? border,
    Color? success,
    Color? warning,
    Color? danger,
    Color? info,
  }) =>
      KedaYaColors(
        brand: brand ?? this.brand,
        brandStrong: brandStrong ?? this.brandStrong,
        brandSoft: brandSoft ?? this.brandSoft,
        ink: ink ?? this.ink,
        inkSoft: inkSoft ?? this.inkSoft,
        bg: bg ?? this.bg,
        surface: surface ?? this.surface,
        surfaceAlt: surfaceAlt ?? this.surfaceAlt,
        text: text ?? this.text,
        textMuted: textMuted ?? this.textMuted,
        textInverse: textInverse ?? this.textInverse,
        border: border ?? this.border,
        success: success ?? this.success,
        warning: warning ?? this.warning,
        danger: danger ?? this.danger,
        info: info ?? this.info,
      );

  @override
  KedaYaColors lerp(covariant KedaYaColors? other, double t) {
    if (other == null) return this;
    return KedaYaColors(
      brand: Color.lerp(brand, other.brand, t) ?? brand,
      brandStrong: Color.lerp(brandStrong, other.brandStrong, t) ?? brandStrong,
      brandSoft: Color.lerp(brandSoft, other.brandSoft, t) ?? brandSoft,
      ink: Color.lerp(ink, other.ink, t) ?? ink,
      inkSoft: Color.lerp(inkSoft, other.inkSoft, t) ?? inkSoft,
      bg: Color.lerp(bg, other.bg, t) ?? bg,
      surface: Color.lerp(surface, other.surface, t) ?? surface,
      surfaceAlt: Color.lerp(surfaceAlt, other.surfaceAlt, t) ?? surfaceAlt,
      text: Color.lerp(text, other.text, t) ?? text,
      textMuted: Color.lerp(textMuted, other.textMuted, t) ?? textMuted,
      textInverse: Color.lerp(textInverse, other.textInverse, t) ?? textInverse,
      border: Color.lerp(border, other.border, t) ?? border,
      success: Color.lerp(success, other.success, t) ?? success,
      warning: Color.lerp(warning, other.warning, t) ?? warning,
      danger: Color.lerp(danger, other.danger, t) ?? danger,
      info: Color.lerp(info, other.info, t) ?? info,
    );
  }

  @override
  String toString() => 'KedaYaColors(surface=$surface, text=$text)';
}

/// 取品牌色扩展：`context.kedayaColors.brand`。
///
/// `MaterialApp` 一定注入了扩展；万一没有（例如在测试里裸跑 widget），
/// 回落到亮色而不是抛错。
extension KedaYaColorsContext on BuildContext {
  KedaYaColors get kedayaColors =>
      Theme.of(this).extension<KedaYaColors>() ?? KedaYaColors.light;
}
