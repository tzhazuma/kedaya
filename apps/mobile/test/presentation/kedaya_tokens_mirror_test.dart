import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/presentation/theme/kedaya_tokens.dart';

/// 防漂移：`packages/design-tokens/tokens.json`（唯一真相）与其 Dart 生成物。
///
/// 逐组、逐键比较值；不是只数个数。色值按 `#RRGGBB` 解析后再比较，
/// 因此「手改生成物里的某一位十六进制」也会被抓住。
void main() {
  final Map<String, Object?> tokens = jsonDecode(
    File('../../packages/design-tokens/tokens.json').readAsStringSync(),
  ) as Map<String, Object?>;

  Map<String, Object?> group(String name) =>
      tokens[name]! as Map<String, Object?>;

  Color colorOf(Object? hex) {
    final int value =
        int.parse(hex.toString().replaceFirst('#', ''), radix: 16);
    return Color(0xFF000000 | value);
  }

  test('亮色：16 个 color 令牌逐键一致', () {
    final Map<String, Object?> expected = group('color');
    expect(expected, hasLength(16));
    for (final MapEntry<String, Object?> entry in expected.entries) {
      expect(
        KedaYaTokens.resolveColor(entry.key, isDark: false),
        colorOf(entry.value),
        reason: 'color.${entry.key}',
      );
    }
  });

  test('暗色：16 个 colorDark 令牌逐键一致，且覆盖表无缺项/多项', () {
    final Map<String, Object?> expected = group('colorDark');
    expect(expected, hasLength(16));
    expect(KedaYaTokens.darkColors.keys.toSet(), expected.keys.toSet());
    for (final MapEntry<String, Object?> entry in expected.entries) {
      expect(
        KedaYaTokens.darkColors[entry.key],
        colorOf(entry.value),
        reason: 'colorDark.${entry.key}',
      );
      expect(
        KedaYaTokens.resolveColor(entry.key, isDark: true),
        colorOf(entry.value),
      );
    }
  });

  test('space / radius / fontSize / lineHeight 逐键一致', () {
    final Map<String, double> space = <String, double>{
      '0': KedaYaTokens.space0,
      '1': KedaYaTokens.space1,
      '2': KedaYaTokens.space2,
      '3': KedaYaTokens.space3,
      '4': KedaYaTokens.space4,
      '5': KedaYaTokens.space5,
      '6': KedaYaTokens.space6,
      '8': KedaYaTokens.space8,
      '10': KedaYaTokens.space10,
      '12': KedaYaTokens.space12,
      '16': KedaYaTokens.space16,
    };
    final Map<String, double> radius = <String, double>{
      'sm': KedaYaTokens.radiusSm,
      'md': KedaYaTokens.radiusMd,
      'lg': KedaYaTokens.radiusLg,
      'xl': KedaYaTokens.radiusXl,
      'pill': KedaYaTokens.radiusPill,
    };
    final Map<String, double> fontSize = <String, double>{
      'xs': KedaYaTokens.fontSizeXs,
      'sm': KedaYaTokens.fontSizeSm,
      'md': KedaYaTokens.fontSizeMd,
      'lg': KedaYaTokens.fontSizeLg,
      'xl': KedaYaTokens.fontSizeXl,
      'xxl': KedaYaTokens.fontSizeXxl,
      'display': KedaYaTokens.fontSizeDisplay,
    };
    final Map<String, double> lineHeight = <String, double>{
      'tight': KedaYaTokens.lineHeightTight,
      'normal': KedaYaTokens.lineHeightNormal,
      'loose': KedaYaTokens.lineHeightLoose,
    };
    for (final MapEntry<String, Map<String, double>> entry
        in <String, Map<String, double>>{
      'space': space,
      'radius': radius,
      'fontSize': fontSize,
      'lineHeight': lineHeight,
    }.entries) {
      final Map<String, Object?> expected = group(entry.key);
      expect(entry.value.keys.toSet(), expected.keys.toSet(),
          reason: entry.key);
      for (final MapEntry<String, Object?> token in expected.entries) {
        expect(
          entry.value[token.key],
          (token.value! as num).toDouble(),
          reason: '${entry.key}.${token.key}',
        );
      }
    }
  });

  test('fontWeight / shadow / fontFamily / zIndex 逐键一致', () {
    final Map<String, FontWeight> weight = <String, FontWeight>{
      'regular': KedaYaTokens.fontWeightRegular,
      'medium': KedaYaTokens.fontWeightMedium,
      'semibold': KedaYaTokens.fontWeightSemibold,
      'bold': KedaYaTokens.fontWeightBold,
    };
    for (final MapEntry<String, Object?> entry in group('fontWeight').entries) {
      expect(weight[entry.key],
          FontWeight.values[(entry.value! as int) ~/ 100 - 1]);
    }

    final Map<String, String> shadow = <String, String>{
      'sm': KedaYaTokens.shadowSm,
      'md': KedaYaTokens.shadowMd,
      'lg': KedaYaTokens.shadowLg,
    };
    for (final MapEntry<String, Object?> entry in group('shadow').entries) {
      expect(shadow[entry.key], entry.value);
    }

    // Flutter 的 fontFamily 只接受单个 family，取 tokens.json 字体栈的首项。
    expect(
      KedaYaTokens.fontFamilySans,
      (group('fontFamily')['sans']! as String).split(',').first.trim(),
    );
    expect(
      KedaYaTokens.fontFamilyMono,
      (group('fontFamily')['mono']! as String).split(',').first.trim(),
    );

    final Map<String, int> zIndex = <String, int>{
      'base': KedaYaTokens.zIndexBase,
      'dropdown': KedaYaTokens.zIndexDropdown,
      'sticky': KedaYaTokens.zIndexSticky,
      'overlay': KedaYaTokens.zIndexOverlay,
      'modal': KedaYaTokens.zIndexModal,
      'toast': KedaYaTokens.zIndexToast,
    };
    for (final MapEntry<String, Object?> entry in group('zIndex').entries) {
      expect(zIndex[entry.key], entry.value);
    }
  });

  test('生成文件头记录了正确的 source blob hash', () {
    final String generated = File(
      'lib/presentation/theme/kedaya_tokens.dart',
    ).readAsStringSync();
    expect(generated, contains('DO NOT EDIT'));
    expect(generated, contains('source-blob-sha1: '));

    final ProcessResult result = Process.runSync(
        'git',
        <String>[
          'hash-object',
          'packages/design-tokens/tokens.json',
        ],
        workingDirectory: '../..');
    if (result.exitCode != 0) return; // 无 git 的环境由脚本 --check 负责
    final String hash = (result.stdout as String).trim();
    expect(generated, contains('source-blob-sha1: $hash'));
  });
}
