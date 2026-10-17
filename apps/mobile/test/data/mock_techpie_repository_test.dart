import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_techpie_repository.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/bind_credential.dart';
import 'package:kedaya/domain/models/campus_capability.dart';
import 'package:kedaya/domain/models/campus_web_entry.dart';
import 'package:kedaya/domain/models/result.dart';
import 'package:kedaya/domain/models/techpie_link.dart';

/// `MockTechpieRepository` 的行为测试（规格 §8.3–§8.6）。
///
/// 重点：
///   - **未绑定 → `CAMPUS_BINDING_REQUIRED`（409），不是 `UNAUTHENTICATED`（401）**；
///   - 一次性票据：**只能成功兑换一次**，且 30 秒后失效；
///   - 目标地址白名单在 mock 里也 **fail-closed**（服务端侧校验的镜像）；
///   - 传进来的凭据**不留在仓库里**（`debugDumpStrings()` 可断言）。
void main() {
  final DateTime base = DateTime.utc(2026, 10, 17, 2);

  MockTechpieRepository repo({
    MockControls? controls,
    DateTime Function()? clock,
    bool renewSupported = true,
  }) =>
      MockTechpieRepository(
        controls: controls ?? MockControls(latency: Duration.zero),
        clock: clock ?? () => base,
        renewSupported: renewSupported,
      );

  String? reasonOf(Result<Object?> result) {
    final Object? details = result.errorOrNull?.details;
    if (details is Map<String, Object?>) return details['reason'] as String?;
    return null;
  }

  group('listLinks', () {
    test('返回种子绑定，按 id 稳定排序，且只含元数据', () async {
      final Result<List<TechpieLink>> result = await repo().listLinks();
      final List<TechpieLink> links = result.unwrap;
      expect(links.map((TechpieLink link) => link.id).toList(),
          <String>['tp-1001', 'tp-1002']);
      expect(links.first.platform, CampusPlatform.cpdaily);
      expect(links.first.status, CampusBindingStatus.linked);
      expect(links.last.status, CampusBindingStatus.expired);
      for (final TechpieLink link in links) {
        final String dump = link.toJson().toString().toLowerCase();
        for (final String token in <String>[
          'cookie',
          'session',
          'tgc',
          'ticket',
          'tenant'
        ]) {
          expect(dump.contains(token), isFalse,
              reason: '${link.id} 泄漏了 "$token"');
        }
      }
    });

    test('三态开关：空列表与故障注入', () async {
      final MockControls controls = MockControls(latency: Duration.zero);
      final MockTechpieRepository repository = repo(controls: controls);

      controls.emptyResults = true;
      expect((await repository.listLinks()).unwrap, isEmpty);

      controls.emptyResults = false;
      controls.failureMode = MockFailureMode.upstreamUnavailable;
      final Result<List<TechpieLink>> failed = await repository.listLinks();
      expect(failed.errorOrNull?.code, ApiErrorCode.upstreamUnavailable);
    });
  });

  group('bind', () {
    test('cas 不是可绑定的校园系统 → VALIDATION_FAILED / UNKNOWN_PLATFORM', () async {
      final Result<TechpieLink> result = await repo().bind(
        CampusPlatform.cas,
        credential: const OAuthCodeCredential(code: 'c'),
      );
      expect(result.errorOrNull?.code, ApiErrorCode.validationFailed);
      expect(reasonOf(result), 'UNKNOWN_PLATFORM');
    });

    test('凭据形态不完整 → VALIDATION_FAILED（错误信息里也只有脱敏标签）', () async {
      final Result<TechpieLink> result = await repo().bind(
        CampusPlatform.egate,
        credential: const OAuthCodeCredential(code: '   '),
      );
      expect(result.errorOrNull?.code, ApiErrorCode.validationFailed);
      expect(reasonOf(result), 'CREDENTIAL_EMPTY');
      expect(result.errorOrNull?.message, isNot(contains('   ')));
    });

    test('已绑定 → CONFLICT / ALREADY_LINKED', () async {
      final Result<TechpieLink> result = await repo().bind(
        CampusPlatform.cpdaily,
        credential: const OAuthCodeCredential(code: 'code-secret'),
      );
      expect(result.errorOrNull?.code, ApiErrorCode.conflict);
      expect(reasonOf(result), 'ALREADY_LINKED');
    });

    test('已过期的绑定可以重新绑定，复用同一 id，状态回到 LINKED', () async {
      final Result<TechpieLink> result = await repo().bind(
        CampusPlatform.egate,
        credential: const OAuthCodeCredential(code: 'code-secret'),
      );
      final TechpieLink link = result.unwrap;
      expect(link.id, 'tp-1002');
      expect(link.status, CampusBindingStatus.linked);
      expect(link.isUsableAt(base), isTrue);
    });

    test('凭据值不留在仓库里（只消费 isWellFormed）', () async {
      final MockTechpieRepository repository = repo();
      await repository.bind(
        CampusPlatform.egate,
        credential: const OAuthCodeCredential(code: 'super-secret-code-xyz'),
      );
      await repository.bind(
        CampusPlatform.techpie,
        credential: const OpenIdCredential(openId: 'super-secret-openid-xyz'),
      );
      final String dump = repository.debugDumpStrings().join('|');
      expect(dump, isNot(contains('super-secret-code-xyz')));
      expect(dump, isNot(contains('super-secret-openid-xyz')));
      expect(dump.toLowerCase(), isNot(contains('castgc')));
    });
  });

  group('unbind / renew', () {
    test('解绑幂等：未知 id 也算成功', () async {
      final MockTechpieRepository repository = repo();
      expect((await repository.unbind('tp-1001')).isOk, isTrue);
      expect((await repository.unbind('tp-1001')).isOk, isTrue);
      expect((await repository.unbind('not-exist')).isOk, isTrue);
      expect((await repository.listLinks()).unwrap, hasLength(1));
    });

    test('手动续期把 expiresAt 往后推', () async {
      final Result<TechpieLink> result = await repo().renew('tp-1002');
      final TechpieLink renewed = result.unwrap;
      expect(renewed.status, CampusBindingStatus.linked);
      expect(renewed.isUsableAt(base), isTrue);
    });

    test('F3：上游没有续期能力 → CONFLICT / RENEW_NOT_SUPPORTED（不谎称已续期）', () async {
      final Result<TechpieLink> result =
          await repo(renewSupported: false).renew('tp-1001');
      expect(result.errorOrNull?.code, ApiErrorCode.conflict);
      expect(reasonOf(result), 'RENEW_NOT_SUPPORTED');
      expect(
        CampusCapabilityState.fromApiError(result.errorOrNull!),
        CampusCapabilityState.unsupported,
      );
    });

    test('续期不存在的绑定 → NOT_FOUND', () async {
      final Result<TechpieLink> result = await repo().renew('tp-9999');
      expect(result.errorOrNull?.code, ApiErrorCode.notFound);
    });
  });

  group('listCapabilities', () {
    test('返回目录；服务端覆盖只改状态，不改阶段', () async {
      final MockTechpieRepository repository = MockTechpieRepository(
        controls: MockControls(latency: Duration.zero),
        clock: () => base,
        serverStates: const <String, CampusCapabilityState>{
          'webview.ecourse': CampusCapabilityState.upstreamUnavailable,
        },
      );
      final List<CampusCapability> items =
          (await repository.listCapabilities()).unwrap;
      final CampusCapability webview = items.firstWhere(
        (CampusCapability item) => item.id == 'webview.ecourse',
      );
      expect(webview.state, CampusCapabilityState.upstreamUnavailable);
      expect(webview.phase, CampusCapabilityPhase.phase0);
      // Phase 1 的项即使被服务端标成 available 也仍然不是 Phase 0。
      final CampusCapability timetable = items.firstWhere(
        (CampusCapability item) => item.id == 'schedule.courses',
      );
      expect(timetable.phase, CampusCapabilityPhase.phase1);
      expect(timetable.phase.isImplemented, isFalse);
    });
  });

  group('createWebViewSession', () {
    test('非 https → VALIDATION_FAILED', () async {
      final Result<WebViewTicket> result = await repo().createWebViewSession(
        platform: CampusPlatform.cpdaily,
        targetUrl: 'http://ecourse.shanghaitech.edu.cn/',
      );
      expect(result.errorOrNull?.code, ApiErrorCode.validationFailed);
      expect(reasonOf(result), 'TARGET_URL_MUST_BE_HTTPS');
    });

    test('非白名单域名 → FORBIDDEN / TARGET_URL_NOT_ALLOWED', () async {
      final Result<WebViewTicket> result = await repo().createWebViewSession(
        platform: CampusPlatform.cpdaily,
        targetUrl: 'https://evil.example.com/',
      );
      expect(result.errorOrNull?.code, ApiErrorCode.forbidden);
      expect(reasonOf(result), 'TARGET_URL_NOT_ALLOWED');
    });

    test('未绑定（或已过期）→ 409 CAMPUS_BINDING_REQUIRED（不是 401）', () async {
      final Result<WebViewTicket> result = await repo().createWebViewSession(
        platform: CampusPlatform.egate,
        targetUrl: 'https://egate.shanghaitech.edu.cn/',
      );
      expect(result.errorOrNull?.code, ApiErrorCode.campusBindingRequired);
      expect(result.errorOrNull?.code, isNot(ApiErrorCode.unauthenticated));
      expect(reasonOf(result), 'CAMPUS_BINDING_REQUIRED');
    });

    test('不传 platform（W4 直连）→ **不要求绑定**也能拿到票据', () async {
      final MockTechpieRepository repository = repo();
      final Result<WebViewTicket> result =
          await repository.createWebViewSession(
        targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
      );
      final WebViewTicket ticket = result.unwrap;
      expect(ticket.platform, isNull);
      expect(ticket.expiresInSec, 30);
      expect(ticket.toString(), contains('none'));
      // 未绑定的平台也能换到票：这正是 Phase 0 的 W4（用户自登录）。
      expect((await repository.redeemWebViewTicket(ticket)).isOk, isTrue);
    });

    test('已绑定 → 一次性票据，30 秒时效', () async {
      final WebViewTicket ticket = (await repo().createWebViewSession(
        platform: CampusPlatform.cpdaily,
        targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
      ))
          .unwrap;
      expect(ticket.expiresInSec, 30);
      expect(ticket.platform, CampusPlatform.cpdaily);
      expect(ticket.ticket, isNotEmpty);
      expect(ticket.toString(), isNot(contains(ticket.ticket)));
    });
  });

  group('redeemWebViewTicket', () {
    test('第一次成功，第二次 TICKET_ALREADY_USED（防重放）', () async {
      final MockTechpieRepository repository = repo();
      final WebViewTicket ticket = (await repository.createWebViewSession(
        platform: CampusPlatform.cpdaily,
        targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
      ))
          .unwrap;

      final Result<WebViewHandoff> first =
          await repository.redeemWebViewTicket(ticket);
      expect(first.isOk, isTrue);
      expect(first.unwrap.targetUrl, 'https://ecourse.shanghaitech.edu.cn/');
      expect(first.unwrap.toString(), isNot(contains(ticket.ticket)));

      final Result<WebViewHandoff> second =
          await repository.redeemWebViewTicket(ticket);
      expect(second.errorOrNull?.code, ApiErrorCode.conflict);
      expect(reasonOf(second), 'TICKET_ALREADY_USED');
      expect(repository.debugConsumedTicketCount, 1);
    });

    test('伪造票据 → NOT_FOUND', () async {
      final WebViewTicket forged = WebViewTicket(
        ticket: 'wvt-forged',
        expiresInSec: 30,
        targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
        platform: CampusPlatform.cpdaily,
      );
      final Result<WebViewHandoff> result =
          await repo().redeemWebViewTicket(forged);
      expect(result.errorOrNull?.code, ApiErrorCode.notFound);
      expect(reasonOf(result), 'TICKET_NOT_FOUND');
    });

    test('超过 30 秒 → TICKET_EXPIRED', () async {
      DateTime now = base;
      final MockTechpieRepository repository = repo(clock: () => now);
      final WebViewTicket ticket = (await repository.createWebViewSession(
        platform: CampusPlatform.cpdaily,
        targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
      ))
          .unwrap;

      now = base.add(const Duration(seconds: 31));
      final Result<WebViewHandoff> result =
          await repository.redeemWebViewTicket(ticket);
      expect(result.errorOrNull?.code, ApiErrorCode.conflict);
      expect(reasonOf(result), 'TICKET_EXPIRED');
    });
  });
}
