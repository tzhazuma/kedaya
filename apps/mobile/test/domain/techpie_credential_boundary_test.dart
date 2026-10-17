import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/bind_credential.dart';
import 'package:kedaya/domain/models/campus_capability.dart';
import 'package:kedaya/domain/models/campus_card.dart';
import 'package:kedaya/domain/models/campus_web_entry.dart';
import 'package:kedaya/domain/models/techpie_link.dart';

import '../support/source_scan.dart';

/// **凭证边界**测试（规格 §8.3 / §10.3；契约 §11.4 的 I1）。
///
/// 三件事必须同时成立：
///   1. 上抛给 UI 的对象里**没有** 8 个禁用键名（键名封闭）；
///   2. 任何凭据对象的 `toString()` 都**脱敏**（"顺手打一行日志"也不泄漏）；
///   3. 票据 / 中转 URL **不进入**上抛对象（否则它就被缓存了）。
void main() {
  const List<String> forbiddenTokens = <String>[
    'cookie',
    'session',
    'tgc',
    'castgc',
    'ticket',
    'tenant',
  ];

  /// 递归收集 JSON 里出现的所有键名。
  Set<String> allKeys(Object? value) {
    final Set<String> keys = <String>{};
    void visit(Object? node) {
      if (node is Map<String, Object?>) {
        for (final MapEntry<String, Object?> entry in node.entries) {
          keys.add(entry.key);
          visit(entry.value);
        }
      } else if (node is List<Object?>) {
        for (final Object? item in node) {
          visit(item);
        }
      }
    }

    visit(value);
    return keys;
  }

  void expectNoForbiddenKeys(String what, Map<String, Object?> json) {
    for (final String key in allKeys(json)) {
      final String lower = key.toLowerCase();
      for (final String token in forbiddenTokens) {
        expect(
          lower.contains(token),
          isFalse,
          reason: '$what 的键 "$key" 命中了禁用词 "$token"（契约 §11.4 I1）',
        );
      }
    }
  }

  group('上抛对象的键名封闭', () {
    test('TechpieLink / CampusBindingSummary', () {
      final TechpieLink link = TechpieLink(
        id: 'tp-1',
        summary: CampusBindingSummary(
          platform: CampusPlatform.cpdaily,
          status: CampusBindingStatus.linked,
          externalUserId: '20240001',
          expiresAt: DateTime.utc(2026, 11, 16),
          lastSyncAt: DateTime.utc(2026, 10, 17),
        ),
      );
      expectNoForbiddenKeys('TechpieLink', link.toJson());
    });

    test('CampusCapability', () {
      const CampusCapability capability = CampusCapability(
        id: 'techpie.webview',
        title: '直连',
        description: 'd',
        phase: CampusCapabilityPhase.phase0,
        platform: CampusPlatform.cpdaily,
        state: CampusCapabilityState.available,
      );
      expectNoForbiddenKeys('CampusCapability', capability.toJson());
    });

    test('CampusCardLink / CampusCardAccount / CampusCardTransaction', () {
      final CampusCardLink link = CampusCardLink(
        state: CampusCardLinkState.linked,
        channel: 'wechat',
        openIdTail: '****a1b2',
        linkedAt: DateTime.utc(2026, 10, 17),
        expiresAt: DateTime.utc(2027, 10, 17),
      );
      expectNoForbiddenKeys('CampusCardLink', link.toJson());

      final CampusCardAccount account = CampusCardAccount(
        holderName: '测试',
        cardNumberMasked: '**** **** **** 1234',
        balanceFen: 100,
        updatedAt: DateTime.utc(2026, 10, 17),
      );
      expectNoForbiddenKeys('CampusCardAccount', account.toJson());

      final CampusCardTransaction transaction = CampusCardTransaction(
        id: 'cc-1',
        merchant: '一食堂',
        amountFen: 1580,
        direction: CampusCardTransactionDirection.debit,
        occurredAt: DateTime.utc(2026, 10, 17),
      );
      expectNoForbiddenKeys('CampusCardTransaction', transaction.toJson());
    });

    test('WebViewTicket 的键名里允许有 ticket（它本身就是票据），但值不进 toString', () {
      final WebViewTicket ticket = WebViewTicket(
        ticket: 'wvt-secret',
        expiresInSec: 30,
        targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
        platform: CampusPlatform.cpdaily,
      );
      // 这个响应**就是**票据，因此键名允许是 ticket；关键是 toString 脱敏。
      expect(ticket.toJson().keys, contains('ticket'));
      expect(ticket.toString(), isNot(contains('wvt-secret')));
    });
  });

  group('BindCredential：类型上就没有口令变体', () {
    test('密封类型只有两个子类（穷尽 switch 能编译 = 没有第三个变体）', () {
      String kindOf(BindCredential credential) => switch (credential) {
            OAuthCodeCredential() => OAuthCodeCredential.kind,
            OpenIdCredential() => OpenIdCredential.kind,
          };
      expect(kindOf(const OAuthCodeCredential(code: 'c')), 'oauth_code');
      expect(kindOf(const OpenIdCredential(openId: 'o')), 'openid');
    });

    test('凭据的 toString / redactedLabel 都不含凭据值', () {
      const OAuthCodeCredential oauth =
          OAuthCodeCredential(code: 'code-secret-1');
      const OpenIdCredential openId =
          OpenIdCredential(openId: 'openid-secret-2');

      expect(oauth.toString(), isNot(contains('code-secret-1')));
      expect(oauth.redactedLabel, isNot(contains('code-secret-1')));
      expect(openId.toString(), isNot(contains('openid-secret-2')));
      expect(openId.redactedLabel, isNot(contains('openid-secret-2')));
      expect(openId.toString(), contains('wechat'));
    });

    test('toWire() 是唯一携带凭据值的出口（形状与规格 §8.5 对齐）', () {
      const OAuthCodeCredential oauth =
          OAuthCodeCredential(code: 'code-secret-1');
      expect(oauth.toWire(), <String, Object?>{
        'kind': 'oauth_code',
        'code': 'code-secret-1',
      });
      const OpenIdCredential openId =
          OpenIdCredential(openId: 'openid-secret-2');
      expect(openId.toWire(), <String, Object?>{
        'kind': 'openid',
        'openId': 'openid-secret-2',
        'channel': 'wechat',
      });
    });

    test('isWellFormed：空值在发请求前就被拦下', () {
      expect(const OAuthCodeCredential(code: '   ').isWellFormed, isFalse);
      expect(const OAuthCodeCredential(code: 'x').isWellFormed, isTrue);
      expect(const OpenIdCredential(openId: '').isWellFormed, isFalse);
      expect(
        const OpenIdCredential(openId: 'x', channel: ' ').isWellFormed,
        isFalse,
      );
    });
  });

  group('付款码脱敏与分组', () {
    test('toString 脱敏；displayCode 只做分组不改凭据', () {
      final CampusPaymentCode code = CampusPaymentCode(
        code: 'ABCD1234EFGH5678',
        expiresAt: DateTime.utc(2026, 10, 17, 2, 1),
        refreshAfterSec: 60,
      );
      expect(code.toString(), isNot(contains('ABCD1234EFGH5678')));
      expect(code.toString(), contains('redacted'));
      expect(code.displayCode, 'ABCD 1234 EFGH 5678');
      expect(
        code.displayCode.replaceAll(' ', ''),
        'ABCD1234EFGH5678',
        reason: '分组不能改变凭据本身',
      );
    });

    test('过期判定可注入时刻', () {
      final DateTime expiresAt = DateTime.utc(2026, 10, 17, 2, 1);
      final CampusPaymentCode code = CampusPaymentCode(
        code: 'X',
        expiresAt: expiresAt,
      );
      expect(code.isExpiredAt(expiresAt.subtract(const Duration(seconds: 1))),
          isFalse);
      expect(code.isExpiredAt(expiresAt), isTrue);
    });

    test('卡号本地兜底脱敏：只留末 4 位', () {
      expect(CampusCardAccount.maskCardNumber('6225880137771234'),
          endsWith('1234'));
      expect(
        CampusCardAccount.maskCardNumber('6225880137771234'),
        isNot(contains('622588013777')),
      );
      expect(CampusCardAccount.maskCardNumber('12'), '****');
    });

    test('OPENID 尾巴：只留末 4 位，短值直接全遮', () {
      expect(CampusCardLink.tailOf('openid-abcdef-9876'), '****9876');
      expect(CampusCardLink.tailOf('abc'), '****');
    });
  });

  group('校园卡模型的容错解析（两端字段名不一致时不崩、也不误判方向）', () {
    test('direction 接受 DEBIT/CREDIT 与脚手架用的 out/in', () {
      expect(
        CampusCardTransactionDirection.fromWire('DEBIT'),
        CampusCardTransactionDirection.debit,
      );
      expect(
        CampusCardTransactionDirection.fromWire('out'),
        CampusCardTransactionDirection.debit,
      );
      expect(
        CampusCardTransactionDirection.fromWire('CREDIT'),
        CampusCardTransactionDirection.credit,
      );
      expect(
        CampusCardTransactionDirection.fromWire('in'),
        CampusCardTransactionDirection.credit,
        reason: '把充值判成支出会让余额看起来一直变少',
      );
      // 未知方向按支出（宁可显示成花销，也不要把支出显示成收入）。
      expect(
        CampusCardTransactionDirection.fromWire('whatever'),
        CampusCardTransactionDirection.debit,
      );
    });

    test('时间字段名两种都接受：occurredAt / happenedAt', () {
      final CampusCardTransaction explicit = CampusCardTransaction.fromJson(
        <String, Object?>{
          'id': 'cc-1',
          'merchant': '一食堂',
          'amountFen': 1580,
          'direction': 'DEBIT',
          'occurredAt': '2026-10-17T02:00:00.000Z',
        },
      );
      expect(explicit.occurredAt, DateTime.utc(2026, 10, 17, 2));
      expect(explicit.signedAmountFen, -1580);

      final CampusCardTransaction scaffolded = CampusCardTransaction.fromJson(
        <String, Object?>{
          'id': 'cc-2',
          'merchant': '校园卡在线充值',
          'amountFen': 20000,
          'direction': 'in',
          'happenedAt': '2026-10-17T03:00:00.000Z',
          'balanceAfterFen': 34500,
        },
      );
      expect(scaffolded.occurredAt, DateTime.utc(2026, 10, 17, 3));
      expect(scaffolded.direction, CampusCardTransactionDirection.credit);
      expect(scaffolded.signedAmountFen, 20000);
    });
  });

  group('票据与中转 URL 不进上抛对象（源码层面）', () {
    test('WebViewLaunchOutcome 的字段集合恰好是 status / entry / problem', () {
      final Set<String> fields = fieldNamesOf(
        readSource('lib/domain/models/campus_web_entry.dart'),
        'WebViewLaunchOutcome',
      );
      expect(fields, <String>{'status', 'entry', 'problem'});
      for (final String name in fields) {
        expect(
          RegExp(r'ticket|url|handoff|code', caseSensitive: false)
              .hasMatch(name),
          isFalse,
          reason: '字段 "$name" 疑似携带票据 / 中转 URL',
        );
      }
    });

    test('TechpieWebViewLauncher 的字段里没有票据 / URL（票据只在栈上）', () {
      final Set<String> fields = fieldNamesOf(
        readSource('lib/features/techpie/application/techpie_providers.dart'),
        'TechpieWebViewLauncher',
      );
      expect(fields, <String>{'port', 'webView', '_clock'});
      for (final String name in fields) {
        expect(
          RegExp(r'ticket|url|handoff', caseSensitive: false).hasMatch(name),
          isFalse,
          reason: '字段 "$name" 会把票据缓存下来',
        );
      }
    });

    test('techpie 源码里不存在"把票据声明成字段"的写法', () {
      final RegExp fieldDeclaration = RegExp(
        r'final\s+WebView(?:Ticket|Handoff)\??\s+\w+\s*;',
      );
      final List<String> files = <String>[
        ...dartSourcesUnder('lib/features/techpie'),
        'lib/domain/models/campus_web_entry.dart',
        'lib/domain/ports/techpie_port.dart',
        'lib/data/repositories/remote_techpie_repository.dart',
        'lib/data/mock/mock_techpie_repository.dart',
        'lib/data/mock/mock_webview_port.dart',
        'lib/platform/method_channel_webview.dart',
      ];
      for (final String file in files) {
        final String code = stripComments(readSource(file));
        expect(
          fieldDeclaration.hasMatch(code),
          isFalse,
          reason: '$file 把票据/中转 URL 声明成了字段（会被缓存）',
        );
      }
    });
  });
}
