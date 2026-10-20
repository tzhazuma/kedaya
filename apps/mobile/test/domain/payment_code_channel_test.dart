import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/campus_card.dart';
import 'package:kedaya/domain/models/result.dart';
import 'package:kedaya/features/techpie/domain/payment_code_channel.dart';
import 'package:kedaya/features/techpie/domain/payment_code_port.dart';

import '../support/source_scan.dart';

/// 原生端「校园卡付款码通道」的领域测试
/// （评估文档：`docs/features/techpie-native-payment-code.md`）。
///
/// 重点不是"能解析"，而是三条**不许被实现细节悄悄破坏**的承诺：
///
///   1. 三态里只有 `available` 能出码，而它只可能来自正式签发者；
///   2. 被阻塞时返回的是**结构化错误**，`Result` 里永远没有码；
///   3. 本领域层**不联网、不做 DNS、不落盘**（源码扫描兜底）。
void main() {
  final CampusPaymentCode sampleCode = CampusPaymentCode(
    code: '4821',
    expiresAt: DateTime.utc(2026, 10, 20, 10),
    refreshAfterSec: 60,
  );

  group('PaymentCodeChannelState：三态封闭', () {
    test('wire 值逐字一致，且恰好三个状态', () {
      expect(
        PaymentCodeChannelState.values
            .map((PaymentCodeChannelState item) => item.wire)
            .toSet(),
        <String>{'NOT_CONFIGURED', 'REQUIRES_BINDING', 'AVAILABLE'},
      );
    });

    test('fromWire 忽略大小写与空白；未知 / 空串 fail-closed 到 notConfigured', () {
      expect(PaymentCodeChannelState.fromWire(' available '),
          PaymentCodeChannelState.available);
      expect(PaymentCodeChannelState.fromWire('REQUIRES_BINDING'),
          PaymentCodeChannelState.requiresBinding);
      expect(PaymentCodeChannelState.fromWire('whatever'),
          PaymentCodeChannelState.notConfigured);
      expect(PaymentCodeChannelState.fromWire(''),
          PaymentCodeChannelState.notConfigured);
      // 未知值绝不收敛成"可用"。
      expect(PaymentCodeChannelState.fromWire('available?'),
          isNot(PaymentCodeChannelState.available));
    });

    test('只有 available 可用；三个状态的 label 与 guidance 互不相同', () {
      expect(PaymentCodeChannelState.available.isUsable, isTrue);
      expect(PaymentCodeChannelState.notConfigured.isUsable, isFalse);
      expect(PaymentCodeChannelState.requiresBinding.isUsable, isFalse);

      final Set<String> labels = PaymentCodeChannelState.values
          .map((PaymentCodeChannelState item) => item.label)
          .toSet();
      final Set<String> guidance = PaymentCodeChannelState.values
          .map((PaymentCodeChannelState item) => item.guidance)
          .toSet();
      expect(labels.length, 3);
      expect(guidance.length, 3);
      for (final PaymentCodeChannelState state
          in PaymentCodeChannelState.values) {
        expect(state.guidance.trim(), isNotEmpty, reason: state.wire);
      }
    });
  });

  group('PaymentCodeChannel：两种阻塞态的表达', () {
    test('notConfigured 的默认值来自服务端的结构化事实', () {
      const PaymentCodeChannel channel = PaymentCodeChannel.notConfigured();
      expect(channel.state, PaymentCodeChannelState.notConfigured);
      expect(channel.reason, paymentCodeNotWiredReason);
      expect(channel.blockedBy, <String>['U7', 'U11']);
      expect(channel.upstreamReady, isFalse);
      expect(channel.isUsable, isFalse);
    });

    test('requiresBinding 是 409（已登录缺开通），不是 401（未登录）', () {
      const PaymentCodeChannel channel = PaymentCodeChannel.requiresBinding();
      final ApiError error = channel.toApiError();
      expect(error.code, ApiErrorCode.campusBindingRequired);
      expect(error.code, isNot(ApiErrorCode.unauthenticated));
      expect(error.needsCampusBinding, isTrue);
      expect(error.userMessage, isNotEmpty);
    });

    test('toApiError：notConfigured 是 503 + 机器可读的 details', () {
      const PaymentCodeChannel channel = PaymentCodeChannel.notConfigured();
      final ApiError error = channel.toApiError();
      expect(error.code, ApiErrorCode.upstreamUnavailable);

      final Map<String, Object?> details =
          error.details! as Map<String, Object?>;
      expect(details['reason'], 'CAMPUS_CARD_PAYMENT_CODE_NOT_WIRED');
      expect(details['upstreamReady'], isFalse);
      expect(details['blockedBy'], <String>['U7', 'U11']);
      // 文案必须诚实：明说不会给假码。
      expect(error.message, contains('假'));
    });

    test('available 没有错误可表达 —— 用它表达失败是编程错误', () {
      const PaymentCodeChannel channel = PaymentCodeChannel.available();
      expect(channel.isUsable, isTrue);
      expect(channel.toApiError, throwsStateError);
    });

    test('toJson 的键是封闭集合（没有凭据、没有 URL）', () {
      final Map<String, Object?> json =
          const PaymentCodeChannel.notConfigured().toJson();
      expect(json.keys.toSet(),
          <String>{'state', 'reason', 'blockedBy', 'upstreamReady'});
    });
  });

  group('tryFromApiError：从服务端错误还原通道状态', () {
    test('往返一致：toApiError → tryFromApiError 得到等价对象', () {
      const PaymentCodeChannel notConfigured =
          PaymentCodeChannel.notConfigured();
      const PaymentCodeChannel requiresBinding =
          PaymentCodeChannel.requiresBinding();
      expect(
        PaymentCodeChannel.tryFromApiError(notConfigured.toApiError()),
        notConfigured,
      );
      expect(
        PaymentCodeChannel.tryFromApiError(requiresBinding.toApiError()),
        requiresBinding,
      );
    });

    test('503 + upstreamReady:false（带 reason / blockedBy）→ notConfigured 且保留细节',
        () {
      final ApiError error = ApiError(
        code: ApiErrorCode.upstreamUnavailable,
        message: '',
        details: const <String, Object?>{
          'reason': 'CAMPUS_CARD_PAYMENT_CODE_NOT_WIRED',
          'upstreamReady': false,
          'blockedBy': <String>['U7'],
        },
      );
      final PaymentCodeChannel? channel =
          PaymentCodeChannel.tryFromApiError(error);
      expect(channel, isNotNull);
      expect(channel!.state, PaymentCodeChannelState.notConfigured);
      expect(channel.reason, 'CAMPUS_CARD_PAYMENT_CODE_NOT_WIRED');
      expect(channel.blockedBy, <String>['U7']);
    });

    test('503 没有 details → 用默认原因（不把缺失当成"可用"）', () {
      final PaymentCodeChannel? channel = PaymentCodeChannel.tryFromApiError(
        const ApiError(
          code: ApiErrorCode.upstreamUnavailable,
          message: '',
        ),
      );
      expect(channel, isNotNull);
      expect(channel!.reason, paymentCodeNotWiredReason);
      expect(channel.blockedBy, isEmpty);
    });

    test('503 但 upstreamReady:true → null（通道是通的，只是这次调用失败）', () {
      final PaymentCodeChannel? channel = PaymentCodeChannel.tryFromApiError(
        const ApiError(
          code: ApiErrorCode.upstreamUnavailable,
          message: '',
          details: <String, Object?>{
            'upstreamReady': true,
            'reason': 'UPSTREAM_TIMEOUT',
          },
        ),
      );
      expect(channel, isNull);
    });

    test('401 / 429 / 500 等不表达通道状态 → null（401 属于一级身份）', () {
      for (final ApiErrorCode code in <ApiErrorCode>[
        ApiErrorCode.unauthenticated,
        ApiErrorCode.forbidden,
        ApiErrorCode.notFound,
        ApiErrorCode.validationFailed,
        ApiErrorCode.rateLimited,
        ApiErrorCode.conflict,
        ApiErrorCode.consentRequired,
        ApiErrorCode.internal,
      ]) {
        expect(
          PaymentCodeChannel.tryFromApiError(
            ApiError(code: code, message: ''),
          ),
          isNull,
          reason: '${code.wire} 被错误地当成了通道状态',
        );
      }
    });

    test('任何错误码都不可能被还原成 available', () {
      for (final ApiErrorCode code in ApiErrorCode.values) {
        final PaymentCodeChannel? channel = PaymentCodeChannel.tryFromApiError(
          ApiError(code: code, message: ''),
        );
        expect(channel?.state, isNot(PaymentCodeChannelState.available),
            reason: '${code.wire} 把通道"还原"成了可用');
      }
    });
  });

  group('GatedPaymentCodeChannel：被阻塞时绝不返回码', () {
    test('notConfigured → Err(503)，Result 里没有码', () async {
      final GatedPaymentCodeChannel port =
          GatedPaymentCodeChannel.notConfigured();
      final Result<CampusPaymentCode> result = await port.issuePaymentCode();

      expect(result.isErr, isTrue);
      expect(result.valueOrNull, isNull);
      expect(result.errorOrNull!.code, ApiErrorCode.upstreamUnavailable);
      expect(
        (result.errorOrNull!.details! as Map<String, Object?>)['reason'],
        paymentCodeNotWiredReason,
      );
    });

    test('requiresBinding → Err(409)，且不触发任何签发', () async {
      final GatedPaymentCodeChannel port =
          GatedPaymentCodeChannel.requiresBinding();
      final Result<CampusPaymentCode> result = await port.issuePaymentCode();

      expect(result.isErr, isTrue);
      expect(result.valueOrNull, isNull);
      expect(result.errorOrNull!.code, ApiErrorCode.campusBindingRequired);
    });

    test('重复调用仍然每次都是 Err（不会"第二次就给码"）', () async {
      final GatedPaymentCodeChannel port =
          GatedPaymentCodeChannel.notConfigured();
      for (int attempt = 0; attempt < 3; attempt++) {
        final Result<CampusPaymentCode> result = await port.issuePaymentCode();
        expect(result.isErr, isTrue, reason: '第 $attempt 次调用返回了码');
        expect(result.valueOrNull, isNull);
      }
    });

    test('official：唯一的 Ok 路径 —— 来自注入的正式签发者', () async {
      final _FakeIssuer issuer = _FakeIssuer(Ok<CampusPaymentCode>(sampleCode));
      final GatedPaymentCodeChannel port =
          GatedPaymentCodeChannel.official(issuer: issuer);

      expect(port.channel.state, PaymentCodeChannelState.available);
      final Result<CampusPaymentCode> result = await port.issuePaymentCode();
      expect(result.valueOrNull, same(sampleCode));
      expect(issuer.calls, 1);
    });

    test('official：签发者的失败原样上抛（不被包装成"通道未配置"）', () async {
      final ApiError upstream = const ApiError(
        code: ApiErrorCode.upstreamUnavailable,
        message: '上游超时',
        details: <String, Object?>{'upstreamReady': true},
      );
      final GatedPaymentCodeChannel port = GatedPaymentCodeChannel.official(
        issuer: _FakeIssuer(Err<CampusPaymentCode>(upstream)),
      );

      final Result<CampusPaymentCode> result = await port.issuePaymentCode();
      expect(result.isErr, isTrue);
      expect(result.valueOrNull, isNull);
      expect(result.errorOrNull, same(upstream));
    });

    test('official：上游给了空码 → Err，绝不把空串当条码展示', () async {
      final CampusPaymentCode empty = CampusPaymentCode(
        code: '   ',
        expiresAt: DateTime.utc(2026, 10, 20, 10),
      );
      final GatedPaymentCodeChannel port = GatedPaymentCodeChannel.official(
        issuer: _FakeIssuer(Ok<CampusPaymentCode>(empty)),
      );

      final Result<CampusPaymentCode> result = await port.issuePaymentCode();
      expect(result.isErr, isTrue);
      expect(result.valueOrNull, isNull);
      expect(
        (result.errorOrNull!.details! as Map<String, Object?>)['reason'],
        paymentCodeEmptyReason,
      );
    });

    test('付款码对象的 toString 仍然脱敏（领域层不新增泄漏点）', () {
      expect(sampleCode.toString(), isNot(contains('4821')));
      expect(sampleCode.toString(), contains('redacted'));
    });
  });

  group('源码扫描：本层不联网 / 不做 DNS / 不落盘', () {
    List<String> domainSources() {
      final List<String> files =
          dartSourcesUnder('lib/features/techpie/domain');
      expect(files.length, greaterThanOrEqualTo(2),
          reason: '领域层文件没被扫到，扫描会静默通过');
      return files;
    }

    test('两个领域文件都存在且非空', () {
      for (final String file in domainSources()) {
        expect(readSource(file).trim(), isNotEmpty, reason: file);
      }
    });

    test('没有网络 / DNS / VPN / 平台通道 / 持久化 / 日志调用', () {
      for (final String file in domainSources()) {
        final String code = stripComments(readSource(file));
        for (final String token in <String>[
          'dart:io',
          'dart:ffi',
          'package:dio',
          'HttpClient',
          'Socket',
          'Uri.parse',
          'VpnService',
          'MethodChannel',
          'NetworkExtension',
          'Process.run',
          'SharedPreferences',
          'FlutterSecureStorage',
          'writeAsString',
          'print(',
          'debugPrint(',
          'Timer(',
        ]) {
          expect(
            code.contains(token),
            isFalse,
            reason: '$file 出现了 "$token" —— 本层只描述能力与状态，不许有 IO',
          );
        }
      }
    });

    test('领域层零框架依赖（只 import 相对路径）', () {
      for (final String file in domainSources()) {
        final String code = stripComments(readSource(file));
        for (final String token in <String>[
          'package:flutter',
          'package:flutter_riverpod',
          'package:dio',
        ]) {
          expect(code.contains(token), isFalse, reason: '$file 依赖了 $token');
        }
        // 唯一的 package: 依赖是测试/工具链之外不该出现的；
        // 领域层只允许相对 import 与 dart:core 隐式导入。
        expect(code.contains('package:kedaya'), isFalse, reason: file);
      }
    });

    test('领域层里没有"可用"的硬编码：available 只由 official 构造', () {
      final String port = stripComments(
        readSource('lib/features/techpie/domain/payment_code_port.dart'),
      );
      // `available` 在端口文件里只出现一次（official 工厂），
      // 任何"默认可用"的写法都会让计数变化。
      expect(
        RegExp('PaymentCodeChannel.available\\(\\)').allMatches(port).length,
        1,
      );
    });
  });
}

/// 假的正式签发者：只用于证明"Ok 只有一个来源"。
final class _FakeIssuer implements PaymentCodeIssuer {
  _FakeIssuer(this._result);

  final Result<CampusPaymentCode> _result;
  int calls = 0;

  @override
  Future<Result<CampusPaymentCode>> issue() async {
    calls++;
    return _result;
  }
}
