import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_router.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/data/mock/mock_activities_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/features/activities/application/activities_providers.dart';
import 'package:kedaya/features/activities/presentation/pages/activity_history_import_page.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

/// 历史消息页批量导入。
///
/// 这组测试只覆盖 **UI 的三条判据**，不重复验证 HTML 解析：
/// 解析逻辑在 `@kedaya/shared` 有 12 例、在 API 有 4 例，
/// 这里换成 mock 仓库（只判空），测的是「页面在什么情况下给什么反馈」。
void main() {
  final DateTime now = DateTime.utc(2026, 11, 22);

  MockActivitiesRepository buildRepo() => MockActivitiesRepository(
        controls: MockControls(latency: Duration.zero),
        clock: () => now,
      );

  Future<void> pumpPage(
    WidgetTester tester,
    MockActivitiesRepository repository,
  ) async {
    tester.view.physicalSize = const Size(1200, 3000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    addTearDown(runtime.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          appRuntimeProvider.overrideWithValue(runtime),
          activitiesRepositoryProvider.overrideWithValue(repository),
          activitiesClockProvider.overrideWithValue(() => now),
        ],
        child: MaterialApp(
          theme: KedaYaTheme.light(),
          home: const ActivityHistoryImportPage(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('空输入时解析给出可操作的提示，且不出现导入按钮', (WidgetTester tester) async {
    await pumpPage(tester, buildRepo());

    await tester.tap(find.text('解析出文章列表'));
    await tester.pumpAndSettle();

    expect(find.textContaining('粘贴'), findsWidgets);
    expect(find.textContaining('导入选中的'), findsNothing);
  });

  testWidgets('解析成功后默认只勾主条，副条不勾', (WidgetTester tester) async {
    await pumpPage(tester, buildRepo());

    await tester.enterText(
      find.byKey(const Key('history-html')),
      '<html><script>var msgList = "{}";</script></html>',
    );
    await tester.tap(find.text('解析出文章列表'));
    await tester.pumpAndSettle();

    // mock 给三条：两条主条 + 一条副条。
    expect(find.text('关于举办 2026 年校园马拉松的通知'), findsOneWidget);
    expect(find.text('名师讲坛：大模型与程序分析'), findsOneWidget);
    expect(find.text('2026 春季学期选课安排'), findsOneWidget);
    expect(find.text('已选 2 / 3'), findsOneWidget);
  });

  testWidgets('取消勾选后计数跟着变，全不勾时提示至少勾一篇', (WidgetTester tester) async {
    await pumpPage(tester, buildRepo());

    await tester.enterText(find.byKey(const Key('history-html')), 'page');
    await tester.tap(find.text('解析出文章列表'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('关于举办 2026 年校园马拉松的通知'));
    await tester.pumpAndSettle();
    expect(find.text('已选 1 / 3'), findsOneWidget);

    await tester.tap(find.text('名师讲坛：大模型与程序分析'));
    await tester.pumpAndSettle();
    expect(find.text('已选 0 / 3'), findsOneWidget);
    expect(find.textContaining('至少勾一篇'), findsOneWidget);
  });

  testWidgets('导入页可以跳到历史消息页，且路由不被 :id 吃掉', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 3000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    addTearDown(runtime.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          appRuntimeProvider.overrideWithValue(runtime),
          activitiesRepositoryProvider.overrideWithValue(buildRepo()),
          activitiesClockProvider.overrideWithValue(() => now),
        ],
        child: MaterialApp.router(
          theme: KedaYaTheme.light(),
          routerConfig: createAppRouter(initialLocation: '/activities/import'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('从「历史消息」页批量导入'));
    await tester.pumpAndSettle();

    // 到了历史页：标题与输入框都在，且没有被解析成活动详情。
    expect(find.text('从历史消息导入'), findsOneWidget);
    expect(find.byKey(const Key('history-html')), findsOneWidget);
  });
}
