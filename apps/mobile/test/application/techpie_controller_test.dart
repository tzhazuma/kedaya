import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/data/mock/mock_auth_repository.dart';
import 'package:kedaya/data/mock/mock_campus_card_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_techpie_repository.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/auth_session.dart';
import 'package:kedaya/domain/models/bind_credential.dart';
import 'package:kedaya/domain/models/campus_capability.dart';
import 'package:kedaya/domain/models/campus_card.dart';
import 'package:kedaya/domain/models/campus_web_entry.dart';
import 'package:kedaya/domain/models/techpie_link.dart';
import 'package:kedaya/domain/models/user.dart';
import 'package:kedaya/features/techpie/application/techpie_providers.dart';

/// techpie 的 application 层测试（三态 + 用例编排 + 两级身份的分流）。
///
/// 这里**同时**接了两个 provider：一级身份（`authProvider`）与二级绑定
/// （`techpieRepositoryProvider`）—— 它们是两个独立对象，
/// 页面拿到的永远是两份数据，而不是一个合并体（契约 §5）。
void main() {
  final DateTime base = DateTime.utc(2026, 10, 17, 2);

  AuthSession session() => AuthSession(
    user: const User(
      userId: 'u-1001',
      studentId: '20240001',
      displayName: '可达鸭测试账号',
      department: '信息科学与技术学院',
      email: 'test@shanghaitech.edu.cn',
    ),
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    issuedAt: base,
    expiresAt: base.add(const Duration(hours: 2)),
  );

  /// 与墙上时钟解耦的种子绑定：`cpdaily` 的有效期远在未来，
  /// 因此 `resolveCampusCapabilities`（它用 `DateTime.now()` 判定）不会随运行日期漂移。
  List<TechpieLink> seededLinks() => <TechpieLink>[
    TechpieLink(
      id: 'tp-1001',
      summary: CampusBindingSummary(
        platform: CampusPlatform.cpdaily,
        status: CampusBindingStatus.linked,
        externalUserId: '20240001',
        expiresAt: DateTime.utc(2099),
        lastSyncAt: base,
      ),
    ),
    TechpieLink(
      id: 'tp-1002',
      summary: CampusBindingSummary(
        platform: CampusPlatform.egate,
        status: CampusBindingStatus.expired,
        externalUserId: '20240001',
        expiresAt: DateTime.utc(2000),
        lastSyncAt: base,
      ),
    ),
  ];

  ProviderContainer container({
    bool signedIn = true,
    MockControls? techpieControls,
    MockCampusCardRepository? campusCard,
    bool renewSupported = true,
  }) {
    final ProviderContainer created = ProviderContainer(
      overrides: <Override>[
        techpieRepositoryProvider.overrideWithValue(
          MockTechpieRepository(
            links: seededLinks(),
            controls: techpieControls ?? MockControls(latency: Duration.zero),
            clock: () => base,
            renewSupported: renewSupported,
          ),
        ),
        campusCardRepositoryProvider.overrideWithValue(
          campusCard ??
              MockCampusCardRepository(
                controls: MockControls(latency: Duration.zero),
                clock: () => base,
              ),
        ),
        authProvider.overrideWithValue(
          MockAuthRepository(
            session: signedIn ? session() : null,
            controls: MockControls(latency: Duration.zero),
          ),
        ),
      ],
    );
    addTearDown(created.dispose);
    return created;
  }

  group('绑定列表控制器', () {
    test('三态：先 loading，再 data', () async {
      final ProviderContainer c = container();
      expect(
        c.read(techpieLinksControllerProvider),
        isA<AsyncLoading<List<TechpieLink>>>(),
      );
      final List<TechpieLink> links = await c.read(
        techpieLinksControllerProvider.future,
      );
      expect(links, hasLength(2));
      expect(c.read(techpieLinksControllerProvider).hasValue, isTrue);
    });

    test('失败态：上游不可用（错误码原样上抛给 UI）', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable;
      final ProviderContainer c = container(techpieControls: controls);
      await expectLater(
        c.read(techpieLinksControllerProvider.future),
        throwsA(
          isA<ApiException>().having(
            (ApiException error) => error.code,
            'code',
            ApiErrorCode.upstreamUnavailable,
          ),
        ),
      );
      expect(c.read(techpieLinksControllerProvider).hasError, isTrue);
    });

    test('refresh 重新拉取（空列表 → empty 态由 UI 渲染）', () async {
      final MockControls controls = MockControls(latency: Duration.zero);
      final ProviderContainer c = container(techpieControls: controls);
      await c.read(techpieLinksControllerProvider.future);
      controls.emptyResults = true;
      await c.read(techpieLinksControllerProvider.notifier).refresh();
      expect(c.read(techpieLinksControllerProvider).valueOrNull, isEmpty);
    });
  });

  group('写操作（TechpieActions 不持有 Ref）', () {
    test('解绑后列表失效并重新拉取', () async {
      final ProviderContainer c = container();
      await c.read(techpieLinksControllerProvider.future);
      await c.read(techpieActionsProvider).unbind('tp-1001');
      final List<TechpieLink> links = await c.read(
        techpieLinksControllerProvider.future,
      );
      expect(links.map((TechpieLink link) => link.id).toList(), <String>['tp-1002']);
    });

    test('手动续期把过期绑定救回来', () async {
      final ProviderContainer c = container();
      final TechpieLink renewed = await c.read(techpieActionsProvider).renew('tp-1002');
      expect(renewed.status, CampusBindingStatus.linked);
      expect(renewed.isUsableAt(base), isTrue);
    });

    test('F3：上游没有续期能力 → 抛 CONFLICT（页面显示"暂不可用"，不谎称已续期）', () async {
      final ProviderContainer c = container(renewSupported: false);
      await expectLater(
        c.read(techpieActionsProvider).renew('tp-1001'),
        throwsA(
          isA<ApiException>().having(
            (ApiException error) => error.code,
            'code',
            ApiErrorCode.conflict,
          ),
        ),
      );
    });

    test('绑定成功后列表里出现新平台（免口令凭据）', () async {
      final ProviderContainer c = container();
      await c.read(techpieLinksControllerProvider.future);
      final TechpieLink bound = await c
          .read(techpieActionsProvider)
          .bind(CampusPlatform.egate, const OAuthCodeCredential(code: 'test-code'));
      expect(bound.status, CampusBindingStatus.linked);
      final List<TechpieLink> links = await c.read(
        techpieLinksControllerProvider.future,
      );
      expect(links, hasLength(2));
      expect(
        links.every((TechpieLink link) => link.status == CampusBindingStatus.linked),
        isTrue,
      );
    });
  });

  group('能力清单：两种不同的出路', () {
    test('已登录 + cpdaily 已绑定 → 可用 / 需绑定 / 未实现 三种并存', () async {
      final ProviderContainer c = container();
      final List<CampusCapability> items = await c.read(
        campusCapabilitiesProvider.future,
      );

      CampusCapability of(String id) =>
          items.firstWhere((CampusCapability item) => item.id == id);

      expect(of('webview.ecourse').state, CampusCapabilityState.available);
      expect(of('webview.ecourse').isUsable, isTrue);
      expect(of('ecard.balance').state, CampusCapabilityState.bindingRequired);
      expect(of('ecard.balance').needsSignIn, isFalse);
      expect(of('schedule.courses').state, CampusCapabilityState.notImplemented);
      expect(of('schedule.courses').isUsable, isFalse);
    });

    test('未登录 → 全部 Phase 0 项都是 UNAUTHENTICATED（引导登录，不是引导绑定）', () async {
      final ProviderContainer c = container(signedIn: false);
      final List<CampusCapability> items = await c.read(
        campusCapabilitiesProvider.future,
      );
      final List<CampusCapability> phase0 = items
          .where((CampusCapability item) => item.phase.isImplemented)
          .toList(growable: false);
      expect(phase0, isNotEmpty);
      for (final CampusCapability item in phase0) {
        expect(item.state, CampusCapabilityState.unauthenticated, reason: item.id);
        expect(item.needsBinding, isFalse, reason: item.id);
        expect(item.needsSignIn, isTrue, reason: item.id);
      }
    });

    test('校园卡走独立 OPENID 通道：开通后校园卡能力变成可用', () async {
      final MockCampusCardRepository card = MockCampusCardRepository(
        initialState: CampusCardLinkState.linked,
        controls: MockControls(latency: Duration.zero),
        clock: () => base,
      );
      final ProviderContainer c = container(campusCard: card);
      final List<CampusCapability> items = await c.read(
        campusCapabilitiesProvider.future,
      );
      final CampusCapability balance = items.firstWhere(
        (CampusCapability item) => item.id == 'ecard.balance',
      );
      expect(balance.state, CampusCapabilityState.available);
    });
  });

  group('校园卡控制器', () {
    test('未开通不是错误：快照里 isLinked=false，且没有错误态', () async {
      final ProviderContainer c = container();
      final CampusCardSnapshot snapshot = await c.read(
        campusCardControllerProvider.future,
      );
      expect(snapshot.isLinked, isFalse);
      expect(snapshot.needsOpen, isTrue);
      expect(snapshot.account, isNull);
      expect(c.read(campusCardControllerProvider).hasError, isFalse);
    });

    test('开通 → 余额 + 流水；付款码单独走 autoDispose provider', () async {
      final ProviderContainer c = container();
      await c
          .read(campusCardControllerProvider.notifier)
          .connect(openId: 'openid-abcdef-9876');
      final CampusCardSnapshot snapshot =
          c.read(campusCardControllerProvider).valueOrNull!;
      expect(snapshot.isLinked, isTrue);
      expect(snapshot.account, isNotNull);
      expect(snapshot.transactions, hasLength(4));

      final CampusPaymentCode code = await c.read(campusPaymentCodeProvider.future);
      expect(code.code, isNotEmpty);
      expect(code.isExpiredAt(base), isFalse);
    });

    test('故障注入 → 错误态', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable;
      final ProviderContainer c = container(
        campusCard: MockCampusCardRepository(controls: controls, clock: () => base),
      );
      await expectLater(
        c.read(campusCardControllerProvider.future),
        throwsA(isA<ApiException>()),
      );
    });
  });

  group('直连入口目录', () {
    test('Phase 0 的四个入口都通过客户端白名单校验', () {
      final ProviderContainer c = container();
      final List<CampusWebEntry> entries = c.read(campusWebEntriesProvider);
      expect(entries, hasLength(4));
      for (final CampusWebEntry entry in entries) {
        expect(entry.isTargetUrlAllowed, isTrue, reason: entry.id);
      }
    });
  });
}
