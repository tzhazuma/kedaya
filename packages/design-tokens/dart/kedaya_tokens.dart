// 由 packages/design-tokens/scripts/generate.mjs 生成 —— 请勿手改。
// 真相来源: packages/design-tokens/tokens.json

import 'package:flutter/widgets.dart';

/// 可达鸭设计令牌（Flutter）。
///
/// 所有颜色/间距/圆角/字号必须从这里取，禁止在 widget 里硬编码。
///
/// 暗色模式：用 [KedaYaTokens.darkColors] 覆盖 [colorXxx] 常量。
abstract final class KedaYaTokens {
  const KedaYaTokens._();

  // ---------------- 亮色（默认） ----------------
  static const Color colorBrand = Color(0xFFFFC53D);
  static const Color colorBrandStrong = Color(0xFFF08F2A);
  static const Color colorBrandSoft = Color(0xFFFFF3B8);
  static const Color colorInk = Color(0xFF1B2436);
  static const Color colorInkSoft = Color(0xFF33405A);
  static const Color colorBg = Color(0xFFF7F8FA);
  static const Color colorSurface = Color(0xFFFFFFFF);
  static const Color colorSurfaceAlt = Color(0xFFF1F3F7);
  static const Color colorText = Color(0xFF1F2733);
  static const Color colorTextMuted = Color(0xFF6B7A90);
  static const Color colorTextInverse = Color(0xFFFFFFFF);
  static const Color colorBorder = Color(0xFFE3E8EF);
  static const Color colorSuccess = Color(0xFF22A06B);
  static const Color colorWarning = Color(0xFFE8833A);
  static const Color colorDanger = Color(0xFFD64545);
  static const Color colorInfo = Color(0xFF3B82F6);

  // ---------------- 暗色 ----------------
  static const Color colorDarkBrand = Color(0xFFFFD666);
  static const Color colorDarkBrandStrong = Color(0xFFFFC53D);
  static const Color colorDarkBrandSoft = Color(0xFF3A2F12);
  static const Color colorDarkInk = Color(0xFF0B1220);
  static const Color colorDarkInkSoft = Color(0xFF1B2436);
  static const Color colorDarkBg = Color(0xFF0B1220);
  static const Color colorDarkSurface = Color(0xFF151C28);
  static const Color colorDarkSurfaceAlt = Color(0xFF1E2734);
  static const Color colorDarkText = Color(0xFFE8EEF7);
  static const Color colorDarkTextMuted = Color(0xFF93A3B8);
  static const Color colorDarkTextInverse = Color(0xFF0B1220);
  static const Color colorDarkBorder = Color(0xFF2A3444);
  static const Color colorDarkSuccess = Color(0xFF3DD68C);
  static const Color colorDarkWarning = Color(0xFFF0A05A);
  static const Color colorDarkDanger = Color(0xFFF07171);
  static const Color colorDarkInfo = Color(0xFF60A5FA);

  /// 暗色覆盖表：key 为亮色常量名后缀，value 为暗色值。
  /// 例: darkColors['brand'] == colorDarkBrand
  static const Map<String, Color> darkColors = <String, Color>{
    'brand': Color(0xFFFFD666),
    'brandStrong': Color(0xFFFFC53D),
    'brandSoft': Color(0xFF3A2F12),
    'ink': Color(0xFF0B1220),
    'inkSoft': Color(0xFF1B2436),
    'bg': Color(0xFF0B1220),
    'surface': Color(0xFF151C28),
    'surfaceAlt': Color(0xFF1E2734),
    'text': Color(0xFFE8EEF7),
    'textMuted': Color(0xFF93A3B8),
    'textInverse': Color(0xFF0B1220),
    'border': Color(0xFF2A3444),
    'success': Color(0xFF3DD68C),
    'warning': Color(0xFFF0A05A),
    'danger': Color(0xFFF07171),
    'info': Color(0xFF60A5FA),
  };

  /// 按亮/暗取色。
  static Color resolveColor(String key, {required bool isDark}) {
    if (isDark) {
      final dark = darkColors[key];
      if (dark != null) return dark;
    }
    return _lightColors[key] ?? colorInk;
  }

  static const Map<String, Color> _lightColors = <String, Color>{
    'brand': Color(0xFFFFC53D),
    'brandStrong': Color(0xFFF08F2A),
    'brandSoft': Color(0xFFFFF3B8),
    'ink': Color(0xFF1B2436),
    'inkSoft': Color(0xFF33405A),
    'bg': Color(0xFFF7F8FA),
    'surface': Color(0xFFFFFFFF),
    'surfaceAlt': Color(0xFFF1F3F7),
    'text': Color(0xFF1F2733),
    'textMuted': Color(0xFF6B7A90),
    'textInverse': Color(0xFFFFFFFF),
    'border': Color(0xFFE3E8EF),
    'success': Color(0xFF22A06B),
    'warning': Color(0xFFE8833A),
    'danger': Color(0xFFD64545),
    'info': Color(0xFF3B82F6),
  };

  // space
  static const double space0 = 0;
  static const double space1 = 4;
  static const double space2 = 8;
  static const double space3 = 12;
  static const double space4 = 16;
  static const double space5 = 20;
  static const double space6 = 24;
  static const double space8 = 32;
  static const double space10 = 40;
  static const double space12 = 48;
  static const double space16 = 64;

  // radius
  static const double radiusSm = 4;
  static const double radiusMd = 8;
  static const double radiusLg = 12;
  static const double radiusXl = 16;
  static const double radiusPill = 999;

  // fontSize
  static const double fontSizeXs = 12;
  static const double fontSizeSm = 14;
  static const double fontSizeMd = 16;
  static const double fontSizeLg = 18;
  static const double fontSizeXl = 20;
  static const double fontSizeXxl = 24;
  static const double fontSizeDisplay = 32;

  // lineHeight (无单位倍数)
  static const double lineHeightTight = 1.25;
  static const double lineHeightNormal = 1.5;
  static const double lineHeightLoose = 1.75;

  // fontWeight
  static const FontWeight fontWeightRegular = FontWeight.w400;
  static const FontWeight fontWeightMedium = FontWeight.w500;
  static const FontWeight fontWeightSemibold = FontWeight.w600;
  static const FontWeight fontWeightBold = FontWeight.w700;

  // shadow
  static const String shadowSm = '0 1px 2px rgba(27,36,54,0.06)';
  static const String shadowMd = '0 4px 12px rgba(27,36,54,0.08)';
  static const String shadowLg = '0 12px 32px rgba(27,36,54,0.12)';

  // fontFamily
  static const String fontFamilySans = 'PingFang SC';
  static const String fontFamilyMono = 'SFMono-Regular';

  // zIndex
  static const int zIndexBase = 0;
  static const int zIndexDropdown = 1000;
  static const int zIndexSticky = 1100;
  static const int zIndexOverlay = 1200;
  static const int zIndexModal = 1300;
  static const int zIndexToast = 1400;
}
