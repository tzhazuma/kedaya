import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/app/app_router.dart';
import 'package:kedaya/features/zhishu/presentation/pages/zhishu_pages.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

void main() {
  Future<void> pumpPage(WidgetTester tester, Widget page) async {
    tester.view.physicalSize = const Size(1200, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    addTearDown(runtime.dispose);
    await tester.pumpWidget(ProviderScope(
      overrides: <Override>[appRuntimeProvider.overrideWithValue(runtime)],
      child: MaterialApp(theme: KedaYaTheme.light(), home: page),
    ));
    await tester.pumpAndSettle();
  }

  testWidgets('工作台展示五个真实功能入口', (WidgetTester tester) async {
    await pumpPage(tester, const ZhishuHomePage());
    for (final String label in <String>['日报', 'JARVIS', '资料库', '知乎', 'QQ 聊天']) {
      expect(find.textContaining(label), findsWidgets);
    }
    expect(find.textContaining('【演示】'), findsNothing);
  });

  testWidgets('日报展示演示条目与关注话题', (WidgetTester tester) async {
    await pumpPage(tester, const ZhishuDailyPage());
    expect(find.textContaining('【演示】信息论学习路线'), findsOneWidget);
    expect(find.text('固定关注话题'), findsOneWidget);
  });

  testWidgets('JARVIS 本地检索展示引用', (WidgetTester tester) async {
    await pumpPage(tester, const ZhishuJarvisPage());
    await tester.enterText(find.byType(TextField).first, '信息论');
    await tester.tap(find.text('本地检索'));
    await tester.pumpAndSettle();
    expect(find.textContaining('以下答案只来自这些引用'), findsOneWidget);
    expect(find.textContaining('【演示】信息论学习路线'), findsOneWidget);
  });

  testWidgets('资料库可新增资料', (WidgetTester tester) async {
    await pumpPage(tester, const ZhishuMaterialsPage());
    await tester.enterText(find.byType(TextField).at(0), '讲座笔记');
    await tester.enterText(find.byType(TextField).at(1), '分布式系统');
    await tester.tap(find.text('保存资料'));
    await tester.pumpAndSettle();
    expect(find.text('讲座笔记'), findsWidgets);
    expect(find.text('分布式系统'), findsWidgets);
  });

  testWidgets('QQ 文本导入进入消息列表', (WidgetTester tester) async {
    await pumpPage(tester, const ZhishuQqPage());
    await tester.enterText(
      find.byType(TextField).first,
      '2026-11-23 09:30:00 张三\n明天下午两点有讲座',
    );
    await tester.tap(find.text('导入到工作区'));
    await tester.pumpAndSettle();
    expect(find.text('张三'), findsOneWidget);
    expect(find.text('明天下午两点有讲座'), findsWidgets);
  });

  testWidgets('知枢路由可进入五个子页面', (WidgetTester tester) async {
    for (final (String path, String title) in <(String, String)>[
      ('/zhishu', '知枢工作台'),
      ('/zhishu/daily', '知枢日报'),
      ('/zhishu/jarvis', 'JARVIS'),
      ('/zhishu/materials', '资料库'),
      ('/zhishu/zhihu', '知乎推荐与反推荐'),
      ('/zhishu/qq', 'QQ 聊天导入'),
    ]) {
      final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
      addTearDown(runtime.dispose);
      await tester.pumpWidget(ProviderScope(
        overrides: <Override>[appRuntimeProvider.overrideWithValue(runtime)],
        child: MaterialApp.router(
          theme: KedaYaTheme.light(),
          routerConfig: createAppRouter(initialLocation: path),
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.text(title), findsWidgets, reason: path);
    }
  });
}
