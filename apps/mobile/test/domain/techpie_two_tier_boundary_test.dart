import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/mock_auth_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_techpie_repository.dart';
import 'package:kedaya/domain/ports/auth_port.dart';
import 'package:kedaya/domain/ports/techpie_port.dart';

import '../support/source_scan.dart';

/// **两级身份的 Port 边界**测试（契约 §5 / §11.4 的 I2；§11.18-F）。
///
/// 契约 §5 硬规则 1/2 说得很清楚：一级身份（"你是谁"）与二级绑定
/// （"你能访问哪些校园系统"）必须是**两个独立的 port**。
/// ADR §2.2 的教训是："一个只有文档保护的边界，在一次紧急修 bug 时就会消失。"
/// 因此这里用**类型层面**与**源码层面**两道机械约束把它钉死。
void main() {
  group('类型层面：两个 port 互不兼容', () {
    test('二级实现不是一级端口，一级实现也不是二级端口', () {
      final Object level2 = MockTechpieRepository(
        controls: MockControls(latency: Duration.zero),
      );
      final Object level1 = MockAuthRepository(
        controls: MockControls(latency: Duration.zero),
      );

      expect(level2 is AuthPort, isFalse, reason: '二级绑定端口不得同时是一级身份端口');
      expect(level1 is TechpiePort, isFalse, reason: '一级身份端口不得同时是二级绑定端口');
      expect(level1 is AuthPort, isTrue);
      expect(level2 is TechpiePort, isTrue);
    });

    test('两个 port 声明的方法名集合不相交', () {
      final Set<String> authMethods = _declaredMethodNames(
        stripComments(readSource('lib/domain/ports/auth_port.dart')),
      );
      final Set<String> techpieMethods = _declaredMethodNames(
        stripComments(readSource('lib/domain/ports/techpie_port.dart')),
      );

      expect(authMethods, contains('signInWithUnifiedIdentity'));
      expect(authMethods, contains('refresh'));
      expect(techpieMethods, contains('listLinks'));
      expect(techpieMethods, contains('bind'));
      expect(
        authMethods.intersection(techpieMethods),
        isEmpty,
        reason: '两个 port 出现了同名方法：$authMethods ∩ $techpieMethods',
      );
    });

    test('校园会话串的唯一出口只在 CampusSessionPort 上', () {
      final String sessionPort = stripComments(
        readSource('lib/domain/ports/campus_session_port.dart'),
      );
      expect(sessionPort.contains('cookieHeaderFor'), isTrue);
      // 本模块的端口**不许**有第二个出口（契约 §11.4 I3）。
      expect(
        stripComments(readSource('lib/domain/ports/techpie_port.dart'))
            .contains('cookieHeaderFor'),
        isFalse,
      );
      expect(
        stripComments(readSource('lib/domain/ports/campus_card_port.dart'))
            .contains('cookieHeaderFor'),
        isFalse,
      );
      expect(
        stripComments(readSource('lib/domain/ports/webview_port.dart'))
            .contains('cookieHeaderFor'),
        isFalse,
      );
    });
  });

  group('源码层面：装配层之外没有文件同时看到两个 port', () {
    test('除 lib/app/ 外，没有任何文件同时 import auth_port 与 techpie_port', () {
      final List<String> violations = <String>[];
      for (final String file in dartSourcesUnder('lib')) {
        if (file.startsWith('lib/app/')) continue; // 装配点是唯一的例外
        final String source = readSource(file);
        if (importsFragment(source, 'auth_port.dart') &&
            importsFragment(source, 'techpie_port.dart')) {
          violations.add(file);
        }
      }
      expect(
        violations,
        isEmpty,
        reason: '这些文件能同时看到两级身份，也就有机会把它们混进一个对象：$violations',
      );
    });

    test('这个例外是真的被用到的（装配点确实同时接了两个端口）', () {
      final String providers = readSource('lib/app/app_providers.dart');
      expect(importsFragment(providers, 'auth_port.dart'), isTrue);
      expect(importsFragment(providers, 'techpie_port.dart'), isTrue);
      expect(importsFragment(providers, 'campus_card_port.dart'), isTrue);
    });

    test('techpie 的 feature 目录不 import 任何身份/会话端口', () {
      final List<String> files = dartSourcesUnder('lib/features/techpie');
      expect(files, isNotEmpty);
      for (final String file in files) {
        final String source = readSource(file);
        expect(
          importsFragment(source, 'auth_port.dart'),
          isFalse,
          reason: '$file 直接依赖了一级身份端口（应经 application 层的会话控制器）',
        );
        expect(
          importsFragment(source, 'campus_session_port.dart'),
          isFalse,
          reason: '$file 直接依赖了校园会话端口（Phase 0 不接触会话）',
        );
        expect(
          importsFragment(source, 'credential_store_port.dart'),
          isFalse,
          reason: '$file 依赖了凭据存储端口（本模块不落任何凭据）',
        );
      }
    });

    test('presentation 通过 application 层的会话控制器读身份', () {
      final String page = readSource(
        'lib/features/techpie/presentation/pages/techpie_capabilities_page.dart',
      );
      expect(importsFragment(page, 'session_controller.dart'), isTrue);
      expect(importsFragment(page, 'auth_port.dart'), isFalse);
      // 两条出路分别指向两个不同的动作源：绑定页（二级）与登录（一级）。
      expect(page.contains("'/techpie/bindings'"), isTrue);
      expect(page.contains('signIn()'), isTrue);
    });
  });

  group('port 源码里没有对方的词汇', () {
    test('techpie_port 的代码里没有身份概念', () {
      final String code = stripComments(
        readSource('lib/domain/ports/techpie_port.dart'),
      ).toLowerCase();
      for (final String token in <String>[
        'authport',
        'accesstoken',
        'refreshtoken',
        'jwt',
        'signout',
        'cookie',
        'tgc',
        'castgc',
      ]) {
        expect(code.contains(token), isFalse, reason: 'techpie_port 出现了 "$token"');
      }
    });

    test('auth_port 的代码里没有绑定/会话概念', () {
      final String code = stripComments(
        readSource('lib/domain/ports/auth_port.dart'),
      ).toLowerCase();
      for (final String token in <String>[
        'cookie',
        'tgc',
        'castgc',
        'ticket',
        'tenant',
        'campusbinding',
        'techpielink',
        'techpieport',
      ]) {
        expect(code.contains(token), isFalse, reason: 'auth_port 出现了 "$token"');
      }
    });
  });
}

/// 声明里的方法名（形如 `Future<X> name(...)` / `X name(...)`）。
///
/// 只用于断言"两个 port 的能力集不相交"，因此保守实现即可：
/// 取每一行里紧跟在标识符后的 `(`。
Set<String> _declaredMethodNames(String source) {
  final RegExp pattern = RegExp(
    r'^\s+[A-Za-z_][\w<>,\?\[\]\s]*\s(\w+)\s*\(',
    multiLine: true,
  );
  return pattern
      .allMatches(source)
      .map((RegExpMatch match) => match.group(1)!)
      .toSet();
}
