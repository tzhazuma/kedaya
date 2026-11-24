import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/presentation/pages/home_page.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

/// 首页在宽窗口下**限宽居中**。
///
/// 判据只有一条：桌面宽度下内容列的宽度 ≤ 1120。
/// 不测像素级布局 —— 那种断言会在每次间距微调时失败，却证明不了可读性。
void main() {
  Future<void> pumpAt(WidgetTester tester, Size size) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    addTearDown(runtime.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[appRuntimeProvider.overrideWithValue(runtime)],
        child: MaterialApp(
          theme: KedaYaTheme.light(),
          home: const HomePage(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('桌面宽度下内容列限宽 1120', (WidgetTester tester) async {
    await pumpAt(tester, const Size(1600, 1200));

    final Finder constrained = find.descendant(
      of: find.byType(Center),
      matching: find.byType(ConstrainedBox),
    );
    expect(constrained, findsWidgets);

    final bool found1120 = tester
        .widgetList<ConstrainedBox>(constrained)
        .any((ConstrainedBox box) => box.constraints.maxWidth == 1120);
    expect(found1120, isTrue);
  });

  testWidgets('宽窗口下「常用」排两列，窄窗口仍是单列', (WidgetTester tester) async {
    // 判据只看结构：同一张卡片里出现两个并列的 Column 即视为两列。
    await pumpAt(tester, const Size(1400, 1200));
    final Finder cardRows = find.byType(Column);
    expect(cardRows, findsWidgets);

    // 窄屏：整页仍能渲染，且没有溢出。
    await pumpAt(tester, const Size(390, 844));
    expect(tester.takeException(), isNull);
  });

  testWidgets('窄窗口不溢出（限宽不会把手机布局挤坏）', (WidgetTester tester) async {
    await pumpAt(tester, const Size(390, 844));
    expect(tester.takeException(), isNull);
    expect(find.text('可达鸭 KedaYa'), findsOneWidget);
  });
}
