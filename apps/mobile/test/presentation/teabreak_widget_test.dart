import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_router.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_teabreak_repository.dart';
import 'package:kedaya/data/mock/teabreak_fixtures.dart';
import 'package:kedaya/domain/models/teabreak.dart';
import 'package:kedaya/features/teabreak/application/teabreak_providers.dart';
import 'package:kedaya/features/teabreak/presentation/pages/teabreak_compose_page.dart';
import 'package:kedaya/features/teabreak/presentation/pages/teabreak_list_page.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

/// 茶歇页面的组件测试。
///
/// 重点不是"能画出来"，而是三件产品承诺：
///   1. 排序按「值不值得现在跑一趟」，不是按时间；
///   2. 时效**可见**（fresh / stale / over / notStarted 四种文案都在）；
///   3. 空态解释这个功能是干什么的，且「确认还有」真的会改状态。
void main() {
  // 本地 2026-10-22 14:00 —— 下午两点，`notStarted` 那条会落在今天 15:30。
  final DateTime now = DateTime(2026, 10, 22, 14, 0);

  MockTeabreakRepository buildRepo({MockControls? controls}) =>
      MockTeabreakRepository(
        teabreaks: buildMockTeabreaks(now),
        controls: controls ?? MockControls(latency: Duration.zero),
        clock: () => now,
      );

  Future<void> pump(
    WidgetTester tester,
    Widget page, {
    MockTeabreakRepository? repo,
    ThemeData? theme,
  }) async {
    tester.view.physicalSize = const Size(1200, 3000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    addTearDown(runtime.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          appRuntimeProvider.overrideWithValue(runtime),
          teabreakRepositoryProvider.overrideWithValue(repo ?? buildRepo()),
          teabreakClockProvider.overrideWithValue(() => now),
        ],
        child: MaterialApp(
          theme: theme ?? KedaYaTheme.light(),
          home: page,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  group('列表页', () {
    testWidgets('按 sortTeabreaks 的顺序渲染四条，且时效文案齐全', (WidgetTester tester) async {
      await pump(tester, const TeabreakListPage());

      // 顺序：fresh → stale → notStarted → over。
      final List<String> titles = <String>[
        '第七届信息科学前沿论坛',
        '物质科学前沿研讨会',
        '人工智能与教育创新论坛',
        '生命科学青年学者论坛',
      ];
      final List<double> tops = <double>[
        for (final String title in titles)
          tester.getTopLeft(find.text(title)).dy,
      ];
      for (int i = 1; i < tops.length; i++) {
        expect(tops[i], greaterThan(tops[i - 1]),
            reason: '${titles[i]} 应该排在 ${titles[i - 1]} 之后');
      }

      // 四种时效各出现一次。
      expect(find.text('刚确认还有'), findsOneWidget);
      expect(find.text('20 分钟没人确认了'), findsOneWidget);
      expect(find.text('还没开始'), findsOneWidget);
      expect(find.text('已结束'), findsWidgets); // 徽章 + 「已结束」倒计时

      // 「还有 X 分钟结束」与地点、access 标签。
      expect(find.text('还有 15 分钟结束'), findsOneWidget);
      expect(find.text('还有 30 分钟结束'), findsOneWidget);
      expect(find.text('还有 1 小时 30 分钟开始'), findsOneWidget);
      expect(find.text('信息学院 1-101'), findsOneWidget);
      expect(find.text('对外开放（不需注册）'), findsNWidgets(2));
      expect(find.text('仅限注册参会者'), findsOneWidget);
      expect(find.text('不确定'), findsOneWidget);

      // 已结束的条目没有「确认还有」按钮。
      expect(find.text('确认还有'), findsNWidgets(3));
    });

    testWidgets('点「确认还有」→ 该条变 fresh，排序立刻重算', (WidgetTester tester) async {
      final MockTeabreakRepository repo = buildRepo();
      await pump(tester, const TeabreakListPage(), repo: repo);

      expect(find.text('20 分钟没人确认了'), findsOneWidget);
      // 第二个按钮属于 tb-1002（stale 那条）。
      await tester.tap(find.text('确认还有').at(1));
      await tester.pumpAndSettle();

      expect(repo.debugById('tb-1002')!.confirms.length, 2);
      expect(find.text('20 分钟没人确认了'), findsNothing);
      expect(find.text('刚确认还有'), findsNWidgets(2));
      expect(find.textContaining('已确认还有'), findsOneWidget); // SnackBar
    });

    testWidgets('空态解释功能用途（不是一句「暂无数据」）', (WidgetTester tester) async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..emptyResults = true;
      await pump(tester, const TeabreakListPage(), repo: buildRepo(controls: controls));

      expect(find.text('还没有人报茶歇'), findsOneWidget);
      expect(find.textContaining('这个功能用来共享校内学术会议的茶歇'), findsOneWidget);
      expect(find.textContaining('第一条信息可能就来自你'), findsOneWidget);
      // 页首说明卡在空态下仍然可见：新用户得知道这是干什么的。
      expect(find.text('现在哪栋楼有点心？'), findsOneWidget);
    });

    testWidgets('上游故障 → 错误态（不是空态）', (WidgetTester tester) async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable;
      await pump(tester, const TeabreakListPage(), repo: buildRepo(controls: controls));

      expect(find.text('还没有人报茶歇'), findsNothing);
      expect(find.textContaining('暂时不可用'), findsWidgets);
      expect(find.text('重试'), findsOneWidget);
    });

    testWidgets('暗色主题下同样可用（颜色全部来自设计令牌）', (WidgetTester tester) async {
      await pump(
        tester,
        const TeabreakListPage(),
        theme: KedaYaTheme.dark(),
      );

      expect(find.text('第七届信息科学前沿论坛'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('路由', () {
    testWidgets('/teabreak 路由指向列表页', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1200, 3000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
      addTearDown(runtime.dispose);

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            appRuntimeProvider.overrideWithValue(runtime),
            teabreakRepositoryProvider.overrideWithValue(buildRepo()),
            teabreakClockProvider.overrideWithValue(() => now),
          ],
          child: MaterialApp.router(
            routerConfig: createAppRouter(initialLocation: '/teabreak'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(TeabreakListPage), findsOneWidget);
      expect(find.text('学术会议茶歇'), findsOneWidget); // AppBar
      expect(find.text('报一个茶歇'), findsOneWidget); // FAB
    });
  });

  group('新建页', () {
    testWidgets('默认时间窗合法：只填名字和地点就能发布', (WidgetTester tester) async {
      final MockTeabreakRepository repo = buildRepo();
      await pump(tester, const TeabreakComposePage(), repo: repo);

      await tester.enterText(find.byType(TextField).at(0), '计算生物学论坛');
      await tester.enterText(find.byType(TextField).at(1), '生命学院 4-102');
      await tester.tap(find.text('发布'));
      await tester.pumpAndSettle();

      expect(repo.debugLength, 5);
      final Teabreak created = repo.debugById('tb-9100')!;
      expect(created.conferenceName, '计算生物学论坛');
      expect(created.venue, '生命学院 4-102');
      expect(created.postedBy, mockTeabreakPosterName);
      // 默认茶歇在 45 分钟后开始 → 新条目是 notStarted。
      expect(
        created.statusAt(now).freshness,
        TeabreakFreshness.notStarted,
      );
    });

    testWidgets('access 选择会带进草稿', (WidgetTester tester) async {
      final MockTeabreakRepository repo = buildRepo();
      await pump(tester, const TeabreakComposePage(), repo: repo);

      await tester.enterText(find.byType(TextField).at(0), '计算生物学论坛');
      await tester.enterText(find.byType(TextField).at(1), '生命学院 4-102');
      await tester.tap(find.text('仅限注册参会者'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('发布'));
      await tester.pumpAndSettle();

      expect(
        repo.debugById('tb-9100')!.access,
        TeabreakAccess.registered,
      );
    });

    testWidgets('不合法草稿：显示具体问题，且不写入', (WidgetTester tester) async {
      final MockTeabreakRepository repo = buildRepo();
      await pump(tester, const TeabreakComposePage(), repo: repo);

      await tester.tap(find.text('发布'));
      await tester.pumpAndSettle();

      expect(find.textContaining('会议名称至少 3 个字'), findsOneWidget);
      expect(find.textContaining('地点至少 2 个字'), findsOneWidget);
      expect(repo.debugLength, 4);
    });

    testWidgets('暗色主题下同样可用', (WidgetTester tester) async {
      await pump(
        tester,
        const TeabreakComposePage(),
        theme: KedaYaTheme.dark(),
      );

      expect(find.text('报一个茶歇'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
