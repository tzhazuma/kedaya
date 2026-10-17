import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/data/mock/mock_auth_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/domain/models/auth_session.dart';
import 'package:kedaya/domain/models/campus_capability.dart';
import 'package:kedaya/domain/models/techpie_link.dart';
import 'package:kedaya/domain/models/user.dart';
import 'package:kedaya/features/techpie/presentation/components/techpie_cards.dart';
import 'package:kedaya/features/techpie/presentation/pages/campus_card_page.dart';
import 'package:kedaya/features/techpie/presentation/pages/techpie_bindings_page.dart';
import 'package:kedaya/features/techpie/presentation/pages/techpie_capabilities_page.dart';
import 'package:kedaya/features/techpie/presentation/pages/techpie_home_page.dart';
import 'package:kedaya/features/techpie/presentation/pages/techpie_webview_page.dart';
import 'package:kedaya/presentation/components/state_views.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

/// techpie 的组件/页面测试。
///
/// 最重要的不是"能画出来"，而是：
///   - **未绑定**显示的是**引导**（"去绑定"），**不是**错误态；
///   - **未登录**显示的是另一条引导（"去登录"）；
///   - 亮/暗两套主题下都不抛异常（颜色全部来自设计令牌）；
///   - 页面上不出现任何凭据值。
void main() {
  final DateTime base = DateTime.utc(2026, 10, 17, 2);

  AuthSession session() => AuthSession(
        user: const User(
          userId: 'u-1001',
          studentId: '20240001',
          displayName: '可达鸭测试账号',
          department: '信息学院',
          email: 'test@shanghaitech.edu.cn',
        ),
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        issuedAt: base,
        expiresAt: base.add(const Duration(hours: 2)),
      );

  Future<void> pumpPage(
    WidgetTester tester,
    Widget page, {
    ThemeData? theme,
    bool signedIn = false,
  }) async {
    // 放大视口：断言不该因为"控件在折叠线下"而失败。
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    addTearDown(runtime.dispose);

    final List<Override> overrides = <Override>[
      appRuntimeProvider.overrideWithValue(runtime),
    ];
    if (signedIn) {
      overrides.add(
        authProvider.overrideWithValue(
          MockAuthRepository(
            session: session(),
            controls: MockControls(latency: Duration.zero),
          ),
        ),
      );
    }

    await tester.pumpWidget(
      ProviderScope(
        overrides: overrides,
        child: MaterialApp(theme: theme ?? KedaYaTheme.light(), home: page),
      ),
    );
    await tester.pumpAndSettle();
  }

  group('CampusCapabilityTile：两种状态给两条不同的出路', () {
    const CampusCapability needsBinding = CampusCapability(
      id: 'campus-card.balance',
      title: '校园卡余额',
      description: '余额查询',
      phase: CampusCapabilityPhase.phase0,
      platform: CampusPlatform.ecard,
      state: CampusCapabilityState.bindingRequired,
    );

    const CampusCapability needsSignIn = CampusCapability(
      id: 'techpie.webview',
      title: '校园系统直连',
      description: 'WebView 直连',
      phase: CampusCapabilityPhase.phase0,
      platform: CampusPlatform.cpdaily,
      state: CampusCapabilityState.unauthenticated,
    );

    testWidgets('未绑定：显示 CAMPUS_BINDING_REQUIRED 与"去绑定"，没有错误态', (tester) async {
      for (final ThemeData theme in <ThemeData>[
        KedaYaTheme.light(),
        KedaYaTheme.dark(),
      ]) {
        await tester.pumpWidget(
          MaterialApp(
            theme: theme,
            home: Scaffold(
              body: CampusCapabilityTile(
                capability: needsBinding,
                onGuide: () {},
                guideLabel: '去绑定',
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('CAMPUS_BINDING_REQUIRED'), findsOneWidget);
        expect(find.text('去绑定'), findsOneWidget);
        expect(find.byType(KedaYaErrorState), findsNothing);
        expect(find.textContaining('这不是错误'), findsOneWidget);
        expect(find.textContaining('已登录'), findsWidgets);
        expect(tester.takeException(), isNull);
      }
    });

    testWidgets('未登录：显示 UNAUTHENTICATED 与"去登录"（与上一条不是同一个状态）', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: KedaYaTheme.dark(),
          home: Scaffold(
            body: CampusCapabilityTile(
              capability: needsSignIn,
              onGuide: () {},
              guideLabel: '去登录',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('UNAUTHENTICATED'), findsOneWidget);
      expect(find.text('去登录'), findsOneWidget);
      expect(find.text('去绑定'), findsNothing);
      expect(find.byType(KedaYaErrorState), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Phase 1 的能力标注"未实现"并写清阻塞在谁身上', (tester) async {
      const CampusCapability notImplemented = CampusCapability(
        id: 'schedule.timetable',
        title: '课表',
        description: '需要结构化调用',
        phase: CampusCapabilityPhase.phase1,
        platform: CampusPlatform.cpdaily,
        state: CampusCapabilityState.notImplemented,
      );
      await tester.pumpWidget(
        MaterialApp(
          theme: KedaYaTheme.light(),
          home:
              Scaffold(body: CampusCapabilityTile(capability: notImplemented)),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('NOT_IMPLEMENTED'), findsOneWidget);
      expect(find.textContaining('尚未实现'), findsWidgets);
      expect(find.textContaining('信息办'), findsWidgets);
      // 未实现的能力不给"去处理"按钮（不给假出路）。
      expect(find.text('去处理'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });

  group('页面：亮暗两套 + 三态齐全', () {
    testWidgets('能力清单页（已登录）：需绑定项显示引导，不显示错误态', (tester) async {
      await pumpPage(tester, const TechpieCapabilitiesPage(), signedIn: true);

      expect(find.byType(KedaYaErrorState), findsNothing);
      expect(find.textContaining('共 13 项'), findsOneWidget);
      expect(find.textContaining('需绑定'), findsWidgets);
      expect(find.text('去绑定'), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    testWidgets('能力清单页（未登录）：显示"去登录"而不是"去绑定"', (tester) async {
      await pumpPage(tester, const TechpieCapabilitiesPage(), signedIn: false);

      expect(find.byType(KedaYaErrorState), findsNothing);
      expect(find.text('去登录'), findsWidgets);
      expect(find.text('去绑定'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('能力清单页在暗色主题下同样可用', (tester) async {
      await pumpPage(
        tester,
        const TechpieCapabilitiesPage(),
        signedIn: true,
        theme: KedaYaTheme.dark(),
      );
      expect(tester.takeException(), isNull);
      expect(find.textContaining('共 13 项'), findsOneWidget);
    });

    testWidgets('绑定管理页：展示绑定与"不含凭证"说明，不出现凭据值', (tester) async {
      await pumpPage(tester, const TechpieBindingsPage());

      expect(find.text('CpDaily'), findsOneWidget);
      expect(find.text('eGate'), findsOneWidget);
      expect(find.textContaining('不含任何凭证'), findsWidgets);
      expect(find.text('发起绑定'), findsOneWidget);
      // 凭据值绝不上屏（mock 的模拟授权码也只在点击后才产生）。
      expect(find.textContaining('mock-oauth-code'), findsNothing);
      expect(find.byType(KedaYaErrorState), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('绑定管理页在暗色主题下同样可用', (tester) async {
      await pumpPage(
        tester,
        const TechpieBindingsPage(),
        theme: KedaYaTheme.dark(),
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('WebView 直连页：入口 + 白名单占位提示 + 票据语义', (tester) async {
      await pumpPage(tester, const TechpieWebViewPage());

      expect(find.text('E云课堂'), findsOneWidget);
      expect(find.textContaining('白名单内容是'), findsOneWidget);
      expect(find.textContaining('一次性'), findsWidgets);
      expect(find.text('打开'), findsWidgets);
      expect(find.byType(KedaYaErrorState), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('校园卡页（未登录）：引导登录（不是引导绑定）', (tester) async {
      await pumpPage(tester, const CampusCardPage());

      expect(find.text('还没有登录'), findsOneWidget);
      expect(find.text('去登录'), findsOneWidget);
      expect(find.byType(KedaYaErrorState), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('校园卡页（已登录未开通）：引导走 OPENID 通道', (tester) async {
      await pumpPage(tester, const CampusCardPage(), signedIn: true);

      expect(find.textContaining('尚未开通'), findsOneWidget);
      expect(find.textContaining('OPENID'), findsWidgets);
      expect(find.byType(KedaYaErrorState), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('入口页：两级身份与 Phase 0 范围如实展示', (tester) async {
      await pumpPage(tester, const TechpieHomePage());

      expect(find.textContaining('两级身份'), findsWidgets);
      expect(find.textContaining('一级 · 未登录'), findsOneWidget);
      expect(find.textContaining('本轮范围（Phase 0）'), findsOneWidget);
      expect(find.text('绑定管理'), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    testWidgets('入口页在暗色主题下同样可用', (tester) async {
      await pumpPage(tester, const TechpieHomePage(),
          theme: KedaYaTheme.dark());
      expect(tester.takeException(), isNull);
    });
  });
}
