import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/mock_campus_card_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/campus_card.dart';
import 'package:kedaya/domain/models/page.dart';
import 'package:kedaya/domain/models/result.dart';

/// `MockCampusCardRepository` 的行为测试（规格 §2.5：**独立 OPENID 通道**）。
///
/// 本文件要钉死两条：
///   1. 未开通 → **409 `CAMPUS_BINDING_REQUIRED`**（不是 401 `UNAUTHENTICATED`）——
///      用户可能已经登录，缺的只是开通校园卡；
///   2. 这条通道**与校园会话代持无关**：全程不产生任何会话凭据，
///      OPENID 与付款码都不留在仓库里。
void main() {
  final DateTime base = DateTime.utc(2026, 10, 17, 2);

  MockCampusCardRepository repo({
    CampusCardLinkState? initialState,
    MockControls? controls,
  }) =>
      MockCampusCardRepository(
        initialState: initialState,
        controls: controls ?? MockControls(latency: Duration.zero),
        clock: () => base,
      );

  String? reasonOf(Result<Object?> result) {
    final Object? details = result.errorOrNull?.details;
    if (details is Map<String, Object?>) return details['reason'] as String?;
    return null;
  }

  group('未开通时的引导（CAMPUS_BINDING_REQUIRED，不是 UNAUTHENTICATED）', () {
    test('linkStatus 返回 unlinked，而不是抛错', () async {
      final CampusCardLink link = (await repo().linkStatus()).unwrap;
      expect(link.state, CampusCardLinkState.unlinked);
      expect(link.state.isUsable, isFalse);
      expect(link.openIdTail, isNull);
    });

    test('余额 / 流水 / 付款码都返回 409 CAMPUS_BINDING_REQUIRED', () async {
      final MockCampusCardRepository repository = repo();

      final Result<CampusCardAccount> account = await repository.account();
      expect(account.errorOrNull?.code, ApiErrorCode.campusBindingRequired);
      expect(account.errorOrNull?.code, isNot(ApiErrorCode.unauthenticated));
      expect(reasonOf(account), 'CAMPUS_BINDING_REQUIRED');

      final Result<Page<CampusCardTransaction>> transactions =
          await repository.listTransactions();
      expect(
          transactions.errorOrNull?.code, ApiErrorCode.campusBindingRequired);

      final Result<CampusPaymentCode> code = await repository.paymentCode();
      expect(code.errorOrNull?.code, ApiErrorCode.campusBindingRequired);
    });

    test('已过期的绑定给出"重新开通"文案，且与"从未开通"是两种状态', () async {
      final Result<CampusCardAccount> expired = await repo(
        initialState: CampusCardLinkState.expired,
      ).account();
      expect(expired.errorOrNull?.code, ApiErrorCode.campusBindingRequired);
      expect(expired.errorOrNull?.message, contains('过期'));
      expect(CampusCardLinkState.expired.needsRebind, isTrue);
      expect(CampusCardLinkState.unlinked.needsRebind, isFalse);
    });
  });

  group('connect / disconnect', () {
    test('空 OPENID → VALIDATION_FAILED', () async {
      final Result<CampusCardLink> result = await repo().connect(openId: '   ');
      expect(result.errorOrNull?.code, ApiErrorCode.validationFailed);
      expect(reasonOf(result), 'CREDENTIAL_EMPTY');
    });

    test('开通成功：只留脱敏尾巴，OPENID 本身不留在仓库里', () async {
      final MockCampusCardRepository repository = repo();
      final CampusCardLink link = (await repository.connect(
        openId: 'openid-super-secret-9876',
      ))
          .unwrap;
      expect(link.state, CampusCardLinkState.linked);
      expect(link.channel, 'wechat');
      expect(link.openIdTail, '****9876');
      expect(link.isUsableAt(base), isTrue);

      final String dump = repository.debugDumpStrings().join('|');
      expect(dump, isNot(contains('openid-super-secret-9876')));
      expect(dump.toLowerCase(), isNot(contains('castgc')));
      expect(dump.toLowerCase(), isNot(contains('cookie')));
    });

    test('解绑幂等，回到未开通', () async {
      final MockCampusCardRepository repository = repo();
      await repository.connect(openId: 'openid-abcdef-9876');
      expect((await repository.disconnect()).isOk, isTrue);
      expect((await repository.disconnect()).isOk, isTrue);
      expect((await repository.linkStatus()).unwrap.state,
          CampusCardLinkState.unlinked);
      expect((await repository.account()).errorOrNull?.code,
          ApiErrorCode.campusBindingRequired);
    });
  });

  group('开通后的余额 / 流水 / 付款码', () {
    test('余额是整数分，卡号已脱敏', () async {
      final MockCampusCardRepository repository = repo();
      await repository.connect(openId: 'openid-abcdef-1234');
      final CampusCardAccount account = (await repository.account()).unwrap;
      expect(account.balanceFen, isA<int>());
      expect(account.cardNumberMasked, contains('1234'));
      expect(account.cardNumberMasked, isNot(contains('622588013777')));
    });

    test('流水游标分页不重不漏', () async {
      final MockCampusCardRepository repository = repo(
        initialState: CampusCardLinkState.linked,
      );
      final Page<CampusCardTransaction> first =
          (await repository.listTransactions(
        limit: 2,
      ))
              .unwrap;
      expect(first.items, hasLength(2));
      expect(first.nextCursor, 'tx-2');

      final Page<CampusCardTransaction> second =
          (await repository.listTransactions(
        cursor: first.nextCursor,
        limit: 2,
      ))
              .unwrap;
      expect(second.items, hasLength(2));
      expect(second.nextCursor, isNull);

      final Set<String> ids = <String>{
        ...first.items.map((CampusCardTransaction item) => item.id),
        ...second.items.map((CampusCardTransaction item) => item.id),
      };
      expect(ids, hasLength(4), reason: '两页之间不该重复');

      // 损坏的游标容错：回到第一页，而不是整页失败。
      final Page<CampusCardTransaction> broken =
          (await repository.listTransactions(
        cursor: 'not-a-cursor',
        limit: 1,
      ))
              .unwrap;
      expect(broken.items, hasLength(1));
      expect(broken.items.first.id, first.items.first.id);
    });

    test('空流水（三态的 empty）', () async {
      final MockControls controls = MockControls(latency: Duration.zero);
      final MockCampusCardRepository repository = repo(
        initialState: CampusCardLinkState.linked,
        controls: controls,
      );
      controls.emptyResults = true;
      expect((await repository.listTransactions()).unwrap.items, isEmpty);
    });

    test('付款码：60 秒时效、toString 脱敏、不落任何字段', () async {
      final MockCampusCardRepository repository = repo(
        initialState: CampusCardLinkState.linked,
      );
      final CampusPaymentCode code = (await repository.paymentCode()).unwrap;
      expect(code.code, isNotEmpty);
      expect(code.refreshAfterSec, 60);
      expect(code.expiresAt, base.add(const Duration(seconds: 60)));
      expect(code.isExpiredAt(base), isFalse);
      expect(code.toString(), isNot(contains(code.code)));

      final String dump = repository.debugDumpStrings().join('|');
      expect(dump, isNot(contains(code.code)), reason: '付款码不许留在仓库里');

      // 两次取码得到不同的码（现取现给）。
      final CampusPaymentCode again = (await repository.paymentCode()).unwrap;
      expect(again.code, isNot(code.code));
    });

    test('故障注入：上游不可用', () async {
      final MockControls controls = MockControls(latency: Duration.zero);
      final MockCampusCardRepository repository = repo(
        initialState: CampusCardLinkState.linked,
        controls: controls,
      );
      controls.failureMode = MockFailureMode.upstreamUnavailable;
      expect(
        (await repository.account()).errorOrNull?.code,
        ApiErrorCode.upstreamUnavailable,
      );
    });
  });
}
