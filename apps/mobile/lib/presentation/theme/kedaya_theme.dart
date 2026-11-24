import 'package:flutter/material.dart';

import '../../domain/models/theme_mode.dart';
import 'kedaya_theme_extension.dart';
import 'kedaya_tokens.dart';

/// 可达鸭主题（冻结契约 §6.2 / §11.5）。
///
/// `light()` 与 `dark()` **共用同一个 [_build]**，只换 [KedaYaColors] 调色板 ——
/// 因此两个主题的结构不可能漂移，将来加组件样式也只需改一处。
abstract final class KedaYaTheme {
  const KedaYaTheme._();

  static const double minTouchTarget = 48;

  /// 亮色主题（默认）。
  static ThemeData light() =>
      _build(KedaYaColors.modernLight, Brightness.light);

  /// 暗色主题（契约 §11.5）。
  static ThemeData dark() =>
      _build(KedaYaColors.modernDark, Brightness.dark);

  static ThemeData _build(KedaYaColors palette, Brightness brightness) {
    final ColorScheme scheme = ColorScheme.fromSeed(
      seedColor: palette.brand,
      brightness: brightness,
    ).copyWith(
      primary: palette.brand,
      onPrimary: palette.ink,
      secondary: palette.brandStrong,
      onSecondary: palette.textInverse,
      surface: palette.surface,
      onSurface: palette.text,
      error: palette.danger,
      onError: palette.textInverse,
      outline: palette.border,
    );

    final ThemeData base = ThemeData(colorScheme: scheme, useMaterial3: true);

    return base.copyWith(
      scaffoldBackgroundColor: palette.bg,
      extensions: <ThemeExtension<dynamic>>[palette],
      textTheme: base.textTheme.apply(
        fontFamily: KedaYaTokens.fontFamilySans,
        bodyColor: palette.text,
        displayColor: palette.text,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: palette.surface,
        foregroundColor: palette.text,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: KedaYaTokens.fontFamilySans,
          fontSize: 17,
          fontWeight: KedaYaTokens.fontWeightSemibold,
          color: palette.text,
        ),
      ),
      cardTheme: CardThemeData(
        color: palette.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: palette.border),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: palette.border,
        thickness: 0.5,
        space: 0.5,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: palette.brand,
          foregroundColor: palette.ink,
          minimumSize: const Size(minTouchTarget, minTouchTarget),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: palette.text,
          minimumSize: const Size(minTouchTarget, minTouchTarget),
          side: BorderSide(color: palette.border),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
          ),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: palette.surface,
        indicatorColor: palette.brandSoft,
        labelTextStyle: WidgetStateProperty.resolveWith<TextStyle>(
          (Set<WidgetState> states) => TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            fontWeight: states.contains(WidgetState.selected)
                ? KedaYaTokens.fontWeightSemibold
                : KedaYaTokens.fontWeightRegular,
            color: palette.text,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith<IconThemeData>(
          (Set<WidgetState> states) => IconThemeData(
            color: states.contains(WidgetState.selected)
                ? palette.brand
                : palette.textMuted,
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: palette.surfaceAlt,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: KedaYaTokens.space4,
          vertical: KedaYaTokens.space3,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: palette.brand, width: 1.5),
        ),
        hintStyle: TextStyle(color: palette.textMuted),
      ),
      chipTheme: base.chipTheme.copyWith(
        backgroundColor: palette.surface,
        side: BorderSide(color: palette.border),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
        ),
        labelStyle: TextStyle(
          fontSize: KedaYaTokens.fontSizeSm,
          color: palette.text,
        ),
      ),
      listTileTheme: ListTileThemeData(
        iconColor: palette.textMuted,
        textColor: palette.text,
        minVerticalPadding: KedaYaTokens.space2,
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: palette.brandStrong,
        linearTrackColor: palette.surfaceAlt,
      ),
    );
  }
}

/// domain 的 [KedaYaThemeMode] -> Flutter 的 [ThemeMode]。
///
/// 这是全项目**唯一**一处模式转换；`MaterialApp.themeMode` 与测试都用它。
ThemeMode themeModeOf(KedaYaThemeMode mode) => switch (mode) {
      KedaYaThemeMode.system => ThemeMode.system,
      KedaYaThemeMode.light => ThemeMode.light,
      KedaYaThemeMode.dark => ThemeMode.dark,
    };
