import 'package:flutter_test/flutter_test.dart';

import '../support/source_scan.dart';

/// **源码机械扫描**（替代无法在本机运行的 `dart analyze` 与集成测试）。
///
/// 规格 §10.3 与契约 §11.18-D/G 的几条硬要求，本质上是"某些代码**不许存在**"。
/// 只要允许它存在，就迟早会被"顺手加上"。因此这里对 techpie 的全部新增源码做扫描：
///
///   - 不许有 cookie 注入（ADR §4-D 否决的路径）；
///   - 不许有把凭据写进日志的调用（规格 §10.3）；
///   - 不许有任何凭据/票据落盘（本模块零持久化）；
///   - 不许出现 CASTGC / 会话密文（契约 §11.18-D：不实现任何落库路径）；
///   - 不许实现 Phase 1–3 的端点或自动续期（本轮范围只有 Phase 0）。
///
/// 扫描**先去掉注释**：文档里为了解释"为什么不这么做"必然会提到这些词，
/// 那些提及不是代码。
void main() {
  /// 本模块新增/改动的全部 Dart 源文件。
  List<String> techpieSources() => <String>[
        ...dartSourcesUnder('lib/features/techpie'),
        'lib/domain/models/techpie_link.dart',
        'lib/domain/models/campus_capability.dart',
        'lib/domain/models/campus_web_entry.dart',
        'lib/domain/models/bind_credential.dart',
        'lib/domain/models/campus_card.dart',
        'lib/domain/ports/techpie_port.dart',
        'lib/domain/ports/campus_card_port.dart',
        'lib/domain/ports/webview_port.dart',
        'lib/data/repositories/remote_techpie_repository.dart',
        'lib/data/repositories/remote_campus_card_repository.dart',
        'lib/data/mock/techpie_fixtures.dart',
        'lib/data/mock/mock_techpie_repository.dart',
        'lib/data/mock/mock_campus_card_repository.dart',
        'lib/data/mock/mock_webview_port.dart',
        'lib/platform/method_channel_webview.dart',
      ];

  group('扫描前提', () {
    test('被扫描的文件都存在且非空（否则扫描会静默通过）', () {
      final List<String> files = techpieSources();
      expect(files.length, greaterThanOrEqualTo(20));
      for (final String file in files) {
        final String source = readSource(file);
        expect(source.trim(), isNotEmpty, reason: '$file 是空的');
      }
    });
  });

  group('不存在 cookie 注入', () {
    test('源码里没有 cookie / setCookie / WebViewController 之类的东西', () {
      for (final String file in techpieSources()) {
        final String code = stripComments(readSource(file)).toLowerCase();
        for (final String token in <String>[
          'cookie',
          'setcookie',
          'webviewcontroller',
          'document.cookie',
          'requestheader',
          'httpheaders',
        ]) {
          expect(
            code.contains(token),
            isFalse,
            reason: '$file 出现了 "$token" —— ADR §4-D 否决的客户端注入路径不许存在',
          );
        }
      }
    });

    test('WebViewPort 只接受一个 URL（类型上就装不下 cookie / 请求头）', () {
      final String code = stripComments(
        readSource('lib/domain/ports/webview_port.dart'),
      );
      expect(code.contains('openOneTimeUrl(String url)'), isTrue);
      expect(code.contains('Map<String, String>'), isFalse);
      expect(code.contains('headers'), isFalse);
    });
  });

  group('不存在把凭据写进日志的调用', () {
    test('techpie 源码里没有任何日志调用', () {
      for (final String file in techpieSources()) {
        final String code = stripComments(readSource(file));
        for (final String token in <String>[
          'print(',
          'debugPrint(',
          'developer.log(',
          'stderr.',
          'stdout.',
        ]) {
          expect(
            code.contains(token),
            isFalse,
            reason: '$file 出现了 "$token" —— 凭据一旦进日志就无法撤回（规格 §10.3）',
          );
        }
      }
    });

    test('凭据对象的 toString 一律脱敏（脱敏是"顺手打日志"的最后一道防线）', () {
      for (final String file in <String>[
        'lib/domain/models/bind_credential.dart',
        'lib/domain/models/campus_web_entry.dart',
        'lib/domain/models/campus_card.dart',
      ]) {
        final String code = stripComments(readSource(file));
        expect(
          code.contains('<redacted>'),
          isTrue,
          reason: '$file 里没有脱敏实现',
        );
      }
    });
  });

  group('不存在任何凭据落盘路径', () {
    test('techpie 源码里没有本地存储 / 文件写入', () {
      for (final String file in techpieSources()) {
        final String code = stripComments(readSource(file));
        for (final String token in <String>[
          'SharedPreferences',
          'FlutterSecureStorage',
          'SecureStorage',
          'writeAsString',
          'writeAsBytes',
          'setString(',
          'dart:io',
        ]) {
          expect(
            code.contains(token),
            isFalse,
            reason: '$file 出现了 "$token" —— 本模块零持久化',
          );
        }
      }
    });
  });

  group('不存在 CASTGC / 校园会话落库路径（契约 §11.18-D）', () {
    test('源码里没有 CASTGC / tgc / 会话密文字段', () {
      for (final String file in techpieSources()) {
        final String code = stripComments(readSource(file)).toLowerCase();
        for (final String token in <String>[
          'castgc',
          'tgc',
          'sessioncipher',
          'tokencipher',
          'cpdailycookies',
          'hasCpdailyBinding'.toLowerCase(),
        ]) {
          expect(
            code.contains(token),
            isFalse,
            reason: '$file 出现了 "$token" —— 在信息办书面批准前不许有会话落库路径',
          );
        }
      }
    });

    test('没有明文口令绑定的写法（U12：在信息办回复前不实现）', () {
      for (final String file in techpieSources()) {
        final String code = stripComments(readSource(file)).toLowerCase();
        for (final String token in <String>[
          'password',
          'passwd',
          'studentid'
        ]) {
          expect(
            code.contains(token),
            isFalse,
            reason: '$file 出现了 "$token" —— Phase 0 只允许免口令通道',
          );
        }
      }
    });
  });

  group('不实现 Phase 1–3', () {
    test('没有 Phase 1+ 的端点路径', () {
      for (final String file in techpieSources()) {
        final String code = stripComments(readSource(file));
        for (final String token in <String>[
          "'schedule/",
          "'facility/",
          "'techpie/sync-jobs",
          'gradescope/',
          'hydro/',
          'gym/',
        ]) {
          expect(
            code.contains(token),
            isFalse,
            reason: '$file 出现了 Phase 1+ 的端点 "$token"',
          );
        }
      }
    });

    test('没有自动续期（Phase 3）：没有定时器、没有后台续期方法', () {
      for (final String file in techpieSources()) {
        final String code = stripComments(readSource(file));
        for (final String token in <String>[
          'Timer.periodic',
          'Timer(',
          'renewInBackground',
          'autoRenew',
          'scheduleRenew',
          'cron',
        ]) {
          expect(
            code.contains(token),
            isFalse,
            reason: '$file 出现了自动续期相关代码 "$token" —— 那属于 Phase 3',
          );
        }
      }
    });

    test('能力目录里的 Phase 1–3 项都是 notImplemented（不谎称可用）', () {
      final String fixtures = stripComments(
        readSource('lib/data/mock/techpie_fixtures.dart'),
      );
      // 与 `services/api` 的 `TECHPIE_CAPABILITIES` 逐条对齐：7 + 4 + 2 = 13。
      expect(
          RegExp('phase: CampusCapabilityPhase.phase0')
              .allMatches(fixtures)
              .length,
          7);
      expect(
          RegExp('phase: CampusCapabilityPhase.phase1')
              .allMatches(fixtures)
              .length,
          4);
      expect(
          RegExp('phase: CampusCapabilityPhase.phase2')
              .allMatches(fixtures)
              .length,
          2);
      expect(
          RegExp('phase: CampusCapabilityPhase.phase3')
              .allMatches(fixtures)
              .length,
          0);
    });
  });

  group('domain 层零框架依赖（契约 §7 硬规则 1）', () {
    test('本模块新增的 domain 文件只 import 相对路径（没有 package:flutter）', () {
      for (final String file in <String>[
        'lib/domain/models/techpie_link.dart',
        'lib/domain/models/campus_capability.dart',
        'lib/domain/models/campus_web_entry.dart',
        'lib/domain/models/bind_credential.dart',
        'lib/domain/models/campus_card.dart',
        'lib/domain/ports/techpie_port.dart',
        'lib/domain/ports/campus_card_port.dart',
        'lib/domain/ports/webview_port.dart',
      ]) {
        final String code = stripComments(readSource(file));
        expect(code.contains('package:flutter'), isFalse, reason: file);
        expect(code.contains('package:dio'), isFalse, reason: file);
        expect(code.contains('package:flutter_riverpod'), isFalse,
            reason: file);
        expect(code.contains('dart:io'), isFalse, reason: file);
      }
    });
  });
}
