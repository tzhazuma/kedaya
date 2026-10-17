import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/theme_mode.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';
import 'package:kedaya/presentation/theme/kedaya_theme_extension.dart';
import 'package:kedaya/presentation/theme/kedaya_tokens.dart';

/// 契约 §11.5（暗色模式）的守门测试。
///
/// 核心目的：**亮暗两套不可能漂移**。
/// `KedaYaColors` 的字段清单只写一次，暗色必须逐键命中生成物的 `darkColors`；
/// 生成器新增暗色令牌时，下面的交叉校验会失败，逼着 Dart 侧同步补字段。
void main() {
  /// 冻结的 16 个颜色令牌键（与 `packages/design-tokens/tokens.json` 对齐）。
  const Set<String> expectedKeys = <String>{
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
  };

  group('KedaYaColors 字段集合', () {
    test('亮暗字段集合完全一致，且等于冻结的 16 个键', () {
      final Set<String> lightKeys = KedaYaColors.light.toMap().keys.toSet();
      final Set<String> darkKeys = KedaYaColors.dark.toMap().keys.toSet();

      expect(lightKeys, expectedKeys, reason: '亮色字段清单变了：请同步 tokenKeys / toMap / 本测试');
      expect(darkKeys, lightKeys, reason: '暗色与亮色的字段集合必须一致');
      expect(KedaYaColors.tokenKeys.toSet(), expectedKeys);
    });

    test('生成物的 darkColors 键集合 == Dart 字段清单（生成器与客户端不会各自漂移）', () {
      expect(
        KedaYaTokens.darkColors.keys.toSet(),
        KedaYaColors.tokenKeys.toSet(),
        reason: 'tokens.json 的 colorDark 组与 Flutter 端的字段清单不一致 —— '
            '请跑 `npm run tokens` 后同步 KedaYaColors',
      );
    });
  });

  group('暗色取值', () {
    test('每个字段都真的来自 darkColors（防止字段与键错位）', () {
      final Map<String, Color> dark = KedaYaColors.dark.toMap();
      for (final String key in KedaYaColors.tokenKeys) {
        expect(
          dark[key],
          KedaYaTokens.darkColors[key],
          reason: 'dark.$key 没有取到 darkColors["$key"]',
        );
      }
    });

    test('具名暗色常量与覆盖表一致（契约 §11.5 明确点名的 4 个）', () {
      expect(KedaYaColors.dark.brand, KedaYaTokens.colorDarkBrand);
      expect(KedaYaColors.dark.surface, KedaYaTokens.colorDarkSurface);
      expect(KedaYaColors.dark.text, KedaYaTokens.colorDarkText);
      expect(KedaYaColors.dark.bg, KedaYaTokens.colorDarkBg);
    });

    test('亮色取值来自 resolveColor(isDark: false)，且与具名常量一致', () {
      final Map<String, Color> light = KedaYaColors.light.toMap();
      for (final String key in KedaYaColors.tokenKeys) {
        expect(light[key], KedaYaTokens.resolveColor(key, isDark: false));
      }
      expect(KedaYaColors.light.brand, KedaYaTokens.colorBrand);
      expect(KedaYaColors.light.surface, KedaYaTokens.colorSurface);
    });

    test('16 个键在暗色下都必须与亮色不同（暗色覆盖不能是复制粘贴）', () {
      final Map<String, Color> light = KedaYaColors.light.toMap();
      final Map<String, Color> dark = KedaYaColors.dark.toMap();
      for (final String key in KedaYaColors.tokenKeys) {
        expect(
          dark[key],
          isNot(light[key]),
          reason: 'darkColors["$key"] 与亮色相同 —— 暗色覆盖没有生效',
        );
      }
    });
  });

  group('resolveColor 分支', () {
    test('暗色分支命中 darkColors', () {
      expect(KedaYaTokens.resolveColor('brand', isDark: true), KedaYaTokens.colorDarkBrand);
      expect(
        KedaYaTokens.resolveColor('surface', isDark: true),
        KedaYaTokens.colorDarkSurface,
      );
      for (final String key in KedaYaColors.tokenKeys) {
        expect(KedaYaTokens.resolveColor(key, isDark: true), KedaYaTokens.darkColors[key]);
      }
    });

    test('亮色分支命中亮色常量', () {
      expect(KedaYaTokens.resolveColor('brand', isDark: false), KedaYaTokens.colorBrand);
      expect(KedaYaTokens.resolveColor('surface', isDark: false), KedaYaTokens.colorSurface);
      expect(KedaYaTokens.resolveColor('danger', isDark: false), KedaYaTokens.colorDanger);
    });

    test('未知键回落到 colorInk（暗色下也是），不抛异常', () {
      expect(KedaYaTokens.resolveColor('not-a-token', isDark: true), KedaYaTokens.colorInk);
      expect(KedaYaTokens.resolveColor('not-a-token', isDark: false), KedaYaTokens.colorInk);
    });
  });

  group('ThemeData 装配', () {
    test('light() 用亮色调色板', () {
      final ThemeData theme = KedaYaTheme.light();
      expect(theme.brightness, Brightness.light);
      expect(theme.scaffoldBackgroundColor, KedaYaTokens.colorBg);
      expect(theme.appBarTheme.backgroundColor, KedaYaTokens.colorSurface);
      expect(theme.cardTheme.color, KedaYaTokens.colorSurface);
      final KedaYaColors? palette = theme.extension<KedaYaColors>();
      expect(palette, isNotNull);
      expect(palette!.toMap(), KedaYaColors.light.toMap());
    });

    test('dark() 用暗色调色板（不是亮色的副本）', () {
      final ThemeData theme = KedaYaTheme.dark();
      expect(theme.brightness, Brightness.dark);
      expect(theme.scaffoldBackgroundColor, KedaYaTokens.colorDarkBg);
      expect(theme.appBarTheme.backgroundColor, KedaYaTokens.colorDarkSurface);
      expect(theme.cardTheme.color, KedaYaTokens.colorDarkSurface);
      expect(theme.dividerTheme.color, KedaYaTokens.colorDarkBorder);
      final KedaYaColors? palette = theme.extension<KedaYaColors>();
      expect(palette, isNotNull);
      expect(palette!.toMap(), KedaYaColors.dark.toMap());
      expect(palette.toMap(), isNot(KedaYaColors.light.toMap()));
    });

    test('亮暗两套的扩展类型相同（同结构，只换色值）', () {
      final KedaYaColors light = KedaYaTheme.light().extension<KedaYaColors>()!;
      final KedaYaColors dark = KedaYaTheme.dark().extension<KedaYaColors>()!;
      expect(light.runtimeType, dark.runtimeType);
      expect(light.toMap().keys.toSet(), dark.toMap().keys.toSet());
    });
  });

  group('themeModeOf 映射', () {
    test('domain 枚举 -> Flutter ThemeMode', () {
      expect(themeModeOf(KedaYaThemeMode.system), ThemeMode.system);
      expect(themeModeOf(KedaYaThemeMode.light), ThemeMode.light);
      expect(themeModeOf(KedaYaThemeMode.dark), ThemeMode.dark);
    });
  });
}
